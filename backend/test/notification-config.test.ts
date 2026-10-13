import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));

vi.mock("../src/modules/notificaciones/notification-config-service.js", () => ({
  getNotificationEmailConfig: mocks.get,
  saveNotificationEmail: mocks.save,
}));

import { buildApp } from "../src/app.js";

describe("configuracion del destinatario de informes", () => {
  const app = buildApp();

  beforeEach(() => {
    mocks.get.mockReset();
    mocks.save.mockReset();
  });

  afterAll(async () => { await app.close(); });

  it("falla cerrado al consultar la configuracion sin autenticacion de servidor", async () => {
    const response = await app.inject({ method: "GET", url: "/api/notificaciones/configuracion-correo" });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("AUTHENTICATION_NOT_CONFIGURED");
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("no permite modificar el destinatario sin autenticacion y permisos verificables", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/notificaciones/configuracion-correo",
      payload: { email: "qa@example.test" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("AUTHENTICATION_NOT_CONFIGURED");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("no confia en cabeceras de identidad declaradas por el cliente", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/notificaciones/configuracion-correo",
      headers: { authorization: "Bearer fake-admin-token", "x-role": "ADMIN" },
      payload: { email: "qa@example.test" },
    });
    expect(response.statusCode).toBe(503);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
