import { createHash } from "node:crypto";
import { normalizeIdentityDate, normalizeIdentityRut } from "./identity-normalization.js";
import { getMatchIdentityKeys, type MatchCandidate } from "./row-matching.js";
import { parseWorkbookForImport, type PreviewRow, type ValidationError } from "./validation-service.js";

export const RETENTION_POLICY_VERSION = "import-retention-v1" as const;

/** Only the existing workbook validator supplies these rows. This policy does not
 * replace its RUT/DV, required-field, date, header or numeric validation rules.
 * Supply the COMPLETE valid-row set and a complete related-candidate snapshot.
 */
export interface RetentionInput {
  readonly registrosValidos: readonly Readonly<PreviewRow>[];
  readonly validation: { readonly errores: readonly Readonly<ValidationError>[] };
}

export type RetentionReason =
  | "COINCIDENCIA_EXACTA_UNICA"
  | "NUEVA_GARANTIA"
  | "FECHA_INICIO_DISTINTA"
  | "MULTIPLES_COINCIDENCIAS_EXACTAS"
  | "FILAS_CONTRADICTORIAS"
  | "NOMBRE_PACIENTE_CONTRADICTORIO"
  | "FECHAS_DISTINTAS_EN_ARCHIVO"
  | "REPETICION_EQUIVALENTE";

interface ValidRowDecision {
  numeroFila: number;
  /** Opaque grouping handles, not keys authorizing a future write. No raw RUTs. */
  huellaFila: string;
  grupoFamiliaId: string;
  motivos: RetentionReason[];
  candidatoIds: string[];
  coincidenciaExactaIds: string[];
  filasEquivalentes: number[];
}

export type RetentionDecision =
  | (ValidRowDecision & { clasificacion: "PROCESAR_NORMAL"; garantiaId: string | null })
  | (ValidRowDecision & { clasificacion: "PENDIENTE_REVISION" })
  | (ValidRowDecision & { clasificacion: "OMITIR_REPETIDA"; numeroFilaRepresentante: number; clasificacionRepresentante: "PROCESAR_NORMAL" | "PENDIENTE_REVISION" })
  | { numeroFila: number; clasificacion: "ERROR_VALIDACION"; errores: ValidationError[] };

export interface RetentionPlan {
  version: typeof RETENTION_POLICY_VERSION;
  filas: RetentionDecision[];
  conteos: { normales: number; pendientes: number; repetidas: number; errores: number };
}

/** A failed/inconsistent snapshot must never be treated as an empty catalog. */
export class RetentionInputError extends Error {
  constructor(public readonly code: "INVALID_POLICY_INPUT" | "INVALID_CANDIDATE_SNAPSHOT") {
    super(code === "INVALID_POLICY_INPUT" ? "La política requiere filas únicas ya validadas y sus errores originales." : "La instantánea de candidatos es inválida o contradictoria.");
    this.name = "RetentionInputError";
  }
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function addTo<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const group = map.get(key);
  if (group) group.push(value); else map.set(key, [value]);
}

/** Pure planning, with no repository, Prisma, clock, logging or mutations.
 * Import-service.ts deliberately does not call this function in stage 1.
 * A future writer must lock/re-read its candidates and re-evaluate before writes;
 * neither candidate IDs nor hashes from a preview authorize a write.
 */
export function evaluateRetentionPolicy(input: RetentionInput, candidates: readonly Readonly<MatchCandidate>[]): RetentionPlan {
  const errorRows = new Map<number, ValidationError[]>();
  for (const error of input.validation.errores) {
    if (!Number.isSafeInteger(error.numeroFila) || error.numeroFila < 1) throw new RetentionInputError("INVALID_POLICY_INPUT");
    addTo(errorRows, error.numeroFila, { ...error });
  }
  const seenRows = new Set<number>();
  const rows = input.registrosValidos.map(row => {
    if (!Number.isSafeInteger(row.numeroFila) || row.numeroFila < 1 || seenRows.has(row.numeroFila) || errorRows.has(row.numeroFila)) throw new RetentionInputError("INVALID_POLICY_INPUT");
    seenRows.add(row.numeroFila);
    try {
      const identity = getMatchIdentityKeys(row);
      const patient = normalizeIdentityRut(row.rut, row.dv);
      const patientKey = JSON.stringify([patient.rutNumero, patient.dv]);
      const limit = normalizeIdentityDate(row.fechaLimite);
      // Identity labels use the shared normalization. Names/responsible use trim
      // only: the importer writes their literal values, so case changes can matter.
      const payload = JSON.stringify([identity.exactKey, limit, row.nombre.trim(), row.responsable.trim()]);
      const representation = JSON.stringify([row.problemaSalud.trim(), row.nombreGarantia.trim(), row.nombre.trim(), row.responsable.trim()]);
      return { row, ...identity, patientKey, payload, representation };
    } catch { throw new RetentionInputError("INVALID_POLICY_INPUT"); }
  });

  type Candidate = { id: string; exactKey: string; familyKey: string };
  const byId = new Map<string, Candidate>();
  for (const candidate of candidates) {
    let normalized: Candidate;
    try {
      if (!candidate.id) throw new Error();
      const { exactKey, familyKey } = getMatchIdentityKeys({ numeroFila: 0, ...candidate });
      normalized = { id: candidate.id, exactKey, familyKey };
    } catch { throw new RetentionInputError("INVALID_CANDIDATE_SNAPSHOT"); }
    const previous = byId.get(normalized.id);
    if (previous && previous.exactKey !== normalized.exactKey) throw new RetentionInputError("INVALID_CANDIDATE_SNAPSHOT");
    byId.set(normalized.id, normalized);
  }
  const candidateFamilies = new Map<string, Candidate[]>();
  for (const candidate of [...byId.values()].sort((a, b) => compare(a.id, b.id))) addTo(candidateFamilies, candidate.familyKey, candidate);

  // Complete-file passes precede every decision: no first/last-row winner.
  const families = new Map<string, typeof rows>();
  const patientNames = new Map<string, Set<string>>();
  for (const row of rows) {
    addTo(families, row.familyKey, row);
    const names = patientNames.get(row.patientKey) ?? new Set<string>();
    names.add(row.row.nombre.trim()); patientNames.set(row.patientKey, names);
  }
  const decisions: RetentionDecision[] = [...errorRows].map(([numeroFila, errores]) => ({ numeroFila, clasificacion: "ERROR_VALIDACION", errores }));
  for (const [familyKey, family] of families) {
    const possible = candidateFamilies.get(familyKey) ?? [];
    const exactCandidates = new Map<string, string[]>();
    for (const candidate of possible) addTo(exactCandidates, candidate.exactKey, candidate.id);
    const variants = new Map<string, Set<string>>();
    for (const row of family) {
      const payloads = variants.get(row.exactKey) ?? new Set<string>();
      payloads.add(row.payload); variants.set(row.exactKey, payloads);
    }
    const conflicting = [...variants.values()].some(payloads => payloads.size > 1);
    const nameConflict = patientNames.get(family[0].patientKey)!.size > 1;
    // Several established episodes are legitimate when EACH incoming identity
    // has exactly one stored match. New/unmatched dates require whole-family review.
    const datesConflict = new Set(family.map(row => row.start)).size > 1
      && family.some(row => (exactCandidates.get(row.exactKey)?.length ?? 0) !== 1);
    const equivalent = new Map<string, typeof rows>();
    for (const row of family) addTo(equivalent, row.payload, row);
    for (const sameRows of equivalent.values()) {
      const ordered = [...sameRows].sort((a, b) => compare(a.representation, b.representation) || a.row.numeroFila - b.row.numeroFila);
      const representative = ordered[0], exactIds = exactCandidates.get(representative.exactKey) ?? [];
      const motivos: RetentionReason[] = [];
      if (conflicting) motivos.push("FILAS_CONTRADICTORIAS");
      if (nameConflict) motivos.push("NOMBRE_PACIENTE_CONTRADICTORIO");
      if (datesConflict) motivos.push("FECHAS_DISTINTAS_EN_ARCHIVO");
      if (exactIds.length > 1) motivos.push("MULTIPLES_COINCIDENCIAS_EXACTAS");
      else if (!exactIds.length && possible.length) motivos.push("FECHA_INICIO_DISTINTA");
      const clasificacion = motivos.length ? "PENDIENTE_REVISION" as const : "PROCESAR_NORMAL" as const;
      if (!motivos.length) motivos.push(exactIds.length === 1 ? "COINCIDENCIA_EXACTA_UNICA" : "NUEVA_GARANTIA");
      const base: ValidRowDecision = {
        numeroFila: representative.row.numeroFila, huellaFila: hash(representative.payload), grupoFamiliaId: hash(familyKey), motivos,
        candidatoIds: possible.map(c => c.id), coincidenciaExactaIds: [...exactIds], filasEquivalentes: sameRows.map(r => r.row.numeroFila).sort((a, b) => a - b),
      };
      decisions.push(clasificacion === "PROCESAR_NORMAL" ? { ...base, clasificacion, garantiaId: exactIds[0] ?? null } : { ...base, clasificacion });
      for (const repeated of ordered.slice(1)) decisions.push({
        ...base, numeroFila: repeated.row.numeroFila, motivos: [...motivos, "REPETICION_EQUIVALENTE"], candidatoIds: [...base.candidatoIds], coincidenciaExactaIds: [...exactIds], filasEquivalentes: [...base.filasEquivalentes],
        clasificacion: "OMITIR_REPETIDA", numeroFilaRepresentante: representative.row.numeroFila, clasificacionRepresentante: clasificacion,
      });
    }
  }
  decisions.sort((a, b) => a.numeroFila - b.numeroFila);
  const conteos = { normales: 0, pendientes: 0, repetidas: 0, errores: 0 };
  for (const row of decisions) {
    if (row.clasificacion === "PROCESAR_NORMAL") conteos.normales++;
    else if (row.clasificacion === "PENDIENTE_REVISION") conteos.pendientes++;
    else if (row.clasificacion === "OMITIR_REPETIDA") conteos.repetidas++;
    else conteos.errores++;
  }
  return { version: RETENTION_POLICY_VERSION, filas: decisions, conteos };
}

export type RetentionCandidateReader = (rows: readonly Readonly<PreviewRow>[]) => Promise<readonly Readonly<MatchCandidate>[]>;

/** Standalone adapter for future callers and real-parser tests. The reader is
 * required/injected; importing or running this module never opens a DB connection.
 * Reader failure propagates instead of falsely proposing new guarantees.
 */
export async function planWorkbookRetention(buffer: Buffer, filename: string, readCandidates: RetentionCandidateReader): Promise<RetentionPlan> {
  const parsed = await parseWorkbookForImport(buffer, filename);
  const candidates = parsed.registrosValidos.length ? await readCandidates(parsed.registrosValidos) : [];
  return evaluateRetentionPolicy(parsed, candidates);
}
