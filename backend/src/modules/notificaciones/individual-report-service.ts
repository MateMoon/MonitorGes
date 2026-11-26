import { createHash } from "node:crypto";
import { z } from "zod";
import { normalizeIdentityText } from "../importaciones/identity-normalization.js";
import { legacyAssignmentRules, matchesAssignmentRules, readAssignmentRules, type AssignmentRule } from "../garantias/assignment-rules.js";
import { buildGuaranteeReport, formatGuaranteeReport, formatGuaranteeReportHtml, type ReportGuarantee, type ReportMailer } from "./report-service.js";
import { isTransientEmailFailure, serializeEmailFailureCode } from "./email-retry-policy.js";

export interface IndividualRecipient {
  id: string;
  rol?: "ADMIN" | "COORDINADOR_SOME" | "PROFESIONAL" | "LECTOR";
  email: string;
  activo: boolean;
  recibirInformeAutomatico: boolean;
  tipos: string[];
  reglasAsignacion?: AssignmentRule[];
}
const mailbox = z.string().trim().email().max(254);
export function receivesCompleteReport(user: IndividualRecipient): boolean {
  return user.rol === "COORDINADOR_SOME";
}
export function recipientEligibility(user: IndividualRecipient | null): string | null {
  if (!user || !user.activo) return "CUENTA_INACTIVA";
  if (!receivesCompleteReport(user) && !user.recibirInformeAutomatico) return "RECEPCION_DESHABILITADA";
  if (!mailbox.safeParse(user.email).success) return "CORREO_INVALIDO";
  if (receivesCompleteReport(user)) return null;
  if (user.reglasAsignacion !== undefined) {
    if (!user.reglasAsignacion.length || readAssignmentRules(user.reglasAsignacion)?.length !== user.reglasAsignacion.length) return "SIN_REGLAS_VALIDAS";
  } else if (!user.tipos.length || user.tipos.some((key) => !key || normalizeIdentityText(key) !== key)) return "SIN_TIPOS_VALIDOS";
  return null;
}
export function configurationFingerprint(user: IndividualRecipient): string {
  const scope = receivesCompleteReport(user) ? { alcance: "TODAS_NO_CUMPLIDAS_HASTA_30_DIAS" }
    : user.reglasAsignacion !== undefined
    ? { reglas: [...new Set(user.reglasAsignacion.map((rule) => JSON.stringify([rule.problemaSalud, rule.establecimiento, rule.tipoGarantia])))].sort() }
    : { tipos: [...new Set(user.tipos)].sort() };
  return createHash("sha256").update(JSON.stringify({ email: user.email.trim().toLowerCase(), ...scope })).digest("hex");
}
export interface IndividualClaim {
  id: string;
  usuarioId: string;
  fechaInforme: string;
  destinatario: string;
  huellaConfiguracion: string;
  tokenReserva: string;
  numero: number;
}
export interface IndividualOutcome {
  estado: "ACEPTADO_SMTP" | "FALLIDO" | "OMITIDO" | "INCIERTO";
  cantidadGarantias: number;
  codigoResultado?: string;
  reintentable?: boolean;
  messageId?: string;
}
export interface IndividualReportStore {
  candidates(date: string): Promise<string[]>;
  getRecipient(id: string): Promise<IndividualRecipient | null>;
  claim(user: IndividualRecipient, date: string, allowNew: boolean): Promise<{ claim: IndividualClaim } | { reason: string }>;
  begin(claim: IndividualClaim): Promise<boolean>;
  // El repositorio bloquea la cuenta, asignaciones y reserva durante la autorización y SMTP.
  withLockedRecipient(claim: IndividualClaim, work: (user: IndividualRecipient | null, loadRows: (keys: string[]) => Promise<ReportGuarantee[]>) => Promise<IndividualOutcome>): Promise<IndividualOutcome>;
  omitExisting(id: string, date: string, reason: string): Promise<void>;
  uncertain(claim: IndividualClaim): Promise<void>;
}

export async function deliverIndividualReports(options: {
  fechaInforme: string;
  store: IndividualReportStore;
  mailer: ReportMailer;
  allowNew?: boolean;
  onError?: (code: string) => void;
}) {
  const result = { usuarios: 0, aceptadosSmtp: 0, omitidos: 0, fallidos: 0, inciertos: 0, aplazados: 0, errores: 0, motivos: {} as Record<string, number> };
  const note = (reason: string) => { result.motivos[reason] = (result.motivos[reason] ?? 0) + 1; };
  for (const id of await options.store.candidates(options.fechaInforme)) {
    result.usuarios++;
    let claim: IndividualClaim | undefined;
    let begun = false;
    try {
      const user = await options.store.getRecipient(id);
      const reason = recipientEligibility(user);
      if (reason) { await options.store.omitExisting(id, options.fechaInforme, reason); result.omitidos++; note(reason); continue; }
      const reservation = await options.store.claim(user!, options.fechaInforme, options.allowNew ?? true);
      if ("reason" in reservation) {
        if (reservation.reason === "APLAZADO") result.aplazados++;
        else result.omitidos++;
        note(reservation.reason);
        continue;
      }
      claim = reservation.claim;
      begun = await options.store.begin(claim);
      if (!begun) { result.aplazados++; note("RESERVA_NO_DISPONIBLE"); continue; }
      const currentClaim = claim;
      const outcome = await options.store.withLockedRecipient(claim, async (current, loadRows) => {
        const invalid = recipientEligibility(current);
        if (invalid) return { estado: "OMITIDO", cantidadGarantias: 0, codigoResultado: invalid };
        if (configurationFingerprint(current!) !== currentClaim.huellaConfiguracion || current!.email.trim().toLowerCase() !== currentClaim.destinatario) {
          return { estado: "OMITIDO", cantidadGarantias: 0, codigoResultado: "CONFIGURACION_CAMBIADA" };
        }
        // Solo Coordinador tiene alcance completo; los demás conservan sus reglas.
        const complete = receivesCompleteReport(current!);
        const rules = current!.reglasAsignacion ?? legacyAssignmentRules(current!.tipos);
        const rows = (await loadRows(current!.tipos)).filter((row) => complete || matchesAssignmentRules(row, rules));
        const report = buildGuaranteeReport(rows, options.fechaInforme);
        if (!report.length) return { estado: "OMITIDO", cantidadGarantias: 0, codigoResultado: "SIN_GARANTIAS_ELEGIBLES" };
        try {
          const accepted = await options.mailer.send({
            to: currentClaim.destinatario,
            subject: `Informe ${complete ? "completo" : "individual"} de garantías GES — ${options.fechaInforme}`,
            text: formatGuaranteeReport(report, options.fechaInforme),
            html: formatGuaranteeReportHtml(report, options.fechaInforme),
            headers: { "Auto-Submitted": "auto-generated" },
          });
          return { estado: "ACEPTADO_SMTP", cantidadGarantias: report.length, messageId: accepted.messageId };
        } catch (error) {
          const candidate = error as { code?: unknown; responseCode?: unknown };
          const details = { code: typeof candidate?.code === "string" && /^[A-Z0-9_:-]{1,80}$/.test(candidate.code) ? candidate.code : undefined, responseCode: typeof candidate?.responseCode === "number" ? candidate.responseCode : undefined };
          const command = (error as { command?: unknown })?.command;
          const beforeData = typeof command === "string" && /^(?:CONN|EHLO|HELO|STARTTLS|AUTH\b|MAIL FROM\b|RCPT TO\b)/i.test(command);
          const knownFailure = (typeof details.responseCode === "number" && details.responseCode >= 400 && details.responseCode < 600) || beforeData || ["ECONNECTION", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN", "EDNS", "EAUTH", "EENVELOPE"].includes(details.code ?? "");
          // Un timeout/desconexión después de DATA puede haber ocurrido tras la
          // aceptación. Reintentarlo automáticamente podría duplicar el informe.
          if (!knownFailure) return { estado: "INCIERTO", cantidadGarantias: report.length, codigoResultado: "SMTP_RESULTADO_INCIERTO", reintentable: false };
          return { estado: "FALLIDO", cantidadGarantias: report.length, codigoResultado: serializeEmailFailureCode(details) ?? "ERROR_SMTP", reintentable: isTransientEmailFailure(details) };
        }
      });
      if (outcome.estado === "ACEPTADO_SMTP") result.aceptadosSmtp++;
      else if (outcome.estado === "FALLIDO") result.fallidos++;
      else if (outcome.estado === "INCIERTO") result.inciertos++;
      else result.omitidos++;
      if (outcome.codigoResultado) note(outcome.codigoResultado);
    } catch {
      // Tras begin se desconoce si SMTP llegó a aceptar: no se libera para reenvío.
      if (claim && begun) {
        result.inciertos++;
        try { await options.store.uncertain(claim); } catch { /* EN_PROCESO también impide reenvío al recuperar. */ }
      } else result.errores++;
      options.onError?.(begun ? "RESULTADO_INCIERTO" : "ERROR_USUARIO");
    }
  }
  return result;
}
