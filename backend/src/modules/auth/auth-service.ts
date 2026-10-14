import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { prisma } from "../../db/prisma.js";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const DUMMY_PASSWORD_HASH = `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${"ab".repeat(16)}$${"00".repeat(KEY_LENGTH)}`;
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function deriveKey(password: string, salt: Buffer, length: number, options: { N: number; r: number; p: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, length, { ...options, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key as Buffer));
  });
}

export type SafeUser = { id: string; username: string; nombre: string; email: string; rol: "ADMIN" | "PROFESIONAL" | "LECTOR" };

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string | null) {
  if (!encoded) return false;
  const [algorithm, n, r, p, saltHex, keyHex] = encoded.split("$");
  if (algorithm !== "scrypt" || Number(n) !== SCRYPT_N || Number(r) !== SCRYPT_R || Number(p) !== SCRYPT_P || !saltHex || saltHex.length !== 32 || !keyHex || keyHex.length !== KEY_LENGTH * 2 || !/^[\da-f]+$/i.test(saltHex) || !/^[\da-f]+$/i.test(keyHex)) return false;
  try {
    const expected = Buffer.from(keyHex, "hex");
    const actual = await deriveKey(password, Buffer.from(saltHex, "hex"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export async function authenticateUser(username: string, password: string) {
  const user = await prisma.usuario.findUnique({ where: { username: username.trim() }, select: { id: true, username: true, nombre: true, email: true, rol: true, activo: true, passwordHash: true } });
  if (!user || !user.activo || !user.passwordHash) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    return null;
  }
  if (!(await verifyPassword(password, user.passwordHash))) return null;
  return { id: user.id, username: user.username, nombre: user.nombre, email: user.email, rol: user.rol } satisfies SafeUser;
}

export async function createSession(usuarioId: string) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiraAt = new Date(now.getTime() + SESSION_TTL_MS);
  await prisma.sesionUsuario.deleteMany({ where: { expiraAt: { lte: now } } });
  await prisma.sesionUsuario.create({ data: { tokenHash: hashSessionToken(token), usuarioId, expiraAt } });
  return { token, expiraAt };
}

export async function getSessionUser(token: string): Promise<SafeUser | null> {
  const session = await prisma.sesionUsuario.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: { expiraAt: true, usuario: { select: { id: true, username: true, nombre: true, email: true, rol: true, activo: true } } },
  });
  if (!session || session.expiraAt.getTime() <= Date.now() || !session.usuario.activo) {
    if (session) await prisma.sesionUsuario.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
    return null;
  }
  const { id, username, nombre, email, rol } = session.usuario;
  return { id, username, nombre, email, rol };
}

export async function revokeSession(token: string) {
  await prisma.sesionUsuario.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}
