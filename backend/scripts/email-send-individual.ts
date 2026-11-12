import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import { z } from "zod";
import { prisma } from "../src/db/prisma.js";
import { timeInSantiago } from "../src/modules/notificaciones/automation-config.js";
import { createEmailService, readEmailConfig, EmailConfigurationError } from "../src/modules/notificaciones/email-service.js";
import { individualReportStore, inspectManualIndividualRecipients } from "../src/modules/notificaciones/individual-report-repository.js";
import { ManualReportError, sendManualIndividualReport } from "../src/modules/notificaciones/manual-individual-report.js";

// No importa server.ts ni inicia el programador, incluso durante el envío real.
process.env.AUTO_EMAIL_ENABLED = "false";

async function main() {
  const { values } = parseArgs({ options: {
    list: { type: "boolean" },
    user: { type: "string" },
    send: { type: "boolean" },
    "confirm-email": { type: "string" },
    "confirm-scope": { type: "string" },
    "confirm-real-data": { type: "boolean" },
    help: { type: "boolean" },
  }, strict: true, allowPositionals: false });
  if (values.help) {
    console.info("Desde backend: node dist/scripts/email-send-individual.js --list\nSeleccionar: --user <UUID>\nEnviar una sola vez hoy: --user <UUID> --send --confirm-email <correo mostrado> --confirm-scope <huella mostrada> --confirm-real-data\nEl envío real requiere autorización explícita del destinatario y de los datos reales. No acepta fechas alternativas ni omite la deduplicación.");
    return;
  }
  if ((!values.list && !values.user) || (values.list && values.user) || (values.list && values.send)) {
    throw new ManualReportError("ELIGE_LIST_O_UN_USUARIO_EXPLICITO");
  }
  if (values.user && !z.uuid().safeParse(values.user).success) throw new ManualReportError("USUARIO_ID_INVALIDO");
  if (values.send && (!values["confirm-email"] || !values["confirm-scope"] || values["confirm-real-data"] !== true)) {
    throw new ManualReportError("CONFIRMA_CORREO_ALCANCE_Y_ENVIO_DE_DATOS_REALES");
  }
  if (!values.send && (values["confirm-email"] || values["confirm-scope"] || values["confirm-real-data"])) {
    throw new ManualReportError("CONFIRMACION_REQUIERE_SEND");
  }

  let backendRoot = path.resolve(import.meta.dirname, "..");
  if (!fs.existsSync(path.join(backendRoot, "prisma/schema.prisma"))) backendRoot = path.resolve(backendRoot, "..");
  const envPath = path.join(backendRoot, ".env");
  const fileEnv = dotenv.parse(fs.readFileSync(envPath));
  dotenv.config({ path: envPath });
  const databaseName = (url: string | undefined) => {
    try { return decodeURIComponent(new URL(url!).pathname.slice(1)); } catch { return null; }
  };
  if (databaseName(fileEnv.DATABASE_URL) !== "monitor_garantias_qa" || databaseName(process.env.DATABASE_URL) !== "monitor_garantias_qa") {
    throw new ManualReportError("EL_COMANDO_SOLO_PERMITE_MONITOR_GARANTIAS_QA");
  }
  if (fileEnv.AUTO_EMAIL_ENABLED !== "false") throw new ManualReportError("AUTO_EMAIL_ENABLED_DEBE_SER_FALSE_EN_ENV");
  const [identity] = await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
  if (identity.database !== "monitor_garantias_qa") throw new ManualReportError("CONEXION_NO_CORRESPONDE_A_QA");
  const date = timeInSantiago(new Date()).date;
  const candidates = await inspectManualIndividualRecipients(date, values.user);
  if (values.list) {
    console.info(JSON.stringify({ database: identity.database, fechaInforme: date, automaticEnabled: false,
      destinatarios: candidates.filter((entry) => !entry.motivo),
      siguientePaso: "Elige explícitamente un usuario y confirma su correo y el envío de datos reales. Esta lista no realiza envíos ni reservas.",
    }, null, 2));
    return;
  }
  const selected = candidates[0];
  if (!selected) throw new ManualReportError("USUARIO_NO_ENCONTRADO");
  console.info(JSON.stringify({ database: identity.database, fechaInforme: date, automaticEnabled: false, seleccionado: selected }, null, 2));
  if (selected.motivo) throw new ManualReportError(selected.motivo);
  if (!values.send) {
    console.info("NO ENVIADO: confirma este destinatario y autoriza los datos reales antes de usar --send con las tres confirmaciones. No se creó reserva ni se conectó SMTP.");
    return;
  }

  const confirmedEmail = values["confirm-email"]!.trim().toLowerCase();
  if (confirmedEmail !== selected.destinatario || values["confirm-scope"] !== selected.huellaConfiguracion) {
    throw new ManualReportError("DESTINATARIO_O_TIPOS_NO_CONFIRMADOS");
  }
  // Solo después de las confirmaciones se construye el transporte. El servicio
  // vuelve a validar la cuenta bajo bloqueo y decide si la deduplicación permite SMTP.
  const mailer = createEmailService(readEmailConfig(process.env, { requireTestRecipient: false }), {
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000,
  });
  const result = await sendManualIndividualReport({
    usuarioId: values.user!, fechaInforme: date, confirmedEmail,
    confirmedFingerprint: values["confirm-scope"]!, realDataConfirmed: values["confirm-real-data"] === true,
    store: individualReportStore, mailer,
  });
  const history = await prisma.envioInformeIndividual.findFirst({
    where: { usuarioId: values.user!, fechaInforme: new Date(`${date}T00:00:00.000Z`) }, orderBy: { createdAt: "desc" },
    select: { id: true, claveEjecucion: true, destinatario: true, estado: true, cantidadGarantias: true, intentos: true, codigoResultado: true, messageId: true, aceptadoSmtpAt: true },
  });
  console.info(JSON.stringify({ database: identity.database, fechaInforme: date, destinatarioAutorizado: confirmedEmail,
    resultado: result, registro: history, automaticEnabled: false,
    entrega: "ACEPTADO_SMTP confirma aceptación del transporte; la llegada al buzón debe comprobarla el destinatario.",
  }, null, 2));
  if (result.resumen.aceptadosSmtp !== 1) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ ok: false,
    code: error instanceof ManualReportError ? error.message : error instanceof EmailConfigurationError ? "CONFIGURACION_SMTP_INCOMPLETA" : "ERROR_ENVIO_MANUAL_REVISAR_HISTORIAL",
    detalle: error instanceof EmailConfigurationError ? error.message : "No se muestran cuerpos de informes, credenciales ni errores crudos. No fuerces otro envío borrando registros.",
  }));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
