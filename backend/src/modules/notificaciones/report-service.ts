import { getDaysRemaining, getGuaranteeStatus, type GuaranteeStatus } from "../garantias/status.js";
import { isTransientEmailFailure, serializeEmailFailureCode } from "./email-retry-policy.js";

export interface ReportGuarantee {
  id: string;
  nombreGarantia: string;
  fechaLimite: string;
  responsable: string;
}

export interface ReportRow extends ReportGuarantee {
  diasRestantes: number;
  estado: GuaranteeStatus;
}

export interface ReportDeliveryStore {
  claim(fechaInforme: string, destinatario: string): Promise<ReportClaimResult>;
  hasReservation(fechaInforme: string): Promise<boolean>;
  sent(fechaInforme: string, destinatario: string, messageId?: string): Promise<void>;
  failed(fechaInforme: string, destinatario: string, error: { code?: string; responseCode?: number; operation?: string }): Promise<void>;
}

export type ReportClaimResult = "claimed" | "deferred" | "terminal" | "already_sent" | "recipient_changed" | "attempts_exhausted" | "permanent_failure";

export interface ReportMailer {
  send(message: { to: string; subject: string; text: string }): Promise<{ messageId?: string }>;
}

const PRIORITY: Record<GuaranteeStatus, number> = {
  vencida: 0,
  critica: 1,
  proxima: 2,
  atencion: 3,
  normal: 4,
};

export function buildGuaranteeReport(rows: ReportGuarantee[], fechaInforme: string): ReportRow[] {
  return rows
    .map((row) => {
      const diasRestantes = getDaysRemaining(row.fechaLimite, fechaInforme);
      return { ...row, diasRestantes, estado: getGuaranteeStatus(row.fechaLimite, fechaInforme) };
    })
    .filter((row) => row.estado !== "normal")
    .sort((a, b) => PRIORITY[a.estado] - PRIORITY[b.estado] || a.fechaLimite.localeCompare(b.fechaLimite) || a.id.localeCompare(b.id));
}

export function formatGuaranteeReport(rows: ReportRow[], fechaInforme: string): string {
  const lines = [
    `Informe diario de garantías GES — ${fechaInforme}`,
    `Garantías vencidas o dentro de los próximos 30 días: ${rows.length}`,
    "",
  ];
  for (const row of rows) {
    const daysLabel = row.diasRestantes < 0 ? `${Math.abs(row.diasRestantes)} día(s) vencida` : `${row.diasRestantes} día(s) restantes`;
    lines.push(`[${row.estado.toUpperCase()}] ${row.nombreGarantia} | Límite: ${row.fechaLimite} | ${daysLabel} | Responsable: ${row.responsable}`);
  }
  if (rows.length === 0) lines.push("No hay garantías vencidas ni próximas a vencer en los rangos configurados.");
  lines.push("", "Este informe se genera con la fecha civil de America/Santiago. No incluye RUT, nombre ni diagnóstico de pacientes.");
  return lines.join("\n");
}

export async function deliverDailyReport(options: {
  fechaInforme: string;
  rows: ReportGuarantee[];
  recipients: string[];
  mailer: ReportMailer;
  store: ReportDeliveryStore;
  onError?: (recipient: string, error: { code?: string; responseCode?: number; operation?: string; retryable: boolean }) => void;
  onPersistenceError?: (error: unknown) => void;
}): Promise<{ eligible: number; sent: number; skipped: number; failed: number; uncertain: number; terminal: number; skipReasons: Record<string, number> }> {
  const report = buildGuaranteeReport(options.rows, options.fechaInforme);
  const text = formatGuaranteeReport(report, options.fechaInforme);
  const result = { eligible: report.length, sent: 0, skipped: 0, failed: 0, uncertain: 0, terminal: 0, skipReasons: {} as Record<string, number> };

  for (const recipient of options.recipients) {
    const claim = await options.store.claim(options.fechaInforme, recipient);
    if (claim !== "claimed") {
      result.skipped += 1;
      const reason = claim === "terminal" ? "reservation_unavailable" : claim;
      result.skipReasons[reason] = (result.skipReasons[reason] ?? 0) + 1;
      if (claim !== "deferred") result.terminal += 1;
      continue;
    }
    let sent: { messageId?: string };
    try {
      sent = await options.mailer.send({
        to: recipient,
        subject: `Informe diario de garantías GES — ${options.fechaInforme}`,
        text,
      });
    } catch (error) {
      const transport = error as { code?: unknown; responseCode?: unknown; operation?: unknown };
      const retryable = isTransientEmailFailure({
        code: typeof transport?.code === "string" ? transport.code : undefined,
        responseCode: typeof transport?.responseCode === "number" ? transport.responseCode : undefined,
      });
      const details = {
        ...(typeof transport?.code === "string" || typeof transport?.responseCode === "number"
          ? { code: serializeEmailFailureCode({ code: typeof transport?.code === "string" ? transport.code : undefined, responseCode: typeof transport?.responseCode === "number" ? transport.responseCode : undefined }) ?? undefined }
          : {}),
        ...(typeof transport?.responseCode === "number" ? { responseCode: transport.responseCode } : {}),
        ...(typeof transport?.operation === "string" ? { operation: transport.operation } : {}),
      };
      await options.store.failed(options.fechaInforme, recipient, details);
      options.onError?.(recipient, { ...details, retryable });
      result.failed += 1;
      continue;
    }
    try {
      await options.store.sent(options.fechaInforme, recipient, sent.messageId);
      result.sent += 1;
    } catch (error) {
      // SMTP may already have accepted the message. Keep the reservation in progress;
      // treating this as a failed send would invite a duplicate on the next run.
      result.uncertain += 1;
      options.onPersistenceError?.(error);
    }
  }
  return result;
}

export async function deliverConfiguredDailyReport(options: {
  fechaInforme: string;
  rows: ReportGuarantee[];
  getRecipient: () => Promise<string | null>;
  mailer: ReportMailer;
  store: ReportDeliveryStore;
  onError?: (recipient: string, error: { code?: string; responseCode?: number; operation?: string; retryable: boolean }) => void;
  onPersistenceError?: (error: unknown) => void;
}): Promise<{ configured: boolean; eligible: number; sent: number; skipped: number; failed: number; uncertain: number; terminal: number; skipReasons: Record<string, number> }> {
  const recipient = await options.getRecipient();
  if (!recipient) return { configured: false, eligible: 0, sent: 0, skipped: 0, failed: 0, uncertain: 0, terminal: 0, skipReasons: {} };
  const result = await deliverDailyReport({
    fechaInforme: options.fechaInforme,
    rows: options.rows,
    recipients: [recipient],
    mailer: options.mailer,
    store: options.store,
    onError: options.onError,
    onPersistenceError: options.onPersistenceError,
  });
  return { configured: true, ...result };
}

export async function sendManualConfiguredReport(options: {
  fechaInforme: string;
  rows: ReportGuarantee[];
  getRecipient: () => Promise<string | null>;
  mailer: ReportMailer;
}): Promise<{ configured: boolean; acceptedBySmtp: boolean; eligible: number; messageId?: string }> {
  const recipient = await options.getRecipient();
  if (!recipient) return { configured: false, acceptedBySmtp: false, eligible: 0 };
  const rows = buildGuaranteeReport(options.rows, options.fechaInforme);
  const result = await options.mailer.send({
    to: recipient,
    subject: `Informe diario de garantías GES — ${options.fechaInforme} (prueba manual)`,
    text: formatGuaranteeReport(rows, options.fechaInforme),
  });
  return { configured: true, acceptedBySmtp: true, eligible: rows.length, ...(result.messageId ? { messageId: result.messageId } : {}) };
}
