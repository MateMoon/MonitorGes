import { describe, expect, it } from "vitest";
import { summarizeWorkbookComparison, type WorkbookComparisonInput } from "../src/modules/importaciones/workbook-comparison.js";
import type { MatchRow } from "../src/modules/importaciones/row-matching.js";

const row = (patch: Partial<MatchRow> = {}): MatchRow => ({
  numeroFila: 2, rut: "12.345.678", dv: "5", problemaSalud: "Problema ficticio A", nombreGarantia: "Garantía ficticia A",
  fechaInicio: "2026-10-05", fechaLimite: "2026-11-30", responsable: "Responsable ficticio A", ...patch,
});
const book = (validRows: MatchRow[], rowsRead = validRows.length, invalidRows = 0): WorkbookComparisonInput => ({ validRows, rowsRead, invalidRows });

describe("simulación agregada de comparación de planillas", () => {
  it("resume clasificaciones, ausencias, diferencias relevantes y solapamientos sin exponer filas", () => {
    const reference = book([
      row({ numeroFila: 2 }),
      row({ numeroFila: 3, rut: "11.111.111", dv: "1", fechaInicio: "2026-10-02", nombreGarantia: "Garantía ficticia B", responsable: "Responsable ficticio B" }),
      row({ numeroFila: 4, rut: "22.222.222", dv: "2", fechaInicio: "2026-09-01", nombreGarantia: "Garantía ficticia C" }),
    ], 4, 1);
    const comparison = book([
      row({ numeroFila: 2, fechaLimite: "2027-01-01", responsable: "Responsable ficticio actualizado" }),
      row({ numeroFila: 3, rut: "22.222.222", dv: "2", fechaInicio: "2026-09-10", nombreGarantia: "Garantía ficticia C" }),
      row({ numeroFila: 4, rut: "22.222.222", dv: "2", fechaInicio: "2026-09-11", nombreGarantia: "Garantía ficticia C" }),
      row({ numeroFila: 5, rut: "33.333.333", dv: "3", nombreGarantia: "Garantía ficticia D" }),
      row({ numeroFila: 6, rut: "44.444.444", dv: "4", nombreGarantia: "Garantía ficticia E" }),
      row({ numeroFila: 7, rut: "44.444.444", dv: "4", nombreGarantia: "Garantía ficticia E", fechaInicio: "2026-10-06" }),
    ], 8, 2);

    const summary = summarizeWorkbookComparison(reference, comparison);
    expect(summary.reference).toEqual({ rowsRead: 4, validRows: 3, invalidRows: 1 });
    expect(summary.comparison).toEqual({ rowsRead: 8, validRows: 6, invalidRows: 2 });
    expect(summary.classifications).toEqual({
      COINCIDENCIA_EXACTA_UNICA: 1,
      DUDOSA_FECHA_DISTINTA: 0,
      DUDOSA_VARIOS_CANDIDATOS: 0,
      DUDOSA_REPETIDA_EN_ARCHIVO: 4,
      NUEVA_PROPUESTA: 1,
    });
    expect(summary.firstFileOnlyOccurrences).toBe(2);
    expect(summary.sharedFamilies).toMatchObject({ comparisonRowsWithSharedFamily: 3, differentStartPairs: 2, differentDeadlinePairs: 1, differentResponsiblePairs: 1 });
    expect(summary.ruleHits).toMatchObject({ exactCandidateRows: 1, dateDifferentCandidateRows: 2, repeatedInComparisonFileRows: 4, noCandidateRows: 3 });
    expect(summary.overlaps.repeatedAndDateDifferent).toBe(2);
    expect(JSON.stringify(summary)).not.toContain("12.345.678");
    expect(JSON.stringify(summary)).not.toContain("Responsable ficticio");
  });

  it("cuenta por separado una coincidencia exacta y otros candidatos de la misma familia", () => {
    const reference = book([row(), row({ numeroFila: 3, fechaInicio: "2026-10-06" })]);
    const comparison = book([row()]);
    const summary = summarizeWorkbookComparison(reference, comparison);
    expect(summary.classifications.DUDOSA_VARIOS_CANDIDATOS).toBe(1);
    expect(summary.ruleHits.exactCandidateRows).toBe(1);
    expect(summary.ruleHits.multiplePossibleCandidateRows).toBe(1);
    expect(summary.overlaps.exactAndMultiple).toBe(1);
  });
});
