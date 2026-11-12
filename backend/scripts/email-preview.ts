import "dotenv/config";
import { prisma } from "../src/db/prisma.js";
import { timeInSantiago } from "../src/modules/notificaciones/automation-config.js";
import { previewIndividualReports } from "../src/modules/notificaciones/individual-report-repository.js";

// Solo SELECT en una transacción READ ONLY. No importa el servicio SMTP ni server.ts.
process.env.AUTO_EMAIL_ENABLED = "false";
const args = process.argv.slice(2);
const date = args.length === 0 ? timeInSantiago(new Date()).date : args.length === 2 && args[0] === "--date" ? args[1] : "";
const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
if (!valid) { console.error("Usa email:preview [-- --date AAAA-MM-DD]."); process.exitCode = 1; }
else {
  try { console.info(JSON.stringify(await previewIndividualReports(date), null, 2)); }
  catch { console.error("No fue posible consultar la vista previa. Se omiten detalles para proteger los datos y la conexión."); process.exitCode = 1; }
  finally { await prisma.$disconnect(); }
}
