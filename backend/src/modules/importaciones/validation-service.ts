import ExcelJS from "exceljs";
import path from "node:path";

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
const PREVIEW_LIMIT = 10;

export type ValidationError = { numeroFila: number; codigo: string; campo?: string; mensaje: string };
export type PreviewRow = {
  numeroFila: number;
  problemaSalud: string;
  rut: string;
  dv: string;
  nombre: string;
  fechaInicio: string;
  fechaLimite: string;
  nombreGarantia: string;
  responsable: string;
};

export type WorkbookValidation = {
  nombreArchivo: string;
  filasLeidas: number;
  filasValidas: number;
  filasConErrores: number;
  vistaPrevia: PreviewRow[];
  errores: ValidationError[];
};

export class WorkbookInputError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "WorkbookInputError";
  }
}

const REQUIRED_HEADERS = [
  "problema de salud",
  "rut",
  "dv",
  "nombre",
  "fecha de inicio",
  "fecha limite",
  "dias que faltan para el vencimiento de la garantia",
  "nombre de la garantia",
  "responsable de la garantia",
] as const;

function normalizeHeader(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function detectHeaderRow(sheet: ExcelJS.Worksheet) {
  const rowsExamined = Math.min(sheet.rowCount, 30);
  let best = { rowNumber: 1, columns: new Map<string, number>(), recognized: [] as string[] };

  for (let rowNumber = 1; rowNumber <= rowsExamined; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const columns = new Map<string, number>();
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      const normalized = normalizeHeader(cellText(row.getCell(column).value));
      if (normalized) columns.set(normalized, column);
    }
    const recognized = REQUIRED_HEADERS.filter((header) => columns.has(header));
    if (recognized.length > best.recognized.length) best = { rowNumber, columns, recognized: [...recognized] };
    if (recognized.length === REQUIRED_HEADERS.length) return { rowNumber, columns };
  }

  const missing = REQUIRED_HEADERS.filter((header) => !best.columns.has(header));
  throw new WorkbookInputError(
    "MISSING_COLUMNS",
    `No se encontraron todos los encabezados al examinar las filas 1–${rowsExamined}. Mejor coincidencia: fila ${best.rowNumber} (${best.recognized.length}/${REQUIRED_HEADERS.length}); encabezados reconocidos: ${best.recognized.join(", ") || "ninguno"}. Faltan: ${missing.join(", ")}.`,
  );
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((part) => part.text).join("").trim();
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("text" in value) return String(value.text ?? "").trim();
    return "";
  }
  return String(value).trim();
}

function rutDigits(value: string): string {
  return value.toUpperCase().replace(/[.\-\s]/g, "");
}

function expectedDv(number: string): string {
  let sum = 0;
  let multiplier = 2;
  for (let index = number.length - 1; index >= 0; index -= 1) {
    sum += Number(number[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const result = 11 - (sum % 11);
  return result === 11 ? "0" : result === 10 ? "K" : String(result);
}

function parseCivilDate(value: ExcelJS.CellValue, date1904: boolean): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value) && value >= 1 && value < 2_958_466) {
    return new Date(Date.UTC(1899, 11, 30) + (Math.floor(value) + (date1904 ? 1462 : 0)) * 86_400_000).toISOString().slice(0, 10);
  }
  const text = cellText(value);
  let parts: number[];
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) parts = [Number(match[1]), Number(match[2]), Number(match[3])];
  else {
    match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(text);
    if (!match) return null;
    parts = [Number(match[3]), Number(match[2]), Number(match[1])];
  }
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isBlankRow(row: ExcelJS.Row, columnCount: number): boolean {
  for (let column = 1; column <= columnCount; column += 1) {
    if (cellText(row.getCell(column).value).length > 0) return false;
  }
  return true;
}

async function validateWorkbookInternal(buffer: Buffer, filename: string): Promise<WorkbookValidation & { registrosValidos: PreviewRow[] }> {
  if (buffer.length === 0) throw new WorkbookInputError("EMPTY_FILE", "El archivo está vacío.");
  if (buffer.length > MAX_FILE_SIZE) throw new WorkbookInputError("FILE_TOO_LARGE", "El archivo supera el límite de 10 MB.", 413);
  const safeFilename = path.basename(filename.replace(/\\/g, "/")).slice(0, 255);
  if (path.extname(safeFilename).toLowerCase() !== ".xlsx") throw new WorkbookInputError("UNSUPPORTED_FILE", "Solo se permiten archivos .xlsx.", 415);
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new WorkbookInputError("INVALID_FILE", "El archivo no tiene una estructura XLSX válida.");

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new WorkbookInputError("INVALID_FILE", "No fue posible leer el archivo XLSX.");
  }
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 1 || sheet.columnCount < 1) throw new WorkbookInputError("EMPTY_FILE", "El libro no contiene una hoja con encabezados.");

  const detectedHeader = detectHeaderRow(sheet);
  const index = Object.fromEntries(REQUIRED_HEADERS.map((header) => [header, detectedHeader.columns.get(header)!])) as Record<(typeof REQUIRED_HEADERS)[number], number>;
  const errors: ValidationError[] = [];
  const preview: PreviewRow[] = [];
  const registrosValidos: PreviewRow[] = [];
  let filasLeidas = 0;
  let filasValidas = 0;
  let filasConErrores = 0;

  for (let rowNumber = detectedHeader.rowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    filasLeidas += 1;
    if (isBlankRow(row, sheet.columnCount)) {
      filasConErrores += 1;
      errors.push({ numeroFila: rowNumber, codigo: "EMPTY_ROW", campo: "fila", mensaje: "La fila está vacía." });
      continue;
    }

    const get = (header: (typeof REQUIRED_HEADERS)[number]) => row.getCell(index[header]).value;
    const values = {
      problemaSalud: cellText(get("problema de salud")),
      rut: cellText(get("rut")),
      dv: cellText(get("dv")).toUpperCase(),
      nombre: cellText(get("nombre")),
      fechaInicio: "",
      fechaLimite: "",
      nombreGarantia: cellText(get("nombre de la garantia")),
      responsable: cellText(get("responsable de la garantia")),
    };
    const rowErrors: ValidationError[] = [];
    const required: Array<[keyof typeof values, string]> = [
      ["problemaSalud", "Problema de salud"], ["rut", "RUT"], ["dv", "DV"], ["nombre", "Nombre"],
      ["nombreGarantia", "Nombre de la garantía"], ["responsable", "Responsable de la garantía"],
    ];
    for (const [field, label] of required) {
      if (!values[field]) rowErrors.push({ numeroFila: rowNumber, codigo: "REQUIRED_FIELD", campo: field, mensaje: `El campo ${label} es obligatorio.` });
    }
    const daysText = cellText(get("dias que faltan para el vencimiento de la garantia"));
    if (!daysText) rowErrors.push({ numeroFila: rowNumber, codigo: "REQUIRED_FIELD", campo: "diasRestantes", mensaje: "El campo Días que faltan para el vencimiento de la garantía es obligatorio." });
    else if (!Number.isInteger(Number(daysText))) rowErrors.push({ numeroFila: rowNumber, codigo: "INVALID_NUMBER", campo: "diasRestantes", mensaje: "Los días restantes deben ser un número entero." });

    let number = rutDigits(values.rut);
    let checkDigit = rutDigits(values.dv);
    const combinedRut = (number.length > 8 || values.rut.includes("-")) ? /^(\d{1,8})([0-9K])$/.exec(number) : null;
    if (combinedRut && !checkDigit) {
      number = combinedRut[1];
      checkDigit = combinedRut[2];
    } else if (combinedRut && checkDigit) {
      number = combinedRut[1];
      if (checkDigit !== combinedRut[2]) rowErrors.push({ numeroFila: rowNumber, codigo: "INVALID_RUT_DV", campo: "dv", mensaje: "El DV informado no coincide con el RUT." });
    }
    if (values.rut && !/^\d{1,8}$/.test(number)) rowErrors.push({ numeroFila: rowNumber, codigo: "INVALID_RUT", campo: "rut", mensaje: "El RUT debe contener entre 1 y 8 dígitos." });
    if (values.dv && !/^[0-9K]$/.test(checkDigit)) rowErrors.push({ numeroFila: rowNumber, codigo: "INVALID_RUT_DV", campo: "dv", mensaje: "El dígito verificador debe ser un número o K." });
    if (values.rut && values.dv && /^\d{1,8}$/.test(number) && /^[0-9K]$/.test(checkDigit) && expectedDv(number) !== checkDigit) {
      rowErrors.push({ numeroFila: rowNumber, codigo: "INVALID_RUT_DV", campo: "dv", mensaje: "El dígito verificador del RUT no es válido." });
    }

    const start = parseCivilDate(get("fecha de inicio"), Boolean(workbook.properties.date1904));
    const limit = parseCivilDate(get("fecha limite"), Boolean(workbook.properties.date1904));
    if (!start) rowErrors.push({ numeroFila: rowNumber, codigo: "INVALID_DATE", campo: "fechaInicio", mensaje: "La fecha de inicio no es válida." });
    else values.fechaInicio = start;
    if (!limit) rowErrors.push({ numeroFila: rowNumber, codigo: "INVALID_DATE", campo: "fechaLimite", mensaje: "La fecha límite no es válida." });
    else values.fechaLimite = limit;
    if (start && limit && start > limit) rowErrors.push({ numeroFila: rowNumber, codigo: "INVALID_DATE_ORDER", campo: "fechaLimite", mensaje: "La fecha límite no puede ser anterior a la fecha de inicio." });

    if (rowErrors.length) {
      filasConErrores += 1;
      errors.push(...rowErrors);
      continue;
    }
    filasValidas += 1;
    const record = { numeroFila: rowNumber, ...values };
    registrosValidos.push(record);
    if (preview.length < PREVIEW_LIMIT) preview.push(record);
  }

  if (filasLeidas === 0) throw new WorkbookInputError("EMPTY_DATA", "El archivo no contiene filas de datos.");
  return { nombreArchivo: safeFilename, filasLeidas, filasValidas, filasConErrores, vistaPrevia: preview, errores: errors, registrosValidos };
}

export async function validateWorkbook(buffer: Buffer, filename: string): Promise<WorkbookValidation> {
  const { registrosValidos: _registrosValidos, ...validation } = await validateWorkbookInternal(buffer, filename);
  return validation;
}

export async function parseWorkbookForImport(buffer: Buffer, filename: string) {
  const { registrosValidos, ...validation } = await validateWorkbookInternal(buffer, filename);
  return { validation, registrosValidos };
}