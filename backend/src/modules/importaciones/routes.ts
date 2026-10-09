import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MAX_FILE_SIZE, WorkbookInputError, validateWorkbook } from "./validation-service.js";
import { importWorkbook } from "./import-service.js";
import { importHistoryQuerySchema } from "./schema.js";
import { listImports } from "./repository.js";

async function uploadedFile(request: FastifyRequest) {
  const file = await request.file();
  if (!file) throw new WorkbookInputError("FILE_REQUIRED", "Debes adjuntar el archivo en el campo archivo.");
  if (file.fieldname !== "archivo") throw new WorkbookInputError("FILE_REQUIRED", "El archivo debe enviarse en el campo archivo.");
  return { buffer: await file.toBuffer(), filename: file.filename };
}

function uploadError(error: unknown, reply: FastifyReply, request: FastifyRequest, genericStatus: number) {
  if (error instanceof WorkbookInputError) {
    return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: [] } });
  }
  const uploadError = error as { code?: string; statusCode?: number };
  if (uploadError.code === "FST_REQ_FILE_TOO_LARGE" || uploadError.statusCode === 413) {
    return reply.code(413).send({ error: { code: "FILE_TOO_LARGE", message: `El archivo supera el límite de ${MAX_FILE_SIZE / 1024 / 1024} MB.`, details: [] } });
  }
  request.log.error(genericStatus === 500 ? "Falló la importación persistente del Excel" : "Falló la validación del archivo Excel");
  return reply.code(genericStatus).send({ error: { code: genericStatus === 500 ? "IMPORT_FAILED" : "INVALID_FILE", message: genericStatus === 500 ? "No fue posible completar la importación." : "No fue posible procesar el archivo enviado.", details: [] } });
}

export async function importValidationRoutes(app: FastifyInstance) {
  app.get("/", async (request, reply) => {
    const parsed = importHistoryQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Parámetros de paginación inválidos.", details: parsed.error.issues } });
    return { ...(await listImports(parsed.data)) };
  });

  app.post("/validar", async (request, reply) => {
    try {
      const { buffer, filename } = await uploadedFile(request);
      return reply.code(200).send({ data: await validateWorkbook(buffer, filename) });
    } catch (error) {
      return uploadError(error, reply, request, 400);
    }
  });

  app.post("/", async (request, reply) => {
    try {
      const { buffer, filename } = await uploadedFile(request);
      return reply.code(201).send({ data: await importWorkbook(buffer, filename) });
    } catch (error) {
      return uploadError(error, reply, request, error instanceof WorkbookInputError ? 400 : 500);
    }
  });
}
