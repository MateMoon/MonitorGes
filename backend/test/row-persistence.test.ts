import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { getValidatedPatientContext, prepareValidatedImportContext, requireValidatedContext } from "../src/modules/calidad-datos/validated-context.js";
import { evaluateRetentionPolicy } from "../src/modules/importaciones/retention-policy.js";
import { createImportRowPersistence } from "../src/modules/calidad-datos/persistence-service.js";
import { originSchema, pageSchema, resolutionSchema, validatedRowSchema } from "../src/modules/calidad-datos/contracts.js";
import { candidateSetHash, fingerprint, snapshotOf, type SourceGuarantee } from "../src/modules/calidad-datos/candidate-evidence.js";

const id = randomUUID();
const source = (): SourceGuarantee => ({ id, pacienteId: randomUUID(), problemaSalud: "Problema ficticio", nombreGarantia: "Tratamiento", fechaInicio: new Date("2026-10-01"), fechaLimite: new Date("2026-12-01"), responsable: "Centro ficticio", estadoGestion: "EN_GESTION", version: 3, revisionGestion: 2,
  createdAt: new Date("2026-10-01"), updatedAt: new Date("2026-11-01"), gestionadaAt: null, gestionadaPorUsuarioId: null, _count: { eventos: 0 },
  paciente: { id: randomUUID(), rutNumero: "12345678", dv: "5", nombre: "Paciente ficticio", updatedAt: new Date("2026-11-01") } });
async function workbook(dv = "5") {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("Datos sintéticos");
  sheet.addRow(["Problema de salud", "RUT", "DV", "Nombre", "Fecha de Inicio", "Fecha Limite", "Dias que faltan para el Vencimiento de la Garantia", "Nombre de la garantia", "Responsable de la garantia"]);
  sheet.addRow(["Problema ficticio", "12345678", dv, "Paciente ficticio", "2026-10-01", "2026-12-01", 0, "Tratamiento", "Centro ficticio"]);
  return Buffer.from(await book.xlsx.writeBuffer());
}
describe("Contratos y límites de la persistencia interna", () => {
  it("el índice transaccional incluye todas las familias y formatos RUT del mismo paciente", async () => {
    const book = new ExcelJS.Workbook(); await book.xlsx.load(await workbook() as never);
    const sheet = book.worksheets[0], otherFamily = (sheet.getRow(2).values as ExcelJS.CellValue[]).slice(1);
    otherFamily[1] = "12.345.678-5"; otherFamily[3] = "Nombre contradictorio ficticio"; otherFamily[7] = "Otra familia";
    sheet.addRow(otherFamily);
    const otherPatient = (sheet.getRow(2).values as ExcelJS.CellValue[]).slice(1); otherPatient[1] = "11111111"; otherPatient[2] = "1";
    sheet.addRow(otherPatient);
    const context = await prepareValidatedImportContext(Buffer.from(await book.xlsx.writeBuffer()), "sintetico.xlsx");
    const scoped = getValidatedPatientContext(context, 2);
    expect(scoped.registrosValidos.map(row => row.numeroFila)).toEqual([2, 3]);
    expect(evaluateRetentionPolicy(scoped, []).filas).toEqual(evaluateRetentionPolicy(context, []).filas.filter(row => row.numeroFila === 2 || row.numeroFila === 3));
    expect(evaluateRetentionPolicy(scoped, []).conteos.pendientes).toBe(2);
  });
  it("solo acepta contextos completos del parser y los protege contra mutaciones", async () => {
    const context = await prepareValidatedImportContext(await workbook(), "sintetico.xlsx");
    expect(context.registrosValidos).toHaveLength(1);
    expect(() => requireValidatedContext(context)).not.toThrow();
    expect(Object.isFrozen(context.registrosValidos[0])).toBe(true);
    expect(Object.isFrozen(context.validation.errores)).toBe(true);
    expect(() => { context.registrosValidos[0].responsable = "Cambio posterior"; }).toThrow();
    const db = { $transaction: vi.fn() };
    await expect(createImportRowPersistence(db as never).savePendingRow({ id, rol: "ADMIN" }, { importacionId: id, hoja: "Datos sintéticos", numeroFila: 2, contextoValidado: structuredClone(context) })).rejects.toMatchObject({ code: "INVALID_VALIDATED_CONTEXT" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("conserva el rechazo de RUT/DV del validador existente", async () => {
    const context = await prepareValidatedImportContext(await workbook("0"), "sintetico.xlsx");
    expect(context.registrosValidos).toHaveLength(0);
    expect(context.validation.errores.length).toBeGreaterThan(0);
  });
  it.each(["PROFESIONAL", "LECTOR"])("%s no puede leer ni resolver la bandeja", async rol => {
    const db = { $transaction: vi.fn() }, store = createImportRowPersistence(db as never), actor = { id, rol };
    for (const work of [() => store.listPendingRows(actor), () => store.getRow(actor, id), () => store.listResolutions(actor), () => store.registerResolution(actor, {} as never)]) await expect(work()).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("LECTOR tampoco registra filas desde importaciones", async () => {
    const db = { $transaction: vi.fn() };
    await expect(createImportRowPersistence(db as never).savePendingRow({ id, rol: "LECTOR" }, {} as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it.each([{ version: 0 }, { justificacion: "  " }, { usuarioId: id }, { garantiaExistenteId: undefined }])("rechaza una resolución MISMA inválida: %j", patch => {
    expect(resolutionSchema.safeParse({ filaId: id, version: 1, solicitudId: randomUUID(), decision: "MISMA", garantiaExistenteId: randomUUID(), justificacion: "Motivo sintético", ...patch }).success).toBe(false);
  });
  it("DISTINTA no acepta un ID resultante enviado por un cliente", () => {
    const input = { filaId: id, version: 1, solicitudId: randomUUID(), decision: "DISTINTA", justificacion: "Motivo sintético" };
    expect(resolutionSchema.safeParse(input).success).toBe(true);
    expect(resolutionSchema.safeParse({ ...input, garantiaExistenteId: id }).success).toBe(false);
    expect(resolutionSchema.safeParse({ ...input, garantiaResultadoId: id }).success).toBe(false);
  });
  it("valida procedencia y límites sin alterar el parser existente", () => {
    expect(originSchema.safeParse({ importacionId: id, hoja: "Nómina", numeroFila: 0 }).success).toBe(false);
    expect(pageSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(validatedRowSchema.safeParse({ ...source(), numeroFila: 2 }).success).toBe(false);
  });
  it("las huellas detectan cambios de fuentes, gestión, versión e identidad", () => {
    const original = source();
    for (const patch of [{ responsable: "Otro centro" }, { fechaInicio: new Date("2026-10-02") }, { version: 4 }, { revisionGestion: 3 }, { estadoGestion: "CUMPLIDA" as const }, { paciente: { ...original.paciente, nombre: "Nombre cambiado" } }]) expect(fingerprint({ ...original, ...patch })).not.toBe(fingerprint(original));
    const other = { ...source(), id: randomUUID() };
    expect(candidateSetHash([original, other])).toBe(candidateSetHash([other, original]));
    expect(candidateSetHash([original])).not.toBe(candidateSetHash([original, other]));
  });
  it("la evidencia candidata no duplica RUT y conserva nombre solo si difiere", () => {
    const original = source();
    expect(snapshotOf(original, original.paciente.nombre)).not.toHaveProperty("nombreEnAplicacion");
    expect(snapshotOf(original, "Otro nombre ficticio")).toHaveProperty("nombreEnAplicacion", original.paciente.nombre);
    expect(JSON.stringify(snapshotOf(original, "Otro nombre ficticio"))).not.toContain("12345678");
  });
  it("la migración es aditiva y restringe origen, terminalidad e idempotencia", () => {
    const sql = readFileSync(new URL("../prisma/migrations/20261125120000_import_row_persistence/migration.sql", import.meta.url), "utf8");
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE)\b/);
    for (const altered of sql.matchAll(/ALTER TABLE "([^"]+)"/g)) expect(["FilaImportacion", "CandidatoFilaImportacion", "ResolucionFilaImportacion"]).toContain(altered[1]);
    expect(sql).toContain('UNIQUE INDEX "ResolucionFilaImportacion_filaId_key"');
    expect(sql).toContain('UNIQUE INDEX "ResolucionFilaImportacion_solicitudId_key"');
    expect(sql).toContain('FOREIGN KEY ("filaId", "garantiaResultadoId")');
    expect(sql).toContain('"ResolucionFilaImportacion_immutable"');
  });
  it("no añade revisiones a las rutas de importación o Supervisión SOME", () => {
    for (const file of ["../src/modules/importaciones/routes.ts", "../src/modules/supervision/routes.ts"]) expect(readFileSync(new URL(file, import.meta.url), "utf8")).not.toMatch(/calidad-datos|createImportRowPersistence|savePendingRow/);
  });
});
