import { getDaysRemaining, getGuaranteeStatus, type GuaranteeStatus } from "../garantias/status.js";
import { isTransientEmailFailure, serializeEmailFailureCode } from "./email-retry-policy.js";
import { emailRecipientListSchema } from "./email-config-schema.js";

export interface ReportGuarantee {
  id: string;
  nombreGarantia: string;
  rut: string;
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
  send(message: { to: string | string[]; subject: string; text: string; html?: string; headers?: Record<string, string> }): Promise<{ messageId?: string }>;
}

const PRIORITY: Record<GuaranteeStatus, number> = {
  critica: 0,
  proxima: 1,
  atencion: 2,
  vencida: 3,
  normal: 4,
};

const STATUS_COLORS: Record<GuaranteeStatus, { background: string; foreground: string; accent: string }> = {
  normal: { background: "#e6f4ec", foreground: "#256b45", accent: "#3c9a67" },
  atencion: { background: "#fcf4d9", foreground: "#7d5c07", accent: "#d9a416" },
  proxima: { background: "#fdeadb", foreground: "#9a4a10", accent: "#dd7a2c" },
  critica: { background: "#fbe7e5", foreground: "#a12a22", accent: "#cc4339" },
  vencida: { background: "#e4e7ec", foreground: "#2c3542", accent: "#3d4756" },
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
    lines.push(`[${row.estado.toUpperCase()}] RUT: ${row.rut} | Garantía: ${row.nombreGarantia} | Límite: ${row.fechaLimite} | ${daysLabel} | Responsable: ${row.responsable}`);
  }
  if (rows.length === 0) lines.push("No hay garantías vencidas ni próximas a vencer en los rangos configurados.");
  lines.push("", "Este informe se genera con la fecha civil de America/Santiago. Incluye el RUT del paciente; no incluye su nombre ni diagnóstico.");
  return lines.join("\n");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function formatGuaranteeReportHtml(rows: ReportRow[], fechaInforme: string): string {
  const rowMarkup = rows.length
    ? rows.map((row) => {
      const colors = STATUS_COLORS[row.estado];
      const daysLabel = row.diasRestantes < 0
        ? `${Math.abs(row.diasRestantes)} día(s) vencida`
        : `${row.diasRestantes} día(s) restantes`;
      return `<tr><td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;border-left:4px solid ${colors.accent}"><span style="display:inline-block;padding:4px 8px;border-radius:999px;background:${colors.background};color:${colors.foreground};font-size:12px;font-weight:700">${escapeHtml(row.estado.toUpperCase())}</span></td><td style="padding:12px;border-bottom:1px solid #e5e7eb;white-space:nowrap">${escapeHtml(row.rut)}</td><td style="padding:12px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.nombreGarantia)}</td><td style="padding:12px;border-bottom:1px solid #e5e7eb;white-space:nowrap">${escapeHtml(row.fechaLimite)}</td><td style="padding:12px;border-bottom:1px solid #e5e7eb">${escapeHtml(daysLabel)}</td><td style="padding:12px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.responsable)}</td></tr>`;
    }).join("")
    : `<tr><td colspan="6" style="padding:16px;color:#475569">No hay garantías vencidas ni próximas a vencer en los rangos configurados.</td></tr>`;
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a"><main style="max-width:900px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden"><header style="padding:24px;background:#0f3b5d;color:#ffffff"><p style="margin:0 0 8px;font-size:12px;letter-spacing:1px;text-transform:uppercase">Monitor de Garantías GES</p><h1 style="margin:0;font-size:22px">Informe diario de garantías GES</h1><p style="margin:8px 0 0;color:#dbeafe">${escapeHtml(fechaInforme)}</p></header><section style="padding:20px 24px"><p style="margin:0 0 16px;font-size:16px;font-weight:600">Garantías vencidas o dentro de los próximos 30 días: ${rows.length}</p><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;text-align:left;font-size:14px"><thead><tr style="background:#f8fafc"><th style="padding:12px;border-bottom:2px solid #cbd5e1">Estado</th><th style="padding:12px;border-bottom:2px solid #cbd5e1">RUT</th><th style="padding:12px;border-bottom:2px solid #cbd5e1">Tipo de garantía</th><th style="padding:12px;border-bottom:2px solid #cbd5e1">Fecha límite</th><th style="padding:12px;border-bottom:2px solid #cbd5e1">Plazo</th><th style="padding:12px;border-bottom:2px solid #cbd5e1">Responsable</th></tr></thead><tbody>${rowMarkup}</tbody></table></div><p style="margin:20px 0 0;color:#64748b;font-size:12px">Este informe usa la fecha civil de America/Santiago. Incluye el RUT del paciente; no incluye su nombre ni diagnóstico de pacientes.</p></section></main></body></html>`;
}

function reportMessage(rows: ReportRow[], fechaInforme: string, subject: string, automatic: boolean) {
  return {
    subject,
    text: formatGuaranteeReport(rows, fechaInforme),
    html: formatGuaranteeReportHtml(rows, fechaInforme),
    // Auto-Submitted marks scheduler-generated mail; the explicitly invoked manual test omits it.
    ...(automatic ? { headers: { "Auto-Submitted": "auto-generated" } } : {}),
  };
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
  const parsedRecipients = emailRecipientListSchema.safeParse(options.recipients);
  if (!parsedRecipients.success || parsedRecipients.data.length === 0) throw new Error("El informe requiere al menos un destinatario válido.");
  const recipients = [...parsedRecipients.data].sort();
  const reservationRecipient = recipients.join(",");
  const report = buildGuaranteeReport(options.rows, options.fechaInforme);
  const result = { eligible: report.length, sent: 0, skipped: 0, failed: 0, uncertain: 0, terminal: 0, skipReasons: {} as Record<string, number> };
  const claim = await options.store.claim(options.fechaInforme, reservationRecipient);
  if (claim !== "claimed") {
    result.skipped = 1;
    const reason = claim === "terminal" ? "reservation_unavailable" : claim;
    result.skipReasons[reason] = 1;
    if (claim !== "deferred") result.terminal = 1;
    return result;
  }

  let sent: { messageId?: string };
  try {
    sent = await options.mailer.send({
      ...reportMessage(report, options.fechaInforme, `Informe diario de garant\u00edas GES \u2014 ${options.fechaInforme}`, true),
      to: recipients,
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
    await options.store.failed(options.fechaInforme, reservationRecipient, details);
    options.onError?.(reservationRecipient, { ...details, retryable });
    result.failed = 1;
    return result;
  }
  try {
    await options.store.sent(options.fechaInforme, reservationRecipient, sent.messageId);
    result.sent = 1;
  } catch (error) {
    // SMTP may already have accepted the message. Keep the reservation in progress;
    // treating it as a failure would invite a duplicate on the next run.
    result.uncertain = 1;
    options.onPersistenceError?.(error);
  }
  return result;
}
export async function deliverConfiguredDailyReport(options: {
  fechaInforme: string;
  rows: ReportGuarantee[];
  getRecipients: () => Promise<string[]>;
  mailer: ReportMailer;
  store: ReportDeliveryStore;
  onError?: (recipient: string, error: { code?: string; responseCode?: number; operation?: string; retryable: boolean }) => void;
  onPersistenceError?: (error: unknown) => void;
}): Promise<{ configured: boolean; eligible: number; sent: number; skipped: number; failed: number; uncertain: number; terminal: number; skipReasons: Record<string, number> }> {
  const recipients = await options.getRecipients();
  if (recipients.length === 0) return { configured: false, eligible: 0, sent: 0, skipped: 0, failed: 0, uncertain: 0, terminal: 0, skipReasons: {} };
  const result = await deliverDailyReport({
    fechaInforme: options.fechaInforme,
    rows: options.rows,
    recipients,
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
  getRecipients: () => Promise<string[]>;
  mailer: ReportMailer;
}): Promise<{ configured: boolean; acceptedBySmtp: boolean; eligible: number; messageId?: string }> {
  const recipients = await options.getRecipients();
  const parsedRecipients = emailRecipientListSchema.safeParse(recipients);
  if (!parsedRecipients.success || parsedRecipients.data.length === 0) return { configured: false, acceptedBySmtp: false, eligible: 0 };
  const normalizedRecipients = [...parsedRecipients.data].sort();
  const rows = buildGuaranteeReport(options.rows, options.fechaInforme);
  const result = await options.mailer.send({
    ...reportMessage(rows, options.fechaInforme, `Informe diario de garantías GES — ${options.fechaInforme} (prueba manual)`, false),
    to: normalizedRecipients,
  });
  return { configured: true, acceptedBySmtp: true, eligible: rows.length, ...(result.messageId ? { messageId: result.messageId } : {}) };
}
