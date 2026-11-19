import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireRoles } from "../auth/routes.js";
import { assignmentRulesSchema } from "../usuarios/schema.js";
import { UserManagementError } from "../usuarios/repository.js";
import { readResponsibilities, writeResponsibilities } from "./responsibility-repository.js";

const authorized = requireRoles("ADMIN", "COORDINADOR_SOME");
const inputSchema = z.object({ reglasAsignacion: assignmentRulesSchema, revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
function fail(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof UserManagementError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: [] }, requestId: request.id });
  request.log.error({ code: "RESPONSIBILITIES_UNAVAILABLE" }, "No fue posible consultar o guardar las responsabilidades.");
  return reply.code(503).send({ error: { code: "RESPONSIBILITIES_UNAVAILABLE", message: "No fue posible completar la operación de responsabilidades. Intenta nuevamente.", details: [] }, requestId: request.id });
}
export async function supervisionResponsibilityRoutes(app: FastifyInstance) {
  app.get("/responsabilidades", { preHandler: authorized }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try { return { data: await readResponsibilities(request.authUser!.id) }; }
    catch (error) { return fail(error, request, reply); }
  });
  app.put<{ Params: { usuarioId: string }; Body: unknown }>("/responsabilidades/:usuarioId", { preHandler: authorized }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const parsed = inputSchema.safeParse(request.body);
    if (!z.string().uuid().safeParse(request.params.usuarioId).success || !parsed.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Revisa las reglas y vuelve a cargar la configuración si es necesario.", details: [] }, requestId: request.id });
    try {
      const result = await writeResponsibilities(request.authUser!.id, request.params.usuarioId, parsed.data.revision, parsed.data.reglasAsignacion);
      if (result.audit.beforeRevision !== result.audit.afterRevision) request.log.info({ event: "ASSIGNMENT_RULES_CHANGED", source: "SUPERVISION_RESPONSABILIDADES", occurredAt: new Date().toISOString(), ...result.audit }, "Reglas de asignación actualizadas.");
      return { data: result.data };
    } catch (error) { return fail(error, request, reply); }
  });
}
