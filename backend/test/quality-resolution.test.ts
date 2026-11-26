import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createQualityResolutionService, resolveBodySchema } from "../src/modules/calidad-datos/resolution-service.js";
import { readDataQualityConfig } from "../src/modules/calidad-datos/config.js";
import { revalidateRetainedRow } from "../src/modules/calidad-datos/retained-row-validation.js";
import { reviewFingerprint } from "../src/modules/calidad-datos/review-evidence.js";
import { hash } from "../src/modules/calidad-datos/candidate-evidence.js";
import { RETENTION_POLICY_VERSION } from "../src/modules/importaciones/retention-policy.js";

const row = { numeroFila: 8, problemaSalud: "Problema sintético", rut: "12345678", dv: "5", nombre: "Paciente ficticio", fechaInicio: "2026-10-01", fechaLimite: "2026-12-01", nombreGarantia: "Tratamiento sintético", responsable: "Centro ficticio" };
const body = { version: 1, solicitudId: randomUUID(), decision: "DISTINTA", justificacion: "Revisión sintética justificada", huellaRevision: "a".repeat(64), confirmaDistintaDeTodas: true };
describe("resolución operativa interna", () => {
  it.each(["PROFESIONAL", "LECTOR"])("%s es rechazado antes de acceder a PostgreSQL", async rol => {
    const db = { $transaction: vi.fn() }, service = createQualityResolutionService(db as never), actor = { id: randomUUID(), rol };
    for (const work of [() => service.listPending(actor), () => service.getPending(actor, randomUUID()), () => service.resolve(actor, randomUUID(), {} as never), () => service.listDecisions(actor)]) await expect(work()).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("DISTINTA requiere confirmación de todas las candidatas y la evidencia revisada", () => {
    expect(resolveBodySchema.safeParse(body).success).toBe(true);
    for (const patch of [{ confirmaDistintaDeTodas: undefined }, { confirmaDistintaDeTodas: false }, { huellaRevision: undefined }, { huellaRevision: "bad" }, { usuarioId: randomUUID() }, { garantiaResultadoId: randomUUID() }, { justificacion: " " }, { version: 0 }]) expect(resolveBodySchema.safeParse({ ...body, ...patch }).success).toBe(false);
  });
  it("actualizar requiere MISMA, candidata explícita y evidencia vigente; no acepta datos ni estado enviados por el cliente", () => {
    const update = { ...body, decision: "MISMA", confirmaDistintaDeTodas: undefined, garantiaExistenteId: randomUUID(), actualizarDatos: true };
    expect(resolveBodySchema.safeParse(update).success).toBe(true);
    for (const patch of [{ garantiaExistenteId: undefined }, { actualizarDatos: false }, { decision: "DISTINTA", confirmaDistintaDeTodas: true }, { huellaRevision: undefined }, { estadoGestion: "SIN_GESTION" }, { datosValidados: row }, { revisionGestion: 0 }, { fechaInicio: "2027-01-01" }]) expect(resolveBodySchema.safeParse({ ...update, ...patch }).success).toBe(false);
  });
  it("revalida con el parser original sin modificar los valores conservados", async () => {
    expect(await revalidateRetainedRow(row, hash(row), RETENTION_POLICY_VERSION)).toEqual(row);
    await expect(revalidateRetainedRow(row, "0".repeat(64), RETENTION_POLICY_VERSION)).rejects.toMatchObject({ code: "INVALID_RETAINED_ROW" });
    await expect(revalidateRetainedRow(row, hash(row), "future-policy")).rejects.toMatchObject({ code: "INVALID_RETAINED_ROW" });
    const invalidDv = { ...row, dv: "9" };
    await expect(revalidateRetainedRow(invalidDv, hash(invalidDv), RETENTION_POLICY_VERSION)).rejects.toMatchObject({ code: "INVALID_RETAINED_ROW" });
  });
  it("el token de revisión vincula fila, versión y datos", () => {
    const original = { id: randomUUID(), version: 1, huellaDatos: hash(row), versionPolitica: RETENTION_POLICY_VERSION };
    for (const patch of [{ id: randomUUID() }, { version: 2 }, { huellaDatos: "b".repeat(64) }]) expect(reviewFingerprint({ ...original, ...patch }, [])).not.toBe(reviewFingerprint(original, []));
  });
});
describe("API apagada por defecto", () => {
  it.each([undefined, "false", "true"])("interpreta %j estrictamente", value => expect(readDataQualityConfig(value === undefined ? {} : { DATA_QUALITY_ENABLED: value })).toBe(value === "true"));
  it.each(["", "TRUE", " true", "true ", "1", "yes"])("rechaza %j", value => expect(() => readDataQualityConfig({ DATA_QUALITY_ENABLED: value })).toThrowError(expect.objectContaining({ code: "DATA_QUALITY_CONFIG_INVALID" })));
});
