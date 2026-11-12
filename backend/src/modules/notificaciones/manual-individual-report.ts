import {
  configurationFingerprint,
  deliverIndividualReports,
  recipientEligibility,
  type IndividualOutcome,
  type IndividualRecipient,
  type IndividualReportStore,
} from "./individual-report-service.js";
import type { ReportMailer } from "./report-service.js";

export class ManualReportError extends Error {}

export async function sendManualIndividualReport(options: {
  usuarioId: string;
  fechaInforme: string;
  confirmedEmail: string;
  confirmedFingerprint: string;
  realDataConfirmed: boolean;
  store: IndividualReportStore;
  mailer: ReportMailer;
}) {
  if (options.realDataConfirmed !== true || !options.confirmedEmail || !options.confirmedFingerprint) {
    throw new ManualReportError("CONFIRMACION_EXPLICITA_REQUERIDA");
  }
  const confirmedEmail = options.confirmedEmail.trim().toLowerCase();
  const authorized = (user: IndividualRecipient | null) => user?.id === options.usuarioId
    && user.email.trim().toLowerCase() === confirmedEmail
    && configurationFingerprint(user) === options.confirmedFingerprint;
  const initial = await options.store.getRecipient(options.usuarioId);
  const invalid = recipientEligibility(initial);
  if (invalid) throw new ManualReportError(invalid);
  if (!authorized(initial)) throw new ManualReportError("DESTINATARIO_O_TIPOS_NO_CONFIRMADOS");

  let outcome: IndividualOutcome | undefined;
  const onlySelectedUser: IndividualReportStore = {
    ...options.store,
    // No se consulta ni se procesa la lista de candidatos del programador.
    candidates: async () => [options.usuarioId],
    async getRecipient(id) {
      if (id !== options.usuarioId) throw new ManualReportError("USUARIO_NO_AUTORIZADO");
      const user = await options.store.getRecipient(id);
      if (!authorized(user)) throw new ManualReportError("DESTINATARIO_O_TIPOS_NO_CONFIRMADOS");
      return user;
    },
    async withLockedRecipient(claim, work) {
      return options.store.withLockedRecipient(claim, async (user, loadRows) => {
        // Revalida el alcance confirmado también después de reservar, bajo los
        // bloqueos del repositorio y antes de leer pacientes o llamar a SMTP.
        if (!authorized(user)) {
          outcome = { estado: "OMITIDO", cantidadGarantias: 0, codigoResultado: "DESTINATARIO_O_TIPOS_NO_CONFIRMADOS" };
        } else {
          outcome = await work(user, loadRows);
          if (outcome.estado === "ACEPTADO_SMTP") outcome = { ...outcome, codigoResultado: "ENVIO_MANUAL" };
        }
        return outcome;
      });
    },
  };
  const resumen = await deliverIndividualReports({
    fechaInforme: options.fechaInforme,
    store: onlySelectedUser,
    mailer: options.mailer,
    allowNew: true,
  });
  if (resumen.inciertos && outcome?.estado !== "INCIERTO") {
    outcome = { estado: "INCIERTO", cantidadGarantias: outcome?.cantidadGarantias ?? 0, codigoResultado: "PERSISTENCIA_INCIERTA" };
  }
  return { resumen, outcome };
}
