import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireRoles } from "../auth/routes.js";
import { SUPERVISION_ROLES } from "../auth/permissions.js";
import { createQualityResolutionService, resolveBodySchema } from "./resolution-service.js";
import { decisionsPageSchema, identifierSchema, parseInput, pendingPageSchema, RowPersistenceError } from "./contracts.js";
import { readDataQualityConfig } from "./config.js";

const paging = { page: z.coerce.number().int().min(1).max(1000000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) };
const pendingQuery = pendingPageSchema.extend(paging), decisionsQuery = decisionsPageSchema.extend(paging);
const paramsSchema = z.object({ id: identifierSchema }).strict();
// Route-local logging also prevents malformed URLs/queries from echoing patient
// identifiers. Operational audit is persisted transactionally, not in HTTP logs.
const privateRoute = { logLevel: "silent" as const };
function respondError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  const known = error instanceof RowPersistenceError;
  const code = known ? error.code : "DATA_QUALITY_UNAVAILABLE";
  // No raw errors, SQL parameters, request bodies or clinical values in logs.
  if (!known || error.statusCode >= 500) request.log.error({ code }, "No fue posible completar la revisión de importación.");
  return reply.code(known ? error.statusCode : 503).send({ error: { code, message: known ? error.message : "No fue posible completar la revisión. Intenta nuevamente.", details: [] }, requestId: request.id });
}
export async function dataQualityRoutes(app: FastifyInstance) {
  const service = createQualityResolutionService(prisma), roles = requireRoles(...SUPERVISION_ROLES);
  app.setErrorHandler((error, request, reply) => {
    const malformed = (error as { statusCode?: number }).statusCode === 400;
    return respondError(malformed ? new RowPersistenceError("INVALID_QUALITY_REQUEST", "La solicitud de revisión no es válida.", 400) : error, request, reply);
  });
  app.addHook("preHandler", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    await roles(request, reply);
    if (reply.sent) return;
    try {
      if (!readDataQualityConfig()) return reply.code(503).send({ error: { code: "DATA_QUALITY_DISABLED", message: "Calidad de datos todavía no está habilitada.", details: [] }, requestId: request.id });
    } catch (error) { return respondError(error, request, reply); }
  });
  app.get("/pendientes", privateRoute, async (request, reply) => {
    try { return await service.listPending(request.authUser!, parseInput(pendingQuery, request.query)); }
    catch (error) { return respondError(error, request, reply); }
  });
  app.get("/pendientes/:id", privateRoute, async (request, reply) => {
    try { return { data: await service.getPending(request.authUser!, parseInput(paramsSchema, request.params).id) }; }
    catch (error) { return respondError(error, request, reply); }
  });
  app.post("/pendientes/:id/resolver", privateRoute, async (request, reply) => {
    try { return { data: await service.resolve(request.authUser!, parseInput(paramsSchema, request.params).id, parseInput(resolveBodySchema, request.body)) }; }
    catch (error) { return respondError(error, request, reply); }
  });
  app.get("/decisiones", privateRoute, async (request, reply) => {
    try { return await service.listDecisions(request.authUser!, parseInput(decisionsQuery, request.query)); }
    catch (error) { return respondError(error, request, reply); }
  });
}
