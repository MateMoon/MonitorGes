import Fastify from "fastify";
import { dashboardRoutes } from "./modules/dashboard/routes.js";
import { guaranteeRoutes } from "./modules/garantias/routes.js";

export function buildApp() {
  const app = Fastify({ logger: true });
  app.register(guaranteeRoutes, { prefix: "/api/garantias" });
  app.register(dashboardRoutes, { prefix: "/api/dashboard" });
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    const message = error instanceof Error ? error.message : "Error inesperado";
    return reply.code(statusCode).send({ error: { code: statusCode === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR", message: statusCode === 500 ? "Error interno del servidor" : message, details: [] }, requestId: request.id });
  });
  return app;
}
