import { EstadoImportacion } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { parseWorkbookForImport, type PreviewRow, type ValidationError } from "./validation-service.js";
import { updateImportCounter, writeValidatedRow } from "./row-writer.js";
import { readImportRetentionConfig } from "./retention-config.js";

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
  registrosPendientesRevision: number;
  registrosRepetidosOmitidos: number;
  registrosInvalidos: number;
  errores: ValidationError[];
}

async function processValidRow(importacionId: string, record: PreviewRow) {
  return prisma.$transaction(tx => writeValidatedRow(tx, importacionId, record));
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

export async function importWorkbook(buffer: Buffer, filename: string, usuarioId: string, options: { solicitudId?: string } = {}): Promise<ImportFileResult> {
  if (readImportRetentionConfig()) {
    const { importWorkbookWithRetention } = await import("./retained-import-service.js");
    return importWorkbookWithRetention(prisma, buffer, filename, usuarioId, options);
  }
  const { validation, registrosValidos } = await parseWorkbookForImport(buffer, filename);
  const validationErrorRows = new Set(validation.errores.map((error) => error.numeroFila));
  const initial = await prisma.$transaction(async (tx) => {
    const importacion = await tx.importacion.create({
      data: {
        nombreArchivo: validation.nombreArchivo,
        usuarioId,
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
    registrosPendientesRevision: 0,
    registrosRepetidosOmitidos: 0,
    registrosInvalidos: validationErrorRows.size,
    errores,
  };
}
