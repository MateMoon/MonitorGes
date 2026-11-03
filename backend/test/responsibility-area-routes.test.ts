import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(), hashPassword: vi.fn(),
  listActiveStaff: vi.fn(), listCatalogs: vi.fn(), listUserAreas: vi.fn(), saveUserAreas: vi.fn(),
  createCatalogEntry: vi.fn(), createAllowedCombination: vi.fn(), setCatalogActive: vi.fn(),
}));
vi.mock("../src/modules/auth/auth-service.js", () => ({ getSessionUser: mocks.getSessionUser, hashPassword: mocks.hashPassword }));
vi.mock("../src/modules/areas-responsabilidad/repository.js", () => ({
  listActiveStaff: mocks.listActiveStaff, listCatalogs: mocks.listCatalogs, listUserAreas: mocks.listUserAreas,
  saveUserAreas: mocks.saveUserAreas, createCatalogEntry: mocks.createCatalogEntry,
  createAllowedCombination: mocks.createAllowedCombination, setCatalogActive: mocks.setCatalogActive,
}));

import Fastify from "fastify";
import { responsibilityAreaRoutes } from "../src/modules/areas-responsabilidad/routes.js";
import { userRoutes } from "../src/modules/usuarios/routes.js";

const userId = "00000000-0000-4000-8000-000000000001";
const area = { id: "area-1", usuarioId: userId, establecimientoId: "00000000-0000-4000-8000-000000000003", combinacionId: "00000000-0000-4000-8000-000000000004", activa: true };

describe("permisos de áreas de responsabilidad", () => {
  const app = Fastify();
  app.decorateRequest("authUser", null);
  app.register(responsibilityAreaRoutes, { prefix: "/api/areas-responsabilidad" });
  app.register(userRoutes, { prefix: "/api/usuarios" });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockImplementation(async (token: string) => {
      const roles = { admin: "ADMIN", coordinator: "COORDINADOR_SOME", professional: "PROFESIONAL", reader: "LECTOR" } as const;
      const rol = roles[token as keyof typeof roles];
      return rol ? { id: `user-${token}`, username: token, nombre: "Usuario ficticio", email: "ficticio@example.test", rol, puedeCargarNominas: false } : null;
    });
    mocks.listActiveStaff.mockResolvedValue([{ id: userId, nombre: "Profesional ficticio", rol: "PROFESIONAL" }]);
    mocks.listCatalogs.mockResolvedValue({ establecimientos: [], problemasSalud: [], tiposGarantia: [], combinaciones: [] });
    mocks.listUserAreas.mockResolvedValue([area]);
    mocks.saveUserAreas.mockResolvedValue({ ok: true, areas: [area] });
    mocks.createCatalogEntry.mockResolvedValue({ duplicate: false, created: { id: "catalog-1", nombre: "Centro ficticio" } });
    mocks.createAllowedCombination.mockResolvedValue({ invalid: false, created: { id: "combo-1" } });
    mocks.setCatalogActive.mockResolvedValue({ blocked: false, changed: 1 });
  });

  afterAll(async () => { await app.close(); });

  it("permite que ADMIN gestione catálogos y áreas", async () => {
    const headers = { cookie: "ges_session=admin" };
    const catalog = await app.inject({ method: "POST", url: "/api/areas-responsabilidad/catalogos/establecimiento", headers, payload: { nombre: "Centro ficticio" } });
    const areas = await app.inject({ method: "PUT", url: `/api/areas-responsabilidad/usuarios/${userId}`, headers, payload: { areas: [{ establecimientoId: area.establecimientoId, combinacionId: area.combinacionId }] } });
    expect(catalog.statusCode).toBe(201);
    expect(areas.statusCode).toBe(200);
    expect(mocks.saveUserAreas).toHaveBeenCalledWith(userId, "user-admin", [{ establecimientoId: "00000000-0000-4000-8000-000000000003", combinacionId: "00000000-0000-4000-8000-000000000004" }]);
  });

  it("permite al coordinador SOME consultar funcionarios y guardar áreas, pero no administrar catálogos ni cuentas", async () => {
    const headers = { cookie: "ges_session=coordinator" };
    const staff = await app.inject({ method: "GET", url: "/api/areas-responsabilidad/usuarios", headers });
    const areas = await app.inject({ method: "PUT", url: `/api/areas-responsabilidad/usuarios/${userId}`, headers, payload: { areas: [] } });
    const catalog = await app.inject({ method: "POST", url: "/api/areas-responsabilidad/catalogos/establecimiento", headers, payload: { nombre: "Centro ficticio" } });
    const accounts = await app.inject({ method: "GET", url: "/api/usuarios", headers });
    expect(staff.statusCode).toBe(200);
    expect(areas.statusCode).toBe(200);
    expect(catalog.statusCode).toBe(403);
    expect(accounts.statusCode).toBe(403);
    expect(mocks.createCatalogEntry).not.toHaveBeenCalled();
  });

  it.each(["professional", "reader"] as const)("deniega modificación de áreas a %s", async (role) => {
    const response = await app.inject({ method: "PUT", url: `/api/areas-responsabilidad/usuarios/${userId}`, headers: { cookie: `ges_session=${role}` }, payload: { areas: [] } });
    expect(response.statusCode).toBe(403);
    expect(mocks.saveUserAreas).not.toHaveBeenCalled();
  });

  it("rechaza identificadores y cuerpos inválidos antes de invocar el repositorio", async () => {
    const invalidId = await app.inject({ method: "PUT", url: "/api/areas-responsabilidad/usuarios/not-a-uuid", headers: { cookie: "ges_session=admin" }, payload: { areas: [] } });
    const invalidArea = await app.inject({ method: "PUT", url: `/api/areas-responsabilidad/usuarios/${userId}`, headers: { cookie: "ges_session=admin" }, payload: { areas: [{ establecimientoId: "bad", combinacionId: "bad" }] } });
    expect(invalidId.statusCode).toBe(400);
    expect(invalidArea.statusCode).toBe(400);
    expect(mocks.saveUserAreas).not.toHaveBeenCalled();
  });
});
