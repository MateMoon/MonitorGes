import type { FastifyInstance } from "fastify";
import { detailController, listController } from "./controller.js";

export async function guaranteeRoutes(app: FastifyInstance) {
  app.get("/", listController);
  app.get<{ Params: { id: string } }>("/:id", detailController);
}
