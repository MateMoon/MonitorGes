import { getDaysRemaining, getGuaranteeStatus, type GuaranteeStatus } from "../garantias/status.js";

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
  claim(fechaInforme: string, destinatario: string): Promise<boolean>;
  sent(fechaInforme: string, destinatario: string, messageId?: string): Promise<void>;
  failed(fechaInforme: string, destinatario: string, error: { code?: string; operation?: string }): Promise<void>;
}

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
  onError?: (recipient: string, error: { code?: string; operation?: string }) => void;
}): Promise<{ eligible: number; sent: number; skipped: number; failed: number }> {
  const report = buildGuaranteeReport(options.rows, options.fechaInforme);
  const text = formatGuaranteeReport(report, options.fechaInforme);
  const result = { eligible: report.length, sent: 0, skipped: 0, failed: 0 };

  for (const recipient of options.recipients) {
    if (!(await options.store.claim(options.fechaInforme, recipient))) {
      result.skipped += 1;
      continue;
    }
    try {
      const sent = await options.mailer.send({
        to: recipient,
        subject: `Informe diario de garantías GES — ${options.fechaInforme}`,
        text,
      });
      await options.store.sent(options.fechaInforme, recipient, sent.messageId);
      result.sent += 1;
    } catch (error) {
      const transport = error as { code?: unknown; operation?: unknown };
      const details = {
        ...(typeof transport?.code === "string" ? { code: transport.code } : {}),
        ...(typeof transport?.operation === "string" ? { operation: transport.operation } : {}),
      };
      await options.store.failed(options.fechaInforme, recipient, details);
      options.onError?.(recipient, details);
      result.failed += 1;
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
  onError?: (recipient: string, error: { code?: string; operation?: string }) => void;
}) {
  const recipient = await options.getRecipient();
  if (!recipient) return { configured: false, eligible: 0, sent: 0, skipped: 0, failed: 0 };
  const result = await deliverDailyReport({
    fechaInforme: options.fechaInforme,
    rows: options.rows,
    recipients: [recipient],
    mailer: options.mailer,
    store: options.store,
    onError: options.onError,
  });
  return { configured: true, ...result };
}
