import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ user: vi.fn(), createSession: vi.fn(), findSession: vi.fn(), deleteSession: vi.fn() }));
vi.mock("../src/db/prisma.js", () => ({ prisma: { usuario: { findUnique: db.user }, sesionUsuario: { create: db.createSession, findUnique: db.findSession, deleteMany: db.deleteSession } } }));

import { authenticateUser, createSession, getSessionUser, hashPassword, hashSessionToken, verifyPassword } from "../src/modules/auth/auth-service.js";

describe("credenciales y sesiones persistentes", () => {
  beforeEach(() => { db.user.mockReset(); db.createSession.mockReset(); db.findSession.mockReset(); db.deleteSession.mockReset(); });

  it("almacena una derivacion scrypt salada y verifica solo la contrasena correcta", async () => {
    const encoded = await hashPassword("a-very-long-test-password");
    expect(encoded.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(encoded).not.toContain("a-very-long-test-password");
    expect(await verifyPassword("a-very-long-test-password", encoded)).toBe(true);
    expect(await verifyPassword("incorrecta", encoded)).toBe(false);
    expect(await verifyPassword("anything", null)).toBe(false);
  });

  it("rechaza usuarios inactivos o contrasenas no validas sin diferenciarlos", async () => {
    const passwordHash = await hashPassword("another-long-test-password");
    db.user.mockResolvedValue({ id: "user-1", username: "staff", nombre: "Staff", email: "staff@example.test", rol: "LECTOR", activo: false, passwordHash });
    expect(await authenticateUser("staff", "another-long-test-password")).toBeNull();
    db.user.mockResolvedValueOnce({ id: "user-1", username: "staff", nombre: "Staff", email: "staff@example.test", rol: "LECTOR", activo: true, passwordHash });
    expect(await authenticateUser("staff", "wrong-password")).toBeNull();
  });

  it("solo persiste el hash del token de sesion y comprueba expiracion y estado activo", async () => {
    db.createSession.mockResolvedValue(undefined);
    const created = await createSession("user-1");
    expect(created.token).toHaveLength(43);
    expect(db.createSession.mock.calls[0][0].data).toMatchObject({ usuarioId: "user-1", tokenHash: hashSessionToken(created.token) });
    expect(db.createSession.mock.calls[0][0].data.tokenHash).not.toBe(created.token);

    db.findSession.mockResolvedValue({ expiraAt: new Date(Date.now() + 60_000), usuario: { id: "user-1", username: "staff", nombre: "Staff", email: "staff@example.test", rol: "LECTOR", activo: true } });
    expect(await getSessionUser(created.token)).toMatchObject({ id: "user-1", rol: "LECTOR" });
    db.findSession.mockResolvedValueOnce({ expiraAt: new Date(Date.now() - 1), usuario: { activo: true } });
    expect(await getSessionUser(created.token)).toBeNull();
    expect(db.deleteSession).toHaveBeenCalledWith({ where: { tokenHash: hashSessionToken(created.token) } });
    db.findSession.mockResolvedValueOnce({ expiraAt: new Date(Date.now() + 60_000), usuario: { activo: false } });
    expect(await getSessionUser(created.token)).toBeNull();
  });
});
