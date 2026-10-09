import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { MAX_FILE_SIZE, validateWorkbook, WorkbookInputError } from "../src/modules/importaciones/validation-service.js";

const headers = [
  "Días que faltan para el Vencimiento de la Garantía", "Fecha Límite", "DV", "Nombre de la garantía",
  "RUT", "Responsable de la garantía", "Fecha de Inicio", "Nombre", "Problema de salud",
];

async function makeWorkbook(
  rows: Array<Array<string | number | Date | null>> = [],
  options: { headerRow?: number; headers?: string[] } = {},
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Reporte");
  const headerRowNumber = options.headerRow ?? 1;
  const selectedHeaders = options.headers ?? headers;
  if (headerRowNumber > 1) {
    sheet.getCell(2, 1).value = "(New) Nómina de Garantías Vigentes";
    for (let rowNumber = 3; rowNumber <= 8; rowNumber += 1) sheet.getCell(rowNumber, 1).value = `Parámetro de prueba ${rowNumber - 2}`;
  }
  selectedHeaders.forEach((header, column) => { sheet.getCell(headerRowNumber, column + 1).value = header; });
  rows.forEach((values, rowIndex) => {
    values.forEach((value, column) => { sheet.getCell(headerRowNumber + rowIndex + 1, column + 1).value = value; });
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function excelSerial(civilDate: string): number {
  const [year, month, day] = civilDate.split("-").map(Number);
  return (Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000;
}
const validRow: Array<string | number | Date | null> = [0, "31/12/2026", "5", "Garantía ficticia", "12.345.678", "Centro ficticio", new Date("2026-10-01T00:00:00.000Z"), "Paciente Prueba", "Problema ficticio"];

describe("validación de libros XLSX", () => {
  it("lee un XLSX válido aunque las columnas estén en otro orden y normaliza encabezados", async () => {
    const buffer = await makeWorkbook([validRow]);
    const result = await validateWorkbook(buffer, "Nomina.xlsx");
    expect(result).toMatchObject({ nombreArchivo: "Nomina.xlsx", filasLeidas: 1, filasValidas: 1, filasConErrores: 0 });
    expect(result.vistaPrevia[0]).toMatchObject({ rut: "12.345.678", dv: "5", fechaInicio: "2026-10-01", fechaLimite: "2026-12-31" });
    expect(result.errores).toEqual([]);
  });

  it("detecta encabezados en la fila 11 tras el título y parámetros, con columnas reordenadas, tildes y puntuación", async () => {
    const variedHeaders = [...headers].reverse().map((header) => `  ${header.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")} !!! `);
    const reorderedRow = [...validRow].reverse();
    reorderedRow[7] = excelSerial("2026-12-31");
    reorderedRow[2] = excelSerial("2026-10-01");
    const result = await validateWorkbook(await makeWorkbook([reorderedRow], { headerRow: 11, headers: variedHeaders }), "Reporte.xlsx");
    expect(result).toMatchObject({ filasLeidas: 1, filasValidas: 1, filasConErrores: 0 });
    expect(result.vistaPrevia[0]).toMatchObject({ numeroFila: 12, fechaInicio: "2026-10-01", fechaLimite: "2026-12-31" });
    expect(result.errores).toEqual([]);
  });
  it("rechaza un archivo de cero bytes", async () => {
    await expect(validateWorkbook(Buffer.alloc(0), "vacio.xlsx")).rejects.toMatchObject({ code: "EMPTY_FILE" });
  });

  it("rechaza un XLSX corrupto", async () => {
    await expect(validateWorkbook(Buffer.from("PK\u0003\u0004contenido roto"), "roto.xlsx")).rejects.toBeInstanceOf(WorkbookInputError);
  });

  it("rechaza columnas obligatorias ausentes", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Nómina").addRow(["RUT", "Nombre"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await expect(validateWorkbook(buffer, "incompleto.xlsx")).rejects.toMatchObject({ code: "MISSING_COLUMNS", message: expect.stringContaining("filas 1–1") });
  });

  it("valida RUT chileno y acepta DV K", async () => {
    const kRow = [0, 46000, "K", "Garantía ficticia", "6", "Centro ficticio", 45900, "Paciente Prueba", "Problema ficticio"];
    const result = await validateWorkbook(await makeWorkbook([kRow]), "rut-k.xlsx");
    expect(result.filasValidas).toBe(1);
  });

  it("informa DV incorrecto con el campo afectado", async () => {
    const invalid = [...validRow];
    invalid[2] = "9";
    const result = await validateWorkbook(await makeWorkbook([invalid]), "dv-invalido.xlsx");
    expect(result.filasConErrores).toBe(1);
    expect(result.errores).toContainEqual(expect.objectContaining({ numeroFila: 2, codigo: "INVALID_RUT_DV", campo: "dv" }));
  });

  it("acepta fechas civiles válidas, rechaza fechas inexistentes y exige fecha de inicio anterior", async () => {
    const invalidDate = [...validRow];
    invalidDate[1] = "31/02/2026";
    const wrongOrder = [...validRow];
    wrongOrder[6] = "2027-01-01";
    const result = await validateWorkbook(await makeWorkbook([validRow, invalidDate, wrongOrder]), "fechas.xlsx");
    expect(result.filasValidas).toBe(1);
    expect(result.errores).toContainEqual(expect.objectContaining({ numeroFila: 3, codigo: "INVALID_DATE", campo: "fechaLimite" }));
    expect(result.errores).toContainEqual(expect.objectContaining({ numeroFila: 4, codigo: "INVALID_DATE_ORDER", campo: "fechaLimite" }));
  });

  it("valida que los días informados sean enteros sin usarlos para derivar el estado", async () => {
    const invalidDays = [...validRow];
    invalidDays[0] = "hoy";
    const result = await validateWorkbook(await makeWorkbook([invalidDays]), "dias.xlsx");
    expect(result.filasConErrores).toBe(1);
    expect(result.errores).toContainEqual(expect.objectContaining({ codigo: "INVALID_NUMBER", campo: "diasRestantes" }));
  });
  it("reporta filas vacías por número", async () => {
    const result = await validateWorkbook(await makeWorkbook([validRow, Array(9).fill(null)]), "filas.xlsx");
    expect(result.filasConErrores).toBe(1);
    expect(result.errores).toContainEqual(expect.objectContaining({ numeroFila: 3, codigo: "EMPTY_ROW" }));
  });

  it("rechaza archivos mayores a 10 MB", async () => {
    await expect(validateWorkbook(Buffer.alloc(MAX_FILE_SIZE + 1), "grande.xlsx")).rejects.toMatchObject({ code: "FILE_TOO_LARGE", statusCode: 413 });
  });
});
