import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(resolve(process.cwd(), "../src/pages/ConfiguracionUsuarios.tsx"), "utf8");
const service = readFileSync(resolve(process.cwd(), "../src/services/usuarios.ts"), "utf8");

describe("gestión de perfiles y permiso de importación en la ficha de usuario", () => {
  it("presenta los cuatro perfiles y el control de carga de nóminas", () => {
    expect(page).toContain('value="ADMIN">Administrador');
    expect(page).toContain('value="COORDINADOR_SOME">Coordinador SOME');
    expect(page).toContain('value="PROFESIONAL">Profesional gestor');
    expect(page).toContain('value="LECTOR">Lector');
    expect(page).toContain("Puede cargar nóminas");
  });

  it("envía y recibe el permiso individual en las operaciones de usuario", () => {
    expect(page).toContain("puedeCargarNominas:u.puedeCargarNominas");
    expect(service).toContain("puedeCargarNominas: boolean");
    expect(service).toContain("'puedeCargarNominas' | 'activo'");
  });
});
