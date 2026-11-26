import type { FastifyInstance } from "fastify";
import { detailController, filterOptionsController, listController, managementController, stateChangeController, reopenController } from "./controller.js";
import { requireAuthenticated, requireRoles } from "../auth/routes.js";
import { OPERATIONAL_ROLES } from "../auth/permissions.js";

export async function guaranteeRoutes(app: FastifyInstance) {
  app.get("/opciones-filtros", { preHandler: requireAuthenticated }, filterOptionsController);
  app.get("/", { preHandler: requireAuthenticated }, listController);
  app.get<{ Params: { id: string } }>("/:id", { preHandler: requireAuthenticated }, detailController);
  app.post<{ Params: { id: string } }>("/:id/gestion", { preHandler: requireRoles(...OPERATIONAL_ROLES) }, managementController);
  app.post<{ Params: { id: string } }>("/:id/estado-gestion", { preHandler: requireRoles(...OPERATIONAL_ROLES) }, stateChangeController);
  app.post<{ Params: { id: string } }>("/:id/reabrir", { preHandler: requireRoles(...OPERATIONAL_ROLES) }, reopenController);
}
