import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "../src/App.tsx"), "utf8");
const pageSource = readFileSync(resolve(process.cwd(), "../src/pages/GuaranteesPage.tsx"), "utf8");
const serviceSource = readFileSync(resolve(process.cwd(), "../src/services/garantias.ts"), "utf8");
const trackingSource = readFileSync(resolve(process.cwd(), "../src/pages/SeguimientoGarantia.tsx"), "utf8");

describe("integración de gestión persistente en la interfaz", () => {
  it("usa la API y toma los datos de gestión de su respuesta, no de un conjunto local", () => {
    expect(appSource).toContain("registrarGestionGarantia(id, input)");
    expect(appSource).not.toContain("new Set<string | number>()");
    expect(serviceSource).toContain("managementRequest(id, 'gestion', input)");
    expect(trackingSource).toContain("onGestionar(guarantee.id, { tipoActuacion, comentario, revisionGestion: guarantee.revisionGestion })");
    expect(pageSource).toContain("eventos: [result.evento, ...(current.eventos ?? [])]");
    expect(pageSource).toContain("guarantee.gestionadaPor?.nombre");
    expect(pageSource).toContain("guarantee.gestionadaAt");
  });

  it("no muestra éxito ante error y protege la acción de solo lectura", () => {
    expect(trackingSource).toContain("catch (cause)");
    expect(trackingSource).toContain("canManage && !completed");
    expect(trackingSource).toContain("isAdmin && <Card");
    expect(appSource).toContain("const result = await registrarGestionGarantia(id, input)");
    expect(appSource).toContain("toast('Gestión registrada correctamente.')");
    expect(pageSource).toContain("Registrar una gestión no significa que la garantía esté cumplida");
  });
});
