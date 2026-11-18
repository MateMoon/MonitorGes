import Fastify from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const memory = vi.hoisted(() => ({
  rows: [] as any[], users: [] as any[], legacy: new Map<string, string[]>(),
  session: null as any, fail: "", corruptCount: false,
}));

// Only synthetic fixtures and a Prisma double. These tests do not connect to a
// database, migrate a schema, import server.ts, start the scheduler or call SMTP.
vi.mock("../src/db/prisma.js", () => {
  const matches = (row: any, where: any = {}): boolean => Object.entries(where).every(([key, condition]: [string, any]) => {
    if (key === "AND") return (Array.isArray(condition) ? condition : [condition]).every((part) => matches(row, part));
    if (key === "OR") return condition.some((part: any) => matches(row, part));
    if (key === "NOT") return (Array.isArray(condition) ? condition : [condition]).every((part) => !matches(row, part));
    const value = row[key];
    if (condition === null || typeof condition !== "object" || condition instanceof Date) return value === condition;
    return Object.entries(condition).every(([operator, target]: [string, any]) => {
      if (operator === "in") return target.includes(value);
      if (operator === "not") return value !== target;
      if (operator === "lt") return value < target;
      if (operator === "lte") return value <= target;
      if (operator === "gt") return value > target;
      if (operator === "gte") return value >= target;
      throw new Error("Unsupported test predicate");
    });
  });
  const project = (row: any, select: any): any => !select ? { ...row } : Object.fromEntries(Object.entries(select).map(([key, selection]: [string, any]) => [key, selection === true ? row[key] : project(row[key], selection.select)]));
  const order = (rows: any[], orderBy: any) => rows.sort((a, b) => {
    for (const item of !orderBy ? [] : Array.isArray(orderBy) ? orderBy : [orderBy]) {
      const [key, direction] = Object.entries(item)[0];
      const difference = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
      if (difference) return direction === "desc" ? -difference : difference;
    }
    return 0;
  });
  const write = vi.fn(() => { throw new Error("Writes are forbidden in supervision"); });
  const prisma: any = {
    usuario: {
      findMany: vi.fn(async ({ where, select, orderBy }: any) => order(memory.users.filter((row) => matches(row, where)), orderBy).map((row) => project(row, select))),
      findUnique: vi.fn(async ({ where, select }: any) => {
        if (memory.fail === "user") throw new Error("DATABASE_QUERY_WITH_PRIVATE_PARAMETERS");
        const row = memory.users.find((entry) => entry.id === where.id);
        return row ? project(row, select) : null;
      }),
      create: write, update: write, delete: write,
    },
    usuarioTipoGarantia: {
      findMany: vi.fn(async ({ where }: any) => (memory.legacy.get(where.usuarioId) ?? []).map((claveNormalizada) => ({ claveNormalizada }))),
      create: write, update: write, deleteMany: write,
    },
    garantia: {
      groupBy: vi.fn(async ({ by }: any) => {
        if (memory.fail === "group") throw new Error("DATABASE_QUERY_WITH_PRIVATE_PARAMETERS");
        const groups = new Map<string, any>();
        for (const row of memory.rows) {
          const key = JSON.stringify(by.map((field: string) => row[field]));
          if (!groups.has(key)) groups.set(key, { ...Object.fromEntries(by.map((field: string) => [field, row[field]])), _count: { _all: 0 } });
          groups.get(key)._count._all++;
        }
        return [...groups.values()];
      }),
      count: vi.fn(async ({ where }: any) => {
        if (memory.fail === "count") throw new Error("DATABASE_QUERY_WITH_PRIVATE_PARAMETERS");
        return memory.rows.filter((row) => matches(row, where)).length + (memory.corruptCount ? 1 : 0);
      }),
      findMany: vi.fn(async ({ where, distinct, select, orderBy, take }: any) => {
        if (memory.fail === "priority" && take !== undefined) throw new Error("DATABASE_QUERY_WITH_PRIVATE_PARAMETERS");
        let rows = memory.rows.filter((row) => matches(row, where));
        if (distinct) rows = [...new Map(rows.map((row) => [JSON.stringify(distinct.map((key: string) => row[key])), row])).values()];
        rows = order(rows, orderBy);
        return rows.slice(0, take ?? rows.length).map((row) => project(row, select));
      }),
      create: write, update: write, delete: write,
    },
    $executeRaw: vi.fn(async () => 0),
    $transaction: vi.fn(async (work: any) => work(prisma)),
    _write: write,
  };
  return { prisma };
});
vi.mock("../src/modules/auth/auth-service.js", () => ({ getSessionUser: vi.fn(async () => memory.session) }));

import { prisma } from "../src/db/prisma.js";
import { supervisionRoutes } from "../src/modules/supervision/routes.js";
import { readSupervisionSummary } from "../src/modules/supervision/repository.js";
import { assignmentScopeForRules, userAssignmentRules } from "../src/modules/garantias/assignment-scope.js";
import { matchesAssignmentRules } from "../src/modules/garantias/assignment-rules.js";
import { buildApp } from "../src/app.js";

const today = "2026-11-17";
const date = (offset: number) => new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000);
const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const rule = (problemaSalud = "", establecimiento = "", tipoGarantia = "tratamiento") => ({ problemaSalud, establecimiento, tipoGarantia });
const professional = (key: string, rules: unknown = [rule()], extra: any = {}) => ({ id: key, nombre: `Profesional ${key}`, activo: true, rol: "PROFESIONAL", reglasAsignacion: rules, ...extra });
const guarantee = (number: number, days: number, state = "SIN_GESTION", extra: any = {}) => ({
  id: id(number), problemaSalud: "Diabetes", nombreGarantia: "Tratamiento", responsable: "Centro Norte",
  fechaLimite: date(days), estadoGestion: state, paciente: { nombre: `Caso sintético ${number}`, rutNumero: "NEVER_RETURN_THIS_FIELD" }, ...extra,
});
const app = Fastify({ logger: false });
app.decorateRequest("authUser", null);
app.register(supervisionRoutes, { prefix: "/api/supervision" });
const request = (headers: Record<string, string> = { cookie: "ges_session=synthetic-token" }) => app.inject({ method: "GET", url: "/api/supervision/resumen", headers });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  // UTC is already the 18th, while the reference civil date in Santiago is the 17th.
  vi.setSystemTime(new Date("2026-11-18T02:30:00.000Z"));
  memory.rows = []; memory.users = []; memory.legacy = new Map(); memory.fail = ""; memory.corruptCount = false;
  memory.session = { id: "admin", nombre: "Cuenta de prueba", username: "test", email: "test@example.test", rol: "ADMIN", puedeCargarNominas: false };
});
afterEach(() => vi.useRealTimers());
afterAll(() => app.close());

describe("Supervisión SOME: autorización y contrato", () => {
  it("rechaza solicitudes sin sesión sin consultar datos", async () => {
    expect((await request({})).statusCode).toBe(401);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it("rechaza sesiones inválidas", async () => {
    memory.session = null;
    expect((await request()).statusCode).toBe(401);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it.each(["COORDINADOR_SOME", "PROFESIONAL", "LECTOR"])("%s no recibe datos globales aunque pueda importar", async (role) => {
    memory.session = { ...memory.session, rol: role, puedeCargarNominas: true };
    const response = await request();
    expect(response.statusCode).toBe(403);
    expect(response.json()).not.toHaveProperty("data");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it("ADMIN recibe un contrato vacío real y consistente, con una fecha de Santiago y sin escrituras", async () => {
    const response = await request();
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json().data).toMatchObject({ fechaReferencia: today, zonaHoraria: "America/Santiago", generadoAt: "2026-11-18T02:30:00.000Z", alcance: "GLOBAL", indicadores: { totalGarantias: 0 }, cobertura: { sinProfesional: 0, unProfesional: 0, variosProfesionales: 0, sinProfesionalNoCumplidas: 0 }, prioritarios: [] });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", timeout: 30_000 });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect((prisma as any)._write).not.toHaveBeenCalled();
  });
  it("registra el endpoint en la aplicación real sin modificar el dashboard", async () => {
    const fullApp = buildApp(); fullApp.log.level = "silent";
    try { expect((await fullApp.inject({ method: "GET", url: "/api/supervision/resumen", headers: { cookie: "ges_session=synthetic-token" } })).statusCode).toBe(200); }
    finally { await fullApp.close(); }
  });
});

describe("Supervisión SOME: indicadores y cobertura", () => {
  it("respeta -1, 0, 7, 8, 15, 16 días, y distingue pendientes de resolución del resto", async () => {
    memory.users = [professional("one")];
    memory.rows = [guarantee(1, -1), guarantee(2, 0, "EN_GESTION"), guarantee(3, 7, "PENDIENTE_RESOLUCION"), guarantee(4, 8), guarantee(5, 15), guarantee(6, 16)];
    const data = (await request()).json().data;
    expect(data.indicadores).toEqual({ totalGarantias: 6, pendientesResolucion: 1, enGestion: 1, cumplidas: 0, vencidasNoCumplidas: 1, proximas15DiasNoCumplidas: 4 });
    expect(data.cobertura).toEqual({ sinProfesional: 0, unProfesional: 6, variosProfesionales: 0, sinProfesionalNoCumplidas: 0 });
    expect(data.prioritarios.map((row: any) => [row.diasRestantes, row.estadoVencimiento])).toEqual([[-1, "vencida"], [0, "critica"], [7, "critica"]]);
  });
  it("cuenta cumplidas en total y cobertura, pero las excluye de indicadores, distribuciones y prioridades operativos", async () => {
    memory.rows = [-1, 0, 7, 8, 15, 16].map((days, index) => guarantee(index + 1, days, "CUMPLIDA"));
    const data = (await request()).json().data;
    expect(data.indicadores).toEqual({ totalGarantias: 6, pendientesResolucion: 0, enGestion: 0, cumplidas: 6, vencidasNoCumplidas: 0, proximas15DiasNoCumplidas: 0 });
    expect(data.cobertura).toEqual({ sinProfesional: 6, unProfesional: 0, variosProfesionales: 0, sinProfesionalNoCumplidas: 0 });
    expect(data.distribuciones.porProblemaSalud).toEqual([]);
    expect(data.distribuciones.porEstablecimiento).toEqual([]);
    expect(data.prioritarios).toEqual([]);
  });
  it("solo profesionales activos con reglas efectivas cuentan; ADMIN no cubre automáticamente", async () => {
    memory.rows = [guarantee(1, 40)];
    memory.users = [professional("inactive", [rule()], { activo: false }), professional("admin", [rule()], { rol: "ADMIN" }), professional("coordinator", [rule()], { rol: "COORDINADOR_SOME" }), professional("reader", [rule()], { rol: "LECTOR" }), professional("empty", [])];
    const data = (await request()).json().data;
    expect(data.cobertura.sinProfesionalNoCumplidas).toBe(1);
    expect(data.criteriosCobertura).toMatchObject({ profesionalesActivos: 1, profesionalesConReglasEfectivas: 0 });
    expect(data.distribuciones.porProfesional).toEqual([]);
    expect(data.prioritarios[0]).toMatchObject({ prioridad: 3, motivosPrioridad: ["SIN_PROFESIONAL_ACTIVO"] });
  });
  it("mantiene reglas heredadas y no recupera tipos anteriores cuando el JSON está vacío", async () => {
    memory.rows = [guarantee(1, 30)];
    memory.users = [professional("legacy", null), professional("revoked", [])];
    memory.legacy.set("legacy", ["tratamiento"]); memory.legacy.set("revoked", ["tratamiento"]);
    const data = (await request()).json().data;
    expect(data.cobertura.unProfesional).toBe(1);
    expect(data.distribuciones.porProfesional).toEqual([{ usuarioId: "legacy", nombre: "Profesional legacy", cantidad: 1 }]);
    expect(prisma.usuarioTipoGarantia.findMany).toHaveBeenCalledTimes(1);
  });
  it("normaliza las tres dimensiones y respeta comodines y combinaciones específicas", async () => {
    memory.users = [professional("specific", [rule("diabetes", "centro norte", "tratamiento")]), professional("wildcard", [rule("hipertension", "", "")])];
    memory.rows = [guarantee(1, 40, "SIN_GESTION", { problemaSalud: "DIÁBETES!!!", responsable: "CÉNTRO  NORTE", nombreGarantia: "TRATÁMIENTO!!" }), guarantee(2, 40, "EN_GESTION", { problemaSalud: "Hipertensión", responsable: "Centro Sur", nombreGarantia: "Diagnóstico" }), guarantee(3, 40, "SIN_GESTION", { responsable: "Centro Sur" })];
    const data = (await request()).json().data;
    expect(data.cobertura).toMatchObject({ sinProfesional: 1, unProfesional: 2, variosProfesionales: 0 });
    expect(data.prioritarios.map((row: any) => row.id)).toEqual([id(3)]);
  });
  it("no duplica una garantía por reglas del mismo profesional y permite varios profesionales", async () => {
    memory.users = [professional("a", [rule(), rule("diabetes"), rule("diabetes", "centro norte")]), professional("b", [rule()])];
    memory.rows = [guarantee(1, 5), guarantee(2, 5), guarantee(3, -1, "CUMPLIDA")];
    const data = (await request()).json().data;
    expect(data.indicadores.totalGarantias).toBe(3);
    expect(data.cobertura.variosProfesionales).toBe(3);
    expect(data.distribuciones.porProfesional.map((entry: any) => entry.cantidad)).toEqual([2, 2]);
    expect(data.prioritarios).toHaveLength(2);
    expect(data.prioritarios.every((row: any) => row.cantidadProfesionalesCoincidentes === 2)).toBe(true);
    expect(data.distribuciones.porProblemaSalud).toEqual([{ problemaSalud: "Diabetes", cantidad: 2 }]);
    expect(data.distribuciones.porEstablecimiento).toEqual([{ establecimiento: "Centro Norte", cantidad: 2 }]);
  });
  it.each([
    { label: "texto", invalid: "bad-json" },
    { label: "objeto", invalid: {} },
    { label: "regla sin criterios", invalid: [rule("", "", "")] },
    { label: "clave sin normalizar", invalid: [rule("DIABETES")] },
    { label: "elemento nulo", invalid: [null] },
  ])("devuelve error ante reglas corruptas ($label) en vez de publicar ceros", async ({ invalid }) => {
    memory.users = [professional("invalid", invalid)]; memory.rows = [guarantee(1, 40)];
    const response = await request();
    expect(response.statusCode).toBe(503);
    expect(response.json()).not.toHaveProperty("data");
    expect(response.json().error.code).toBe("SUPERVISION_UNAVAILABLE");
  });
  it("rechaza claves heredadas inválidas sin alterar las reglas actuales", async () => {
    memory.users = [professional("legacy", null)]; memory.legacy.set("legacy", ["CLAVE INVALIDA"]);
    expect((await request()).statusCode).toBe(503);
  });
});

describe("Supervisión SOME: prioridades y fallos", () => {
  it("ordena por grupo, días e ID, limita a diez y conserva todos los motivos sin repetir filas", async () => {
    memory.users = [professional("covered", [rule("", "", "cubierta")])];
    memory.rows = [guarantee(9, 100), guarantee(8, 8), guarantee(7, 16), guarantee(6, 7), guarantee(5, 0), guarantee(4, -1), guarantee(3, -2), guarantee(2, -2), guarantee(1, -4), guarantee(10, 15), guarantee(11, 40), guarantee(12, 40), guarantee(13, -99, "CUMPLIDA"), guarantee(14, 1, "EN_GESTION", { nombreGarantia: "Cubierta" })];
    const data = (await request()).json().data;
    expect(data.prioritarios.map((row: any) => row.id)).toEqual([1, 2, 3, 4, 5, 14, 6, 8, 10, 7].map(id));
    expect(new Set(data.prioritarios.map((row: any) => row.id)).size).toBe(10);
    expect(data.prioritarios[0].motivosPrioridad).toEqual(["VENCIDA", "SIN_PROFESIONAL_ACTIVO"]);
    expect(data.prioritarios.find((row: any) => row.id === id(5)).motivosPrioridad).toEqual(["CRITICA", "SIN_PROFESIONAL_ACTIVO"]);
    expect(data.prioritarios.find((row: any) => row.id === id(14)).motivosPrioridad).toEqual(["CRITICA"]);
    expect(data.prioritarios.map((row: any) => row.prioridad)).toEqual([1, 1, 1, 1, 2, 2, 2, 3, 3, 3]);
    expect(JSON.stringify(data)).not.toContain("NEVER_RETURN_THIS_FIELD");
    expect(data.prioritarios[0]).not.toHaveProperty("rut");
  });
  it("cuenta garantías individuales en grupos agregados sin contar varias veces pacientes o reglas", async () => {
    memory.rows = Array.from({ length: 15 }, (_, index) => guarantee(index + 1, -1));
    const data = (await request()).json().data;
    expect(data.indicadores.totalGarantias).toBe(15);
    expect(data.cobertura.sinProfesional).toBe(15);
    expect(data.prioritarios.map((row: any) => row.id)).toEqual(Array.from({ length: 10 }, (_, index) => id(index + 1)));
  });
  it.each(["user", "group", "count", "priority"])("un fallo de %s devuelve 503 sin datos parciales ni detalles sensibles", async (operation) => {
    memory.users = [professional("one")]; memory.rows = [guarantee(1, -1)]; memory.fail = operation;
    const response = await request();
    expect(response.statusCode).toBe(503);
    expect(response.json()).not.toHaveProperty("data");
    expect(response.body).not.toContain("PRIVATE_PARAMETERS");
    expect(response.body).not.toContain("Caso sintético");
    expect((prisma as any)._write).not.toHaveBeenCalled();
  });
  it("una divergencia entre SQL y el matcher produce error explícito", async () => {
    memory.rows = [guarantee(1, 40)]; memory.corruptCount = true;
    expect((await request()).statusCode).toBe(503);
  });
  it("reutiliza las reglas de acceso, mantiene su alcance y observa cambios entre solicitudes", async () => {
    memory.users = [professional("one", [rule("diabetes", "centro norte")])];
    memory.rows = [guarantee(1, 30), guarantee(2, 30, "SIN_GESTION", { responsable: "Centro Sur" })];
    const before = JSON.stringify(memory.users);
    const rules = await userAssignmentRules("one");
    const scopeBefore = await assignmentScopeForRules(rules);
    expect((await request()).json().data.cobertura.unProfesional).toBe(1);
    expect(JSON.stringify(memory.users)).toBe(before);
    expect(await assignmentScopeForRules(await userAssignmentRules("one"))).toEqual(scopeBefore);
    expect(memory.rows.map((row) => matchesAssignmentRules(row, rules))).toEqual([true, false]);
    memory.users[0].reglasAsignacion = [];
    expect((await request()).json().data.cobertura.sinProfesional).toBe(2);
    expect((await readSupervisionSummary(today)).prioritarios).toHaveLength(2);
  });
});
