import { readEmailConfig, createEmailService } from "./email-service.js";
import { readEmailAutomationConfig, timeInSantiago, AUTOMATION_TIME_ZONE } from "./automation-config.js";
import { emailReportDeliveryStore, findConfiguredEmailRecipient, findReportGuarantees } from "./email-report-repository.js";
import { deliverConfiguredDailyReport } from "./report-service.js";

const CHECK_INTERVAL_MS = 30_000;
const RETRY_INTERVAL_MS = 5 * 60_000;

export function startEmailReportScheduler(logger: {
  info(data: object, message: string): void;
  warn(data: object, message: string): void;
  error(data: object, message: string): void;
}) {
  const config = readEmailAutomationConfig();
  if (!config.enabled) {
    logger.info({ enabled: false }, "Envío automático de informes de correo deshabilitado.");
    return () => undefined;
  }

  const mailer = createEmailService(readEmailConfig(process.env, { requireTestRecipient: false }));
  const lastAttempt = new Map<string, number>();
  const completed = new Set<string>();
  let running = false;

  const runIfDue = async () => {
    if (running) return;
    const local = timeInSantiago(new Date());
    if (local.time < config.time || completed.has(local.date) || (lastAttempt.has(local.date) && Date.now() - lastAttempt.get(local.date)! < RETRY_INTERVAL_MS)) return;
    running = true;
    lastAttempt.set(local.date, Date.now());
    try {
      const rows = await findReportGuarantees(local.date);
      const result = await deliverConfiguredDailyReport({
        fechaInforme: local.date,
        rows,
        getRecipient: findConfiguredEmailRecipient,
        mailer,
        store: emailReportDeliveryStore,
        onError: (_recipient, details) => logger.warn({ date: local.date, ...details }, "Falló un destinatario del informe automático; se reintentará."),
      });
      if (!result.configured) {
        logger.warn({ date: local.date }, "No hay destinatario de informes configurado en PostgreSQL; no se enviará correo.");
        lastAttempt.set(local.date, Date.now());
        return;
      }
      logger.info({ date: local.date, eligible: result.eligible, sent: result.sent, skipped: result.skipped, failed: result.failed }, "Ejecución del informe automático completada.");
      if (result.failed > 0) lastAttempt.set(local.date, Date.now());
      else completed.add(local.date);
    } catch (error) {
      const name = error instanceof Error ? error.name : "UnknownError";
      logger.error({ date: local.date, errorName: name }, "No se pudo procesar el informe automático; se reintentará.");
    } finally {
      running = false;
    }
  };

  logger.info({ enabled: true, time: config.time, timeZone: AUTOMATION_TIME_ZONE }, "Programador de informes automáticos iniciado.");
  void runIfDue();
  const timer = setInterval(() => void runIfDue(), CHECK_INTERVAL_MS);
  return () => clearInterval(timer);
}
