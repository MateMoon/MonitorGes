import "dotenv/config";
import { prisma } from "../src/db/prisma.js";
import { timeInSantiago } from "../src/modules/notificaciones/automation-config.js";
import { findConfiguredEmailRecipients, findReportGuarantees } from "../src/modules/notificaciones/email-report-repository.js";
import { createEmailService, EmailConfigurationError, EmailTransportError, readEmailConfig } from "../src/modules/notificaciones/email-service.js";
import { sendManualConfiguredReport } from "../src/modules/notificaciones/report-service.js";

async function main() {
  const emailConfig = readEmailConfig(process.env, { requireTestRecipient: false });
  const recipients = await findConfiguredEmailRecipients();
  if (recipients.length === 0) {
    throw new Error("No hay un destinatario válido guardado en la configuración de Alertas.");
  }
  const mailer = createEmailService(emailConfig);
  await mailer.verify();
  const fechaInforme = timeInSantiago(new Date()).date;
  const rows = await findReportGuarantees(fechaInforme);
  const result = await sendManualConfiguredReport({
    fechaInforme,
    rows,
    getRecipients: async () => recipients,
    mailer,
  });

  if (!result.configured) throw new Error("No se pudo validar el destinatario de Alertas.");
  console.info(`SMTP aceptó la prueba manual del informe (${fechaInforme}); garantías incluidas: ${result.eligible}.`);
  if (result.messageId) console.info(`Identificador de mensaje: ${result.messageId}`);
}

main()
  .catch((error: unknown) => {
    if (error instanceof EmailConfigurationError) {
      console.error(error.message);
    } else if (error instanceof EmailTransportError) {
      console.error("SMTP no aceptó la prueba manual del informe.", {
        operation: error.operation,
        code: error.code,
        responseCode: error.responseCode,
      });
    } else {
      const candidate = error as { code?: unknown };
      const code = typeof candidate?.code === "string" && /^[A-Z0-9_:-]+$/.test(candidate.code) ? candidate.code : undefined;
      console.error("No se pudo completar la prueba manual del informe.", { code });
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
