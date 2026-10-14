import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticateUser: vi.fn(), createSession: vi.fn(), getSessionUser: vi.fn(), revokeSession: vi.fn() }));
vi.mock("../src/modules/auth/auth-service.js", () => mocks);

import { buildApp } from "../src/app.js";
import { resetLoginRateLimitForTests } from "../src/modules/auth/routes.js";

const user = { id: "admin-id", username: "admin", nombre: "Admin QA", email: "admin@example.test", rol: "ADMIN" as const };

describe("sesion de autenticacion", () => {
  const app = buildApp();
  beforeEach(() => {
    resetLoginRateLimitForTests();
    mocks.authenticateUser.mockReset().mockResolvedValue(user);
    mocks.createSession.mockReset().mockResolvedValue({ token: "opaque-random-token", expiraAt: new Date(Date.now() + 60_000) });
    mocks.getSessionUser.mockReset().mockImplementation(async (token: string) => token === "valid-token" ? user : null);
    mocks.revokeSession.mockReset();
  });
  afterAll(async () => { await app.close(); });

  it("inicia sesion con credenciales validas y cookie protegida", async () => {
    const response = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: "http://localhost:8443" }, payload: { username: "admin", password: "long-password-example" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.user).toEqual(user);
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("SameSite=Strict");
    expect(response.headers["set-cookie"]).toContain("Path=/api");
    expect(response.headers["set-cookie"]).not.toContain("long-password-example");
  });

  it("rechaza credenciales invalidas con respuesta generica", async () => {
    mocks.authenticateUser.mockResolvedValueOnce(null);
    const response = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: "http://localhost:8443" }, payload: { username: "missing", password: "wrong" } });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toBe("Usuario o contraseña incorrectos.");
  });

  it("rechaza origenes no configurados en operaciones con cookie", async () => {
    const response = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: "https://evil.example" }, payload: { username: "admin", password: "long-password-example" } });
    expect(response.statusCode).toBe(403);
    expect(mocks.authenticateUser).not.toHaveBeenCalled();
  });

  it("limita intentos repetidos", async () => {
    mocks.authenticateUser.mockResolvedValue(null);
    for (let index = 0; index < 5; index += 1) {
      const response = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: "http://localhost:8443" }, payload: { username: "admin", password: "wrong" } });
      expect(response.statusCode).toBe(401);
    }
    const limited = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: "http://localhost:8443" }, payload: { username: "admin", password: "wrong" } });
    expect(limited.statusCode).toBe(429);
    expect(mocks.authenticateUser).toHaveBeenCalledTimes(5);
  });

  it("requiere sesion y reconoce sesiones invalidas o expiradas", async () => {
    const anonymous = await app.inject({ method: "GET", url: "/api/auth/me" });
    const expired = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: "ges_session=expired-token" } });
    expect(anonymous.statusCode).toBe(401);
    expect(expired.statusCode).toBe(401);
    expect(expired.headers["set-cookie"]).toContain("Max-Age=0");
  });

  it("devuelve la identidad verificada y revoca la sesion al cerrar", async () => {
    const current = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: "ges_session=valid-token" } });
    expect(current.statusCode).toBe(200);
    expect(current.json().data.user).toEqual(user);
    const ended = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: "ges_session=valid-token", origin: "http://localhost:8443" } });
    expect(ended.statusCode).toBe(204);
    expect(mocks.revokeSession).toHaveBeenCalledWith("valid-token");
    expect(ended.headers["set-cookie"]).toContain("Max-Age=0");
  });
});
