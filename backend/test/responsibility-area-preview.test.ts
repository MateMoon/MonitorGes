import { describe, expect, it } from "vitest";
const frontendServicePath = new URL("../../src/services/areas-responsabilidad.ts", import.meta.url).href;
const { expandAreaSelection } = await import(frontendServicePath);

describe("vista previa de coberturas", () => {
  it("expande varias dimensiones en filas concretas sin inventar combinaciones problema-tipo", () => {
    const result = expandAreaSelection(["s1", "s2"], ["pair-a", "pair-b"], []);
    expect(result.selections).toEqual([
      { establecimientoId: "s1", combinacionId: "pair-a" },
      { establecimientoId: "s1", combinacionId: "pair-b" },
      { establecimientoId: "s2", combinacionId: "pair-a" },
      { establecimientoId: "s2", combinacionId: "pair-b" },
    ]);
    expect(result.duplicateCount).toBe(0);
  });

  it("omite coberturas existentes y duplicados en las opciones recibidas, informando el conteo", () => {
    const result = expandAreaSelection(["s1", "s1"], ["pair-a", "pair-b"], [{ establecimientoId: "s1", combinacionId: "pair-a" }]);
    expect(result.selections).toEqual([{ establecimientoId: "s1", combinacionId: "pair-b" }]);
    expect(result.duplicateCount).toBe(3);
  });
});
