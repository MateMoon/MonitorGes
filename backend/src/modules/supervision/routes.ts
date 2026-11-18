import type { FastifyInstance } from "fastify";
import { requireRoles } from "../auth/routes.js";
import { getSupervisionSummary, getSupervisionActivity } from "./service.js";

export async function supervisionRoutes(app: FastifyInstance) {
  app.get("/eventos", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      return await getSupervisionActivity();
    } catch {
      request.log.error({ code: "SUPERVISION_ACTIVITY_UNAVAILABLE" }, "No fue posible consultar las gestiones y cambios de supervisión.");
      return reply.code(503).send({ error: { code: "SUPERVISION_ACTIVITY_UNAVAILABLE", message: "No fue posible cargar las gestiones y cambios. Intenta nuevamente.", details: [] }, requestId: request.id });
    }
  });
  app.get("/resumen", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      return await getSupervisionSummary();
    } catch {
      // Database errors can embed SQL parameters. Do not log the error object,
      // rule contents, account identifiers or patient data.
      request.log.error({ code: "SUPERVISION_UNAVAILABLE" }, "No fue posible calcular el resumen de supervisión.");
      return reply.code(503).send({ error: { code: "SUPERVISION_UNAVAILABLE", message: "No fue posible calcular el resumen de supervisión. Intenta nuevamente o solicita revisar las reglas de asignación.", details: [] }, requestId: request.id });
    }
  });
}
