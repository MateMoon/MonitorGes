import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), findUnique: vi.fn(), count: vi.fn(), update: vi.fn(), deleteMany: vi.fn(), hashPassword: vi.fn() }));
vi.mock("../src/db/prisma.js", () => ({ prisma: { usuario: { create: mocks.create, findUnique: mocks.findUnique, count: mocks.count, update: mocks.update }, sesionUsuario: { deleteMany: mocks.deleteMany }, $transaction: vi.fn() } }));
vi.mock("../src/modules/auth/auth-service.js", () => ({ hashPassword: mocks.hashPassword }));
vi.mock("../src/modules/auth/routes.js", () => ({ requireRoles: () => async () => undefined }));

import Fastify from "fastify";
import { userRoutes } from "../src/modules/usuarios/routes.js";

describe("POST /api/usuarios", () => {
  const app = Fastify();
  app.register(userRoutes, { prefix: "/api/usuarios" });
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.findUnique.mockReset();
    mocks.count.mockReset();
    mocks.update.mockReset();
    mocks.deleteMany.mockReset();
    mocks.hashPassword.mockReset().mockResolvedValue("scrypt$hash-for-test");
    mocks.create.mockResolvedValue({
      id: "user-id",
      nombre: "Usuario QA",
      username: "usuario.qa",
      email: "usuario@example.test",
      rol: "LECTOR",
      puedeCargarNominas: false,
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
        puedeCargarNominas: false,
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
      puedeCargarNominas: false,
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
        puedeCargarNominas: false,
        password: "a-long-test-password",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("USER_ALREADY_EXISTS");
  });

  it("persists the coordinator profile and explicit payroll permission", async () => {
    const response = await app.inject({ method: "POST", url: "/api/usuarios", payload: {
      nombre: "Coordinador Ficticio", username: "coord.ficticio", email: "coord@example.test",
      rol: "COORDINADOR_SOME", puedeCargarNominas: true, password: "another-long-test-password",
    } });
    expect(response.statusCode).toBe(201);
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ rol: "COORDINADOR_SOME", puedeCargarNominas: true });
    expect(response.json().data).not.toHaveProperty("passwordHash");
  });

  it("persists an edited profile and payroll permission", async () => {
    mocks.findUnique.mockResolvedValue({ id: "user-id", rol: "PROFESIONAL", activo: true, puedeCargarNominas: false });
    mocks.update.mockResolvedValue({ id: "user-id", nombre: "Profesional Ficticio", email: "professional@example.test", rol: "PROFESIONAL", puedeCargarNominas: true, activo: true });
    const response = await app.inject({ method: "PUT", url: "/api/usuarios/user-id", payload: {
      nombre: "Profesional Ficticio", email: "professional@example.test", rol: "PROFESIONAL", activo: true, puedeCargarNominas: true,
    } });
    expect(response.statusCode).toBe(200);
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({ rol: "PROFESIONAL", puedeCargarNominas: true });
    expect(response.json().data.puedeCargarNominas).toBe(true);
  });

  it("rejects a payroll permission for LECTOR", async () => {
    const response = await app.inject({ method: "POST", url: "/api/usuarios", payload: {
      nombre: "Lector Ficticio", username: "lector.ficticio", email: "lector@example.test",
      rol: "LECTOR", puedeCargarNominas: true, password: "another-long-test-password",
    } });
    expect(response.statusCode).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("prevents deactivating or demoting the last active administrator", async () => {
    mocks.findUnique.mockResolvedValue({ id: "last-admin", rol: "ADMIN", activo: true, puedeCargarNominas: false });
    mocks.count.mockResolvedValue(1);
    const response = await app.inject({ method: "PUT", url: "/api/usuarios/last-admin", payload: {
      nombre: "Admin Ficticio", email: "admin@example.test", rol: "COORDINADOR_SOME", activo: true,
    } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("LAST_ADMIN");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("revokes sessions after deactivation and password changes", async () => {
    mocks.findUnique.mockResolvedValue({ id: "user-id", rol: "PROFESIONAL", activo: true, puedeCargarNominas: true });
    mocks.update.mockResolvedValue({ id: "user-id", rol: "PROFESIONAL", activo: false, puedeCargarNominas: true });
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    const deactivated = await app.inject({ method: "PUT", url: "/api/usuarios/user-id", payload: {
      nombre: "Usuario Ficticio", email: "user@example.test", rol: "PROFESIONAL", activo: false, puedeCargarNominas: true,
    } });
    expect(deactivated.statusCode).toBe(200);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { usuarioId: "user-id" } });

    mocks.findUnique.mockResolvedValueOnce({ id: "user-id" });
    const password = await app.inject({ method: "PUT", url: "/api/usuarios/user-id/contrasena", payload: { password: "new-long-test-password" } });
    expect(password.statusCode).toBe(204);
    expect(mocks.deleteMany).toHaveBeenLastCalledWith({ where: { usuarioId: "user-id" } });
  });
});
