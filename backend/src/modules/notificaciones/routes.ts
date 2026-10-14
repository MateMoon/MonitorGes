import type { FastifyInstance } from "fastify";
import { getNotificationEmailConfig, saveNotificationEmail } from "./notification-config-service.js";
import { updateEmailConfigSchema } from "./email-config-schema.js";
import { requireAuthenticated, requireRoles } from "../auth/routes.js";

export async function notificationRoutes(app: FastifyInstance) {
  app.get("/configuracion-correo", { preHandler: requireAuthenticated }, async (request, reply) => {
    try {
      return { data: await getNotificationEmailConfig() };
    } catch (error) {
      request.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "No se pudo consultar la configuracion de correo.");
      return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "No fue posible cargar la configuracion del correo.", details: [] }, requestId: request.id });
    }
  });

  app.put<{ Body: unknown }>("/configuracion-correo", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const parsed = updateEmailConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Ingresa una direccion de correo valida.", details: parsed.error.issues }, requestId: request.id });
    }
    try {
      return { data: await saveNotificationEmail(parsed.data.email) };
    } catch (error) {
      request.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "No se pudo guardar la configuracion de correo.");
      return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "No fue posible guardar la direccion de correo.", details: [] }, requestId: request.id });
    }
  });
}
