import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { previewWorkbookComparison } from "../src/modules/importaciones/comparison-preview-service.js";
import type { ExistingMatchCandidate } from "../src/modules/importaciones/candidate-repository.js";
import { MAX_COMPARISON_ROWS, parseWorkbookForComparison } from "../src/modules/importaciones/validation-service.js";

const headers = ["Problema de salud", "RUT", "DV", "Nombre", "Fecha de Inicio", "Fecha Límite", "Días que faltan para el Vencimiento de la Garantía", "Nombre de la garantía", "Responsable de la garantía"];
const excelRow = (rut: string, problem: string, guarantee: string, start: string, limit: string, responsible: string) => [problem, rut, "5", "Paciente Ficticio", start, limit, 5, guarantee, responsible];

async function workbook(rows: Array<Array<string | number>>) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Prueba ficticia");
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
}

const existing = (patch: Partial<ExistingMatchCandidate> = {}): ExistingMatchCandidate => ({
  id: "fake-case-1", rut: "12345678", dv: "5", problemaSalud: "Problema ficticio A", nombreGarantia: "Garantía ficticia A",
  fechaInicio: "2026-10-05", fechaLimite: "2026-11-30", responsable: "Responsable ficticio A", ...patch,
});

describe("vista previa de comparación de importación", () => {
  it("acepta el límite configurado de filas en la comparación", async () => {
    const row = excelRow("12345678", "Problema ficticio", "Garantía ficticia", "2026-10-05", "2026-12-31", "Responsable ficticio");
    const result = await parseWorkbookForComparison(await workbook(Array.from({ length: MAX_COMPARISON_ROWS }, () => row)), "limite.xlsx");
    expect(result.validation.filasLeidas).toBe(MAX_COMPARISON_ROWS);
    expect(result.registrosValidos).toHaveLength(MAX_COMPARISON_ROWS);
  }, 30_000);

  it("rechaza el exceso antes de consultar el repositorio de candidatos", async () => {
    const row = excelRow("12345678", "Problema ficticio", "Garantía ficticia", "2026-10-05", "2026-12-31", "Responsable ficticio");
    const readCandidates = vi.fn(async () => []);
    await expect(previewWorkbookComparison(
      await workbook(Array.from({ length: MAX_COMPARISON_ROWS + 1 }, () => row)),
      "exceso.xlsx",
      readCandidates,
    )).rejects.toMatchObject({ code: "TOO_MANY_ROWS", statusCode: 413, message: expect.stringContaining("5.000") });
    expect(readCandidates).not.toHaveBeenCalled();
  }, 30_000);

  it("resume identidades y diferencias de datos fuente sin incluir datos personales", async () => {
    const rows = [
      excelRow("12345678", "Problema ficticio A", "Garantía ficticia A", "2026-10-05", "2026-12-31", "Responsable ficticio B"),
      excelRow("12345678", "Problema ficticio B", "Garantía ficticia B", "2026-10-10", "2026-12-31", "Responsable ficticio A"),
      excelRow("12345678", "Problema ficticio C", "Garantía ficticia C", "2026-10-15", "2026-12-31", "Responsable ficticio A"),
      excelRow("12345678", "Problema ficticio D", "Garantía ficticia D", "2026-10-20", "2026-12-31", "Responsable ficticio A"),
      excelRow("12345678", "Problema ficticio D", "Garantía ficticia D", "2026-10-21", "2026-12-31", "Responsable ficticio A"),
      excelRow("12345678", "Problema ficticio E", "Garantía ficticia E", "2026-10-25", "2026-12-31", "Responsable ficticio A"),
      ["Problema ficticio", "12345678", "5", "Paciente Ficticio", "fecha inválida", "2026-12-31", 5, "Garantía inválida", "Responsable ficticio A"],
    ];
    const candidates = [
      existing(),
      existing({ id: "fake-case-2", problemaSalud: "Problema ficticio B", nombreGarantia: "Garantía ficticia B", fechaInicio: "2026-10-09" }),
      existing({ id: "fake-case-3", problemaSalud: "Problema ficticio C", nombreGarantia: "Garantía ficticia C", fechaInicio: "2026-10-15" }),
      existing({ id: "fake-case-4", problemaSalud: "Problema ficticio C", nombreGarantia: "Garantía ficticia C", fechaInicio: "2026-10-15" }),
    ];
    const readCandidates = vi.fn(async () => candidates);

    const result = await previewWorkbookComparison(await workbook(rows), "nómina-ficticia.xlsx", readCandidates);

    expect(readCandidates).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ filasLeidas: 7, filasValidas: 6, filasInvalidas: 1 });
    expect(result.conteos).toEqual({
      COINCIDENCIA_EXACTA_UNICA: 1,
      DUDOSA_FECHA_DISTINTA: 1,
      DUDOSA_VARIOS_CANDIDATOS: 1,
      DUDOSA_REPETIDA_EN_ARCHIVO: 2,
      NUEVA_PROPUESTA: 1,
    });
    expect(result.filas[0].camposImportadosDiferentes).toEqual(["fechaLimite", "responsableInformado"]);
    expect(result.filas[1].camposImportadosDiferentes).toEqual([]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("12345678");
    expect(serialized).not.toContain("Paciente Ficticio");
    expect(serialized).not.toContain("Responsable ficticio");
  });

  it("maneja una planilla sin filas válidas sin consultar candidatos", async () => {
    const readCandidates = vi.fn(async () => []);
    const result = await previewWorkbookComparison(
      await workbook([["", "", "", "", "bad-date", "bad-date", "bad", "", ""]]),
      "inválida.xlsx",
      readCandidates,
    );
    expect(result.filasValidas).toBe(0);
    expect(result.filasInvalidas).toBe(1);
    expect(readCandidates).not.toHaveBeenCalled();
    expect(result.filas).toEqual([]);
  });
});
