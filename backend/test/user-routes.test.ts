import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), hashPassword: vi.fn() }));
vi.mock("../src/db/prisma.js", () => ({ prisma: { usuario: { create: mocks.create } } }));
vi.mock("../src/modules/auth/auth-service.js", () => ({ hashPassword: mocks.hashPassword }));
vi.mock("../src/modules/auth/routes.js", () => ({ requireRoles: () => async () => undefined }));

import Fastify from "fastify";
import { userRoutes } from "../src/modules/usuarios/routes.js";

describe("POST /api/usuarios", () => {
  const app = Fastify();
  app.register(userRoutes, { prefix: "/api/usuarios" });
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.hashPassword.mockReset().mockResolvedValue("scrypt$hash-for-test");
    mocks.create.mockResolvedValue({
      id: "user-id",
      nombre: "Usuario QA",
      username: "usuario.qa",
      email: "usuario@example.test",
      rol: "LECTOR",
      activo: true,
      ultimoAccesoAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  });
  afterAll(async () => { await app.close(); });

  it("persists only the password hash and returns the created safe user", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/usuarios",
      payload: {
        nombre: "Usuario QA",
        username: "usuario.qa",
        email: "usuario@example.test",
        rol: "LECTOR",
        password: "a-long-test-password",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mocks.hashPassword).toHaveBeenCalledWith("a-long-test-password");
    const createArgs = mocks.create.mock.calls[0][0];
    expect(createArgs.data).toEqual({
      nombre: "Usuario QA",
      username: "usuario.qa",
      email: "usuario@example.test",
      rol: "LECTOR",
      passwordHash: "scrypt$hash-for-test",
    });
    expect(createArgs.data).not.toHaveProperty("password");
    expect(response.json().data).not.toHaveProperty("password");
    expect(response.json().data).not.toHaveProperty("passwordHash");
  });

  it("maps duplicate usernames or emails to 409", async () => {
    mocks.create.mockRejectedValueOnce({ code: "P2002" });
    const response = await app.inject({
      method: "POST",
      url: "/api/usuarios",
      payload: {
        nombre: "Usuario QA",
        username: "usuario.qa",
        email: "usuario@example.test",
        rol: "LECTOR",
        password: "a-long-test-password",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("USER_ALREADY_EXISTS");
  });
});
