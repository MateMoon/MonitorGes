import { describe, expect, it, vi } from "vitest";
import { readImportRetentionConfig } from "../src/modules/importaciones/retention-config.js";

describe("activación explícita de la retención", () => {
  it("permanece desactivada cuando la variable no existe", () => expect(readImportRetentionConfig({})).toBe(false));
  it.each(["false", "true"])("acepta únicamente el literal %s", value => expect(readImportRetentionConfig({ IMPORT_RETENTION_ENABLED: value })).toBe(value === "true"));
  it.each(["", "TRUE", "False", " true", "true ", "1", "yes", "on", "undefined"])("rechaza %j sin habilitar importaciones", value => {
    expect(() => readImportRetentionConfig({ IMPORT_RETENTION_ENABLED: value })).toThrowError(expect.objectContaining({ code: "IMPORT_RETENTION_CONFIG_INVALID", statusCode: 503 }));
  });
});

const state = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("../src/db/prisma.js", () => ({ prisma: { $transaction: state.transaction } }));
it("una configuración inválida aborta antes de abrir transacciones o leer el Excel", async () => {
  vi.stubEnv("IMPORT_RETENTION_ENABLED", "TRUE");
  try {
    const { importWorkbook } = await import("../src/modules/importaciones/import-service.js");
    await expect(importWorkbook(Buffer.from("invalid"), "prueba.xlsx", "synthetic")).rejects.toMatchObject({ code: "IMPORT_RETENTION_CONFIG_INVALID" });
    expect(state.transaction).not.toHaveBeenCalled();
  } finally { vi.unstubAllEnvs(); }
});
