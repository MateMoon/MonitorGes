import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ user: vi.fn(), users: vi.fn(), createSession: vi.fn(), findSession: vi.fn(), deleteSession: vi.fn() }));
vi.mock("../src/db/prisma.js", () => ({ prisma: { usuario: { findUnique: db.user, findMany: db.users }, sesionUsuario: { create: db.createSession, findUnique: db.findSession, deleteMany: db.deleteSession } } }));

import { authenticateUser, createSession, getSessionUser, hashPassword, hashSessionToken, verifyPassword } from "../src/modules/auth/auth-service.js";

describe("credenciales y sesiones persistentes", () => {
  beforeEach(() => { db.user.mockReset(); db.users.mockReset(); db.createSession.mockReset(); db.findSession.mockReset(); db.deleteSession.mockReset(); });

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
    db.user.mockResolvedValue({ id: "user-1", username: "staff", nombre: "Staff", email: "staff@example.test", rol: "LECTOR", puedeCargarNominas: false, activo: false, passwordHash });
    expect(await authenticateUser("staff", "another-long-test-password")).toBeNull();
    db.user.mockResolvedValueOnce({ id: "user-1", username: "staff", nombre: "Staff", email: "staff@example.test", rol: "LECTOR", puedeCargarNominas: false, activo: true, passwordHash });
    expect(await authenticateUser("staff", "wrong-password")).toBeNull();
  });

  it("carga el perfil y permiso de importación desde el usuario persistido", async () => {
    const passwordHash = await hashPassword("coordinator-test-password");
    db.user.mockResolvedValue({ id: "user-1", username: "coord", nombre: "Coordinador", email: "coord@example.test", rol: "COORDINADOR_SOME", puedeCargarNominas: true, activo: true, passwordHash });
    const authenticated = await authenticateUser("coord", "coordinator-test-password");
    expect(authenticated).toMatchObject({ rol: "COORDINADOR_SOME", puedeCargarNominas: true });
    expect(db.user.mock.calls[0][0].select).toMatchObject({ rol: true, puedeCargarNominas: true });
  });

  it("autentica con correo sin distinguir mayúsculas y conserva el usuario y perfil de la cuenta", async () => {
    const passwordHash = await hashPassword(" email-password-with-spaces ");
    const account = { id: "user-1", username: "staff", nombre: "Cuenta sintética", email: "Staff@Example.Test", rol: "PROFESIONAL", puedeCargarNominas: false, activo: true, passwordHash };
    db.users.mockImplementation(async ({ where }: any) => where.OR.some((condition: any) => condition.username === account.username || (condition.email?.mode === "insensitive" && condition.email.equals.toLowerCase() === account.email.toLowerCase())) ? [account] : []);
    const result = await authenticateUser("  STAFF@example.test  ", " email-password-with-spaces ");
    expect(result).toEqual({ id: account.id, username: "staff", nombre: account.nombre, email: account.email, rol: "PROFESIONAL", puedeCargarNominas: false });
    expect(result).not.toHaveProperty("passwordHash");
    expect(db.users).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [{ username: "STAFF@example.test" }, { email: { equals: "STAFF@example.test", mode: "insensitive" } }] }, take: 2 }));
    expect(db.user).not.toHaveBeenCalled();
  });

  it.each(["wrong-password", "inactive", "missing", "ambiguous"])("rechaza el acceso por correo ante %s sin seleccionar otra cuenta", async (kind) => {
    const passwordHash = await hashPassword("correct-test-password");
    const account = { id: "user-1", username: "staff", nombre: "Cuenta sintética", email: "staff@example.test", rol: "PROFESIONAL", puedeCargarNominas: false, activo: kind !== "inactive", passwordHash };
    db.users.mockResolvedValue(kind === "missing" ? [] : kind === "ambiguous" ? [account, { ...account, id: "user-2", email: "STAFF@example.test" }] : [account]);
    expect(await authenticateUser("staff@example.test", kind === "wrong-password" ? "incorrect" : "correct-test-password")).toBeNull();
    expect(db.createSession).not.toHaveBeenCalled();
  });

  it("solo persiste el hash del token de sesion y comprueba expiracion y estado activo", async () => {
    db.createSession.mockResolvedValue(undefined);
    const created = await createSession("user-1");
    expect(created.token).toHaveLength(43);
    expect(db.createSession.mock.calls[0][0].data).toMatchObject({ usuarioId: "user-1", tokenHash: hashSessionToken(created.token) });
    expect(db.createSession.mock.calls[0][0].data.tokenHash).not.toBe(created.token);

    db.findSession.mockResolvedValue({ expiraAt: new Date(Date.now() + 60_000), usuario: { id: "user-1", username: "staff", nombre: "Staff", email: "staff@example.test", rol: "LECTOR", puedeCargarNominas: false, activo: true } });
    expect(await getSessionUser(created.token)).toMatchObject({ id: "user-1", rol: "LECTOR", puedeCargarNominas: false });
    db.findSession.mockResolvedValueOnce({ expiraAt: new Date(Date.now() - 1), usuario: { activo: true } });
    expect(await getSessionUser(created.token)).toBeNull();
    expect(db.deleteSession).toHaveBeenCalledWith({ where: { tokenHash: hashSessionToken(created.token) } });
    db.findSession.mockResolvedValueOnce({ expiraAt: new Date(Date.now() + 60_000), usuario: { activo: false } });
    expect(await getSessionUser(created.token)).toBeNull();
  });
});
