import "dotenv/config";
import { buildApp } from "./app.js";
import { prisma } from "./db/prisma.js";
import { startEmailReportScheduler } from "./modules/notificaciones/email-report-scheduler.js";

const app = buildApp();
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";
const stopEmailScheduler = startEmailReportScheduler(app.log);

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    stopEmailScheduler();
    await prisma.$disconnect();
    process.exit(0);
  });
}
