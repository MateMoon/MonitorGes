import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), getSessionUser: vi.fn() }));

vi.mock("../src/modules/notificaciones/notification-config-service.js", () => ({ getNotificationEmailConfig: mocks.get, saveNotificationEmails: mocks.save }));
vi.mock("../src/modules/auth/auth-service.js", () => ({ getSessionUser: mocks.getSessionUser }));

import { buildApp } from "../src/app.js";

const admin = { id: "admin-1", username: "admin", nombre: "Admin QA", email: "admin@example.test", rol: "ADMIN" } as const;
const lector = { id: "reader-1", username: "reader", nombre: "Lector QA", email: "reader@example.test", rol: "LECTOR" } as const;

describe("acceso a configuracion de correo", () => {
  const app = buildApp();
  beforeEach(() => {
    mocks.get.mockReset(); mocks.save.mockReset(); mocks.getSessionUser.mockReset();
    mocks.get.mockResolvedValue({ emails: ["qa@example.test", "second@example.test"], email: "qa@example.test", updatedAt: null, automaticEnabled: false, scheduledTime: "08:00" });
    mocks.save.mockResolvedValue({ emails: ["qa@example.test"], email: "qa@example.test", updatedAt: new Date("2026-10-13T12:00:00.000Z") });
    mocks.getSessionUser.mockImplementation(async (token: string) => token === "admin-cookie" ? admin : token === "reader-cookie" ? lector : null);
  });
  afterAll(async () => { await app.close(); });

  it("responde 401 sin sesion y no consulta el destinatario", async () => {
    const response = await app.inject({ method: "GET", url: "/api/notificaciones/configuracion-correo" });
    expect(response.statusCode).toBe(401);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("permite que una sesion valida lea la configuracion", async () => {
    const response = await app.inject({ method: "GET", url: "/api/notificaciones/configuracion-correo", headers: { cookie: "ges_session=reader-cookie" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.emails).toEqual(["qa@example.test", "second@example.test"]);
  });

  it("devuelve 403 a un lector y no cambia el destinatario", async () => {
    const response = await app.inject({ method: "PUT", url: "/api/notificaciones/configuracion-correo", headers: { cookie: "ges_session=reader-cookie", origin: "http://localhost:8443" }, payload: { emails: ["attacker@example.test"] } });
    expect(response.statusCode).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("permite a ADMIN guardar una direccion valida", async () => {
    const response = await app.inject({ method: "PUT", url: "/api/notificaciones/configuracion-correo", headers: { cookie: "ges_session=admin-cookie", origin: "http://localhost:8443" }, payload: { emails: [" QA@Example.Test ", "qa@example.test", "SECOND@example.test"] } });
    expect(response.statusCode).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith(["qa@example.test", "second@example.test"]);
  });

  it("rejects malformed recipient addresses", async () => {
    const response = await app.inject({ method: "PUT", url: "/api/notificaciones/configuracion-correo", headers: { cookie: "ges_session=admin-cookie", origin: "http://localhost:8443" }, payload: { emails: ["bad-address"] } });
    expect(response.statusCode).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("permite al administrador limpiar todos los destinatarios", async () => {
    const response = await app.inject({ method: "PUT", url: "/api/notificaciones/configuracion-correo", headers: { cookie: "ges_session=admin-cookie", origin: "http://localhost:8443" }, payload: { emails: [] } });
    expect(response.statusCode).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith([]);
  });
  it("no acepta roles enviados por el cliente como identidad", async () => {
    const response = await app.inject({ method: "PUT", url: "/api/notificaciones/configuracion-correo", headers: { "x-role": "ADMIN", origin: "http://localhost:8443" }, payload: { emails: ["attacker@example.test"] } });
    expect(response.statusCode).toBe(401);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
