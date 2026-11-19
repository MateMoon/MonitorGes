// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const path = "../../src/services/responsabilidades.ts";
const { getResponsibilities, saveResponsibilities } = await import(path);
const fetchMock = vi.fn();
const staff = { id: "staff-1", nombre: "Funcionaria sintética", rol: "PROFESIONAL", activo: true, reglasAsignacion: [], revision: "a".repeat(64) };
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());
describe("servicio frontend de responsabilidades", () => {
  it("consulta el endpoint específico con sesión, cancelación y sin caché", async () => {
    const data = { funcionarios: [staff], opciones: { problemasSalud: [], establecimientos: [], tiposGarantia: [] } };
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data }) });
    const controller = new AbortController();
    expect(await getResponsibilities(controller.signal)).toEqual(data);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/supervision/responsabilidades");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include", cache: "no-store", signal: controller.signal });
  });
  it("guarda solo reglas y revisión, sin campos de administración de usuarios", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: staff }) });
    const rules = [{ problemaSalud: "diabetes", establecimiento: "", tipoGarantia: "tratamiento" }];
    expect(await saveResponsibilities(staff, rules)).toEqual(staff);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/supervision/responsabilidades/staff-1");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include", cache: "no-store", method: "PUT" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ reglasAsignacion: rules, revision: staff.revision });
  });
  it.each(["FORBIDDEN", "UNAUTHENTICATED", "STALE_ASSIGNMENT_RULES", "RESPONSIBILITIES_UNAVAILABLE"])("conserva %s sin reintentar ni devolver datos de respaldo", async (code) => {
    fetchMock.mockResolvedValue({ ok: false, status: code === "FORBIDDEN" ? 403 : code === "UNAUTHENTICATED" ? 401 : code === "STALE_ASSIGNMENT_RULES" ? 409 : 503, json: async () => ({ error: { code, message: "No disponible", details: [] } }) });
    await expect(saveResponsibilities(staff, [])).rejects.toMatchObject({ code });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
