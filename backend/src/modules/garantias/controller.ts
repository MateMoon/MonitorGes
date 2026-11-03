import type { FastifyReply, FastifyRequest } from "fastify";
import { getGuarantee, getGuarantees, getGuaranteeFilterOptions } from "./service.js";
import { actionSchema, stateChangeSchema, reopenSchema, ManagementError } from "./management.js";
import { writeManagement } from "./management-repository.js";
import { listQuerySchema } from "./schema.js";

export async function listController(request: FastifyRequest, reply: FastifyReply) {
  const parsed = listQuerySchema.safeParse(request.query);
  if (!parsed.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Parámetros inválidos", details: parsed.error.issues }, requestId: request.id });
  return getGuarantees(parsed.data);
}

export async function filterOptionsController() {
  return { data: await getGuaranteeFilterOptions() };
}

export async function detailController(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const { id } = request.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "ID UUID inválido", details: [] }, requestId: request.id });
  const data = await getGuarantee(id);
  if (!data) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Garantía no encontrada", details: [] }, requestId: request.id });
  return { data };
}

export const managementController = managementHandler("actuacion");
export const stateChangeController = managementHandler("estado");
export const reopenController = managementHandler("reabrir");

function managementHandler(operation: "actuacion" | "estado" | "reabrir") {
return async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
  const { id } = request.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "ID UUID inválido", details: [] }, requestId: request.id });
  }

  try {
    const command = operation === "actuacion" ? { operacion: operation, ...actionSchema.parse(request.body) }
      : operation === "estado" ? { operacion: operation, ...stateChangeSchema.parse(request.body) }
      : { operacion: operation, ...reopenSchema.parse(request.body) };
    const management = await writeManagement(id, request.authUser!, command);
    if (!management) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Garantía no encontrada", details: [] }, requestId: request.id });
    return { data: management };
  } catch (error) {
    if (error instanceof ManagementError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: [] }, requestId: request.id });
    if (error instanceof Error && error.name === "ZodError") return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Revisa el tipo, comentario, respaldo o motivo y la revisión del seguimiento.", details: [] }, requestId: request.id });
    request.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "No se pudo registrar la gestión de la garantía.");
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "No fue posible registrar la gestión.", details: [] }, requestId: request.id });
  }
};
}
