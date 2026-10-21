import { readEmailConfig, createEmailService } from "./email-service.js";
import { readEmailAutomationConfig, timeInSantiago, AUTOMATION_TIME_ZONE, type EmailAutomationConfig } from "./automation-config.js";
import { emailReportDeliveryStore, findConfiguredEmailRecipients, findReportGuarantees } from "./email-report-repository.js";
import { deliverConfiguredDailyReport, type ReportDeliveryStore, type ReportMailer } from "./report-service.js";

const CHECK_INTERVAL_MS = 30_000;
const RETRY_INTERVAL_MS = 5 * 60_000;

type SchedulerLogger = {
  info(data: object, message: string): void;
  warn(data: object, message: string): void;
  error(data: object, message: string): void;
};

export interface EmailSchedulerDependencies {
  config?: EmailAutomationConfig;
  now?: () => Date;
  checkIntervalMs?: number;
  retryIntervalMs?: number;
  findRows?: typeof findReportGuarantees;
  getRecipients?: typeof findConfiguredEmailRecipients;
  mailer?: ReportMailer;
  store?: ReportDeliveryStore;
}

export interface EmailSchedulerHandle {
  stop(): Promise<void>;
}

export function startEmailReportScheduler(logger: SchedulerLogger, dependencies: EmailSchedulerDependencies = {}): EmailSchedulerHandle {
  const config = dependencies.config ?? readEmailAutomationConfig();
  if (!config.enabled) {
    logger.info({ enabled: false }, "Envío automático de informes de correo deshabilitado.");
    return { stop: async () => undefined };
  }

  const mailer = dependencies.mailer ?? createEmailService(readEmailConfig(process.env, { requireTestRecipient: false }));
  const findRows = dependencies.findRows ?? findReportGuarantees;
  const getRecipients = dependencies.getRecipients ?? findConfiguredEmailRecipients;
  const store = dependencies.store ?? emailReportDeliveryStore;
  const now = dependencies.now ?? (() => new Date());
  const retryIntervalMs = dependencies.retryIntervalMs ?? RETRY_INTERVAL_MS;
  const startupLocal = timeInSantiago(now());
  let startupGatePending = startupLocal.time > config.time;
  let blockedStartupDate: string | undefined;
  const lastAttempt = new Map<string, number>();
  const completed = new Set<string>();
  let inFlight: Promise<void> | undefined;
  let stopped = false;

  const runIfDue = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (inFlight) return inFlight;
    const instant = now();
    const local = timeInSantiago(instant);
    if (local.time < config.time || completed.has(local.date) || blockedStartupDate === local.date || (lastAttempt.has(local.date) && instant.getTime() - lastAttempt.get(local.date)! < retryIntervalMs)) {
      return Promise.resolve();
    }
    // Bound process-local bookkeeping while preserving today's retry/completion state.
    for (const date of [...lastAttempt.keys()]) if (date !== local.date) lastAttempt.delete(date);
    for (const date of [...completed]) if (date !== local.date) completed.delete(date);
    lastAttempt.set(local.date, instant.getTime());
    const shouldCheckStartupReservation = startupGatePending;
    startupGatePending = false;
    const work = (async () => {
      try {
        if (shouldCheckStartupReservation) {
          try {
            if (!await store.hasReservation(local.date)) {
              blockedStartupDate = local.date;
              logger.warn({ date: local.date, reason: "late_start_without_daily_reservation" }, "El backend inició después de la hora programada; no se generará un informe nuevo hoy.");
              return;
            }
          } catch (error) {
            blockedStartupDate = local.date;
            logger.error({ date: local.date, errorName: error instanceof Error ? error.name : "UnknownError" }, "No se pudo comprobar una reserva previa; se omite el envío al arrancar tarde por seguridad.");
            return;
          }
        }
        const rows = await findRows(local.date);
        const result = await deliverConfiguredDailyReport({
          fechaInforme: local.date,
          rows,
          getRecipients,
          mailer,
          store,
          onError: (_recipient, details) => logger.warn({ date: local.date, code: details.code, responseCode: details.responseCode, retryable: details.retryable }, details.retryable ? "Falló el envío transitorio del informe; se reintentará según la política." : "Falló el envío del informe por un error permanente; no habrá más reintentos hoy."),
          onPersistenceError: (error) => logger.error({ date: local.date, errorName: error instanceof Error ? error.name : "UnknownError" }, "SMTP pudo aceptar el informe, pero no se pudo registrar el resultado; queda en estado incierto y no se reintentará hoy."),
        });
        if (!result.configured) {
          logger.warn({ date: local.date }, "No hay destinatario de informes configurado en PostgreSQL; no se enviará correo.");
          return;
        }
        logger.info({ date: local.date, eligible: result.eligible, sent: result.sent, skipped: result.skipped, skipReasons: result.skipReasons, failed: result.failed, uncertain: result.uncertain }, "Ejecución del informe automático completada.");
        if ((result.failed === 0 && result.skipped === 0) || result.terminal > 0 || result.uncertain > 0) completed.add(local.date);
      } catch (error) {
        const name = error instanceof Error ? error.name : "UnknownError";
        logger.error({ date: local.date, errorName: name }, "No se pudo procesar el informe automático; se reintentará tras la espera configurada.");
      }
    })();
    inFlight = work.finally(() => { inFlight = undefined; });
    return inFlight;
  };

  logger.info({ enabled: true, time: config.time, timeZone: AUTOMATION_TIME_ZONE }, "Programador de informes automáticos iniciado.");
  void runIfDue();
  const timer = setInterval(() => { void runIfDue(); }, dependencies.checkIntervalMs ?? CHECK_INTERVAL_MS);
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await inFlight;
    },
  };
}
