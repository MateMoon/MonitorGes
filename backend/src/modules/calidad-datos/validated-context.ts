import { parseWorkbookForImport } from "../importaciones/validation-service.js";
import type { RetentionInput } from "../importaciones/retention-policy.js";
import { RowPersistenceError } from "./contracts.js";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { normalizeIdentityRut } from "../importaciones/identity-normalization.js";

const prepared = new WeakSet<object>();
const origins = new WeakMap<object, { hoja: string; huellaArchivo: string }>();
const patientContexts = new WeakMap<object, Map<number, RetentionInput>>();
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Only the unchanged real parser can prepare a save context. The WeakSet and
 * frozen data prevent an arbitrary JSON body or later in-memory mutation from
 * masquerading as validated input. No context or original file is persisted.
 */
export async function prepareValidatedImportContext(buffer: Buffer, filename: string) {
  const context = freeze(await parseWorkbookForImport(buffer, filename));
  // The existing parser processes the first worksheet. Read its real name
  // without changing that parser's validation or public return contract.
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer as unknown as Parameters<typeof book.xlsx.load>[0]);
  origins.set(context, { hoja: book.worksheets[0].name, huellaArchivo: createHash("sha256").update(buffer).digest("hex") });
  const groups = new Map<string, typeof context.registrosValidos>();
  for (const row of context.registrosValidos) {
    const key = JSON.stringify(normalizeIdentityRut(row.rut, row.dv));
    const group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
  }
  const scoped = new Map<number, RetentionInput>();
  for (const rows of groups.values()) {
    const patientContext = freeze({ registrosValidos: rows, validation: context.validation });
    for (const row of rows) scoped.set(row.numeroFila, patientContext);
  }
  patientContexts.set(context, scoped);
  prepared.add(context);
  return context;
}
export function getValidatedImportOrigin(context: RetentionInput) {
  requireValidatedContext(context);
  return { ...origins.get(context)! };
}
/** The policy's dependencies are confined to normalized patient identity:
 * families, dates, duplicate payloads and patient-name conflicts. After a full
 * workbook preflight, transaction checks can reuse ALL rows of that patient
 * (including ALL its families). This index is built once from the trusted full
 * parser output; callers cannot provide or mutate a hand-picked subset.
 */
export function getValidatedPatientContext(context: RetentionInput, numeroFila: number) {
  requireValidatedContext(context);
  const scoped = patientContexts.get(context)!.get(numeroFila);
  if (!scoped) throw new RowPersistenceError("INVALID_ROW_SELECTION", "Selecciona una fila válida del resultado original del parser.", 400);
  return scoped;
}
export function requireValidatedContext(context: RetentionInput) {
  if (!context || !prepared.has(context)) throw new RowPersistenceError("INVALID_VALIDATED_CONTEXT", "La fila debe proceder del parser de importación mediante prepareValidatedImportContext.", 400);
}
