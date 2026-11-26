import type { Prisma } from "@prisma/client";
import type { PreviewRow } from "../importaciones/validation-service.js";
import { fingerprint, type SourceGuarantee } from "./candidate-evidence.js";

/** The complete allowlist for a supervisor's explicit source-data update.
 * Patient identity/name, management state, revision and history are excluded. */
export function sourceUpdateValues(data: Readonly<PreviewRow>) {
  return {
    problemaSalud: data.problemaSalud, nombreGarantia: data.nombreGarantia,
    fechaInicio: new Date(`${data.fechaInicio}T00:00:00.000Z`),
    fechaLimite: new Date(`${data.fechaLimite}T00:00:00.000Z`), responsable: data.responsable,
  } satisfies Prisma.GarantiaUpdateInput;
}

export function changedSourceFields(source: SourceGuarantee, data: Readonly<PreviewRow>) {
  const values = sourceUpdateValues(data);
  return (Object.keys(values) as (keyof typeof values)[]).filter(key => {
    const before = source[key], after = values[key];
    return before instanceof Date && after instanceof Date ? before.getTime() !== after.getTime() : before !== after;
  });
}

export function validSourceUpdate(before: SourceGuarantee, after: SourceGuarantee, data: Readonly<PreviewRow>) {
  const expected = { ...before, ...sourceUpdateValues(data), version: before.version + 1, updatedAt: after.updatedAt };
  return after.updatedAt >= before.updatedAt && fingerprint(after) === fingerprint(expected);
}

/** Kept in the existing append-only evidence JSON, so historical MISMA records
 * retain their original meaning and no enum/schema migration is required. */
export function isSourceDataUpdate(value: { decision: string; antecedentesRevisados?: Prisma.JsonValue | null }) {
  const evidence = value.antecedentesRevisados;
  return value.decision === "MISMA" && evidence !== null && typeof evidence === "object" && !Array.isArray(evidence)
    && evidence?.accion === "ACTUALIZAR_DATOS";
}
