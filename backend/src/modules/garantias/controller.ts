import type { FastifyReply, FastifyRequest } from "fastify";
import { getGuarantee, getGuarantees } from "./service.js";
import { listQuerySchema } from "./schema.js";

export async function listController(request: FastifyRequest, reply: FastifyReply) {
  const parsed = listQuerySchema.safeParse(request.query);
  if (!parsed.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Parámetros inválidos", details: parsed.error.issues }, requestId: request.id });
  return getGuarantees(parsed.data);
}

export async function detailController(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const { id } = request.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "ID UUID inválido", details: [] }, requestId: request.id });
  const data = await getGuarantee(id);
  if (!data) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Garantía no encontrada", details: [] }, requestId: request.id });
  return { data };
}
