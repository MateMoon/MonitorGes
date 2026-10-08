import cors from '@fastify/cors';
import Fastify from 'fastify';
import { dashboardRoutes } from './modules/dashboard/routes.js';
import { guaranteeRoutes } from './modules/garantias/routes.js';

export function buildApp() {
  const app = Fastify({ logger: true });
  const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:8443')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.register(cors, {
    origin(origin, callback) {
      callback(null, origin === undefined || allowedOrigins.includes(origin));
    },
  });
  app.register(guaranteeRoutes, { prefix: '/api/garantias' });
  app.register(dashboardRoutes, { prefix: '/api/dashboard' });
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    const message = error instanceof Error ? error.message : 'Error inesperado';
    return reply.code(statusCode).send({ error: { code: statusCode === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR', message: statusCode === 500 ? 'Error interno del servidor' : message, details: [] }, requestId: request.id });
  });
  return app;
}
