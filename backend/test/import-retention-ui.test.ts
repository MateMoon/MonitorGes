// @vitest-environment jsdom
import { createElement, type ComponentType } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({ validate: vi.fn(), import: vi.fn() }));
vi.mock("../../src/services/importaciones", () => ({ validateImportFile: api.validate, importFile: api.import, compareImportFile: vi.fn(), getImportHistory: vi.fn() }));
const modulePath = "../../src/pages/pages2.tsx";
const { Importar } = await import(modulePath) as { Importar: ComponentType<any> };
beforeEach(() => {
  api.validate.mockReset().mockResolvedValue({ filasLeidas: 3, filasValidas: 3, filasConErrores: 0, vistaPrevia: [{ numeroFila: 2 }], errores: [] });
  api.import.mockReset();
});
afterEach(cleanup);
async function confirm() {
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(["synthetic"], "sintetico.xlsx")] } });
  fireEvent.click(screen.getByRole("button", { name: /Validar archivo/ }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar e importar" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Confirmar e importar" }));
}
const result = { nombreArchivo: "sintetico.xlsx", filasLeidas: 3, estado: "COMPLETADA_CON_OBSERVACIONES", registrosNuevos: 1, registrosActualizados: 0, registrosSinCambios: 0, registrosConError: 0, registrosPendientesRevision: 1, registrosRepetidosOmitidos: 1, registrosInvalidos: 0, errores: [] };
it("explica los pendientes y distingue repeticiones sin añadir una bandeja", async () => {
  api.import.mockResolvedValue(result);
  render(createElement(Importar, { nav: vi.fn(), toast: vi.fn() }));
  await confirm();
  expect(await screen.findByText("La nómina se procesó. Algunas filas necesitan revisión y no se incorporaron todavía como garantías.")).toBeTruthy();
  expect(screen.getByText("Pendientes de revisión: 1")).toBeTruthy();
  expect(screen.getByText("Repeticiones equivalentes omitidas")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Revisar" })).toBeNull();
});
it("reutiliza el UUID al reintentar después de una respuesta perdida", async () => {
  api.import.mockRejectedValueOnce(new Error("Respuesta interrumpida")).mockResolvedValueOnce(result);
  render(createElement(Importar, { nav: vi.fn(), toast: vi.fn() }));
  await confirm();
  await screen.findByText("Respuesta interrumpida");
  fireEvent.click(screen.getByRole("button", { name: "Confirmar e importar" }));
  await screen.findByText("Pendientes de revisión: 1");
  expect(api.import.mock.calls[0][2]).toMatch(/^[0-9a-f-]{36}$/);
  expect(api.import.mock.calls[1][2]).toBe(api.import.mock.calls[0][2]);
});
it("acepta respuestas antiguas sin contadores de retención", async () => {
  api.import.mockResolvedValue({ ...result, estado: "COMPLETADA", registrosPendientesRevision: undefined, registrosRepetidosOmitidos: undefined, registrosInvalidos: undefined });
  render(createElement(Importar, { nav: vi.fn(), toast: vi.fn() }));
  await confirm();
  await screen.findByText("Importación completada");
  expect(screen.queryByText(/Pendientes de revisión:/)).toBeNull();
});
