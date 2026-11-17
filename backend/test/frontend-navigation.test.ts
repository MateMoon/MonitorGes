import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "../src/App.tsx"), "utf8");
const pagesSource = readFileSync(resolve(process.cwd(), "../src/pages/pages2.tsx"), "utf8");

describe("navegación del frontend", () => {
  it("retira Alertas, conserva Gestión de usuarios y mantiene Estadísticas oculta y bloqueada", () => {
    const menu = appSource.match(/const MENU:[\s\S]*?\n\]/)?.[0] ?? "";
    const main = appSource.match(/<main[\s\S]*?<\/main>/)?.[0] ?? "";
    const activeMain = main.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

    expect(menu).not.toContain("'alertas'");
    expect(activeMain).not.toContain("<Alertas");
    expect(menu).toMatch(/\{ id: 'configuracion', label: 'Gestión de usuarios'/);
    expect(activeMain).toContain("{page === 'configuracion' && <Configuracion");
    expect(menu).not.toMatch(/^\s*\{ id: 'estadisticas'/m);
    expect(activeMain).not.toContain("<Estadisticas");
    expect(appSource).toContain("if (p === 'estadisticas') return");
  });

  it("retira la pantalla y la consulta de destinatarios globales", () => {
    expect(pagesSource).not.toContain('export function Alertas');
    expect(pagesSource).not.toContain('Destinatarios globales anteriores');
    expect(pagesSource).not.toContain('getNotificationEmailConfig');
  });

  it("no presenta actividad mock ni un estado de ejecucion no verificado como real", () => {
    expect(appSource).not.toContain("06/10/2026 08:32");
    expect(appSource).not.toContain("aria-label=\"Notificaciones\"");
    expect(pagesSource).not.toContain("NOTIFS");
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
