import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { evaluateRetentionPolicy, planWorkbookRetention, RetentionInputError, RETENTION_POLICY_VERSION, type RetentionPlan } from "../src/modules/importaciones/retention-policy.js";
import { classifyImportRows, type MatchCandidate } from "../src/modules/importaciones/row-matching.js";
import type { PreviewRow, ValidationError } from "../src/modules/importaciones/validation-service.js";

// Entirely synthetic fixtures; no Prisma, credentials, real files or QA connection.
const row = (patch: Partial<PreviewRow> = {}): PreviewRow => ({ numeroFila: 2, rut: "12345678", dv: "5", nombre: "Paciente ficticio", problemaSalud: "Problema de prueba", nombreGarantia: "Tratamiento", fechaInicio: "2026-10-01", fechaLimite: "2026-12-31", responsable: "Centro de prueba", ...patch });
const candidate = (patch: Partial<MatchCandidate> = {}): MatchCandidate => ({ id: "garantia-ficticia-1", rut: "12345678", dv: "5", problemaSalud: "Problema de prueba", nombreGarantia: "Tratamiento", fechaInicio: "2026-10-01", ...patch });
const plan = (rows: readonly PreviewRow[], candidates: readonly MatchCandidate[] = [], errores: readonly ValidationError[] = []) => evaluateRetentionPolicy({ registrosValidos: rows, validation: { errores } }, candidates);
const logical = (result: RetentionPlan) => ({
  conteos: result.conteos,
  filas: result.filas.map(r => r.clasificacion === "ERROR_VALIDACION" ? { clasificacion: r.clasificacion, codigos: r.errores.map(e => e.codigo).sort() } : { huella: r.huellaFila, clasificacion: r.clasificacion, motivos: r.motivos, candidatos: r.candidatoIds, exactos: r.coincidenciaExactaIds }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
});
function permutations<T>(values: readonly T[]): T[][] {
  if (!values.length) return [[]];
  return values.flatMap((value, i) => permutations(values.filter((_, j) => i !== j)).map(rest => [value, ...rest]));
}

describe("Política independiente: procesamiento normal y candidatos", () => {
  it("identifica la coincidencia exacta única y propone el ID concreto sin escribir", () => {
    expect(plan([row()], [candidate()])).toMatchObject({ version: RETENTION_POLICY_VERSION, conteos: { normales: 1, pendientes: 0, repetidas: 0, errores: 0 }, filas: [{ clasificacion: "PROCESAR_NORMAL", motivos: ["COINCIDENCIA_EXACTA_UNICA"], garantiaId: "garantia-ficticia-1", coincidenciaExactaIds: ["garantia-ficticia-1"] }] });
  });
  it("propone una garantía nueva sin candidatos", () => {
    expect(plan([row()])).toMatchObject({ filas: [{ clasificacion: "PROCESAR_NORMAL", motivos: ["NUEVA_GARANTIA"], candidatoIds: [], garantiaId: null }] });
  });
  it.each([
    { rut: "11111111", dv: "1" }, { dv: "K" }, { problemaSalud: "Otro problema de prueba" }, { nombreGarantia: "Diagnóstico" },
  ])("no relaciona otro paciente, DV, problema o garantía: %j", patch => {
    expect(plan([row()], [candidate(patch)]).filas[0]).toMatchObject({ clasificacion: "PROCESAR_NORMAL", motivos: ["NUEVA_GARANTIA"], candidatoIds: [] });
  });
  it("retiene la misma familia con otra fecha de inicio", () => {
    expect(plan([row()], [candidate({ fechaInicio: "2026-09-01" })]).filas[0]).toMatchObject({ clasificacion: "PENDIENTE_REVISION", motivos: ["FECHA_INICIO_DISTINTA"], candidatoIds: ["garantia-ficticia-1"], coincidenciaExactaIds: [] });
  });
  it("no elige entre varios candidatos exactos y ordena sus IDs", () => {
    expect(plan([row()], [candidate({ id: "b" }), candidate({ id: "a" })]).filas[0]).toMatchObject({ clasificacion: "PENDIENTE_REVISION", motivos: ["MULTIPLES_COINCIDENCIAS_EXACTAS"], coincidenciaExactaIds: ["a", "b"] });
  });
  it("retiene varios candidatos sin coincidencia exacta", () => {
    expect(plan([row()], [candidate({ id: "b", fechaInicio: "2026-09-01" }), candidate({ id: "a", fechaInicio: "2026-08-01" })]).filas[0]).toMatchObject({ clasificacion: "PENDIENTE_REVISION", motivos: ["FECHA_INICIO_DISTINTA"], candidatoIds: ["a", "b"] });
  });
  it("prioriza la exacta única aunque existan varios episodios con otras fechas", () => {
    const candidates = [candidate({ id: "episodio-anterior", fechaInicio: "2026-09-01" }), candidate({ id: "episodio-exacto" }), candidate({ id: "episodio-posterior", fechaInicio: "2026-11-01" })];
    expect(plan([row()], candidates).filas[0]).toMatchObject({ clasificacion: "PROCESAR_NORMAL", garantiaId: "episodio-exacto", coincidenciaExactaIds: ["episodio-exacto"] });
    // The existing preview classifier intentionally retains its former contract.
    expect(classifyImportRows([row()], candidates)[0].clasificacion).toBe("DUDOSA_VARIOS_CANDIDATOS");
  });
  it.each([{ fechaLimite: "2027-02-01" }, { responsable: "Otro centro ficticio" }, { fechaLimite: "2027-02-01", responsable: "Otro centro ficticio" }])("no bloquea una modificación fuente en una única fila: %j", patch => {
    expect(plan([row(patch)], [candidate()]).filas[0]).toMatchObject({ clasificacion: "PROCESAR_NORMAL", motivos: ["COINCIDENCIA_EXACTA_UNICA"] });
  });
  it("reutiliza la normalización compartida de identidad", () => {
    expect(plan([row({ rut: " 12.345.678-5 ", problemaSalud: " PROBLÉMA / DE PRUEBA!! ", nombreGarantia: " TRATAMIENTO... " })], [candidate()]).filas[0]).toMatchObject({ clasificacion: "PROCESAR_NORMAL", garantiaId: "garantia-ficticia-1" });
  });
});

describe("Archivo completo: equivalencias, contradicciones y episodios", () => {
  it.each([false, true])("agrupa repeticiones equivalentes con candidato=%s", hasCandidate => {
    const result = plan([row({ numeroFila: 5 }), row({ numeroFila: 2 }), row({ numeroFila: 8 })], hasCandidate ? [candidate()] : []);
    expect(result.conteos).toEqual({ normales: 1, pendientes: 0, repetidas: 2, errores: 0 });
    expect(result.filas.map(r => r.numeroFila)).toEqual([2, 5, 8]);
    expect(result.filas[0]).toMatchObject({ clasificacion: "PROCESAR_NORMAL", filasEquivalentes: [2, 5, 8] });
    for (const r of result.filas.slice(1)) expect(r).toMatchObject({ clasificacion: "OMITIR_REPETIDA", numeroFilaRepresentante: 2, clasificacionRepresentante: "PROCESAR_NORMAL" });
  });
  it("también deduplica las equivalentes de una fila pendiente", () => {
    const result = plan([row(), row({ numeroFila: 3 })], [candidate({ fechaInicio: "2026-09-01" })]);
    expect(result.conteos).toEqual({ normales: 0, pendientes: 1, repetidas: 1, errores: 0 });
    expect(result.filas[1]).toMatchObject({ clasificacion: "OMITIR_REPETIDA", numeroFilaRepresentante: 2, clasificacionRepresentante: "PENDIENTE_REVISION" });
  });
  it("equivale RUT y formato de identidad, conservando las diferencias literales que se escriben", () => {
    const result = plan([row(), row({ numeroFila: 3, rut: "12.345.678-5", nombre: " Paciente ficticio ", responsable: " Centro de prueba ", problemaSalud: " PROBLÉMA DE PRUEBA " })]);
    expect(result.conteos).toEqual({ normales: 1, pendientes: 0, repetidas: 1, errores: 0 });
  });
  it.each([{ fechaLimite: "2027-01-01" }, { responsable: "Centro de prueba B" }, { responsable: "CENTRO DE PRUEBA" }, { nombre: "Otro nombre ficticio" }])("retiene todas las filas contradictorias antes de aplicar alguna: %j", patch => {
    const result = plan([row(), row({ numeroFila: 3, ...patch })], [candidate()]);
    expect(result.conteos).toEqual({ normales: 0, pendientes: 2, repetidas: 0, errores: 0 });
    for (const r of result.filas) expect(r).toMatchObject({ clasificacion: "PENDIENTE_REVISION", motivos: expect.arrayContaining(["FILAS_CONTRADICTORIAS"]) });
  });
  it("no deja que nombres contradictorios del mismo paciente se sobrescriban entre familias", () => {
    const result = plan([row(), row({ numeroFila: 3, nombre: "Nombre alternativo ficticio", nombreGarantia: "Diagnóstico" })]);
    expect(result.conteos.normales).toBe(0);
    for (const r of result.filas) expect(r).toMatchObject({ clasificacion: "PENDIENTE_REVISION", motivos: ["NOMBRE_PACIENTE_CONTRADICTORIO"] });
  });
  it.each([false, true])("retiene fechas distintas de una familia si algún episodio no está establecido; candidato=%s", hasCandidate => {
    const result = plan([row(), row({ numeroFila: 3, fechaInicio: "2026-11-01" })], hasCandidate ? [candidate()] : []);
    expect(result.conteos.pendientes).toBe(2);
    expect(result.conteos.normales).toBe(0);
    for (const r of result.filas) expect(r).toMatchObject({ motivos: expect.arrayContaining(["FECHAS_DISTINTAS_EN_ARCHIVO"]) });
  });
  it("permite varios episodios legítimos ya registrados con sus propias fechas, plazos y responsables", () => {
    const result = plan([row(), row({ numeroFila: 3, fechaInicio: "2026-11-01", fechaLimite: "2027-01-01", responsable: "Centro del segundo episodio" })], [candidate(), candidate({ id: "garantia-ficticia-2", fechaInicio: "2026-11-01" })]);
    expect(result.conteos).toEqual({ normales: 2, pendientes: 0, repetidas: 0, errores: 0 });
    expect(result.filas).toMatchObject([{ garantiaId: "garantia-ficticia-1" }, { garantiaId: "garantia-ficticia-2" }]);
  });
  it("una familia conflictiva no retiene pacientes independientes", () => {
    const result = plan([row(), row({ numeroFila: 3, fechaLimite: "2027-01-01" }), row({ numeroFila: 4, rut: "11111111", dv: "1" })]);
    expect(result.conteos).toMatchObject({ pendientes: 2, normales: 1 });
    expect(result.filas[2]).toMatchObject({ clasificacion: "PROCESAR_NORMAL", motivos: ["NUEVA_GARANTIA"] });
  });
});

describe("Independencia del orden y contratos para integración posterior", () => {
  it("produce el mismo plan al permutar el arreglo y los candidatos, sin renumerar las filas", () => {
    const rows = [row({ numeroFila: 4 }), row(), row({ numeroFila: 3, fechaLimite: "2027-02-01" })];
    const candidates = [candidate({ id: "b" }), candidate({ id: "a" })];
    const expected = plan(rows, candidates);
    for (const permutation of permutations(rows)) expect(plan(permutation, [...candidates].reverse())).toEqual(expected);
  });
  it("mantiene la clasificación lógica cuando el contenido ocupa otras posiciones del Excel", () => {
    const contents = [row(), row(), row({ fechaLimite: "2027-02-01" })];
    const expected = logical(plan(contents.map((r, i) => ({ ...r, numeroFila: i + 2 })), [candidate()]));
    for (const permutation of permutations(contents)) expect(logical(plan(permutation.map((r, i) => ({ ...r, numeroFila: i + 2 })), [candidate()]))).toEqual(expected);
  });
  it("elige un formato representante estable, sin depender de la primera fila recibida", () => {
    const lower = row({ numeroFila: 8, problemaSalud: "problema de prueba" }), upper = row({ numeroFila: 2, problemaSalud: "PROBLEMA DE PRUEBA" });
    for (const rows of [[lower, upper], [upper, lower]]) expect(plan(rows).filas.find(r => r.clasificacion === "OMITIR_REPETIDA")).toMatchObject({ numeroFilaRepresentante: 2 });
    const swapped = plan([{ ...lower, numeroFila: 2 }, { ...upper, numeroFila: 8 }]);
    expect(swapped.filas.find(r => r.clasificacion === "OMITIR_REPETIDA")).toMatchObject({ numeroFilaRepresentante: 8 });
  });
  it("no muta filas, errores ni candidatos y devuelve claves opacas", () => {
    const rows = Object.freeze([Object.freeze(row())]), candidates = Object.freeze([Object.freeze(candidate())]);
    const error = Object.freeze({ numeroFila: 3, codigo: "INVALID_DATE", campo: "fechaInicio", mensaje: "Fecha de prueba inválida" });
    const errores = Object.freeze([error]), before = JSON.stringify({ rows, candidates, errores });
    const result = plan(rows, candidates, errores);
    expect(JSON.stringify({ rows, candidates, errores })).toBe(before);
    expect(JSON.stringify(result)).not.toContain("12345678");
    expect(JSON.stringify(result)).not.toContain("Paciente ficticio");
    expect(result.filas[0]).toMatchObject({ huellaFila: expect.stringMatching(/^[a-f0-9]{64}$/), grupoFamiliaId: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const invalid = result.filas.find(r => r.clasificacion === "ERROR_VALIDACION")!;
    if (invalid.clasificacion === "ERROR_VALIDACION") invalid.errores[0].mensaje = "Cambio solo en la copia";
    expect(error.mensaje).toBe("Fecha de prueba inválida");
  });
  it("cuenta filas inválidas y no cantidad de errores", () => {
    const result = plan([], [], [{ numeroFila: 3, codigo: "REQUIRED_FIELD", mensaje: "Falta nombre" }, { numeroFila: 3, codigo: "INVALID_DATE", mensaje: "Fecha inválida" }]);
    expect(result.conteos).toEqual({ normales: 0, pendientes: 0, repetidas: 0, errores: 1 });
    expect(result.filas).toMatchObject([{ numeroFila: 3, clasificacion: "ERROR_VALIDACION", errores: expect.any(Array) }]);
  });
  it.each([
    [row(), row()],
    [row({ numeroFila: 0 })],
  ])("rechaza un contrato con números de fila repetidos o inválidos: %j", (...rows) => {
    expect(() => plan(rows)).toThrow(RetentionInputError);
  });
  it("rechaza una fila simultáneamente válida y con errores del parser", () => {
    expect(() => plan([row()], [], [{ numeroFila: 2, codigo: "INVALID_RUT", mensaje: "Error de prueba" }])).toThrow(RetentionInputError);
  });
  it("no cuenta dos veces el mismo candidato recibido en la instantánea", () => {
    expect(plan([row()], [candidate(), candidate()]).filas[0]).toMatchObject({ clasificacion: "PROCESAR_NORMAL", coincidenciaExactaIds: [candidate().id] });
  });
  it("rechaza instantáneas contradictorias del mismo ID en vez de elegir una", () => {
    for (const candidates of [[candidate(), candidate({ fechaInicio: "2026-09-01" })], [candidate({ fechaInicio: "2026-09-01" }), candidate()]]) expect(() => plan([row()], candidates)).toThrow(RetentionInputError);
  });
  it("no convierte una instantánea inválida en una propuesta nueva", () => {
    expect(() => plan([row()], [candidate({ fechaInicio: "2026-02-30" })])).toThrow(RetentionInputError);
  });
});

const headers = ["Problema de salud", "RUT", "DV", "Nombre", "Fecha de Inicio", "Fecha Limite", "Días que faltan para el Vencimiento de la Garantía", "Nombre de la Garantía", "Responsable de la Garantía"];
const cells = ["Problema de prueba", "12345678", "5", "Paciente ficticio", "2026-10-01", "2026-12-31", 0, "Tratamiento", "Centro de prueba"];
async function workbook(rows: readonly (readonly (string | number | null)[])[]) {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("Nomina de prueba");
  sheet.addRow(headers); rows.forEach(r => sheet.addRow([...r]));
  return Buffer.from(await book.xlsx.writeBuffer());
}

describe("Adaptador XLSX: reutiliza todas las validaciones vigentes sin escribir", () => {
  it.each([
    { field: 1, value: "RUT-no-valido", code: "INVALID_RUT" },
    { field: 2, value: "9", code: "INVALID_RUT_DV" },
    { field: 4, value: "2026-02-30", code: "INVALID_DATE" },
    { field: 5, value: "2026-09-01", code: "INVALID_DATE_ORDER" },
    { field: 3, value: "", code: "REQUIRED_FIELD" },
    { field: 8, value: "", code: "REQUIRED_FIELD" },
    { field: 6, value: "no-es-entero", code: "INVALID_NUMBER" },
  ])("conserva el error del validador $code y no consulta candidatos", async ({ field, value, code }) => {
    const invalid = [...cells]; invalid[field] = value;
    const reader = vi.fn(async () => [candidate()]);
    const result = await planWorkbookRetention(await workbook([invalid]), "nomina-sintetica.xlsx", reader);
    expect(reader).not.toHaveBeenCalled();
    expect(result.conteos).toEqual({ normales: 0, pendientes: 0, repetidas: 0, errores: 1 });
    expect(result.filas[0]).toMatchObject({ clasificacion: "ERROR_VALIDACION", errores: expect.arrayContaining([expect.objectContaining({ codigo: code })]) });
  });
  it("clasifica un archivo mixto conservando la validación y consulta solo las filas válidas", async () => {
    const invalid = [...cells]; invalid[2] = "9";
    const reader = vi.fn(async (_rows: readonly Readonly<PreviewRow>[]) => [candidate()]);
    const result = await planWorkbookRetention(await workbook([cells, invalid]), "mixto-sintetico.xlsx", reader);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(reader.mock.calls[0][0]).toMatchObject([{ numeroFila: 2 }]);
    expect(result.conteos).toEqual({ normales: 1, pendientes: 0, repetidas: 0, errores: 1 });
  });
  it("un archivo inválido falla antes de invocar el lector", async () => {
    const reader = vi.fn(async () => []);
    await expect(planWorkbookRetention(Buffer.from("archivo ficticio inválido"), "nomina.txt", reader)).rejects.toMatchObject({ code: "UNSUPPORTED_FILE" });
    expect(reader).not.toHaveBeenCalled();
  });
  it("propaga el fallo del lector y nunca presenta un catálogo vacío falso", async () => {
    const reader = vi.fn(async () => { throw new Error("Lector de prueba no disponible"); });
    await expect(planWorkbookRetention(await workbook([cells]), "nomina.xlsx", reader)).rejects.toThrow("Lector de prueba no disponible");
  });
  it("reordenar físicamente las filas conflictivas conserva el plan lógico", async () => {
    const changed = [...cells]; changed[5] = "2027-01-01";
    const first = await planWorkbookRetention(await workbook([cells, changed]), "orden-a.xlsx", async () => [candidate()]);
    const second = await planWorkbookRetention(await workbook([changed, cells]), "orden-b.xlsx", async () => [candidate()]);
    expect(logical(first)).toEqual(logical(second));
    expect(first.conteos.pendientes).toBe(2);
  });
});
