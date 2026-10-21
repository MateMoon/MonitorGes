import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { hashPassword } from "../auth/auth-service.js";
import { requireRoles } from "../auth/routes.js";

const roles = ["ADMIN", "PROFESIONAL", "LECTOR"] as const;
const createSchema = z.object({ nombre: z.string().trim().min(2).max(120), username: z.string().trim().min(3).max(100).regex(/^[\w.-]+$/), email: z.string().trim().email().max(254), rol: z.enum(roles), password: z.string().min(12).max(128) }).strict();
const updateSchema = z.object({ nombre: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254), rol: z.enum(roles), activo: z.boolean() }).strict();
const passwordSchema = z.object({ password: z.string().min(12).max(128) }).strict();
const safeSelect = { id: true, nombre: true, username: true, email: true, rol: true, activo: true, ultimoAccesoAt: true, createdAt: true } as const;

export async function userRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: requireRoles("ADMIN") }, async () => ({ data: await prisma.usuario.findMany({ select: safeSelect, orderBy: [{ activo: "desc" }, { nombre: "asc" }] }) }));

  app.post<{ Body: unknown }>("/", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Revisa los datos. La contraseña debe tener al menos 12 caracteres.", details: parsed.error.issues } });
    try {
      const { password, ...userData } = parsed.data;
      const passwordHash = await hashPassword(password);
      const user = await prisma.usuario.create({ data: { ...userData, passwordHash }, select: safeSelect });
      return reply.code(201).send({ data: user });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") return reply.code(409).send({ error: { code: "USER_ALREADY_EXISTS", message: "El nombre de usuario o correo ya está registrado.", details: [] } });
      throw error;
    }
  });

  app.put<{ Params: { id: string }; Body: unknown }>("/:id", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Revisa los datos del usuario.", details: parsed.error.issues } });
    const existing = await prisma.usuario.findUnique({ where: { id: request.params.id }, select: { id: true, rol: true, activo: true } });
    if (!existing) return reply.code(404).send({ error: { code: "USER_NOT_FOUND", message: "No se encontró el usuario.", details: [] } });
    const removesAdmin = existing.rol === "ADMIN" && existing.activo && (parsed.data.rol !== "ADMIN" || !parsed.data.activo);
    if (removesAdmin) {
      const admins = await prisma.usuario.count({ where: { rol: "ADMIN", activo: true } });
      if (admins <= 1) return reply.code(409).send({ error: { code: "LAST_ADMIN", message: "Debe quedar al menos un administrador activo.", details: [] } });
    }
    try {
      const user = await prisma.usuario.update({ where: { id: request.params.id }, data: parsed.data, select: safeSelect });
      if (!user.activo) await prisma.sesionUsuario.deleteMany({ where: { usuarioId: user.id } });
      return { data: user };
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") return reply.code(409).send({ error: { code: "USER_ALREADY_EXISTS", message: "El correo ya está registrado.", details: [] } });
      throw error;
    }
  });

  app.put<{ Params: { id: string }; Body: unknown }>("/:id/contrasena", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const parsed = passwordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "La contraseña debe tener entre 12 y 128 caracteres.", details: parsed.error.issues } });
    const user = await prisma.usuario.findUnique({ where: { id: request.params.id }, select: { id: true } });
    if (!user) return reply.code(404).send({ error: { code: "USER_NOT_FOUND", message: "No se encontró el usuario.", details: [] } });
    await prisma.$transaction([prisma.usuario.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(parsed.data.password) } }), prisma.sesionUsuario.deleteMany({ where: { usuarioId: user.id } })]);
    return reply.code(204).send();
  });
}
