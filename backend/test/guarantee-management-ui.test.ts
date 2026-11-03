import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "../src/App.tsx"), "utf8");
const pageSource = readFileSync(resolve(process.cwd(), "../src/pages/GuaranteesPage.tsx"), "utf8");
const serviceSource = readFileSync(resolve(process.cwd(), "../src/services/garantias.ts"), "utf8");

describe("integración de gestión persistente en la interfaz", () => {
  it("usa la API y toma los datos de gestión de su respuesta, no de un conjunto local", () => {
    expect(appSource).toContain("registrarGestionGarantia(id)");
    expect(appSource).not.toContain("new Set<string | number>()");
    expect(serviceSource).toContain("/api/garantias/${encodeURIComponent(String(id))}/gestion");
    expect(pageSource).toContain("const latestManagement = await onGestionar(guarantee.id)");
    expect(pageSource).toContain("...latestManagement");
    expect(pageSource).toContain("guarantee.gestionadaPor?.nombre");
    expect(pageSource).toContain("guarantee.gestionadaAt");
  });

  it("no muestra éxito ante error y protege la acción de solo lectura", () => {
    expect(pageSource).toContain("catch (cause)");
    expect(pageSource).toContain("setManagementError(");
    expect(pageSource).toContain("canManage && <Btn");
    expect(appSource).toContain("const result = await registrarGestionGarantia(id)");
    expect(appSource).toContain("toast('Gestión registrada correctamente.')");
    expect(pageSource).toContain("Registrar una gestión no significa que la garantía esté cumplida");
  });
});
