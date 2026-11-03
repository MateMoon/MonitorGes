import { normalizeIdentityDate, normalizeIdentityRut, normalizeIdentityText } from "./identity-normalization.js";

/** Campos de identidad de una fila ya validada; otras columnas se ignoran. */
export type MatchRow = {
  numeroFila: number;
  rut: string;
  dv: string;
  problemaSalud: string;
  nombreGarantia: string;
  fechaInicio: string;
  fechaLimite?: string;
  responsable?: string;
};

/** Proyección mínima de una garantía existente, independiente de Prisma y de la BD. */
export type MatchCandidate = {
  id: string;
  rut: string;
  dv: string;
  problemaSalud: string;
  nombreGarantia: string;
  fechaInicio: string;
};

export type MatchClassification =
  | "COINCIDENCIA_EXACTA_UNICA"
  | "DUDOSA_FECHA_DISTINTA"
  | "DUDOSA_VARIOS_CANDIDATOS"
  | "DUDOSA_REPETIDA_EN_ARCHIVO"
  | "NUEVA_PROPUESTA";

export type RowMatchResult = {
  numeroFila: number;
  clasificacion: MatchClassification;
  /** Candidatos posibles para revisión; no implica que deban fusionarse. */
  candidatoIds: string[];
  /** Identidad compuesta normalizada, útil para explicar la comparación. */
  claveNormalizada: string;
};

type NormalizedIdentity = {
  patient: string;
  problem: string;
  guarantee: string;
  start: string;
  exactKey: string;
  familyKey: string;
};

function identityOf(row: MatchRow): NormalizedIdentity {
  const rut = normalizeIdentityRut(row.rut, row.dv);
  const patient = `${rut.rutNumero}-${rut.dv}`;
  const problem = normalizeIdentityText(row.problemaSalud);
  const guarantee = normalizeIdentityText(row.nombreGarantia);
  const start = normalizeIdentityDate(row.fechaInicio);
  const familyKey = JSON.stringify([patient, problem, guarantee]);
  return { patient, problem, guarantee, start, familyKey, exactKey: JSON.stringify([patient, problem, guarantee, start]) };
}

/** Identificadores normalizados solo para comparar en memoria; contienen datos sensibles y no deben registrarse. */
export function getMatchIdentityKeys(row: MatchRow): { exactKey: string; familyKey: string; start: string } {
  const identity = identityOf(row);
  return { exactKey: identity.exactKey, familyKey: identity.familyKey, start: identity.start };
}

/**
 * Compara filas válidas con una instantánea de candidatos. Es una función pura:
 * solo clasifica y devuelve IDs; no inserta, cambia, fusiona ni borra garantías.
 * Una coincidencia exacta única es una regla operativa, no prueba la identidad
 * del episodio: sin ID de origen, dos episodios idénticos son indistinguibles.
 * Días restantes, fecha límite y responsable se excluyen intencionalmente.
 */
export function classifyImportRows(rows: readonly MatchRow[], candidates: readonly MatchCandidate[]): RowMatchResult[] {
  const rowIdentities = rows.map(identityOf);
  // Una misma persona/problema/tipo repetida en el archivo es dudosa incluso
  // cuando cambia la fecha de inicio: podría ser otro episodio o una corrección.
  const repeatedFamilies = new Set<string>();
  const rowCounts = new Map<string, number>();
  for (const identity of rowIdentities) rowCounts.set(identity.familyKey, (rowCounts.get(identity.familyKey) ?? 0) + 1);
  for (const [key, count] of rowCounts) if (count > 1) repeatedFamilies.add(key);

  const candidateIdentities = candidates.map((candidate) => ({ candidate, identity: identityOf({ numeroFila: 0, ...candidate }) }));

  return rowIdentities.map((identity, index) => {
    const row = rows[index];
    const possible = candidateIdentities.filter(({ identity: candidateIdentity }) => candidateIdentity.familyKey === identity.familyKey);
    const exact = possible.filter(({ identity: candidateIdentity }) => candidateIdentity.start === identity.start);
    let clasificacion: MatchClassification;
    if (repeatedFamilies.has(identity.familyKey)) clasificacion = "DUDOSA_REPETIDA_EN_ARCHIVO";
    else if (possible.length > 1) clasificacion = "DUDOSA_VARIOS_CANDIDATOS";
    else if (exact.length === 1) clasificacion = "COINCIDENCIA_EXACTA_UNICA";
    else if (possible.length === 1) clasificacion = "DUDOSA_FECHA_DISTINTA";
    else clasificacion = "NUEVA_PROPUESTA";

    return {
      numeroFila: row.numeroFila,
      clasificacion,
      candidatoIds: possible.map(({ candidate }) => candidate.id),
      claveNormalizada: identity.exactKey,
    };
  });
}
