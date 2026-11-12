import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "../src/App.tsx"), "utf8");
const pagesSource = readFileSync(resolve(process.cwd(), "../src/pages/pages2.tsx"), "utf8");

describe("navegación del frontend", () => {
  it("mantiene Alertas accesible y Estadísticas oculta y bloqueada", () => {
    const menu = appSource.match(/const MENU:[\s\S]*?\n\]/)?.[0] ?? "";
    const main = appSource.match(/<main[\s\S]*?<\/main>/)?.[0] ?? "";
    const activeMain = main.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

    expect(menu).toMatch(/\{ id: 'alertas', label: 'Alertas'/);
    expect(activeMain).toContain("{page === 'alertas' && <Alertas");
    expect(menu).not.toMatch(/^\s*\{ id: 'estadisticas'/m);
    expect(activeMain).not.toContain("<Estadisticas");
    expect(appSource).toContain("if (p === 'estadisticas') return");
  });

  it("presenta la lista global histórica con carga y errores, sin controles de envío", () => {
    expect(pagesSource).toContain('Destinatarios globales anteriores');
    expect(pagesSource).toContain('La lista global anterior ya no controla los envíos');
    expect(pagesSource).toContain('Cargando lista histórica');
    expect(pagesSource).toContain("role=\"alert\" className=\"rounded-lg bg-[#fbe7e5]");
    expect(pagesSource).not.toContain("onSubmit={saveEmail}");
  });

  it("no presenta actividad mock ni un estado de ejecucion no verificado como real", () => {
    expect(appSource).not.toContain("06/10/2026 08:32");
    expect(appSource).not.toContain("aria-label=\"Notificaciones\"");
    expect(pagesSource).not.toContain("NOTIFS");
    expect(pagesSource).toContain("La recepción y los tipos se administran por usuario; la lista global se conserva para consulta.");
    expect(appSource).toContain("if (p === 'estadisticas') return");
  });

  it("mantiene errores visibles del dashboard sin datos de respaldo mock", () => {
    const dashboardSource = readFileSync(resolve(process.cwd(), "../src/pages/pages1.tsx"), "utf8");
    expect(dashboardSource).toContain("No se pudo cargar el dashboard");
    expect(dashboardSource).toContain("dashboard?.conteosPorEstado[s] ?? 0");
    expect(dashboardSource).not.toContain("Nomina_06102026.xlsx");
    expect(dashboardSource).toContain("vencidas o con fecha l");
  });

  it("invalida comparaciones anteriores y evita exponer campos de pacientes en la validación", () => {
    expect(pagesSource).toContain("comparisonGate.current.begin()");
    expect(pagesSource).toContain("comparisonGate.current.invalidate()");
    expect(pagesSource).toContain("comparisonGate.current.isCurrent(requestGeneration)");
    expect(pagesSource).toContain("setComparison(null)");
    expect(pagesSource).not.toContain("row.rut}");
    expect(pagesSource).not.toContain("row.nombre}");
  });
});
