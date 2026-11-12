import type { FastifyInstance } from "fastify";
import { getNotificationEmailConfig, saveNotificationEmails } from "./notification-config-service.js";
import { updateEmailConfigSchema } from "./email-config-schema.js";
import { requireAuthenticated, requireRoles } from "../auth/routes.js";
import { latestIndividualResults, previewIndividualReports } from "./individual-report-repository.js";
import { readEmailAutomationConfig, timeInSantiago } from "./automation-config.js";

export async function notificationRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { fecha?: string } }>("/vista-previa-individual", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const date = request.query.fecha ?? timeInSantiago(new Date()).date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) return reply.code(400).send({ error: { code: "INVALID_DATE", message: "Ingresa una fecha civil válida AAAA-MM-DD." } });
    try { return { data: await previewIndividualReports(date) }; }
    catch { return reply.code(503).send({ error: { code: "PREVIEW_UNAVAILABLE", message: "No fue posible consultar la vista previa individual." } }); }
  });
  app.get("/ultimos-resultados-individuales", { preHandler: requireRoles("ADMIN") }, async (_request, reply) => {
    try { return { ...await latestIndividualResults(), automaticEnabled: readEmailAutomationConfig().enabled }; }
    catch { return reply.code(503).send({ error: { code: "RESULTS_UNAVAILABLE", message: "No fue posible consultar los resultados individuales." } }); }
  });
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
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues.map((issue) => issue.message).join(" "), details: parsed.error.issues }, requestId: request.id });
    }
    try {
      return { data: await saveNotificationEmails(parsed.data.emails) };
    } catch (error) {
      request.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "No se pudo guardar la configuracion de correo.");
      return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "No fue posible guardar la direccion de correo.", details: [] }, requestId: request.id });
    }
  });
}
