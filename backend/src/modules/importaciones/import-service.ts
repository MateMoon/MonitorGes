import { EstadoImportacion, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { dateToCivil } from "../../utils/dates.js";
import { parseWorkbookForImport, type PreviewRow, type ValidationError } from "./validation-service.js";

export interface ImportFileResult {
  id: string;
  nombreArchivo: string;
  fechaImportacion: Date;
  estado: EstadoImportacion;
  filasLeidas: number;
  registrosNuevos: number;
  registrosActualizados: number;
  registrosSinCambios: number;
  registrosConError: number;
  errores: ValidationError[];
}

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function normalizeRut(record: PreviewRow): { rutNumero: string; dv: string } {
  const raw = record.rut.toUpperCase();
  const clean = raw.replace(/[.\-\s]/g, "");
  const combined = (raw.includes("-") || clean.length > 8) ? /^(\d{1,8})([0-9K])$/.exec(clean) : null;
  return { rutNumero: combined?.[1] ?? clean.replace(/\D/g, ""), dv: record.dv.toUpperCase() || combined?.[2] || "" };
}

function civilDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function errorRecord(numeroFila: number, codigo: string, mensaje: string) {
  return { numeroFila, codigo, mensaje };
}

async function updateImportCounter(tx: Prisma.TransactionClient, id: string, field: "registrosNuevos" | "registrosActualizados" | "registrosSinCambios" | "registrosConError") {
  return tx.importacion.update({ where: { id }, data: { [field]: { increment: 1 } } });
}

async function processValidRow(importacionId: string, record: PreviewRow): Promise<"nuevo" | "actualizado" | "sinCambios" | "ambiguo"> {
  return prisma.$transaction(async (tx) => {
    const { rutNumero, dv } = normalizeRut(record);
    const problemKey = normalizeText(record.problemaSalud);
    const guaranteeKey = normalizeText(record.nombreGarantia);
    const startDate = civilDate(record.fechaInicio);
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
  });
}

async function persistInitialErrors(importacionId: string, errors: ValidationError[]) {
  if (errors.length === 0) return;
  await prisma.errorImportacion.createMany({
    data: errors.map((error) => ({
      importacionId,
      numeroFila: error.numeroFila,
      codigo: error.codigo,
      mensaje: error.campo ? `${error.campo}: ${error.mensaje}` : error.mensaje,
    })),
  });
}

async function persistRowError(importacionId: string, error: ValidationError) {
  await prisma.$transaction(async (tx) => {
    await tx.errorImportacion.create({
      data: { importacionId, numeroFila: error.numeroFila, codigo: error.codigo, mensaje: error.mensaje },
    });
    await updateImportCounter(tx, importacionId, "registrosConError");
  });
}

export async function importWorkbook(buffer: Buffer, filename: string): Promise<ImportFileResult> {
  const { validation, registrosValidos } = await parseWorkbookForImport(buffer, filename);
  const validationErrorRows = new Set(validation.errores.map((error) => error.numeroFila));
  const initial = await prisma.$transaction(async (tx) => {
    const importacion = await tx.importacion.create({
      data: {
        nombreArchivo: validation.nombreArchivo,
        estado: EstadoImportacion.FALLIDA,
        registrosLeidos: validation.filasLeidas,
        registrosConError: validationErrorRows.size,
      },
    });
    if (validation.errores.length) {
      await tx.errorImportacion.createMany({
        data: validation.errores.map((error) => ({
          importacionId: importacion.id,
          numeroFila: error.numeroFila,
          codigo: error.codigo,
          mensaje: error.campo ? `${error.campo}: ${error.mensaje}` : error.mensaje,
        })),
      });
    }
    return importacion;
  });

  const errores = [...validation.errores];
  let registrosNuevos = 0;
  let registrosActualizados = 0;
  let registrosSinCambios = 0;
  let registrosConError = validationErrorRows.size;

  for (const record of registrosValidos) {
    try {
      const outcome = await processValidRow(initial.id, record);
      if (outcome === "nuevo") registrosNuevos += 1;
      else if (outcome === "actualizado") registrosActualizados += 1;
      else if (outcome === "sinCambios") registrosSinCambios += 1;
      else {
        registrosConError += 1;
        errores.push({ numeroFila: record.numeroFila, codigo: "AMBIGUOUS_MATCH", campo: "garantia", mensaje: "Más de una garantía coincide con la clave provisional; no se modificó ningún registro." });
      }
    } catch {
      const error = { numeroFila: record.numeroFila, codigo: "DATABASE_ERROR", campo: "fila", mensaje: "No fue posible guardar esta fila por un error de base de datos." };
      await persistRowError(initial.id, error);
      errores.push(error);
      registrosConError += 1;
    }
  }

  const successes = registrosNuevos + registrosActualizados + registrosSinCambios;
  const estado = registrosConError === 0
    ? EstadoImportacion.COMPLETADA
    : successes > 0 ? EstadoImportacion.COMPLETADA_CON_OBSERVACIONES : EstadoImportacion.FALLIDA;
  const final = await prisma.importacion.update({ where: { id: initial.id }, data: { estado } });
  return {
    id: final.id,
    nombreArchivo: final.nombreArchivo,
    fechaImportacion: final.fechaImportacion,
    estado: final.estado,
    filasLeidas: final.registrosLeidos,
    registrosNuevos,
    registrosActualizados,
    registrosSinCambios,
    registrosConError,
    errores,
  };
}
