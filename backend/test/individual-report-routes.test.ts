import Fastify from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getSessionUser: vi.fn(), preview: vi.fn(), latest: vi.fn() }));
vi.mock("../src/modules/auth/auth-service.js", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("../src/modules/notificaciones/individual-report-repository.js", () => ({ previewIndividualReports: mocks.preview, latestIndividualResults: mocks.latest }));
import { notificationRoutes } from "../src/modules/notificaciones/routes.js";

describe("API de vista previa y resultados individuales", () => {
  const app = Fastify();
  app.decorateRequest("authUser", null);
  app.register(notificationRoutes, { prefix: "/api/notificaciones" });
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubEnv("AUTO_EMAIL_ENABLED", "false");
    mocks.getSessionUser.mockResolvedValue({ id: "test-admin", rol: "ADMIN" });
    mocks.preview.mockResolvedValue({ fechaInforme: "2026-11-05", usuarios: [{ indice: 1, tiposAsignados: 2, garantias: 3, enviaria: true, motivo: null }], simulacion: true, correosPrevistos: 1, garantiasEnInformes: 3 });
    mocks.latest.mockResolvedValue({ disponible: true, data: [{ usuarioId: "test-user", estado: "ACEPTADO_SMTP", cantidadGarantias: 3, aceptadoSmtpAt: "2026-11-05T11:00:00Z" }] });
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(() => app.close());
  const headers = { cookie: "ges_session=authorized" };
  it.each(["ADMIN", "COORDINADOR_SOME"])("%s obtiene solo conteos en la vista previa", async (rol) => {
    mocks.getSessionUser.mockResolvedValue({ id: "test-actor", rol });
    const response = await app.inject({ method: "GET", url: "/api/notificaciones/vista-previa-individual?fecha=2026-11-05", headers });
    expect(response.statusCode).toBe(200); expect(response.json().data.correosPrevistos).toBe(1);
    expect(response.body).not.toMatch(/email|rut|nombrePaciente|html|messageId/);
    expect(mocks.preview).toHaveBeenCalledWith("2026-11-05");
  });
  it.each(["LECTOR", "PROFESIONAL", null])("exige un perfil operativo global para ambas consultas: %s", async (role) => {
    mocks.getSessionUser.mockResolvedValue(role ? { id: "test-user", rol: role } : null);
    for (const path of ["vista-previa-individual", "ultimos-resultados-individuales"]) {
      const response = await app.inject({ method: "GET", url: "/api/notificaciones/" + path, headers });
      expect(response.statusCode).toBe(role ? 403 : 401);
    }
    expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.latest).not.toHaveBeenCalled();
  });
  it.each(["2026-02-31", "hoy", "2026-13-01"])("rechaza fechas inválidas: %s", async (fecha) => {
    const response = await app.inject({ method: "GET", url: "/api/notificaciones/vista-previa-individual?fecha=" + fecha, headers });
    expect(response.statusCode).toBe(400); expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("conserva la diferencia entre aceptación SMTP y entrega", async () => {
    const response = await app.inject({ method: "GET", url: "/api/notificaciones/ultimos-resultados-individuales", headers });
    expect(response.json()).toMatchObject({ automaticEnabled: false, disponible: true, data: [{ estado: "ACEPTADO_SMTP" }] });
    expect(response.body).not.toMatch(/entregado|entregadoAt|ENVIADO/);
  });
  it("no inventa resultados si la migración está pendiente o una consulta falla", async () => {
    mocks.latest.mockResolvedValueOnce({ disponible: false, data: [] });
    expect((await app.inject({ method: "GET", url: "/api/notificaciones/ultimos-resultados-individuales", headers })).json().disponible).toBe(false);
    mocks.preview.mockRejectedValueOnce(new Error("detalle privado"));
    const failed = await app.inject({ method: "GET", url: "/api/notificaciones/vista-previa-individual", headers });
    expect(failed.statusCode).toBe(503); expect(failed.body).not.toContain("detalle privado");
  });
});
