import ExcelJS from "exceljs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("../src/db/prisma.js", () => ({
  prisma: {
    $transaction: db.read,
    garantia: { count: db.read, findMany: db.read, findUnique: db.read, create: db.write, update: db.write, delete: db.write, upsert: db.write },
    paciente: { findUnique: db.read, create: db.write, update: db.write, delete: db.write, upsert: db.write },
    importacion: { findFirst: db.read, create: db.write, update: db.write, delete: db.write },
    usuario: { findMany: db.read },
  },
}));
import { buildApp } from "../src/app.js";
const authMocks = vi.hoisted(() => ({ getSessionUser: vi.fn() }));
vi.mock("../src/modules/auth/auth-service.js", () => ({ getSessionUser: authMocks.getSessionUser }));

async function sampleXlsx() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Nómina");
  sheet.addRow(["Problema de salud", "RUT", "DV", "Nombre", "Fecha de Inicio", "Fecha Límite", "Días que faltan para el Vencimiento de la Garantía", "Nombre de la garantía", "Responsable de la garantía"]);
  sheet.addRow(["Problema ficticio", "12345678", "5", "Paciente Prueba", "2026-10-01", "2026-12-31", 0, "Garantía ficticia", "Centro ficticio"]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function multipart(file: Buffer) {
  const boundary = "----import-validation-boundary";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="archivo"; filename="prueba.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

describe("POST /api/importaciones/validar", () => {
  const app = buildApp();
  beforeEach(() => {
    db.read.mockReset().mockResolvedValue([]);
    db.write.mockReset();
    authMocks.getSessionUser.mockResolvedValue({ id: "user-1", username: "qa", nombre: "QA", email: "qa@example.test", rol: "PROFESIONAL", puedeCargarNominas: true });
  });
  beforeAll(async () => { await app.ready(); });
  afterAll(async () => { await app.close(); });

  it("devuelve el resumen y la vista previa, sin modificar PostgreSQL", async () => {
    const form = multipart(await sampleXlsx());
    const response = await app.inject({ method: "POST", url: "/api/importaciones/validar", headers: { "content-type": form.contentType, origin: "http://localhost:8443", cookie: "ges_session=professional" }, payload: form.body });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ filasLeidas: 1, filasValidas: 1, filasConErrores: 0, vistaPrevia: [{ numeroFila: 2 }] });
    expect(response.body).not.toContain("12345678");
    expect(response.body).not.toContain("Paciente Prueba");
    expect(db.read).not.toHaveBeenCalled();
    expect(db.write).not.toHaveBeenCalled();
  });

  it("no filtra valores personales en los errores de validación", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Nómina ficticia");
    sheet.addRow(["Problema de salud", "RUT", "DV", "Nombre", "Fecha de Inicio", "Fecha Límite", "Días que faltan para el Vencimiento de la Garantía", "Nombre de la garantía", "Responsable de la garantía"]);
    sheet.addRow(["Diagnóstico ficticio", "12345678", "9", "Paciente Ficticio Único", "2026-10-01", "2026-12-31", 0, "Garantía ficticia", "Responsable ficticio"]);
    const form = multipart(Buffer.from(await workbook.xlsx.writeBuffer()));
    const response = await app.inject({ method: "POST", url: "/api/importaciones/validar", headers: { "content-type": form.contentType, origin: "http://localhost:8443", cookie: "ges_session=professional" }, payload: form.body });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.errores).toMatchObject([{ numeroFila: 2, codigo: "INVALID_RUT_DV" }]);
    for (const personalValue of ["12345678", "Paciente Ficticio Único", "Diagnóstico ficticio", "Responsable ficticio"]) {
      expect(response.body).not.toContain(personalValue);
    }
  });

  it("devuelve error legible si falta el campo archivo", async () => {
    const response = await app.inject({ method: "POST", url: "/api/importaciones/validar", headers: { "content-type": "multipart/form-data; boundary=empty", origin: "http://localhost:8443", cookie: "ges_session=professional" }, payload: "--empty--\r\n" });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("FILE_REQUIRED");
  });
  it("requiere permiso persistido antes de validar o importar", async () => {
    const anonymous = await app.inject({ method: "POST", url: "/api/importaciones/validar", headers: { origin: "http://localhost:8443" } });
    expect(anonymous.statusCode).toBe(401);
    authMocks.getSessionUser.mockResolvedValueOnce({ id: "professional", username: "professional", nombre: "Professional", email: "professional@example.test", rol: "PROFESIONAL", puedeCargarNominas: false });
    const forged = await app.inject({ method: "POST", url: "/api/importaciones", headers: { origin: "http://localhost:8443", cookie: "ges_session=professional", "content-type": "application/json" }, payload: { rol: "ADMIN", puedeCargarNominas: true } });
    expect(forged.statusCode).toBe(403);
    expect(db.read).not.toHaveBeenCalled();
    expect(db.write).not.toHaveBeenCalled();

    authMocks.getSessionUser.mockResolvedValueOnce({ id: "reader", username: "reader", nombre: "Reader", email: "reader@example.test", rol: "LECTOR", puedeCargarNominas: true });
    const reader = await app.inject({ method: "POST", url: "/api/importaciones", headers: { origin: "http://localhost:8443", cookie: "ges_session=reader" } });
    expect(reader.statusCode).toBe(403);
  });

  it("permite al COORDINADOR_SOME cargar solo cuando tiene permiso persistido", async () => {
    const form = multipart(await sampleXlsx());
    authMocks.getSessionUser.mockResolvedValueOnce({ id: "coord", username: "coord", nombre: "Coordinador", email: "coord@example.test", rol: "COORDINADOR_SOME", puedeCargarNominas: true });
    const allowed = await app.inject({ method: "POST", url: "/api/importaciones/validar", headers: { "content-type": form.contentType, origin: "http://localhost:8443", cookie: "ges_session=coord" }, payload: form.body });
    expect(allowed.statusCode).toBe(200);

    authMocks.getSessionUser.mockResolvedValueOnce({ id: "coord", username: "coord", nombre: "Coordinador", email: "coord@example.test", rol: "COORDINADOR_SOME", puedeCargarNominas: false });
    const denied = await app.inject({ method: "POST", url: "/api/importaciones/validar", headers: { "content-type": form.contentType, origin: "http://localhost:8443", cookie: "ges_session=coord" }, payload: form.body });
    expect(denied.statusCode).toBe(403);
  });

  it("da carga al ADMIN por perfil y limita al COORDINADOR en administración global", async () => {
    const form = multipart(await sampleXlsx());
    authMocks.getSessionUser.mockResolvedValueOnce({ id: "admin", username: "admin", nombre: "Admin", email: "admin@example.test", rol: "ADMIN", puedeCargarNominas: false });
    const uploadAllowed = await app.inject({ method: "POST", url: "/api/importaciones/validar", headers: { "content-type": form.contentType, origin: "http://localhost:8443", cookie: "ges_session=admin" }, payload: form.body });
    expect(uploadAllowed.statusCode).toBe(200);

    authMocks.getSessionUser.mockResolvedValueOnce({ id: "admin", username: "admin", nombre: "Admin", email: "admin@example.test", rol: "ADMIN", puedeCargarNominas: false });
    db.read.mockResolvedValueOnce([]);
    const users = await app.inject({ method: "GET", url: "/api/usuarios", headers: { cookie: "ges_session=admin" } });
    expect(users.statusCode).toBe(200);

    authMocks.getSessionUser.mockResolvedValueOnce({ id: "coord", username: "coord", nombre: "Coordinador", email: "coord@example.test", rol: "COORDINADOR_SOME", puedeCargarNominas: false });
    const userAdminDenied = await app.inject({ method: "GET", url: "/api/usuarios", headers: { cookie: "ges_session=coord" } });
    expect(userAdminDenied.statusCode).toBe(403);
    authMocks.getSessionUser.mockResolvedValueOnce({ id: "coord", username: "coord", nombre: "Coordinador", email: "coord@example.test", rol: "COORDINADOR_SOME", puedeCargarNominas: false });
    const configDenied = await app.inject({ method: "PUT", url: "/api/notificaciones/configuracion-correo", headers: { cookie: "ges_session=coord", origin: "http://localhost:8443", "content-type": "application/json" }, payload: { emails: ["ops@example.test"] } });
    expect(configDenied.statusCode).toBe(403);

    authMocks.getSessionUser.mockResolvedValueOnce({ id: "coord", username: "coord", nombre: "Coordinador", email: "coord@example.test", rol: "COORDINADOR_SOME", puedeCargarNominas: false });
    const readOnlyOptions = await app.inject({ method: "GET", url: "/api/garantias/opciones-filtros", headers: { cookie: "ges_session=coord" } });
    expect(readOnlyOptions.statusCode).toBe(200);
  });

  it("compara en modo lectura, devuelve solo clasificación/diferencias y no invoca escrituras", async () => {
    db.read.mockResolvedValueOnce([{
      id: "fake-case-1", problemaSalud: "Problema ficticio", nombreGarantia: "Garantía ficticia",
      fechaInicio: new Date("2026-10-01T00:00:00.000Z"), fechaLimite: new Date("2026-12-01T00:00:00.000Z"),
      responsable: "Centro ficticio anterior", paciente: { rutNumero: "12345678", dv: "5" },
    }]);
    const form = multipart(await sampleXlsx());
    const response = await app.inject({ method: "POST", url: "/api/importaciones/comparar", headers: { "content-type": form.contentType, origin: "http://localhost:8443", cookie: "ges_session=professional" }, payload: form.body });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      filasLeidas: 1, filasValidas: 1, filasInvalidas: 0,
      conteos: { COINCIDENCIA_EXACTA_UNICA: 1 },
      filas: [{ numeroFila: 2, clasificacion: "COINCIDENCIA_EXACTA_UNICA", camposImportadosDiferentes: ["fechaLimite", "responsableInformado"] }],
    });
    expect(response.body).not.toContain("12345678");
    expect(response.body).not.toContain("Paciente Prueba");
    expect(db.read).toHaveBeenCalledOnce();
    expect(db.read.mock.calls[0][0].where.paciente.is.OR).toEqual([{ rutNumero: "12345678", dv: "5" }]);
    expect(db.read.mock.calls[0][0].select).not.toHaveProperty("nombre");
    expect(db.write).not.toHaveBeenCalled();
  });

  it("deniega la comparación a LECTOR antes de leer candidatos", async () => {
    authMocks.getSessionUser.mockResolvedValueOnce({ id: "reader", username: "reader", nombre: "Reader", email: "reader@example.test", rol: "LECTOR" });
    const response = await app.inject({ method: "POST", url: "/api/importaciones/comparar", headers: { origin: "http://localhost:8443", cookie: "ges_session=reader" } });
    expect(response.statusCode).toBe(403);
    expect(db.read).not.toHaveBeenCalled();
    expect(db.write).not.toHaveBeenCalled();
  });
});
