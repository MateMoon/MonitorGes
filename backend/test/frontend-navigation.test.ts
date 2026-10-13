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

  it("presenta carga, errores y confirmación en la configuración del destinatario", () => {
    expect(pagesSource).toContain('type="email" required');
    expect(pagesSource).toContain("Guardar configuración");
    expect(pagesSource).toContain("role=\"alert\" className=\"rounded-lg bg-[#fbe7e5]");
    expect(pagesSource).toContain("emailSaveError");
    expect(pagesSource).toContain("La dirección destinataria se guardó correctamente.");
  });
});
