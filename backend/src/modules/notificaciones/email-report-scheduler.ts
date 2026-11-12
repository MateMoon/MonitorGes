import { readEmailConfig, createEmailService } from "./email-service.js";
import { readEmailAutomationConfig, timeInSantiago, scheduledExecutionKey, AUTOMATION_TIME_ZONE, type EmailAutomationConfig } from "./automation-config.js";
import { createIndividualReportStore } from "./individual-report-repository.js";
import { deliverIndividualReports, type IndividualReportStore } from "./individual-report-service.js";
import { EMAIL_RETRY_DELAY_MS } from "./email-retry-policy.js";
import type { ReportMailer } from "./report-service.js";

type SchedulerLogger = { info(data: object, message: string): void; warn(data: object, message: string): void; error(data: object, message: string): void };
export interface EmailSchedulerDependencies {
  config?: EmailAutomationConfig;
  now?: () => Date;
  checkIntervalMs?: number;
  retryIntervalMs?: number;
  mailer?: ReportMailer;
  store?: IndividualReportStore;
  run?: (date: string, allowNew: boolean, executionKey: string) => Promise<unknown>;
}
export interface EmailSchedulerHandle { stop(): Promise<void>; }

export function startEmailReportScheduler(logger: SchedulerLogger, dependencies: EmailSchedulerDependencies = {}): EmailSchedulerHandle {
  const config = dependencies.config ?? readEmailAutomationConfig();
  if (!config.enabled) {
    logger.info({ enabled: false, mode: "individual" }, "Envío automático de informes de correo deshabilitado.");
    return { stop: async () => undefined };
  }
  const now = dependencies.now ?? (() => new Date());
  const start = timeInSantiago(now());
  const lateDate = start.time > config.time ? start.date : undefined;
  const executionKey = scheduledExecutionKey(config);
  const mailer = dependencies.run ? undefined : dependencies.mailer ?? createEmailService(readEmailConfig(process.env, { requireTestRecipient: false }), { connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000 });
  const run = dependencies.run ?? ((date: string, allowNew: boolean) => deliverIndividualReports({ fechaInforme: date, allowNew, mailer: mailer!, store: dependencies.store ?? createIndividualReportStore({ claveEjecucion: executionKey, dedupEnabled: config.dedupEnabled }), onError: (code) => logger.warn({ date, executionKey, code }, "No se completó un informe individual; los demás usuarios continuarán.") }));
  let inFlight: Promise<void> | undefined;
  let stopped = false;
  let lastDate: string | undefined;
  let lastAttempt = 0;
  const tick = () => {
    if (stopped || inFlight) return;
    const instant = now();
    const local = timeInSantiago(instant);
    if (local.time < config.time || (lastDate === local.date && instant.getTime() - lastAttempt < (dependencies.retryIntervalMs ?? EMAIL_RETRY_DELAY_MS))) return;
    lastDate = local.date; lastAttempt = instant.getTime();
    inFlight = (async () => {
      try {
        const result = await run(local.date, local.date !== lateDate, executionKey);
        logger.info({ date: local.date, executionKey, result }, "Ejecución de informes individuales completada. Aceptación SMTP no confirma entrega.");
      } catch (error) {
        logger.error({ date: local.date, errorName: error instanceof Error ? error.name : "UnknownError" }, "No se pudo consultar la ejecución individual; se reintentará después de la espera.");
      }
    })().finally(() => { inFlight = undefined; });
  };
  logger.info({ enabled: true, mode: "individual", time: config.time, timeZone: AUTOMATION_TIME_ZONE, dedupEnabled: config.dedupEnabled, executionKey, lateStart: Boolean(lateDate) }, "Programador individual iniciado; la lista global de Alertas no se utiliza.");
  tick();
  const timer = setInterval(tick, dependencies.checkIntervalMs ?? 30_000);
  return { async stop() { stopped = true; clearInterval(timer); await inFlight; } };
}
