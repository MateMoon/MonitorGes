import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { eventSelect, timelineOrder } from "../garantias/management-repository.js";
import { isSourceDataUpdate } from "../calidad-datos/source-update.js";

export const SUPERVISION_ACTIVITY_LIMIT = 30;

const guaranteeSelect = { id: true, problemaSalud: true, nombreGarantia: true, responsable: true, estadoGestion: true, paciente: { select: { nombre: true } } } satisfies Prisma.GarantiaSelect;
type GuaranteeContext = Prisma.GarantiaGetPayload<{ select: typeof guaranteeSelect }>;
const context = (guarantee: GuaranteeContext) => ({ id: guarantee.id, problemaSalud: guarantee.problemaSalud, nombreGarantia: guarantee.nombreGarantia,
  establecimiento: guarantee.responsable, estadoGestion: guarantee.estadoGestion, paciente: guarantee.paciente,
});
export const IMPORT_REVIEW_DESCRIPTIONS = {
  MISMA: "Se confirmó que los datos recibidos corresponden a una garantía existente",
  DISTINTA: "Se confirmó una garantía distinta y se incorporó un nuevo registro",
} as const;

/** A single global SQL window selects IDs before hydrating either source. This
 * reads resolutions, never creates EventoGarantia or changes management state.
 * The catalog check keeps the previous QA schema working without migrations,
 * independently of the import/API activation flags. No partial-error fallback.
 */
export async function readSupervisionActivity(db = prisma) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const [availability] = await tx.$queryRaw<Array<{ present: boolean }>>`SELECT to_regclass('"ResolucionFilaImportacion"') IS NOT NULL AS present`;
    if (typeof availability?.present !== "boolean") throw new Error("SUPERVISION_ACTIVITY_SCHEMA_CHECK_FAILED");
    const keys = availability.present ? await tx.$queryRaw<Array<{ id: string; fuente: "GESTION" | "REVISION_IMPORTACION" }>>`
      SELECT "id", "fuente" FROM (
        SELECT "id", "createdAt", "secuencia", 'GESTION' AS "fuente" FROM "EventoGarantia"
        UNION ALL
        SELECT "id", "createdAt", NULL::integer AS "secuencia", 'REVISION_IMPORTACION' AS "fuente" FROM "ResolucionFilaImportacion"
      ) AS timeline
      ORDER BY "createdAt" DESC, "fuente" ASC, "secuencia" DESC NULLS LAST, "id" DESC
      LIMIT ${SUPERVISION_ACTIVITY_LIMIT}
    ` : null;
    const rows = await tx.eventoGarantia.findMany({
      where: keys ? { id: { in: keys.filter(key => key.fuente === "GESTION").map(key => key.id) } } : undefined,
      orderBy: keys ? undefined : timelineOrder, take: keys ? undefined : SUPERVISION_ACTIVITY_LIMIT,
      select: { ...eventSelect, garantia: { select: guaranteeSelect } },
    });
    const normal = rows.map(({ garantia, createdAt, ...event }) => ({ ...event, createdAt: createdAt.toISOString(), garantia: context(garantia) }));
    if (!keys) return normal;
    const reviewIds = keys.filter(key => key.fuente === "REVISION_IMPORTACION").map(key => key.id);
    const decisions = reviewIds.length ? await tx.resolucionFilaImportacion.findMany({
      where: { id: { in: reviewIds } },
      select: { id: true, decision: true, antecedentesRevisados: true, autorNombre: true, usuarioId: true, justificacion: true, createdAt: true, garantiaResultadoId: true,
        garantiaResultado: { select: guaranteeSelect },
        fila: { select: { hoja: true, numeroFila: true, importacionId: true, importacion: { select: { nombreArchivo: true } } } },
      },
    }) : [];
    const reviews = decisions.map(decision => ({
      id: `revision-importacion:${decision.id}`, secuencia: null, tipo: "REVISION_IMPORTACION" as const,
      tipoActuacion: null, comentario: null, estadoAnterior: null, estadoNuevo: null, respaldo: null,
      createdAt: decision.createdAt.toISOString(), autorNombre: decision.autorNombre, usuarioId: decision.usuarioId,
      garantia: context(decision.garantiaResultado),
      revisionImportacion: { id: decision.id, decision: decision.decision,
        ...(isSourceDataUpdate(decision) ? { actualizarDatos: true as const } : {}),
        descripcion: isSourceDataUpdate(decision) ? "Se actualizaron los datos de la garantía existente con la nómina, conservando su estado, gestiones e historial" : IMPORT_REVIEW_DESCRIPTIONS[decision.decision],
        justificacion: decision.justificacion, garantiaResultadoId: decision.garantiaResultadoId,
        origen: { importacionId: decision.fila.importacionId, archivo: decision.fila.importacion.nombreArchivo || null, hoja: decision.fila.hoja, numeroFila: decision.fila.numeroFila },
      },
    }));
    const normalById = new Map(normal.map(event => [event.id, event])), reviewsById = new Map(reviews.map(event => [event.revisionImportacion.id, event]));
    return keys.map(key => {
      const event = key.fuente === "GESTION" ? normalById.get(key.id) : reviewsById.get(key.id);
      if (!event) throw new Error("SUPERVISION_ACTIVITY_INCOMPLETE");
      return event;
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
}
