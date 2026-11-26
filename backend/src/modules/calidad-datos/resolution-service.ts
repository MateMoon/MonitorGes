import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { SUPERVISION_ROLES } from "../auth/permissions.js";
import { normalizeIdentityText } from "../importaciones/identity-normalization.js";
import { createImportRowPersistence } from "./persistence-service.js";
import { operationalResolutionEffects } from "./resolution-writer.js";
import { parseInput, resolutionSchema, RowPersistenceError, type DecisionsPageInput, type PendingPageInput, type PersistenceActor } from "./contracts.js";
import { revalidateRetainedRow } from "./retained-row-validation.js";
import { isSourceDataUpdate } from "./source-update.js";

const { filaId: _filaId, ...bodyFields } = resolutionSchema.shape;
export const resolveBodySchema = z.object({ ...bodyFields,
  huellaRevision: z.string().regex(/^[a-f0-9]{64}$/),
  confirmaDistintaDeTodas: z.literal(true).optional(),
}).strict().refine(input => input.decision === "DISTINTA" ? input.confirmaDistintaDeTodas === true && input.actualizarDatos === undefined && input.garantiaExistenteId === undefined : input.confirmaDistintaDeTodas === undefined && !!input.garantiaExistenteId);
export type ResolveBody = z.infer<typeof resolveBodySchema>;
function authorize(actor: PersistenceActor) {
  if (!SUPERVISION_ROLES.some(role => role === actor.rol)) throw new RowPersistenceError("FORBIDDEN", "No tienes permiso para revisar importaciones.", 403);
}
const decisionView = (value: { id: string; filaId: string; decision: string; usuarioId: string; autorNombre: string; justificacion: string; garantiaResultadoId: string; createdAt: Date; antecedentesRevisados?: Prisma.JsonValue | null }) => ({
  id: value.id, filaId: value.filaId, decision: value.decision, usuario: { id: value.usuarioId, nombre: value.autorNombre },
  justificacion: value.justificacion, garantiaResultadoId: value.garantiaResultadoId, createdAt: value.createdAt,
  ...(isSourceDataUpdate(value) ? { actualizarDatos: true as const } : {}),
});

export function createQualityResolutionService(db: PrismaClient) {
  const persistence = createImportRowPersistence(db);
  return {
    async listPending(actor: PersistenceActor, query: PendingPageInput = {}) {
      authorize(actor);
      const result = await persistence.listPendingRows(actor, query);
      return { data: result.filas.map(({ _count, ...row }) => ({ ...row, candidatas: _count.candidatos })), pendientesTotales: result.pendientesTotales, pagination: result.pagination };
    },
    async getPending(actor: PersistenceActor, id: string) {
      authorize(actor);
      const row = await persistence.getRow(actor, id);
      const data = await revalidateRetainedRow(row.datosValidados, row.huellaDatos, row.versionPolitica);
      const candidatas = row.candidatosActuales.map(candidate => {
        const fields = [
          ["problemaSalud", candidate.datos.problemaSalud, data.problemaSalud, true],
          ["nombreGarantia", candidate.datos.nombreGarantia, data.nombreGarantia, true],
          ["nombre", candidate.datos.nombreEnAplicacion ?? data.nombre, data.nombre, false],
          ["fechaInicio", candidate.datos.fechaInicio, data.fechaInicio, false],
          ["fechaLimite", candidate.datos.fechaLimite, data.fechaLimite, false],
          ["responsable", candidate.datos.responsable, data.responsable, false],
        ] as const;
        const comparacion = fields.map(([campo, existente, nomina, normalized]) => ({ campo, existente, nomina,
          coincide: normalized ? normalizeIdentityText(existente) === normalizeIdentityText(nomina) : existente === nomina,
        }));
        return { id: candidate.id, datos: candidate.datos, estadoGestion: candidate.datos.estadoGestion, actuacionesDisponibles: candidate.actuacionesDisponibles,
          comparacion, diferencias: comparacion.filter(field => !field.coincide).map(field => field.campo),
        };
      });
      return { id: row.id, importacionId: row.importacionId, hoja: row.hoja, numeroFila: row.numeroFila, estado: row.estado, version: row.version,
        datosNomina: data, motivos: row.motivos, candidatas, huellaRevision: row.huellaRevision,
        antecedentesCambiaron: !row.antecedentesVigentes, puedeResolver: row.estado === "PENDIENTE", puedeActualizarDatos: true,
        significadoDistinta: "Es una garantía distinta de todas las candidatas relevantes mostradas.",
        resolucion: row.resolucion ? decisionView(row.resolucion) : null,
      };
    },
    async resolve(actor: PersistenceActor, id: string, body: ResolveBody) {
      authorize(actor);
      const input = parseInput(resolveBodySchema, body);
      const { confirmaDistintaDeTodas: _confirmation, ...command } = input;
      const parsed = parseInput(resolutionSchema, { ...command, filaId: id });
      const result = await persistence.registerResolution(actor, parsed, operationalResolutionEffects);
      return { resolucion: decisionView(result.resolucion), repetida: result.repetida };
    },
    async listDecisions(actor: PersistenceActor, query: DecisionsPageInput = {}) {
      authorize(actor);
      const result = await persistence.listResolutions(actor, query);
      return { data: result.resoluciones.map(value => ({ ...decisionView(value), origen: value.fila })), pagination: result.pagination };
    },
  };
}
