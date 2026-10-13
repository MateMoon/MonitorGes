import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

// Fail closed until the API has real authentication and role authorization.
// A UI-only login cannot establish a trustworthy identity on this server.
function authenticationNotConfigured(request: FastifyRequest, reply: FastifyReply) {
  return reply.code(503).send({
    error: {
      code: "AUTHENTICATION_NOT_CONFIGURED",
      message: "La configuracion de correo esta deshabilitada hasta integrar autenticacion en el servidor.",
      details: [],
    },
    requestId: request.id,
  });
}

export async function notificationRoutes(app: FastifyInstance) {
  app.get("/configuracion-correo", authenticationNotConfigured);
  app.put<{ Body: unknown }>("/configuracion-correo", authenticationNotConfigured);
}
