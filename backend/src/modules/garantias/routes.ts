import type { FastifyInstance } from "fastify";
import { detailController, filterOptionsController, listController, managementController } from "./controller.js";
import { requireAuthenticated, requireRoles } from "../auth/routes.js";

export async function guaranteeRoutes(app: FastifyInstance) {
  app.get("/opciones-filtros", { preHandler: requireAuthenticated }, filterOptionsController);
  app.get("/", { preHandler: requireAuthenticated }, listController);
  app.get<{ Params: { id: string } }>("/:id", { preHandler: requireAuthenticated }, detailController);
  app.post<{ Params: { id: string } }>("/:id/gestion", { preHandler: requireRoles("ADMIN", "PROFESIONAL") }, managementController);
}
