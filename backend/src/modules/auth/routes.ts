import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticateUser, createSession, getSessionUser, revokeSession, type SafeUser } from "./auth-service.js";

declare module "fastify" {
  interface FastifyRequest { authUser: SafeUser | null; }
}

const COOKIE_NAME = "ges_session";
const loginSchema = z.object({ username: z.string().trim().min(1).max(100), password: z.string().min(1).max(1024) }).strict();
const attempts = new Map<string, { failures: number; blockedUntil: number; startedAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;

function readCookie(request: FastifyRequest) {
  const header = request.headers.cookie ?? "";
  const pair = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
  try { return pair ? decodeURIComponent(pair.slice(COOKIE_NAME.length + 1)) : null; }
  catch { return null; }
}

function writeSessionCookie(reply: FastifyReply, token: string, expiresAt: Date) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  reply.header("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/api; HttpOnly; SameSite=Strict; Expires=${expiresAt.toUTCString()}${secure}`);
}

function clearSessionCookie(reply: FastifyReply) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  reply.header("Set-Cookie", `${COOKIE_NAME}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

function attemptKeys(request: FastifyRequest, username: string) {
  return [
    { key: `pair:${request.ip}:${username.toLocaleLowerCase("en-US")}`, maximum: 5 },
    { key: `ip:${request.ip}`, maximum: 30 },
  ];
}

function checkLoginAllowed(key: string) {
  const now = Date.now();
  const state = attempts.get(key);
  if (!state || state.startedAt + WINDOW_MS <= now) {
    attempts.delete(key);
    return true;
  }
  return state.blockedUntil <= now;
}

function pruneLoginAttempts() {
  const now = Date.now();
  for (const [key, state] of attempts) if (state.startedAt + WINDOW_MS <= now) attempts.delete(key);
  while (attempts.size > 10_000) {
    const oldest = attempts.keys().next().value as string | undefined;
    if (!oldest) break;
    attempts.delete(oldest);
  }
}

function recordLoginFailure(key: string, maximum: number) {
  const now = Date.now();
  const current = attempts.get(key);
  const state = !current || current.startedAt + WINDOW_MS <= now ? { failures: 0, blockedUntil: 0, startedAt: now } : current;
  state.failures += 1;
  if (state.failures >= maximum) state.blockedUntil = now + BLOCK_MS;
  attempts.set(key, state);
}

export function resetLoginRateLimitForTests() { attempts.clear(); }

export async function requireAuthenticated(request: FastifyRequest, reply: FastifyReply) {
  const token = readCookie(request);
  if (!token) return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Inicia sesión para continuar.", details: [] }, requestId: request.id });
  let user: SafeUser | null;
  try { user = await getSessionUser(token); }
  catch (error) {
    request.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "No se pudo verificar la sesion.");
    return reply.code(500).send({ error: { code: "AUTHENTICATION_UNAVAILABLE", message: "No fue posible verificar la sesion.", details: [] }, requestId: request.id });
  }
  if (!user) {
    clearSessionCookie(reply);
    return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "La sesión no es válida o expiró.", details: [] }, requestId: request.id });
  }
  request.authUser = user;
}

export function requireRoles(...roles: SafeUser["rol"][]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await requireAuthenticated(request, reply);
    if (authResult) return authResult;
    if (!request.authUser || !roles.includes(request.authUser.rol)) {
      return reply.code(403).send({ error: { code: "FORBIDDEN", message: "No tienes permisos para realizar esta acción.", details: [] }, requestId: request.id });
    }
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: unknown }>("/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Ingresa usuario y contraseña.", details: [] }, requestId: request.id });
    const keys = attemptKeys(request, parsed.data.username);
    pruneLoginAttempts();
    if (keys.some(({ key }) => !checkLoginAllowed(key))) return reply.code(429).send({ error: { code: "LOGIN_RATE_LIMITED", message: "Demasiados intentos. Espera 15 minutos antes de volver a intentar.", details: [] }, requestId: request.id });
    let user: SafeUser | null;
    try { user = await authenticateUser(parsed.data.username, parsed.data.password); }
    catch (error) {
      request.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "No se pudo consultar la autenticacion.");
      return reply.code(500).send({ error: { code: "AUTHENTICATION_UNAVAILABLE", message: "No fue posible iniciar sesion en este momento.", details: [] }, requestId: request.id });
    }
    if (!user) {
      for (const { key, maximum } of keys) recordLoginFailure(key, maximum);
      request.log.warn({ ip: request.ip }, "Intento de inicio de sesión rechazado.");
      return reply.code(401).send({ error: { code: "INVALID_CREDENTIALS", message: "Usuario o contraseña incorrectos.", details: [] }, requestId: request.id });
    }
    attempts.delete(keys[0].key);
    let session: Awaited<ReturnType<typeof createSession>>;
    try { session = await createSession(user.id); }
    catch (error) {
      request.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "No se pudo crear la sesion.");
      return reply.code(500).send({ error: { code: "AUTHENTICATION_UNAVAILABLE", message: "No fue posible iniciar sesion en este momento.", details: [] }, requestId: request.id });
    }
    writeSessionCookie(reply, session.token, session.expiraAt);
    return { data: { user, expiresAt: session.expiraAt } };
  });

  app.get("/me", { preHandler: requireAuthenticated }, async (request) => ({ data: { user: request.authUser } }));

  app.post("/logout", { preHandler: requireAuthenticated }, async (request, reply) => {
    const token = readCookie(request);
    if (token) {
      try { await revokeSession(token); }
      catch (error) {
        request.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "No se pudo cerrar la sesion.");
        return reply.code(500).send({ error: { code: "AUTHENTICATION_UNAVAILABLE", message: "No fue posible cerrar la sesion.", details: [] }, requestId: request.id });
      }
    }
    clearSessionCookie(reply);
    return reply.code(204).send();
  });
}
