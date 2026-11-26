import { randomUUID } from "node:crypto";
import { EstadoImportacion, Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { OPERATIONAL_ROLES } from "../auth/permissions.js";
import { createImportRowPersistence } from "../calidad-datos/persistence-service.js";
import { matchOf, readPatientSources } from "../calidad-datos/candidate-evidence.js";
import { getValidatedImportOrigin, getValidatedPatientContext, prepareValidatedImportContext } from "../calidad-datos/validated-context.js";
import { findExistingMatchCandidates } from "./candidate-repository.js";
import { normalizeIdentityRut } from "./identity-normalization.js";
import { evaluateRetentionPolicy, RETENTION_POLICY_VERSION } from "./retention-policy.js";
import { writeValidatedRow } from "./row-writer.js";
import { WorkbookInputError, type PreviewRow } from "./validation-service.js";
import type { ImportFileResult } from "./import-service.js";

type Tx = Prisma.TransactionClient;
const outcomesSchema = z.record(z.string(), z.enum(["nuevo", "actualizado", "sinCambios", "pendiente", "repetida", "error"]));
type Outcomes = z.infer<typeof outcomesSchema>;
const controlInclude = { importacion: { include: { errores: true } } } satisfies Prisma.ControlRetencionImportacionInclude;
function fail(code: string, message: string, status = 409): never { throw new WorkbookInputError(code, message, status); }
async function actorIn(tx: Tx, id: string) {
  const actor = await tx.usuario.findUnique({ where: { id }, select: { id: true, rol: true, activo: true } });
  if (!actor?.activo || !OPERATIONAL_ROLES.some(role => role === actor.rol)) return fail("FORBIDDEN", "La cuenta no tiene permiso para importar.", 403);
  return actor;
}
async function lockedControl(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "importacionId" FROM "ControlRetencionImportacion" WHERE "importacionId" = ${id}::uuid FOR UPDATE`;
  return tx.controlRetencionImportacion.findUniqueOrThrow({ where: { importacionId: id } });
}
function isRetryable(error: unknown) {
  const value = error as { code?: string; meta?: { code?: string } };
  return value.code === "P2034" || (value.code === "P2010" && ["40001", "40P01"].includes(value.meta?.code ?? ""));
}

/** Enabled mode only. Never calls the informative comparison service. A patient
 * group is the transaction boundary: it includes all families affected by a
 * shared patient name, and all contradictory rows before any source write.
 * Row outcomes, counters, retained evidence and normal writes commit together.
 */
export async function importWorkbookWithRetention(db: PrismaClient, buffer: Buffer, filename: string, usuarioId: string, options: { solicitudId?: string } = {}): Promise<ImportFileResult> {
  const parsedId = z.uuid().safeParse(options.solicitudId ?? randomUUID());
  if (!parsedId.success) return fail("INVALID_IMPORT_REQUEST_ID", "El identificador de solicitud de importación debe ser un UUID.", 400);
  const requestId = parsedId.data;
  const context = await prepareValidatedImportContext(buffer, filename);
  const { validation, registrosValidos } = context;
  const origin = getValidatedImportOrigin(context);
  // Complete-file analysis happens BEFORE any patient or guarantee write.
  // Failure to read the catalog propagates; it never means an empty catalog.
  evaluateRetentionPolicy(context, await findExistingMatchCandidates(registrosValidos, db));
  const invalidRows = new Set(validation.errores.map(error => error.numeroFila));
  const persist = createImportRowPersistence(db);

  const transaction = <T>(work: (tx: Tx) => Promise<T>) => db.$transaction(work, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 60000, maxWait: 10000,
  });
  const initial = await transaction(async tx => {
    await actorIn(tx, usuarioId);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestId}, 0))::text`;
    // This lookup also fails closed if the required migrations are absent.
    const previous = await tx.controlRetencionImportacion.findUnique({ where: { solicitudId: requestId }, include: { importacion: true } });
    if (previous) {
      if (previous.importacion.usuarioId !== usuarioId || previous.huellaArchivo !== origin.huellaArchivo || previous.importacion.nombreArchivo !== validation.nombreArchivo || previous.versionPolitica !== RETENTION_POLICY_VERSION) return fail("IMPORT_IDEMPOTENCY_CONFLICT", "La solicitud ya corresponde a otra cuenta, archivo o versión de la política.");
      return previous.importacion;
    }
    const importation = await tx.importacion.create({ data: {
      nombreArchivo: validation.nombreArchivo, usuarioId, estado: EstadoImportacion.FALLIDA,
      registrosLeidos: validation.filasLeidas, registrosConError: invalidRows.size,
    } });
    if (validation.errores.length) await tx.errorImportacion.createMany({ data: validation.errores.map(error => ({
      importacionId: importation.id, numeroFila: error.numeroFila, codigo: error.codigo,
      mensaje: error.campo ? `${error.campo}: ${error.mensaje}` : error.mensaje,
    })) });
    await tx.controlRetencionImportacion.create({ data: {
      importacionId: importation.id, solicitudId: requestId, huellaArchivo: origin.huellaArchivo,
      versionPolitica: RETENTION_POLICY_VERSION, registrosInvalidos: invalidRows.size,
    } });
    return importation;
  });

  const groups = new Map<string, PreviewRow[]>();
  for (const row of registrosValidos) {
    const key = JSON.stringify(normalizeIdentityRut(row.rut, row.dv));
    const group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
  }
  for (const group of groups.values()) {
    const patientContext = getValidatedPatientContext(context, group[0].numeroFila);
    let failure: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await transaction(async tx => {
          const actor = await actorIn(tx, usuarioId);
          const control = await lockedControl(tx, initial.id), outcomes = outcomesSchema.parse(control.resultados);
          if (control.completada || group.every(row => outcomes[row.numeroFila])) return;
          if (group.some(row => outcomes[row.numeroFila])) return fail("IMPORT_PROGRESS_CONFLICT", "El progreso de este grupo está incompleto; no se aplicaron cambios.");
          // Same source-origin order as the persistence service, before taking
          // the shared patient lock. Never lock by start date alone.
          for (const row of group) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify({ importacionId: initial.id, hoja: origin.hoja, numeroFila: row.numeroFila })}, 0))::text`;
          const sources = await readPatientSources(tx, group[0], true);
          const plan = evaluateRetentionPolicy(patientContext, sources.map(matchOf));
          const decisions = new Map(plan.filas.map(row => [row.numeroFila, row]));
          let pending = 0, repeated = 0;
          // All pending/conflicting rows are already classified under locks.
          // None of them enters the normal writer, regardless of file order.
          for (const row of group) {
            const decision = decisions.get(row.numeroFila);
            if (decision?.clasificacion === "OMITIR_REPETIDA") { outcomes[row.numeroFila] = "repetida"; repeated++; continue; }
            if (decision?.clasificacion === "PENDIENTE_REVISION") continue;
            // Re-read under the held patient/source locks immediately before
            // each normal write. An initial preview cannot authorize this write.
            const current = await readPatientSources(tx, row);
            const checked = evaluateRetentionPolicy(patientContext, current.map(matchOf)).filas.find(result => result.numeroFila === row.numeroFila);
            if (checked?.clasificacion !== "PROCESAR_NORMAL") return fail("IMPORT_POLICY_CHANGED", "La clasificación cambió dentro de la transacción; no se aplicó este grupo.");
            const outcome = await writeValidatedRow(tx, initial.id, row);
            if (outcome === "ambiguo") return fail("IMPORT_POLICY_CHANGED", "Las candidatas cambiaron; no se aplicó este grupo.");
            outcomes[row.numeroFila] = outcome;
          }
          // Capture evidence after legitimate writes in OTHER families of this
          // patient, so a permitted patient-name update cannot make a pending
          // snapshot stale at its own commit. Failure here rolls back the whole
          // group, including every prior normal write and its counters.
          for (const row of group) {
            if (decisions.get(row.numeroFila)?.clasificacion !== "PENDIENTE_REVISION") continue;
            await persist.savePendingRowInTransaction(tx, actor, { importacionId: initial.id, hoja: origin.hoja, numeroFila: row.numeroFila, contextoValidado: context });
            outcomes[row.numeroFila] = "pendiente"; pending++;
          }
          await tx.controlRetencionImportacion.update({ where: { importacionId: initial.id }, data: {
            resultados: outcomes, registrosPendientesRevision: { increment: pending }, registrosRepetidosOmitidos: { increment: repeated },
          } });
        });
        failure = undefined; break;
      } catch (error) {
        failure = error;
        if (!isRetryable(error) || attempt === 2) break;
      }
    }
    if (failure) {
      const status = (failure as { statusCode?: number }).statusCode;
      if (status === 403 || status === 400 || status === 409) throw failure;
      // A failed group was rolled back completely. Record errors once, without
      // source values. If the DB is unavailable here, a same-ID retry resumes
      // the uncommitted group; prior committed groups are never applied twice.
      await transaction(async tx => {
        await actorIn(tx, usuarioId);
        const control = await lockedControl(tx, initial.id), outcomes = outcomesSchema.parse(control.resultados);
        if (control.completada || group.every(row => outcomes[row.numeroFila])) return;
        if (group.some(row => outcomes[row.numeroFila])) return fail("IMPORT_PROGRESS_CONFLICT", "No fue posible recuperar el progreso de la importación.");
        await tx.errorImportacion.createMany({ data: group.map(row => ({ importacionId: initial.id, numeroFila: row.numeroFila, codigo: "DATABASE_ERROR", mensaje: "No fue posible guardar esta fila; se revirtió su grupo sin cambios parciales." })) });
        for (const row of group) outcomes[row.numeroFila] = "error";
        await tx.importacion.update({ where: { id: initial.id }, data: { registrosConError: { increment: group.length } } });
        await tx.controlRetencionImportacion.update({ where: { importacionId: initial.id }, data: { resultados: outcomes } });
      });
    }
  }

  return transaction(async tx => {
    await actorIn(tx, usuarioId);
    const control = await lockedControl(tx, initial.id), outcomes: Outcomes = outcomesSchema.parse(control.resultados);
    if (!registrosValidos.every(row => outcomes[row.numeroFila])) return fail("IMPORT_INCOMPLETE", "La importación tiene grupos pendientes de procesar; reintenta con la misma solicitud.", 503);
    const row = await tx.importacion.findUniqueOrThrow({ where: { id: initial.id } });
    const successes = row.registrosNuevos + row.registrosActualizados + row.registrosSinCambios;
    const hasObservations = row.registrosConError > 0 || control.registrosPendientesRevision > 0;
    const estado = !hasObservations ? EstadoImportacion.COMPLETADA
      : successes + control.registrosPendientesRevision > 0 ? EstadoImportacion.COMPLETADA_CON_OBSERVACIONES : EstadoImportacion.FALLIDA;
    if (!control.completada) {
      await tx.importacion.update({ where: { id: initial.id }, data: { estado } });
      await tx.controlRetencionImportacion.update({ where: { importacionId: initial.id }, data: { completada: true } });
    }
    const final = await tx.controlRetencionImportacion.findUniqueOrThrow({ where: { importacionId: initial.id }, include: controlInclude });
    const imported = final.importacion;
    return {
      id: imported.id, nombreArchivo: imported.nombreArchivo, fechaImportacion: imported.fechaImportacion, estado: imported.estado,
      filasLeidas: imported.registrosLeidos, registrosNuevos: imported.registrosNuevos, registrosActualizados: imported.registrosActualizados,
      registrosSinCambios: imported.registrosSinCambios, registrosConError: imported.registrosConError,
      registrosPendientesRevision: final.registrosPendientesRevision, registrosRepetidosOmitidos: final.registrosRepetidosOmitidos, registrosInvalidos: final.registrosInvalidos,
      errores: imported.errores.map(error => ({ numeroFila: error.numeroFila, codigo: error.codigo, mensaje: error.mensaje })).sort((a, b) => a.numeroFila - b.numeroFila || a.codigo.localeCompare(b.codigo)),
    };
  });
}
