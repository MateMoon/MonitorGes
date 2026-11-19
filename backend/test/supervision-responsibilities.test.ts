import Fastify from "fastify";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const memory = vi.hoisted(() => ({ users: [] as any[], logs: [] as string[], fail: false }));
vi.mock("../src/db/prisma.js", () => {
  const selectRow = (row: any, select: any): any => row == null ? null : Object.fromEntries(Object.entries(select).map(([key, value]: [string, any]) => [key, value === true ? structuredClone(row[key]) : Array.isArray(row[key]) ? row[key].map((entry: any) => selectRow(entry, value.select)) : selectRow(row[key], value.select)]));
  const matches = (row: any, where: any = {}) => Object.entries(where).every(([key, value]: [string, any]) => typeof value !== "object" || value === null ? row[key] === value : value.in ? value.in.includes(row[key]) : value.not !== row[key]);
  const prisma: any = {
    usuario: {
      findUnique: vi.fn(async ({ where, select }: any) => selectRow(memory.users.find((entry) => entry.id === where.id), select)),
      findUniqueOrThrow: vi.fn(async ({ where, select }: any) => { const row = memory.users.find((entry) => entry.id === where.id); if (!row) throw new Error("Missing fixture"); return selectRow(row, select); }),
      findMany: vi.fn(async ({ where, select }: any) => { if (memory.fail) throw new Error("PRIVATE_DATABASE_PARAMETERS"); return memory.users.filter((row) => matches(row, where)).map((row) => selectRow(row, select)); }),
      update: vi.fn(async ({ where, data, select }: any) => { const row = memory.users.find((entry) => entry.id === where.id); Object.assign(row, data); return selectRow(row, select); }),
    },
    tipoGarantia: { findMany: vi.fn(async () => [{ nombre: "Tratamiento" }, { nombre: "Consulta" }]) },
    problemaSalud: { findMany: vi.fn(async () => [{ nombre: "Diabetes" }, { nombre: "Hipertensión" }]) },
    establecimiento: { findMany: vi.fn(async () => [{ nombre: "Centro Norte" }, { nombre: "Centro Sur" }]) },
    garantia: { findMany: vi.fn(async () => []) },
    nombreGarantiaAsignable: { findMany: vi.fn(async () => []) },
    usuarioTipoGarantia: { findMany: vi.fn(async ({ where }: any) => memory.users.find((entry) => entry.id === where.usuarioId)?.tiposGarantia ?? []) },
    $executeRaw: vi.fn(async () => 0),
    $transaction: vi.fn(async (work: any) => { const copy = structuredClone(memory.users); try { return await work(prisma); } catch (error) { memory.users = copy; throw error; } }),
  };
  return { prisma };
});
vi.mock("../src/modules/auth/auth-service.js", () => ({
  getSessionUser: vi.fn(async (token: string) => { const user = memory.users.find((entry) => entry.token === token); return user?.activo ? user : null; }),
  hashPassword: vi.fn(),
}));
import { prisma } from "../src/db/prisma.js";
import { supervisionRoutes } from "../src/modules/supervision/routes.js";
import { userRoutes } from "../src/modules/usuarios/routes.js";
import { responsibilityAreaRoutes } from "../src/modules/areas-responsabilidad/routes.js";
import { updateManagedUser } from "../src/modules/usuarios/repository.js";
import { updateSchema } from "../src/modules/usuarios/schema.js";
import { canAccessGuarantee, userAssignmentRules } from "../src/modules/garantias/assignment-scope.js";
import { matchesAssignmentRules } from "../src/modules/garantias/assignment-rules.js";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const rule = { problemaSalud: "diabetes", establecimiento: "centro norte", tipoGarantia: "tratamiento" };
const account = (number: number, rol: string, token: string, extra = {}) => ({ id: id(number), rol, token, nombre: `Funcionario sintético ${number}`, activo: true, reglasAsignacion: [rule], tiposGarantia: [], email: "PRIVATE_EMAIL", username: "PRIVATE_USERNAME", passwordHash: "PRIVATE_HASH", ...extra });
const app = Fastify({ logger: { stream: { write: (line: string) => memory.logs.push(line) } } });
app.decorateRequest("authUser", null);
app.register(supervisionRoutes, { prefix: "/api/supervision" });
app.register(userRoutes, { prefix: "/api/usuarios" });
app.register(responsibilityAreaRoutes, { prefix: "/api/areas-responsabilidad" });
const request = (method: "GET" | "PUT", path = "/api/supervision/responsabilidades", token = "coordinator", payload?: any) => app.inject({ method, url: path, headers: token ? { cookie: `ges_session=${token}` } : {}, payload });
const revision = async (target = id(3), token = "coordinator") => (await request("GET", undefined, token)).json().data.funcionarios.find((entry: any) => entry.id === target).revision;
const put = async (rules: any, extra = {}, target = id(3), token = "coordinator") => request("PUT", `/api/supervision/responsabilidades/${target}`, token, { reglasAsignacion: rules, revision: await revision(target, token), ...extra });
beforeEach(() => {
  vi.clearAllMocks(); memory.fail = false; memory.logs = [];
  memory.users = [account(1, "ADMIN", "admin"), account(2, "COORDINADOR_SOME", "coordinator"), account(3, "PROFESIONAL", "professional"), account(4, "LECTOR", "reader"), account(5, "PROFESIONAL", "inactive", { activo: false }), account(6, "COORDINADOR_SOME", "other-coordinator")];
});
afterAll(() => app.close());

describe("Responsabilidades: autorización real y persistencia compartida", () => {
  it.each(["", "invalid", "professional", "reader"])("deniega lectura y escritura con sesión %s antes de consultar el repositorio", async (token) => {
    expect((await request("GET", undefined, token)).statusCode).toBe(token === "" || token === "invalid" ? 401 : 403);
    expect((await request("PUT", `/api/supervision/responsabilidades/${id(3)}`, token, { reglasAsignacion: [] })).statusCode).toBe(token === "" || token === "invalid" ? 401 : 403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it("COORDINADOR recibe solo PROFESIONAL y LECTOR activos, sin información de administración de cuentas", async () => {
    const response = await request("GET");
    expect(response.statusCode).toBe(200); expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json().data.funcionarios.map((entry: any) => entry.id)).toEqual([id(3), id(4)]);
    expect(response.body).not.toContain("PRIVATE_");
    expect(response.json().data.opciones.establecimientos).toContainEqual({ nombre: "Centro Norte", claveNormalizada: "centro norte" });
  });
  it("ADMIN consulta y modifica únicamente cuentas no administrativas desde Responsabilidades", async () => {
    const staff = (await request("GET", undefined, "admin")).json().data.funcionarios;
    expect(staff).toHaveLength(5);
    expect(staff.every((entry: any) => entry.rol !== "ADMIN")).toBe(true);
    const response = await put([], {}, id(2), "admin");
    expect(response.statusCode).toBe(200);
    expect(memory.users[1]).toMatchObject({ rol: "COORDINADOR_SOME", activo: true, reglasAsignacion: [], email: "PRIVATE_EMAIL" });
  });
  it.each(["admin", "coordinator"])("%s no puede cambiar reglas de ningún ADMIN, ni su propia cuenta ni otra", async (token) => {
    memory.users.push(account(7, "ADMIN", "other-admin"));
    for (const target of [1, 7]) {
      const response = await request("PUT", `/api/supervision/responsabilidades/${id(target)}`, token, { reglasAsignacion: [], revision: "a".repeat(64) });
      expect(response.statusCode).toBe(403);
      expect(memory.users.find((entry) => entry.id === id(target)).reglasAsignacion).toEqual([rule]);
    }
    expect(prisma.usuario.update).not.toHaveBeenCalled();
  });
  it.each([1, 2, 5, 6, 99])("COORDINADOR no puede modificar la cuenta excluida %i ni adivinando su ID", async (target) => {
    const response = await request("PUT", `/api/supervision/responsabilidades/${id(target)}`, "coordinator", { reglasAsignacion: [], revision: "a".repeat(64) });
    expect(response.statusCode).toBe(403); expect(prisma.usuario.update).not.toHaveBeenCalled();
  });
  it.each(["rol", "email", "password", "activo", "puedeCargarNominas", "actorId", "recibirInformeAutomatico"])("rechaza el campo de administración %s en el endpoint de reglas", async (field) => {
    expect((await put([], { [field]: field === "rol" ? "ADMIN" : false })).statusCode).toBe(400);
    expect(prisma.usuario.update).not.toHaveBeenCalled();
  });
  it("guarda, deduplica, recarga y elimina las mismas reglas que consume Gestión de usuarios", async () => {
    const next = { problemaSalud: "hipertension", establecimiento: "centro sur", tipoGarantia: "consulta" };
    const before = structuredClone(memory.users[2]);
    const response = await put([next, next]);
    expect(response.statusCode).toBe(200);
    expect(response.json().data.reglasAsignacion).toEqual([next]);
    expect(memory.users[2]).toEqual({ ...before, reglasAsignacion: [next] });
    expect((await request("GET")).json().data.funcionarios[0].reglasAsignacion).toEqual([next]);
    expect((await put([])).statusCode).toBe(200);
    expect(await userAssignmentRules(id(3))).toEqual([]);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });
  it("los cambios alcanzan inmediatamente el filtro común de acceso y correo sin asignaciones individuales", async () => {
    await put([{ problemaSalud: "diabetes", establecimiento: "centro sur", tipoGarantia: "" }]);
    const allowed = { problemaSalud: "Diabetes", responsable: "Centro Sur", nombreGarantia: "Consulta" };
    const denied = { ...allowed, responsable: "Centro Norte" };
    const viewer = { id: id(3), rol: "PROFESIONAL" };
    expect(await canAccessGuarantee(viewer, allowed)).toBe(true);
    expect(await canAccessGuarantee(viewer, denied)).toBe(false);
    expect(matchesAssignmentRules(allowed, await userAssignmentRules(id(3)))).toBe(true);
    await put([]);
    expect(await canAccessGuarantee(viewer, allowed)).toBe(false);
  });
  it("COORDINADOR también administra reglas de LECTOR activo sin modificar sus permisos de gestión", async () => {
    const response = await put([], {}, id(4));
    expect(response.statusCode).toBe(200);
    expect(memory.users[3]).toMatchObject({ rol: "LECTOR", activo: true, reglasAsignacion: [] });
    expect(prisma.usuario.update).toHaveBeenCalledWith({ where: { id: id(4) }, data: { reglasAsignacion: [] }, select: { id: true } });
  });
  it("mantiene tipos heredados al leer y no los recupera después de guardar reglas vacías", async () => {
    Object.assign(memory.users[2], { reglasAsignacion: null, tiposGarantia: [{ claveNormalizada: "tratamiento", tipoGarantia: { nombre: "Tratamiento", claveNormalizada: "tratamiento" } }] });
    expect((await request("GET")).json().data.funcionarios[0].reglasAsignacion).toEqual([{ problemaSalud: "", establecimiento: "", tipoGarantia: "tratamiento" }]);
    expect((await put([])).statusCode).toBe(200);
    expect(await userAssignmentRules(id(3))).toEqual([]);
  });
  it.each([
    { rules: [{ problemaSalud: "", establecimiento: "", tipoGarantia: "" }] },
    { rules: [{ ...rule, problemaSalud: "inventado" }] },
    { rules: [{ ...rule, establecimiento: "CENTRO NORTE" }] },
    { rules: Array.from({ length: 1001 }, () => rule) },
  ])("reutiliza las validaciones de reglas sin guardar selecciones inválidas", async ({ rules }) => {
    expect((await put(rules)).statusCode).toBe(400); expect(prisma.usuario.update).not.toHaveBeenCalled();
  });
  it("permite conservar valores previos que desaparecieron del catálogo", async () => {
    memory.users[2].reglasAsignacion = [{ ...rule, establecimiento: "centro antiguo" }];
    expect((await put(memory.users[2].reglasAsignacion)).statusCode).toBe(200);
  });
  it("detecta cambios hechos desde Gestión de usuarios sin sobrescribirlos", async () => {
    const oldRevision = await revision();
    await updateManagedUser(id(3), updateSchema.parse({ nombre: memory.users[2].nombre, email: "new@example.test", rol: "PROFESIONAL", activo: true, reglasAsignacion: [] }));
    const response = await request("PUT", `/api/supervision/responsabilidades/${id(3)}`, "coordinator", { revision: oldRevision, reglasAsignacion: [rule] });
    expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe("STALE_ASSIGNMENT_RULES");
    expect(memory.users[2].reglasAsignacion).toEqual([]);
  });
  it("revalida el perfil y la actividad del destinatario antes de escribir", async () => {
    const oldRevision = await revision(); memory.users[2].rol = "ADMIN";
    const response = await request("PUT", `/api/supervision/responsabilidades/${id(3)}`, "coordinator", { revision: oldRevision, reglasAsignacion: [] });
    expect(response.statusCode).toBe(403); expect(prisma.usuario.update).not.toHaveBeenCalled();
  });
  it("registra solo cambios nuevos confirmados, con autor y huellas, sin reglas ni datos privados", async () => {
    expect((await put([])).statusCode).toBe(200);
    const logs = memory.logs.map((line) => JSON.parse(line)).filter((entry) => entry.event === "ASSIGNMENT_RULES_CHANGED");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorId: id(2), targetId: id(3), beforeCount: 1, afterCount: 0 });
    expect(logs[0].beforeRevision).not.toBe(logs[0].afterRevision);
    expect(JSON.stringify(logs)).not.toContain("diabetes"); expect(JSON.stringify(logs)).not.toContain("PRIVATE_");
    await put([]);
    expect(memory.logs.filter((line) => line.includes('"event":"ASSIGNMENT_RULES_CHANGED"'))).toHaveLength(1);
  });
  it("un fallo de lectura no publica ceros ni expone detalles internos", async () => {
    memory.fail = true; const response = await request("GET");
    expect(response.statusCode).toBe(503); expect(response.json()).not.toHaveProperty("data");
    expect(response.body).not.toContain("PRIVATE_"); expect(memory.logs.join("")).not.toContain("PRIVATE_DATABASE_PARAMETERS");
  });
  it("COORDINADOR sigue sin Resumen, actividad global, gestión de cuentas o escritura de áreas heredadas", async () => {
    for (const path of ["/api/supervision/resumen", "/api/supervision/eventos", "/api/usuarios", "/api/areas-responsabilidad/usuarios"]) expect((await request("GET", path)).statusCode).toBe(403);
    for (const path of [`/api/usuarios/${id(3)}`, `/api/usuarios/${id(3)}/contrasena`, `/api/areas-responsabilidad/usuarios/${id(3)}`]) expect((await request("PUT", path, "coordinator", {})).statusCode).toBe(403);
  });
});
