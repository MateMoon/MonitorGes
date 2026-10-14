import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), find: vi.fn(), filterOptions: vi.fn(), dashboard: vi.fn(), latestImport: vi.fn(), getSessionUser: vi.fn() }));
vi.mock("../src/modules/garantias/repository.js", () => ({ listGuarantees: mocks.list, findGuarantee: mocks.find, listGuaranteeFilterOptions: mocks.filterOptions }));
vi.mock("../src/modules/dashboard/repository.js", () => ({ dashboardData: mocks.dashboard, latestImport: mocks.latestImport }));
vi.mock("../src/modules/auth/auth-service.js", () => ({ getSessionUser: mocks.getSessionUser }));
import { buildApp } from "../src/app.js";

describe("API de lectura", () => {
  const app = buildApp();
  beforeEach(() => {
    mocks.getSessionUser.mockImplementation(async (token: string) => token === "lector" ? { id: "user-1", username: "qa", nombre: "QA", email: "qa@example.test", rol: "LECTOR" } : null);
    mocks.list.mockResolvedValue({ rows: [], total: 0 });
    mocks.filterOptions.mockResolvedValue({ responsables: ["Centro Ficticio"], problemasSalud: [], nombresGarantia: [] });
    mocks.find.mockResolvedValue(null);
    mocks.dashboard.mockResolvedValue({ total: 0, conteosPorEstado: { vencida: 0, critica: 0, proxima: 0, atencion: 0, normal: 0 }, urgentes: [] });
    mocks.latestImport.mockResolvedValue(null);
  });
  afterAll(async () => { await app.close(); });
  it("valida filtros y paginación", async () => {
    const response = await app.inject({ method: "GET", url: "/api/garantias?estado=desconocido&page=0", headers: { cookie: "ges_session=lector" } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });
  it("deniega solicitudes anonimas a garantias, dashboard e historial de importaciones", async () => {
    const paths = ["/api/garantias", "/api/dashboard", "/api/importaciones?page=1&limit=25", "/api/garantias/opciones-filtros"];
    for (const url of paths) expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
  });
  it("responde dashboard con contrato estable", async () => {
    const response = await app.inject({ method: "GET", url: "/api/dashboard", headers: { cookie: "ges_session=lector" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.conteosPorEstado).toHaveProperty("vencida");
  });
  it("exige una sesion para las opciones de los comboboxes y permite cargar opciones", async () => {
    const anonymous = await app.inject({ method: "GET", url: "/api/garantias/opciones-filtros", headers: { cookie: "ges_session=invalid" } });
    expect(anonymous.statusCode).toBe(401);
    const response = await app.inject({ method: "GET", url: "/api/garantias/opciones-filtros", headers: { cookie: "ges_session=lector" } });
    expect(response.statusCode).toBe(200);
  });
  it("responde una lista paginada", async () => {
    const response = await app.inject({ method: "GET", url: "/api/garantias?page=2&limit=10&sort=fechaLimite&order=desc", headers: { cookie: "ges_session=lector" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().pagination).toEqual({ page: 2, limit: 10, total: 0, totalPages: 0 });
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ page: 2, limit: 10, order: "desc" }), expect.any(String));
  });
  it("responde 404 para detalle inexistente", async () => {
    const response = await app.inject({ method: "GET", url: "/api/garantias/00000000-0000-4000-8000-000000000000", headers: { cookie: "ges_session=lector" } });
    expect(response.statusCode).toBe(404);
  });
  it("devuelve el detalle con paciente y estado calculado", async () => {
    mocks.find.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001", paciente: { id: "00000000-0000-4000-8000-000000000002", rutNumero: "12345678", dv: "9", nombre: "Paciente Ficticio" },
      fechaInicio: new Date("2026-10-01T00:00:00.000Z"), fechaLimite: new Date("2026-10-08T00:00:00.000Z"),
      problemaSalud: "Problema ficticio", nombreGarantia: "Garantía ficticia", responsable: "Centro ficticio", gestionadaAt: null, gestionadaPor: null, version: 1,
    });
    const response = await app.inject({ method: "GET", url: "/api/garantias/00000000-0000-4000-8000-000000000001", headers: { cookie: "ges_session=lector" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.paciente.rut).toBe("12345678-9");
    expect(response.json().data).toMatchObject({ diasRestantes: expect.any(Number), estado: expect.any(String), responsable: "Centro ficticio" });
  });
  it("permite solo el origen de desarrollo configurado por defecto", async () => {
    const allowed = await app.inject({ method: "GET", url: "/api/dashboard", headers: { origin: "http://localhost:8443", cookie: "ges_session=lector" } });
    const denied = await app.inject({ method: "GET", url: "/api/dashboard", headers: { origin: "https://otro-origen.example", cookie: "ges_session=lector" } });
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:8443");
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
