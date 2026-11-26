import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ listPending: vi.fn(), getPending: vi.fn(), resolve: vi.fn(), listDecisions: vi.fn() }));
const auth = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock("../src/modules/auth/auth-service.js", () => ({ getSessionUser: auth.user }));
vi.mock("../src/modules/calidad-datos/resolution-service.js", async original => ({ ...await original<object>(), createQualityResolutionService: () => api }));
vi.mock("../src/db/prisma.js", () => ({ prisma: {} }));
import { dataQualityRoutes } from "../src/modules/calidad-datos/routes.js";

const id = randomUUID(), actor = { id: randomUUID(), rol: "ADMIN", nombre: "Cuenta sintética" };
const body = { version: 1, solicitudId: randomUUID(), decision: "MISMA", garantiaExistenteId: randomUUID(), justificacion: "Antecedentes verificados", huellaRevision: "a".repeat(64) };
const paths = ["/pendientes", `/pendientes/${id}`, `/pendientes/${id}/resolver`, "/decisiones"];
const logs: string[] = [];
const app = Fastify({ logger: { stream: { write: (message: string) => { logs.push(message); } } } });
app.decorateRequest("authUser", null);
app.register(dataQualityRoutes, { prefix: "/api/calidad-datos" });
const request = (path: string, extra = {}) => app.inject({ method: path.endsWith("resolver") ? "POST" : "GET", url: "/api/calidad-datos" + path, headers: { cookie: "ges_session=synthetic" }, ...(path.endsWith("resolver") ? { payload: body } : {}), ...extra });
beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); });
beforeEach(() => {
  vi.stubEnv("DATA_QUALITY_ENABLED", "true");
  auth.user.mockReset().mockResolvedValue(actor);
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({ data: [] });
  logs.length = 0;
});
afterEach(() => { vi.unstubAllEnvs(); });
describe("autorización de las cuatro rutas", () => {
  it.each(["ADMIN", "COORDINADOR_SOME"])("permite %s", async rol => {
    auth.user.mockResolvedValue({ ...actor, rol });
    for (const path of paths) expect((await request(path)).statusCode).toBe(200);
    expect(api.resolve).toHaveBeenCalledWith(expect.objectContaining({ rol }), id, body);
  });
  it.each(["PROFESIONAL", "LECTOR"])("deniega %s antes de llamar al servicio", async rol => {
    auth.user.mockResolvedValue({ ...actor, rol });
    for (const path of paths) expect((await request(path)).statusCode).toBe(403);
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });
  it("deniega las sesiones ausentes o expiradas", async () => {
    auth.user.mockResolvedValue(null);
    for (const path of paths) expect((await request(path)).statusCode).toBe(401);
    expect((await request(paths[0], { headers: {} })).statusCode).toBe(401);
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });
});
it("la API apagada o mal configurada nunca consulta las tablas nuevas", async () => {
  for (const value of ["false", "TRUE"]) {
    vi.stubEnv("DATA_QUALITY_ENABLED", value);
    for (const path of paths) expect((await request(path)).statusCode).toBe(503);
  }
  for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
});
it("convierte paginación y limita los filtros a campos básicos", async () => {
  const result = await request("/pendientes?page=2&limit=5&motivo=FECHA_INICIO_DISTINTA");
  expect(result.statusCode).toBe(200); expect(result.headers["cache-control"]).toBe("no-store");
  expect(api.listPending).toHaveBeenCalledWith(actor, { page: 2, limit: 5, motivo: "FECHA_INICIO_DISTINTA" });
  for (const path of ["/pendientes?limit=101", "/pendientes?motivo=invalid", "/pendientes?rut=12345678", "/decisiones?decision=invalid", "/pendientes/invalid-id"]) expect((await request(path)).statusCode).toBe(400);
});
it("rechaza datos adicionales y no filtra cuerpos, SQL o consultas en logs", async () => {
  const marker = "PACIENTE_SINTETICO_PRIVADO";
  const invalid = await request(`/pendientes/${id}/resolver`, { payload: { ...body, nombre: marker, rut: "12345678" } });
  expect(invalid.statusCode).toBe(400); expect(api.resolve).not.toHaveBeenCalled();
  api.listPending.mockRejectedValue(new Error(`SQL parameter ${marker} 12345678`));
  const failed = await request("/pendientes");
  expect(failed.statusCode).toBe(503); expect(failed.body).not.toContain(marker);
  await request(`/pendientes?nombre=${marker}&rut=12345678`);
  expect(logs.join("")).not.toContain(marker); expect(logs.join("")).not.toContain("12345678");
});
it("responde de forma segura ante JSON mal formado", async () => {
  const result = await request(`/pendientes/${id}/resolver`, { payload: '{"rut":"12345678",', headers: { cookie: "ges_session=synthetic", "content-type": "application/json" } });
  expect(result.statusCode).toBe(400); expect(result.body).not.toContain("12345678");
});
