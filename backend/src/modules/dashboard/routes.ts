import type { FastifyInstance } from "fastify";
import { getDashboard } from "./service.js";

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/", getDashboard);
}
