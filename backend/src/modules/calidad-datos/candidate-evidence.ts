import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { dateToCivil } from "../../utils/dates.js";
import { normalizeIdentityRut } from "../importaciones/identity-normalization.js";
import { getMatchIdentityKeys } from "../importaciones/row-matching.js";
import type { PreviewRow } from "../importaciones/validation-service.js";

export const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const sourceSelect = {
  id: true, pacienteId: true, problemaSalud: true, nombreGarantia: true, fechaInicio: true, fechaLimite: true,
  responsable: true, estadoGestion: true, version: true, revisionGestion: true,
  createdAt: true, updatedAt: true, gestionadaAt: true, gestionadaPorUsuarioId: true,
  _count: { select: { eventos: true } },
  paciente: { select: { id: true, rutNumero: true, dv: true, nombre: true, updatedAt: true } },
} satisfies Prisma.GarantiaSelect;
export type SourceGuarantee = Prisma.GarantiaGetPayload<{ select: typeof sourceSelect }>;
export const matchOf = (source: SourceGuarantee) => ({ id: source.id, rut: source.paciente.rutNumero, dv: source.paciente.dv, problemaSalud: source.problemaSalud, nombreGarantia: source.nombreGarantia, fechaInicio: dateToCivil(source.fechaInicio) });
export const snapshotOf = (source: SourceGuarantee, receivedName: string) => ({
  problemaSalud: source.problemaSalud, nombreGarantia: source.nombreGarantia,
  fechaInicio: dateToCivil(source.fechaInicio), fechaLimite: dateToCivil(source.fechaLimite), responsable: source.responsable,
  estadoGestion: source.estadoGestion, ...(source.paciente.nombre !== receivedName ? { nombreEnAplicacion: source.paciente.nombre } : {}),
});
export const fingerprint = (source: SourceGuarantee) => hash(source);
export const candidateSetHash = (sources: readonly SourceGuarantee[]) => hash([...sources].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(s => ({ id: s.id, huella: fingerprint(s) })));

/** Patient FOR UPDATE blocks FK inserts into its guarantees as well as patient
 * edits. Lock ALL its current guarantees before filtering families, so another
 * source cannot move into the family during a resolution. FOR UPDATE also
 * blocks FK inserts of events while the reviewed history count is checked.
 * No source is written by these reads.
 * Missing patients are serialized by the advisory protocol shared with both
 * importer modes and the operational resolution writer.
 */
export async function readPatientSources(tx: Prisma.TransactionClient, row: PreviewRow, lock = false) {
  const identity = normalizeIdentityRut(row.rut, row.dv);
  if (lock) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(identity)}, 0))::text`;
    await tx.$queryRaw`SELECT "id" FROM "Paciente" WHERE "rutNumero" = ${identity.rutNumero} AND "dv" = ${identity.dv} FOR UPDATE`;
  }
  const patient = await tx.paciente.findUnique({ where: { rutNumero_dv: identity }, select: { id: true } });
  if (!patient) return [];
  if (lock) await tx.$queryRaw`SELECT "id" FROM "Garantia" WHERE "pacienteId" = ${patient.id}::uuid ORDER BY "id" FOR UPDATE`;
  const sources = await tx.garantia.findMany({ where: { pacienteId: patient.id }, select: sourceSelect, orderBy: { id: "asc" } });
  return sources;
}

export async function readFamily(tx: Prisma.TransactionClient, row: PreviewRow, lock = false) {
  const sources = await readPatientSources(tx, row, lock);
  const family = getMatchIdentityKeys(row).familyKey;
  return sources.filter(source => getMatchIdentityKeys({ numeroFila: 0, ...matchOf(source) }).familyKey === family);
}
