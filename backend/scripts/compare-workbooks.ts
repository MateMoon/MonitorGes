import { readFile } from "node:fs/promises";
import { parseWorkbookForImport } from "../src/modules/importaciones/validation-service.js";
import { summarizeWorkbookComparison } from "../src/modules/importaciones/workbook-comparison.js";

async function readWorkbook(path: string) {
  const buffer = await readFile(path);
  const { validation, registrosValidos } = await parseWorkbookForImport(buffer, path);
  return {
    rowsRead: validation.filasLeidas,
    invalidRows: validation.filasConErrores,
    validRows: registrosValidos.map(({ numeroFila, rut, dv, problemaSalud, nombreGarantia, fechaInicio, fechaLimite, responsable }) => ({
      numeroFila, rut, dv, problemaSalud, nombreGarantia, fechaInicio, fechaLimite, responsable,
    })),
  };
}

async function main() {
  const [referencePath, comparisonPath, ...extra] = process.argv.slice(2);
  if (!referencePath || !comparisonPath || extra.length > 0) {
    console.error("Uso: tsx scripts/compare-workbooks.ts <planilla-05-oct.xlsx> <planilla-22-oct.xlsx>");
    process.exitCode = 2;
    return;
  }

  try {
    const [reference, comparison] = await Promise.all([readWorkbook(referencePath), readWorkbook(comparisonPath)]);
    const summary = summarizeWorkbookComparison(reference, comparison);
    console.log(JSON.stringify({
      referencia: "primera planilla (catálogo inicial, no historial completo)",
      comparada: "segunda planilla",
      alcance: "simulación en memoria; sin acceso a BD y sin aplicar cambios",
      ...summary,
    }, null, 2));
  } catch {
    // No imprimir excepciones de librerías/rutas: pueden incluir nombres o rutas personales.
    console.error("No fue posible procesar ambos archivos. Verifique las rutas y que sean XLSX válidos.");
    process.exitCode = 1;
  }
}

void main();
