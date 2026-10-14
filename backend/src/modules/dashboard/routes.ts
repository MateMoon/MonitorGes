import type { FastifyInstance } from "fastify";
import { getDashboard } from "./service.js";
import { requireAuthenticated } from "../auth/routes.js";

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: requireAuthenticated }, getDashboard);
}
