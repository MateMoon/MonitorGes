import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { OPERATIONAL_ROLES } from "../auth/permissions.js";
import { evaluateRetentionPolicy, RETENTION_POLICY_VERSION } from "../importaciones/retention-policy.js";
import type { PreviewRow } from "../importaciones/validation-service.js";
import { getValidatedImportOrigin, getValidatedPatientContext, requireValidatedContext } from "./validated-context.js";
import { dateToCivil } from "../../utils/dates.js";
import { getMatchIdentityKeys } from "../importaciones/row-matching.js";
import { reviewFingerprint } from "./review-evidence.js";
import { revalidateRetainedRow } from "./retained-row-validation.js";
import { changedSourceFields, validSourceUpdate } from "./source-update.js";
import { candidateSetHash, fingerprint, hash, matchOf, readFamily, snapshotOf, sourceSelect, type SourceGuarantee } from "./candidate-evidence.js";
import { identifierSchema, originSchema, pendingPageSchema, decisionsPageSchema, parseInput, resolutionSchema, RowPersistenceError, validatedRowSchema, type FutureResolutionEffects, type PendingPageInput, type DecisionsPageInput, type PersistenceActor, type ResolutionInput, type SavePendingInput } from "./contracts.js";

type Tx = Prisma.TransactionClient;
const supervisors = ["ADMIN", "COORDINADOR_SOME"];
const detail = { candidatos: { orderBy: { garantiaId: "asc" as const } }, resolucion: true } satisfies Prisma.FilaImportacionInclude;
const failure = (code: string, message: string, status = 409): never => { throw new RowPersistenceError(code, message, status); };
function checkActor(actor: PersistenceActor, roles: readonly string[]) {
  if (!roles.includes(actor.rol)) failure("FORBIDDEN", "No tienes permiso para esta operación de Calidad de datos.", 403);
  parseInput(identifierSchema, actor.id);
}
async function actualActor(tx: Tx, actor: PersistenceActor) {
  const user = await tx.usuario.findUnique({ where: { id: actor.id }, select: { id: true, nombre: true, rol: true, activo: true } });
  if (!user?.activo || user.rol !== actor.rol) return failure("FORBIDDEN", "La cuenta no está autorizada o ya no está activa.", 403);
  return user;
}

/** No singleton, routes, scheduler or DB URL: callers must supply their own
 * client. No operational DISTINCT effect is supplied here. The importer may
 * join savePendingRowInTransaction to its classification/progress transaction.
 */
export function createImportRowPersistence(db: PrismaClient) {
  async function transaction<T>(action: (tx: Tx) => Promise<T>, readOnly = false): Promise<T> {
    try {
      return await db.$transaction(async tx => {
        if (readOnly) await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return action(tx);
      }, { isolationLevel: readOnly ? Prisma.TransactionIsolationLevel.RepeatableRead : Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30000, maxWait: 10000 });
    } catch (error) {
      if (error instanceof RowPersistenceError) throw error;
      const code = (error as { code?: string }).code;
      if (code === "P2002" || code === "P2034") return failure("PERSISTENCE_CONFLICT", "Otra operación cambió la fila o utilizó esta solicitud. Recarga antes de continuar.");
      if (code === "P2003") return failure("INVALID_SOURCE_REFERENCE", "La importación, el usuario o la garantía de origen ya no están disponibles.");
      return failure("PERSISTENCE_UNAVAILABLE", "No fue posible completar la operación de filas de importación.", 503);
    }
  }

  async function savePendingRow(actor: PersistenceActor, input: SavePendingInput) {
    checkActor(actor, OPERATIONAL_ROLES);
    requireValidatedContext(input.contextoValidado);
    return transaction(tx => savePendingRowInTransaction(tx, actor, input));
  }

  /** Internal unit of work: caller owns the transaction and its commit/rollback. */
  async function savePendingRowInTransaction(tx: Tx, actor: PersistenceActor, input: SavePendingInput) {
    checkActor(actor, OPERATIONAL_ROLES);
    requireValidatedContext(input.contextoValidado);
    const origin = parseInput(originSchema, { importacionId: input.importacionId, hoja: input.hoja, numeroFila: input.numeroFila });
    if (origin.hoja !== getValidatedImportOrigin(input.contextoValidado).hoja) return failure("INVALID_SOURCE_SHEET", "La hoja no corresponde a la nómina validada.", 400);
    const patientContext = getValidatedPatientContext(input.contextoValidado, origin.numeroFila);
    const rows = patientContext.registrosValidos.map(row => parseInput(validatedRowSchema, row));
    const context = { registrosValidos: rows, validation: patientContext.validation };
    const received = rows.find(row => row.numeroFila === origin.numeroFila);
    if (!received) return failure("INVALID_ROW_SELECTION", "Selecciona una fila válida del resultado original del parser.", 400);
    const dataHash = hash(received);
      const user = await actualActor(tx, actor);
      const source = await tx.importacion.findUnique({ where: { id: origin.importacionId }, select: { id: true, usuarioId: true } });
      if (!source) return failure("IMPORT_NOT_FOUND", "La importación de origen no existe.", 404);
      if (source.usuarioId !== user.id) return failure("IMPORT_OWNER_MISMATCH", "La fila debe proceder de una importación de esta cuenta.", 403);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(origin)}, 0))::text`;
      const previous = await tx.filaImportacion.findUnique({ where: { importacionId_hoja_numeroFila: origin } });
      if (previous) {
        if (previous.huellaDatos !== dataHash || previous.versionPolitica !== RETENTION_POLICY_VERSION) return failure("SOURCE_ROW_CONFLICT", "La procedencia ya corresponde a otros datos o a otra versión de la política.");
        return { id: previous.id, estado: previous.estado, version: previous.version, reutilizada: true };
      }
      const candidates = await readFamily(tx, received, true);
      let result;
      try { result = evaluateRetentionPolicy(context, candidates.map(matchOf)).filas.find(row => row.numeroFila === origin.numeroFila); }
      catch { return failure("INVALID_VALIDATED_CONTEXT", "El contexto debe ser el resultado completo y validado de la nómina.", 400); }
      if (result?.clasificacion !== "PENDIENTE_REVISION") return failure("ROW_NOT_PENDING", "La política no propone retener esta fila; las repeticiones equivalentes remiten a su representante.", 400);
      const saved = await tx.filaImportacion.create({ data: {
        ...origin, datosValidados: received, motivos: result.motivos, versionPolitica: RETENTION_POLICY_VERSION,
        huellaFila: result.huellaFila, huellaDatos: dataHash, huellaCandidatos: candidateSetHash(candidates),
        candidatos: { create: candidates.map(candidate => ({ garantiaId: candidate.id, datos: snapshotOf(candidate, received.nombre), huella: fingerprint(candidate), versionGarantia: candidate.version, revisionGestion: candidate.revisionGestion })) },
      } });
      return { id: saved.id, estado: saved.estado, version: saved.version, reutilizada: false };
  }

  async function listPendingRows(actor: PersistenceActor, query: PendingPageInput = {}) {
    checkActor(actor, supervisors);
    const page = parseInput(pendingPageSchema, query);
    return transaction(async tx => {
      await actualActor(tx, actor);
      const where = { estado: "PENDIENTE" as const, ...(page.importacionId ? { importacionId: page.importacionId } : {}), ...(page.motivo ? { motivos: { has: page.motivo } } : {}) };
      const pendientesTotales = await tx.filaImportacion.count({ where: { estado: "PENDIENTE" } });
      const total = await tx.filaImportacion.count({ where }), totalPages = Math.ceil(total / page.limit), current = Math.min(page.page, Math.max(1, totalPages));
      const rows = await tx.filaImportacion.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: (current - 1) * page.limit, take: page.limit,
        select: { id: true, importacionId: true, hoja: true, numeroFila: true, motivos: true, version: true, createdAt: true, datosValidados: true, _count: { select: { candidatos: true } } },
      });
      return { filas: rows.map(({ datosValidados, ...row }) => { const data = parseInput(validatedRowSchema, datosValidados); return { ...row, nombre: data.nombre, problemaSalud: data.problemaSalud, nombreGarantia: data.nombreGarantia }; }), pendientesTotales, pagination: { page: current, limit: page.limit, total, totalPages } };
    }, true);
  }

  async function getRow(actor: PersistenceActor, id: string) {
    checkActor(actor, supervisors);
    parseInput(identifierSchema, id);
    return transaction(async tx => {
      await actualActor(tx, actor);
      const row = await tx.filaImportacion.findUnique({ where: { id }, include: detail });
      if (!row) return failure("ROW_NOT_FOUND", "La fila de importación no existe.", 404);
      const data = parseInput(validatedRowSchema, row.datosValidados), current = await readFamily(tx, data);
      const sources = row.resolucion?.decision === "DISTINTA" ? current.filter(g => g.id !== row.garantiaResultadoId) : current;
      const counts = current.length ? await tx.eventoGarantia.groupBy({ by: ["garantiaId"], where: { garantiaId: { in: current.map(g => g.id) }, tipo: "ACTUACION" }, _count: { _all: true } }) : [];
      const byGuarantee = new Map(counts.map(count => [count.garantiaId, count._count._all]));
      return { ...row, huellaRevision: reviewFingerprint(row, current), antecedentesVigentes: candidateSetHash(sources) === row.huellaCandidatos, candidatosActuales: current.map(g => ({ id: g.id, datos: snapshotOf(g, data.nombre), version: g.version, revisionGestion: g.revisionGestion, actuacionesDisponibles: byGuarantee.get(g.id) ?? 0 })) };
    }, true);
  }

  async function registerResolution(actor: PersistenceActor, command: ResolutionInput, effects?: FutureResolutionEffects) {
    checkActor(actor, supervisors);
    const input = parseInput(resolutionSchema, command), requestHash = hash({ actor: actor.id, ...input });
    return transaction(async tx => {
      const user = await actualActor(tx, actor);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.solicitudId}, 0))::text`;
      const previous = await tx.resolucionFilaImportacion.findUnique({ where: { solicitudId: input.solicitudId } });
      if (previous) {
        if (previous.usuarioId !== actor.id || previous.huellaSolicitud !== requestHash) return failure("IDEMPOTENCY_CONFLICT", "La solicitud ya fue utilizada con otra cuenta o contenido.");
        return { resolucion: previous, repetida: true };
      }
      const initial = await tx.filaImportacion.findUnique({ where: { id: input.filaId } });
      if (!initial) return failure("ROW_NOT_FOUND", "La fila de importación no existe.", 404);
      const data = await revalidateRetainedRow(initial.datosValidados, initial.huellaDatos, initial.versionPolitica);
      const sources = await readFamily(tx, data, true);
      await tx.$queryRaw`SELECT "id" FROM "FilaImportacion" WHERE "id" = ${input.filaId}::uuid FOR UPDATE`;
      const row = await tx.filaImportacion.findUniqueOrThrow({ where: { id: input.filaId } });
      if (row.estado !== "PENDIENTE" || row.version !== input.version) return failure("STALE_ROW", "La fila ya fue resuelta o cambió de versión. Recarga sus antecedentes.");
      if (row.huellaDatos !== initial.huellaDatos || hash(parseInput(validatedRowSchema, row.datosValidados)) !== initial.huellaDatos || row.versionPolitica !== initial.versionPolitica) return failure("INVALID_RETAINED_ROW", "Los datos retenidos cambiaron durante la revisión.");
      const reviewedHash = reviewFingerprint(row, sources);
      if (input.huellaRevision ? input.huellaRevision !== reviewedHash : candidateSetHash(sources) !== row.huellaCandidatos) return failure("STALE_CANDIDATES", "Las garantías candidatas cambiaron. Recarga el detalle y revisa todas las candidatas antes de confirmar.");
      let result: SourceGuarantee;
      let actualizacion: Prisma.InputJsonObject | undefined;
      if (input.decision === "MISMA") {
        const selected = sources.find(g => g.id === input.garantiaExistenteId);
        if (!selected) return failure("INVALID_CANDIDATE", "Selecciona una garantía candidata vigente.", 400);
        result = selected; // No UPDATE, including patient names, source timestamps or management state.
        if (input.actualizarDatos) {
          const campos = changedSourceFields(selected, data);
          if (!campos.length) return failure("NO_SOURCE_CHANGES", "La garantía seleccionada ya tiene esos datos. Puedes conservarla con la opción Es la misma garantía.", 400);
          if (sources.some(source => source.id !== selected.id && dateToCivil(source.fechaInicio) === data.fechaInicio)) return failure("UPDATE_IDENTITY_CONFLICT", "Otra garantía candidata ya tiene la fecha de inicio de la nómina. Revisa la selección antes de actualizar para evitar duplicar un episodio.", 400);
          if (!effects?.actualizarGarantiaExistente) return failure("UPDATE_EFFECT_NOT_CONFIGURED", "La actualización de datos no está disponible.", 501);
          await effects.actualizarGarantiaExistente(tx, { garantiaExistenteId: selected.id, datosValidados: Object.freeze({ ...data }) });
          const updated = await tx.garantia.findUnique({ where: { id: selected.id }, select: sourceSelect });
          if (!updated || !validSourceUpdate(selected, updated, data)) return failure("EFFECT_NOT_COMPLETED", "No se pudo actualizar la garantía conservando su gestión e historial.");
          result = updated;
          actualizacion = {
            campos, antes: snapshotOf(selected, data.nombre), despues: snapshotOf(updated, data.nombre),
            versionAnterior: selected.version, versionNueva: updated.version,
            revisionGestion: selected.revisionGestion, gestionadaAt: selected.gestionadaAt?.toISOString() ?? null,
            gestionadaPorUsuarioId: selected.gestionadaPorUsuarioId, actuacionesConservadas: selected._count.eventos,
          };
        }
      } else {
        if (!effects) return failure("DISTINCT_EFFECT_NOT_CONFIGURED", "La creación operativa de garantías se habilitará en una etapa posterior.", 501);
        const id = randomUUID();
        if (await tx.garantia.findUnique({ where: { id }, select: { id: true } })) return failure("RESULT_ID_CONFLICT", "No fue posible reservar un identificador nuevo.");
        await effects.crearGarantiaDistinta(tx, { nuevaGarantiaId: id, datosValidados: Object.freeze({ ...data }) });
        const created = await tx.garantia.findUnique({ where: { id }, select: sourceSelect });
        if (!created || !validDistinctResult(created, data)) return failure("EFFECT_NOT_COMPLETED", "El ejecutor no creó una garantía nueva válida en la transacción.");
        result = created;
      }
      // The composite FK requires the same result in both rows. If audit INSERT
      // fails, this state/version change AND the optional future effect roll back.
      await tx.filaImportacion.update({ where: { id: row.id }, data: { estado: "RESUELTA", version: { increment: 1 }, garantiaResultadoId: result.id } });
      const resolution = await tx.resolucionFilaImportacion.create({ data: {
        filaId: row.id, decision: input.decision, usuarioId: user.id, autorNombre: user.nombre, justificacion: input.justificacion,
        solicitudId: input.solicitudId, huellaSolicitud: requestHash, garantiaResultadoId: result.id,
        antecedentesRevisados: { version: actualizacion ? 2 : 1, huellaRevision: reviewedHash, huellaDatos: row.huellaDatos, distintaDeTodas: input.decision === "DISTINTA", candidatas: sources.map(source => ({ id: source.id, version: source.version, revisionGestion: source.revisionGestion, huella: fingerprint(source), datos: snapshotOf(source, data.nombre) })),
          ...(actualizacion ? { accion: "ACTUALIZAR_DATOS", actualizacion } : {}),
        },
      } });
      return { resolucion: resolution, repetida: false };
    });
  }

  async function listResolutions(actor: PersistenceActor, query: DecisionsPageInput = {}) {
    checkActor(actor, supervisors);
    const page = parseInput(decisionsPageSchema, query);
    return transaction(async tx => {
      await actualActor(tx, actor);
      const where = { ...(page.importacionId ? { fila: { importacionId: page.importacionId } } : {}), ...(page.decision ? { decision: page.decision } : {}) };
      const total = await tx.resolucionFilaImportacion.count({ where }), totalPages = Math.ceil(total / page.limit), current = Math.min(page.page, Math.max(1, totalPages));
      const resoluciones = await tx.resolucionFilaImportacion.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (current - 1) * page.limit, take: page.limit,
        include: { fila: { select: { importacionId: true, hoja: true, numeroFila: true } } },
      });
      return { resoluciones, pagination: { page: current, limit: page.limit, total, totalPages } };
    }, true);
  }
  return { savePendingRow, savePendingRowInTransaction, listPendingRows, getRow, registerResolution, listResolutions };
}

function validDistinctResult(result: SourceGuarantee, row: PreviewRow) {
  return getMatchIdentityKeys({ numeroFila: 0, ...matchOf(result) }).exactKey === getMatchIdentityKeys(row).exactKey
    && dateToCivil(result.fechaLimite) === row.fechaLimite && result.responsable === row.responsable.trim()
    && result.estadoGestion === "SIN_GESTION" && result.revisionGestion === 0 && result.version === 1
    && result.gestionadaAt === null && result.gestionadaPorUsuarioId === null && result._count.eventos === 0;
}
