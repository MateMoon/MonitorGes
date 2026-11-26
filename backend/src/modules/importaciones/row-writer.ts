import { type Prisma } from "@prisma/client";
import { dateToCivil } from "../../utils/dates.js";
import { normalizeIdentityRut as normalizeRut, normalizeIdentityText as normalizeText } from "./identity-normalization.js";
import type { PreviewRow } from "./validation-service.js";

export type RowWriteOutcome = "nuevo" | "actualizado" | "sinCambios" | "ambiguo";
function civilDate(value: string): Date { return new Date(`${value}T00:00:00.000Z`); }
function errorRecord(numeroFila: number, codigo: string, mensaje: string) { return { numeroFila, codigo, mensaje }; }
export async function updateImportCounter(tx: Prisma.TransactionClient, id: string, field: "registrosNuevos" | "registrosActualizados" | "registrosSinCambios" | "registrosConError") {
  return tx.importacion.update({ where: { id }, data: { [field]: { increment: 1 } } });
}

// Shared write rules for both modes. The caller must classify before invoking
// this writer when retention is enabled. No clinical data is logged here.
export async function writeValidatedRow(tx: Prisma.TransactionClient, importacionId: string, record: PreviewRow): Promise<RowWriteOutcome> {
  const { rutNumero, dv } = normalizeRut(record.rut, record.dv);
  const problemKey = normalizeText(record.problemaSalud);
  const guaranteeKey = normalizeText(record.nombreGarantia);
  const startDate = civilDate(record.fechaInicio);
  await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS locked", JSON.stringify({ rutNumero, dv }));
  const lockKey = `${rutNumero}-${dv}-${problemKey}-${guaranteeKey}-${record.fechaInicio}`;
  // PostgreSQL returns `void` for the lock function; cast it so Prisma can deserialize the raw result.
  await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS locked", lockKey);

  const patient = await tx.paciente.findUnique({ where: { rutNumero_dv: { rutNumero, dv } } });
  const candidateRows = patient
    ? await tx.garantia.findMany({
        where: { pacienteId: patient.id, fechaInicio: startDate },
        select: { id: true, problemaSalud: true, nombreGarantia: true, fechaLimite: true, responsable: true },
      })
    : [];
  const matches = candidateRows.filter((row) => normalizeText(row.problemaSalud) === problemKey && normalizeText(row.nombreGarantia) === guaranteeKey);

  if (matches.length > 1) {
    await tx.errorImportacion.create({ data: { importacionId, ...errorRecord(record.numeroFila, "AMBIGUOUS_MATCH", "Más de una garantía coincide con la clave provisional; no se modificó ningún registro.") } });
    await updateImportCounter(tx, importacionId, "registrosConError");
    return "ambiguo";
  }

  let patientId = patient?.id;
  const patientName = record.nombre.trim();
  if (!patient) {
    const createdPatient = await tx.paciente.create({ data: { rutNumero, dv, nombre: patientName } });
    patientId = createdPatient.id;
  } else if (patient.nombre !== patientName) {
    await tx.paciente.update({ where: { id: patient.id }, data: { nombre: patientName } });
  }

  if (matches.length === 1) {
    const match = matches[0];
    const nextLimit = civilDate(record.fechaLimite);
    const limitChanged = dateToCivil(match.fechaLimite) !== record.fechaLimite;
    const responsible = record.responsable.trim();
    const responsibleChanged = match.responsable !== responsible;
    if (limitChanged || responsibleChanged) {
      await tx.garantia.update({
        where: { id: match.id },
        data: {
          ...(limitChanged ? { fechaLimite: nextLimit } : {}),
          ...(responsibleChanged ? { responsable: responsible } : {}),
          version: { increment: 1 },
        },
      });
      await updateImportCounter(tx, importacionId, "registrosActualizados");
      return "actualizado";
    }
    await updateImportCounter(tx, importacionId, patient && patient.nombre !== patientName ? "registrosActualizados" : "registrosSinCambios");
    return patient && patient.nombre !== patientName ? "actualizado" : "sinCambios";
  }

  await tx.garantia.create({
    data: {
      pacienteId: patientId!,
      problemaSalud: record.problemaSalud.trim(),
      nombreGarantia: record.nombreGarantia.trim(),
      fechaInicio: startDate,
      fechaLimite: civilDate(record.fechaLimite),
      responsable: record.responsable.trim(),
    },
  });
  await updateImportCounter(tx, importacionId, "registrosNuevos");
  return "nuevo";
}


