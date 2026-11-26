import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { matchingGuaranteeNames, assignmentScopeForRules } from "../garantias/assignment-scope.js";
import { legacyAssignmentRules, readAssignmentRules, type AssignmentRule } from "../garantias/assignment-rules.js";
export { matchingGuaranteeNames } from "../garantias/assignment-scope.js";
import { ABANDONED_EMAIL_ATTEMPT_MS, EMAIL_RETRY_DELAY_MS, MAX_EMAIL_ATTEMPTS, isStoredFailureTransient } from "./email-retry-policy.js";
import { configurationFingerprint, recipientEligibility, receivesCompleteReport, type IndividualClaim, type IndividualOutcome, type IndividualRecipient, type IndividualReportStore } from "./individual-report-service.js";
import type { ReportGuarantee } from "./report-service.js";

const recipientSelect = { id: true, rol: true, email: true, activo: true, recibirInformeAutomatico: true, reglasAsignacion: true, tiposGarantia: { select: { claveNormalizada: true } } } as const;
type RecipientRow = Prisma.UsuarioGetPayload<{ select: typeof recipientSelect }>;
const recipient = (row: RecipientRow | null): IndividualRecipient | null => row ? { id: row.id, rol: row.rol, email: row.email, activo: row.activo, recibirInformeAutomatico: row.recibirInformeAutomatico, tipos: row.tiposGarantia.map((type) => type.claveNormalizada), reglasAsignacion: readAssignmentRules(row.reglasAsignacion) ?? legacyAssignmentRules(row.tiposGarantia.map((type) => type.claveNormalizada)) } : null;
const dateValue = (date: string) => new Date(`${date}T00:00:00.000Z`);

export function individualGuaranteeWhere(date: string, names: string[]): Prisma.GarantiaWhereInput {
  const limit = dateValue(date);
  limit.setUTCDate(limit.getUTCDate() + 30);
  return { estadoGestion: { not: "CUMPLIDA" }, fechaLimite: { lte: limit }, nombreGarantia: { in: names } };
}
async function reportWhere(tx: Prisma.TransactionClient, keys: string[], date: string, rules?: AssignmentRule[], complete = false): Promise<Prisma.GarantiaWhereInput> {
  const scope = complete ? {} : rules !== undefined ? await assignmentScopeForRules(rules, tx) : { nombreGarantia: { in: await matchingGuaranteeNames(tx, keys) } };
  const limit = dateValue(date);
  limit.setUTCDate(limit.getUTCDate() + 30);
  return { ...(complete ? {} : { AND: [scope] }), estadoGestion: { not: "CUMPLIDA" }, fechaLimite: { lte: limit } };
}
async function loadRows(tx: Prisma.TransactionClient, keys: string[], date: string, rules?: AssignmentRule[], complete = false): Promise<ReportGuarantee[]> {
  const rows = await tx.garantia.findMany({
    where: await reportWhere(tx, keys, date, rules, complete),
    select: { id: true, problemaSalud: true, nombreGarantia: true, fechaLimite: true, responsable: true, paciente: { select: { rutNumero: true, dv: true, nombre: true } } },
  });
  return rows.map(({ paciente, ...row }) => ({ ...row, rut: `${paciente.rutNumero}-${paciente.dv}`, nombrePaciente: paciente.nombre, fechaLimite: row.fechaLimite.toISOString().slice(0, 10) }));
}

async function finish(tx: Prisma.TransactionClient, id: string, numero: number, outcome: IndividualOutcome | { estado: "INCIERTO"; cantidadGarantias: number; codigoResultado: string }) {
  const now = new Date();
  const data = { reintentable: false, ...outcome, finalizadoAt: now, ...(outcome.estado === "ACEPTADO_SMTP" ? { aceptadoSmtpAt: now } : {}) };
  await tx.envioInformeIndividual.update({ where: { id }, data });
  await tx.intentoInformeIndividual.update({ where: { envioId_numero: { envioId: id, numero } }, data });
}

export function createIndividualReportStore(options: { claveEjecucion: string; dedupEnabled: boolean } = { claveEjecucion: "diario", dedupEnabled: true }): IndividualReportStore {
  const { claveEjecucion, dedupEnabled } = options;
  if (claveEjecucion !== "diario" && !/^programado:([01]\d|2[0-3]):[0-5]\d$/.test(claveEjecucion)) throw new Error("CLAVE_EJECUCION_INVALIDA");
  return {
  async candidates(date) {
    const rows = await prisma.usuario.findMany({
      where: { OR: [
        { activo: true, OR: [{ recibirInformeAutomatico: true }, { rol: "COORDINADOR_SOME" }] },
        { informesIndividuales: { some: { fechaInforme: dateValue(date), claveEjecucion, estado: { in: ["RESERVADO", "EN_PROCESO", "FALLIDO"] } } } },
      ] },
      select: { id: true }, orderBy: { id: "asc" },
    });
    return rows.map((row) => row.id);
  },
  async getRecipient(id) { return recipient(await prisma.usuario.findUnique({ where: { id }, select: recipientSelect })); },
  async claim(user, date, allowNew) {
    try {
      return await prisma.$transaction(async (tx) => {
        const fechaInforme = dateValue(date);
        const now = new Date();
        const destinatario = user.email.trim().toLowerCase();
        const huellaConfiguracion = configurationFingerprint(user);
        const tokenReserva = randomUUID();
        // También serializa reservas inexistentes y procesos con horarios distintos.
        // Mismo orden de bloqueo que la administración y withLockedRecipient.
        await tx.$queryRaw`SELECT id FROM "Usuario" WHERE id=${user.id}::uuid FOR UPDATE`;
        if (dedupEnabled) {
          const delivered = await tx.envioInformeIndividual.findFirst({ where: { usuarioId: user.id, fechaInforme, estado: { in: ["ACEPTADO_SMTP", "INCIERTO"] } }, select: { estado: true } });
          if (delivered) return { reason: delivered.estado };
        }
        const competing = await tx.envioInformeIndividual.findFirst({ where: { usuarioId: user.id, fechaInforme, claveEjecucion: { not: claveEjecucion }, estado: { in: ["RESERVADO", "EN_PROCESO"] } }, select: { id: true } });
        if (competing) return { reason: "APLAZADO" };
        const existing = await tx.envioInformeIndividual.findUnique({ where: { usuarioId_fechaInforme_claveEjecucion: { usuarioId: user.id, fechaInforme, claveEjecucion } } });
        let id: string;
        let numero = 1;
        if (!existing) {
          if (!allowNew) return { reason: "INICIO_TARDIO_SIN_RESERVA" };
          const created = await tx.envioInformeIndividual.create({ data: { usuarioId: user.id, fechaInforme, claveEjecucion, destinatario, huellaConfiguracion, tokenReserva, intentosDetalle: { create: { numero: 1 } } } });
          id = created.id;
        } else {
          if (["ACEPTADO_SMTP", "OMITIDO", "INCIERTO"].includes(existing.estado)) return { reason: existing.estado };
          if (existing.estado === "EN_PROCESO") {
            if (now.getTime() - existing.iniciadoAt.getTime() >= ABANDONED_EMAIL_ATTEMPT_MS) {
              await finish(tx, existing.id, existing.intentos, { estado: "INCIERTO", cantidadGarantias: existing.cantidadGarantias, codigoResultado: "INTENTO_ABANDONADO" });
              return { reason: "INCIERTO" };
            }
            return { reason: "APLAZADO" };
          }
          if (existing.destinatario !== destinatario || existing.huellaConfiguracion !== huellaConfiguracion) {
            await finish(tx, existing.id, existing.intentos, { estado: "OMITIDO", cantidadGarantias: 0, codigoResultado: "CONFIGURACION_CAMBIADA" });
            return { reason: "CONFIGURACION_CAMBIADA" };
          }
          if (existing.intentos >= MAX_EMAIL_ATTEMPTS) return { reason: "INTENTOS_AGOTADOS" };
          // Compatibilidad con EDNS guardados antes de corregir su clasificación.
          // No se edita el intento anterior; se conservan espera, límite y estados
          // terminales. DNS falla antes de SMTP, por lo que no hubo aceptación.
          const recoveredDnsPolicy = existing.codigoResultado === "EDNS" && isStoredFailureTransient(existing.codigoResultado);
          if (existing.estado === "FALLIDO" && !existing.reintentable && !recoveredDnsPolicy) return { reason: "FALLO_PERMANENTE" };
          const delay = existing.estado === "RESERVADO" ? ABANDONED_EMAIL_ATTEMPT_MS : EMAIL_RETRY_DELAY_MS;
          if (now.getTime() - existing.updatedAt.getTime() < delay) return { reason: "APLAZADO" };
          id = existing.id;
          numero = existing.intentos + 1;
          await tx.envioInformeIndividual.update({ where: { id }, data: { estado: "RESERVADO", intentos: numero, tokenReserva, iniciadoAt: now, finalizadoAt: null, aceptadoSmtpAt: null, reintentable: false, codigoResultado: null, messageId: null, cantidadGarantias: 0 } });
          await tx.intentoInformeIndividual.create({ data: { envioId: id, numero } });
        }
        return { claim: { id, usuarioId: user.id, fechaInforme: date, destinatario, huellaConfiguracion, tokenReserva, numero } };
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") return { reason: "APLAZADO" };
      throw error;
    }
  },
  async begin(claim) {
    return prisma.$transaction(async (tx) => {
      const acquired = await tx.envioInformeIndividual.updateMany({ where: { id: claim.id, tokenReserva: claim.tokenReserva, estado: "RESERVADO", intentos: claim.numero }, data: { estado: "EN_PROCESO", iniciadoAt: new Date() } });
      if (acquired.count !== 1) return false;
      await tx.intentoInformeIndividual.update({ where: { envioId_numero: { envioId: claim.id, numero: claim.numero } }, data: { estado: "EN_PROCESO" } });
      return true;
    });
  },
  async withLockedRecipient(claim, work) {
    return prisma.$transaction(async (tx) => {
      // La administración de usuarios toma este mismo bloqueo al actualizar la cuenta
      // antes de reemplazar sus tipos. Las retiradas se ordenan respecto de SMTP.
      await tx.$queryRaw`SELECT id FROM "Usuario" WHERE id=${claim.usuarioId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "usuarioId" FROM "UsuarioTipoGarantia" WHERE "usuarioId"=${claim.usuarioId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "EnvioInformeIndividual" WHERE id=${claim.id}::uuid FOR UPDATE`;
      const current = await tx.envioInformeIndividual.findUnique({ where: { id: claim.id } });
      if (!current || current.tokenReserva !== claim.tokenReserva || current.estado !== "EN_PROCESO" || current.intentos !== claim.numero) throw new Error("RESERVA_NO_DISPONIBLE");
      const user = recipient(await tx.usuario.findUnique({ where: { id: claim.usuarioId }, select: recipientSelect }));
      const result = await work(user, (keys) => loadRows(tx, keys, claim.fechaInforme, user?.reglasAsignacion, Boolean(user && receivesCompleteReport(user))));
      await finish(tx, claim.id, claim.numero, result);
      return result;
    }, { timeout: 120_000, maxWait: 10_000 });
  },
  async omitExisting(id, date, reason) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "EnvioInformeIndividual" WHERE "usuarioId"=${id}::uuid AND "fechaInforme"=${dateValue(date)}::date AND "claveEjecucion"=${claveEjecucion} FOR UPDATE`;
      const row = await tx.envioInformeIndividual.findUnique({ where: { usuarioId_fechaInforme_claveEjecucion: { usuarioId: id, fechaInforme: dateValue(date), claveEjecucion } } });
      if (row && ["RESERVADO", "FALLIDO"].includes(row.estado)) await finish(tx, row.id, row.intentos, { estado: "OMITIDO", cantidadGarantias: 0, codigoResultado: reason });
      else if (row?.estado === "EN_PROCESO" && Date.now() - row.iniciadoAt.getTime() >= ABANDONED_EMAIL_ATTEMPT_MS) await finish(tx, row.id, row.intentos, { estado: "INCIERTO", cantidadGarantias: row.cantidadGarantias, codigoResultado: "INTENTO_ABANDONADO" });
    });
  },
  async uncertain(claim) {
    await prisma.$transaction(async (tx) => {
      const acquired = await tx.envioInformeIndividual.updateMany({ where: { id: claim.id, tokenReserva: claim.tokenReserva, estado: "EN_PROCESO", intentos: claim.numero }, data: { estado: "INCIERTO", reintentable: false, codigoResultado: "PERSISTENCIA_INCIERTA", finalizadoAt: new Date() } });
      if (acquired.count) await tx.intentoInformeIndividual.update({ where: { envioId_numero: { envioId: claim.id, numero: claim.numero } }, data: { estado: "INCIERTO", reintentable: false, codigoResultado: "PERSISTENCIA_INCIERTA", finalizadoAt: new Date() } });
    });
  },
  };
}

// Los comandos manuales conservan la deduplicación diaria, incluso en QA.
export const individualReportStore = createIndividualReportStore();

export async function previewIndividualReports(date: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const users = await tx.usuario.findMany({ select: recipientSelect, orderBy: { id: "asc" } });
    const rows = [];
    for (const [index, row] of users.entries()) {
      const user = recipient(row)!;
      let reason = recipientEligibility(user);
      let count = 0;
      if (!reason) {
        count = await tx.garantia.count({ where: await reportWhere(tx, user.tipos, date, user.reglasAsignacion, receivesCompleteReport(user)) });
        if (!count) reason = "SIN_GARANTIAS_ELEGIBLES";
      }
      rows.push({ indice: index + 1, tiposAsignados: user.tipos.length, reglasAsignadas: user.reglasAsignacion?.length ?? user.tipos.length, garantias: count, enviaria: !reason, motivo: reason });
    }
    return { fechaInforme: date, usuarios: rows, correosPrevistos: rows.filter((row) => row.enviaria).length, garantiasEnInformes: rows.reduce((sum, row) => sum + row.garantias, 0), simulacion: true, alcance: "Elegibilidad y contenido; no simula reservas ni horario. No realiza envíos." };
  }, { timeout: 30000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

// Inspección operativa para elegir y autorizar UN destinatario. No lee pacientes,
// no crea reservas y no conecta SMTP. La huella vincula la confirmación a sus reglas.
export async function inspectManualIndividualRecipients(date: string, usuarioId?: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const users = await tx.usuario.findMany({ where: usuarioId ? { id: usuarioId } : undefined, select: recipientSelect, orderBy: { id: "asc" } });
    const results = [];
    for (const row of users) {
      const user = recipient(row)!;
      let reason = recipientEligibility(user);
      let count = 0;
      if (!reason) {
        count = await tx.garantia.count({ where: await reportWhere(tx, user.tipos, date, user.reglasAsignacion, receivesCompleteReport(user)) });
        if (!count) reason = "SIN_GARANTIAS_ELEGIBLES";
      }
      const history = await tx.envioInformeIndividual.findFirst({
        where: { usuarioId: user.id, fechaInforme: dateValue(date) }, orderBy: { createdAt: "desc" },
        select: { claveEjecucion: true, estado: true, intentos: true, codigoResultado: true, cantidadGarantias: true, reintentable: true, messageId: true, aceptadoSmtpAt: true },
      });
      results.push({ usuarioId: user.id, destinatario: user.email.trim().toLowerCase(), tiposAsignados: user.tipos.length, reglasAsignadas: user.reglasAsignacion?.length ?? user.tipos.length, garantias: count, motivo: reason, huellaConfiguracion: configurationFingerprint(user), historialHoy: history });
    }
    return results;
  }, { timeout: 30000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function latestIndividualResults() {
  try {
    const data = await prisma.envioInformeIndividual.findMany({ distinct: ["usuarioId"], orderBy: [{ fechaInforme: "desc" }, { createdAt: "desc" }], select: { usuarioId: true, fechaInforme: true, estado: true, aceptadoSmtpAt: true, cantidadGarantias: true, codigoResultado: true } });
    return { disponible: true, data };
  } catch (error) {
    if ((error as { code?: string }).code === "P2021") return { disponible: false, data: [] };
    throw error;
  }
}
