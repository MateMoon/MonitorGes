import { classifyImportRows, type MatchClassification, type MatchRow } from "./row-matching.js";
import { parseWorkbookForComparison, type PreviewRow } from "./validation-service.js";
import type { ExistingMatchCandidate } from "./candidate-repository.js";

export type CandidateReader = (rows: readonly PreviewRow[]) => Promise<ExistingMatchCandidate[]>;
export type ImportedDifference = "fechaLimite" | "responsableInformado";

export type ComparisonPreview = {
  filasLeidas: number;
  filasValidas: number;
  filasInvalidas: number;
  conteos: Record<MatchClassification, number>;
  filas: Array<{
    numeroFila: number;
    clasificacion: MatchClassification;
    candidatosPosibles: number;
    camposImportadosDiferentes: ImportedDifference[];
  }>;
};

const CLASSIFICATIONS: MatchClassification[] = [
  "COINCIDENCIA_EXACTA_UNICA",
  "DUDOSA_FECHA_DISTINTA",
  "DUDOSA_VARIOS_CANDIDATOS",
  "DUDOSA_REPETIDA_EN_ARCHIVO",
  "NUEVA_PROPUESTA",
];

function asMatchRow(row: PreviewRow): MatchRow {
  return {
    numeroFila: row.numeroFila,
    rut: row.rut,
    dv: row.dv,
    problemaSalud: row.problemaSalud,
    nombreGarantia: row.nombreGarantia,
    fechaInicio: row.fechaInicio,
    fechaLimite: row.fechaLimite,
    responsable: row.responsable,
  };
}

/**
 * Analiza un Excel en memoria y lo compara con candidatos proporcionados por un lector.
 * La dependencia es inyectable para que pruebas usen datos ficticios y ninguna BD.
 * No invoca el servicio de importación ni expone celdas o identificadores sensibles.
 */
export async function previewWorkbookComparison(buffer: Buffer, filename: string, readCandidates: CandidateReader): Promise<ComparisonPreview> {
  const { validation, registrosValidos } = await parseWorkbookForComparison(buffer, filename);
  const candidates = registrosValidos.length ? await readCandidates(registrosValidos) : [];
  const rows = registrosValidos.map(asMatchRow);
  const matches = classifyImportRows(rows, candidates);
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const conteos = Object.fromEntries(CLASSIFICATIONS.map((classification) => [classification, 0])) as Record<MatchClassification, number>;

  const resultRows = matches.map((match, index) => {
    conteos[match.clasificacion] += 1;
    const camposImportadosDiferentes: ImportedDifference[] = [];
    if (match.clasificacion === "COINCIDENCIA_EXACTA_UNICA" && match.candidatoIds.length === 1) {
      const candidate = byId.get(match.candidatoIds[0]);
      const sourceRow = registrosValidos[index];
      if (candidate && candidate.fechaLimite !== sourceRow.fechaLimite) camposImportadosDiferentes.push("fechaLimite");
      if (candidate && candidate.responsable.trim() !== sourceRow.responsable.trim()) {
        camposImportadosDiferentes.push("responsableInformado");
      }
    }
    return {
      numeroFila: match.numeroFila,
      clasificacion: match.clasificacion,
      candidatosPosibles: match.candidatoIds.length,
      camposImportadosDiferentes,
    };
  });

  return {
    filasLeidas: validation.filasLeidas,
    filasValidas: registrosValidos.length,
    filasInvalidas: validation.filasConErrores,
    conteos,
    filas: resultRows,
  };
}
