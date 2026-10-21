import cors from '@fastify/cors';
import Fastify from 'fastify';
import { dashboardRoutes } from './modules/dashboard/routes.js';
import { guaranteeRoutes } from './modules/garantias/routes.js';
import multipart from '@fastify/multipart';
import { importValidationRoutes } from './modules/importaciones/routes.js';
import { notificationRoutes } from './modules/notificaciones/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { userRoutes } from './modules/usuarios/routes.js';

export function buildApp() {
  const app = Fastify({ logger: true });
  app.decorateRequest('authUser', null);
  const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:8443')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.register(cors, {
    credentials: true,
    origin(origin, callback) {
      callback(null, origin === undefined || allowedOrigins.includes(origin));
    },
  });
  app.addHook('onRequest', async (request, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    const origin = request.headers.origin;
    if (!origin || !allowedOrigins.includes(origin)) {
      return reply.code(403).send({ error: { code: 'ORIGIN_FORBIDDEN', message: 'El origen de esta solicitud no está permitido.', details: [] }, requestId: request.id });
    }
  });
  app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1, parts: 1 } });
  app.register(authRoutes, { prefix: '/api/auth' });
  app.register(userRoutes, { prefix: '/api/usuarios' });
  app.register(guaranteeRoutes, { prefix: '/api/garantias' });
  app.register(importValidationRoutes, { prefix: '/api/importaciones' });
  app.register(dashboardRoutes, { prefix: '/api/dashboard' });
  app.register(notificationRoutes, { prefix: '/api/notificaciones' });
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    const message = error instanceof Error ? error.message : 'Error inesperado';
    return reply.code(statusCode).send({ error: { code: statusCode === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR', message: statusCode === 500 ? 'Error interno del servidor' : message, details: [] }, requestId: request.id });
  });
  return app;
}
