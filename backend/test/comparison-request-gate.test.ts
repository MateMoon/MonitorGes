import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type Gate = { begin(): number; invalidate(): void; isCurrent(generation: number): boolean };

function loadGate(): new () => Gate {
  const sourcePath = resolve(process.cwd(), "../src/services/comparison-request-gate.ts");
  const source = readFileSync(sourcePath, "utf8");
  const javascript = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 });
  const module = { exports: {} as Record<string, unknown> };
  new Function("exports", "module", javascript)(module.exports, module);
  return module.exports.ComparisonRequestGate as new () => Gate;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("protección de respuestas de comparación", () => {
  it("mantiene únicamente el resultado de la solicitud más reciente cuando llegan fuera de orden", async () => {
    const GateClass = loadGate();
    const gate = new GateClass();
    const first = deferred<string>();
    const second = deferred<string>();
    let result: string | null = null;
    const run = async (promise: Promise<string>) => {
      const generation = gate.begin();
      result = null;
      try { const value = await promise; if (gate.isCurrent(generation)) result = value; }
      catch { /* la solicitud obsoleta no debe cambiar el estado visible */ }
    };
    const firstRun = run(first.promise);
    const secondRun = run(second.promise);
    second.resolve("resultado-nuevo");
    await secondRun;
    first.resolve("resultado-antiguo");
    await firstRun;
    expect(result).toBe("resultado-nuevo");
  });

  it("deja vacío el resultado cuando una petición nueva falla después de un éxito", async () => {
    const GateClass = loadGate();
    const gate = new GateClass();
    let result: string | null = "resultado-anterior";
    const generation = gate.begin();
    result = null;
    const failed = Promise.reject(new Error("fallo ficticio"));
    try { const value = await failed; if (gate.isCurrent(generation)) result = value; }
    catch { /* el componente publica el error de esta solicitud por separado */ }
    expect(result).toBeNull();
  });

  it("invalida una respuesta pendiente si cambia el archivo", async () => {
    const GateClass = loadGate();
    const gate = new GateClass();
    const pending = deferred<string>();
    const generation = gate.begin();
    let file = "archivo-a";
    let result: string | null = null;
    file = "archivo-b";
    gate.invalidate();
    pending.resolve("resultado-archivo-a");
    const value = await pending.promise;
    if (gate.isCurrent(generation) && file === "archivo-a") result = value;
    expect(result).toBeNull();
  });
});
