import { normalizeIdentityText } from "./identity-normalization.js";
import { classifyImportRows, getMatchIdentityKeys, type MatchCandidate, type MatchClassification, type MatchRow } from "./row-matching.js";

export type WorkbookComparisonInput = {
  validRows: readonly MatchRow[];
  rowsRead: number;
  invalidRows: number;
};

export type WorkbookComparisonSummary = {
  reference: { rowsRead: number; validRows: number; invalidRows: number };
  comparison: { rowsRead: number; validRows: number; invalidRows: number };
  classifications: Record<MatchClassification, number>;
  firstFileOnlyOccurrences: number;
  sharedFamilies: {
    comparisonRowsWithSharedFamily: number;
    distinctFamilies: number;
    rowPairs: number;
    differentStartPairs: number;
    differentDeadlinePairs: number;
    differentResponsiblePairs: number;
  };
  ruleHits: {
    exactCandidateRows: number;
    dateDifferentCandidateRows: number;
    multiplePossibleCandidateRows: number;
    repeatedInComparisonFileRows: number;
    noCandidateRows: number;
  };
  overlaps: {
    repeatedAndExact: number;
    repeatedAndDateDifferent: number;
    repeatedAndMultiple: number;
    exactAndMultiple: number;
    dateDifferentAndMultiple: number;
  };
};

const CLASSIFICATIONS: MatchClassification[] = [
  "COINCIDENCIA_EXACTA_UNICA",
  "DUDOSA_FECHA_DISTINTA",
  "DUDOSA_VARIOS_CANDIDATOS",
  "DUDOSA_REPETIDA_EN_ARCHIVO",
  "NUEVA_PROPUESTA",
];

function multisetDifferenceCount(first: readonly MatchRow[], second: readonly MatchRow[]): number {
  const secondCounts = new Map<string, number>();
  for (const row of second) {
    const key = getMatchIdentityKeys(row).exactKey;
    secondCounts.set(key, (secondCounts.get(key) ?? 0) + 1);
  }
  let missing = 0;
  for (const row of first) {
    const key = getMatchIdentityKeys(row).exactKey;
    const remaining = secondCounts.get(key) ?? 0;
    if (remaining > 0) secondCounts.set(key, remaining - 1);
    else missing += 1;
  }
  return missing;
}

function comparisonFamilyCounts(rows: readonly MatchRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const family = getMatchIdentityKeys(row).familyKey;
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  return counts;
}

/**
 * Simula segunda planilla contra la primera como catálogo inicial. Solo devuelve
 * métricas agregadas; no conserva filas/candidatos ni ejecuta operaciones de escritura.
 */
export function summarizeWorkbookComparison(reference: WorkbookComparisonInput, comparison: WorkbookComparisonInput): WorkbookComparisonSummary {
  const candidates: MatchCandidate[] = reference.validRows.map((row, index) => ({
    id: `REF-${String(index + 1).padStart(6, "0")}`,
    rut: row.rut,
    dv: row.dv,
    problemaSalud: row.problemaSalud,
    nombreGarantia: row.nombreGarantia,
    fechaInicio: row.fechaInicio,
  }));
  const matches = classifyImportRows(comparison.validRows, candidates);
  const classifications = Object.fromEntries(CLASSIFICATIONS.map((status) => [status, 0])) as Record<MatchClassification, number>;
  for (const result of matches) classifications[result.clasificacion] += 1;

  const candidateKeys = candidates.map((candidate) => ({ candidate, ...getMatchIdentityKeys({ numeroFila: 0, ...candidate }) }));
  const rowKeys = comparison.validRows.map((row) => getMatchIdentityKeys(row));
  const familyCounts = comparisonFamilyCounts(comparison.validRows);
  const ruleHits = { exactCandidateRows: 0, dateDifferentCandidateRows: 0, multiplePossibleCandidateRows: 0, repeatedInComparisonFileRows: 0, noCandidateRows: 0 };
  const overlaps = { repeatedAndExact: 0, repeatedAndDateDifferent: 0, repeatedAndMultiple: 0, exactAndMultiple: 0, dateDifferentAndMultiple: 0 };

  rowKeys.forEach((key) => {
    const familyCandidates = candidateKeys.filter((candidate) => candidate.familyKey === key.familyKey);
    const exactCandidates = familyCandidates.filter((candidate) => candidate.start === key.start);
    const exact = exactCandidates.length > 0;
    const dateDifferent = familyCandidates.some((candidate) => candidate.start !== key.start);
    const multiple = familyCandidates.length > 1;
    const repeated = (familyCounts.get(key.familyKey) ?? 0) > 1;
    if (exact) ruleHits.exactCandidateRows += 1;
    if (dateDifferent) ruleHits.dateDifferentCandidateRows += 1;
    if (multiple) ruleHits.multiplePossibleCandidateRows += 1;
    if (repeated) ruleHits.repeatedInComparisonFileRows += 1;
    if (familyCandidates.length === 0) ruleHits.noCandidateRows += 1;
    if (repeated && exact) overlaps.repeatedAndExact += 1;
    if (repeated && dateDifferent) overlaps.repeatedAndDateDifferent += 1;
    if (repeated && multiple) overlaps.repeatedAndMultiple += 1;
    if (exact && multiple) overlaps.exactAndMultiple += 1;
    if (dateDifferent && multiple) overlaps.dateDifferentAndMultiple += 1;
  });

  const referenceFamilies = new Map<string, MatchRow[]>();
  for (const row of reference.validRows) {
    const family = getMatchIdentityKeys(row).familyKey;
    const group = referenceFamilies.get(family) ?? [];
    group.push(row);
    referenceFamilies.set(family, group);
  }
  let comparisonRowsWithSharedFamily = 0;
  let distinctFamilies = 0;
  let rowPairs = 0;
  let differentStartPairs = 0;
  let differentDeadlinePairs = 0;
  let differentResponsiblePairs = 0;
  const seenFamilies = new Set<string>();
  for (const row of comparison.validRows) {
    const identity = getMatchIdentityKeys(row);
    const related = referenceFamilies.get(identity.familyKey) ?? [];
    if (related.length === 0) continue;
    comparisonRowsWithSharedFamily += 1;
    seenFamilies.add(identity.familyKey);
    for (const earlier of related) {
      rowPairs += 1;
      if (getMatchIdentityKeys(earlier).start !== identity.start) differentStartPairs += 1;
      if (earlier.fechaLimite !== row.fechaLimite) differentDeadlinePairs += 1;
      if (normalizeIdentityText(earlier.responsable ?? "") !== normalizeIdentityText(row.responsable ?? "")) differentResponsiblePairs += 1;
    }
  }
  distinctFamilies = seenFamilies.size;

  return {
    reference: { rowsRead: reference.rowsRead, validRows: reference.validRows.length, invalidRows: reference.invalidRows },
    comparison: { rowsRead: comparison.rowsRead, validRows: comparison.validRows.length, invalidRows: comparison.invalidRows },
    classifications,
    firstFileOnlyOccurrences: multisetDifferenceCount(reference.validRows, comparison.validRows),
    sharedFamilies: { comparisonRowsWithSharedFamily, distinctFamilies, rowPairs, differentStartPairs, differentDeadlinePairs, differentResponsiblePairs },
    ruleHits,
    overlaps,
  };
}
