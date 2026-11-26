import ExcelJS from "exceljs";
import { parseWorkbookForImport, type PreviewRow } from "../importaciones/validation-service.js";
import { RETENTION_POLICY_VERSION } from "../importaciones/retention-policy.js";
import { hash } from "./candidate-evidence.js";
import { parseInput, RowPersistenceError, validatedRowSchema } from "./contracts.js";

/** Reuse the actual import validator (including DV checksum) without invoking
 * any import writer. Only persisted guarantee-relevant fields are reconstructed;
 * the unused days column was validated on ingestion and is not a source field. */
export async function revalidateRetainedRow(raw: unknown, expectedHash: string, policyVersion: string): Promise<PreviewRow> {
  const data = parseInput(validatedRowSchema, raw);
  if (hash(data) !== expectedHash || policyVersion !== RETENTION_POLICY_VERSION) throw invalid();
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("Revalidación interna");
  sheet.addRow(["Problema de salud", "RUT", "DV", "Nombre", "Fecha de Inicio", "Fecha Limite", "Dias que faltan para el Vencimiento de la Garantia", "Nombre de la garantia", "Responsable de la garantia"]);
  sheet.addRow([data.problemaSalud, data.rut, data.dv, data.nombre, data.fechaInicio, data.fechaLimite, 0, data.nombreGarantia, data.responsable]);
  const parsed = await parseWorkbookForImport(Buffer.from(await book.xlsx.writeBuffer()), "revalidacion.xlsx");
  if (parsed.validation.errores.length || parsed.registrosValidos.length !== 1 || hash({ ...parsed.registrosValidos[0], numeroFila: data.numeroFila }) !== expectedHash) throw invalid();
  return data;
}
function invalid() { return new RowPersistenceError("INVALID_RETAINED_ROW", "Los datos retenidos no superan la revalidación o cambiaron. Solicita revisar su integridad."); }
