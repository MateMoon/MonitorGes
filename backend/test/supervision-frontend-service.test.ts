// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const servicePath = "../../src/services/supervision.ts";
const { getSupervisionSummary, getSupervisionActivity } = await import(servicePath);
const fetchMock = vi.fn();
const empty = () => ({
  fechaReferencia: "2026-11-18", zonaHoraria: "America/Santiago", generadoAt: "2026-11-18T13:00:00Z", alcance: "GLOBAL",
  indicadores: { totalGarantias: 0, pendientesResolucion: 0, enGestion: 0, cumplidas: 0, vencidasNoCumplidas: 0, proximas15DiasNoCumplidas: 0 },
  cobertura: { sinProfesional: 0, unProfesional: 0, variosProfesionales: 0, sinProfesionalNoCumplidas: 0 },
  criteriosCobertura: { rol: "PROFESIONAL", soloActivos: true, profesionalesActivos: 0, profesionalesConReglasEfectivas: 0 },
  distribuciones: { soloNoCumplidas: true, permiteSuperposicionEntreProfesionales: true, porProblemaSalud: [], porEstablecimiento: [], porProfesional: [] },
  prioritarios: [],
});

const activity = () => ({ generadoAt: "2026-11-18T13:00:00Z", zonaHoraria: "America/Santiago", alcance: "GLOBAL", limite: 30, eventos: [{
  id: "event-1", secuencia: 1, tipo: "ANTECEDENTE_LEGADO", tipoActuacion: null, comentario: null, estadoAnterior: null, estadoNuevo: null,
  respaldo: null, createdAt: "2026-11-17T13:00:00Z", autorNombre: null, usuarioId: null,
  garantia: { id: "case-1", paciente: { nombre: "Caso sintético" }, problemaSalud: "Diabetes", nombreGarantia: "Tratamiento", establecimiento: "Centro Norte", estadoGestion: "EN_GESTION" },
}] });

describe("servicio frontend de gestiones y cambios", () => {
  it("usa el endpoint autenticado sin caché y admite antecedentes con campos nulos", async () => {
    const data = activity(); respond({ data });
    const controller = new AbortController();
    expect(await getSupervisionActivity(controller.signal)).toEqual(data);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/supervision/eventos");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include", cache: "no-store", signal: controller.signal });
  });
  it.each(["missing-events", "too-many", "bad-date", "bad-type", "bad-state", "missing-author", "missing-case", "bad-action"])("rechaza el historial inválido: %s", async (kind) => {
    const data: any = activity(); const event = data.eventos[0];
    if (kind === "missing-events") delete data.eventos;
    if (kind === "too-many") data.eventos = Array.from({ length: 31 }, () => event);
    if (kind === "bad-date") event.createdAt = "invalid";
    if (kind === "bad-type") event.tipo = "IMPORTACION";
    if (kind === "bad-state") event.estadoAnterior = "invalid";
    if (kind === "missing-author") delete event.autorNombre;
    if (kind === "missing-case") delete event.garantia;
    if (kind === "bad-action") event.tipoActuacion = "invalid";
    respond({ data });
    await expect(getSupervisionActivity()).rejects.toMatchObject({ code: "INVALID_SUPERVISION_ACTIVITY_RESPONSE" });
  });
  it.each(["UNAUTHENTICATED", "FORBIDDEN", "SUPERVISION_ACTIVITY_UNAVAILABLE"])("propaga %s sin devolver un historial vacío", async (code) => {
    respond({ error: { code, message: "No disponible", details: [] } }, code === "UNAUTHENTICATED" ? 401 : code === "FORBIDDEN" ? 403 : 503);
    await expect(getSupervisionActivity()).rejects.toMatchObject({ code });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("conserva la cancelación sin reintentar", async () => {
    fetchMock.mockRejectedValue(new DOMException("Aborted", "AbortError"));
    await expect(getSupervisionActivity()).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());
const respond = (body: unknown, status = 200) => fetchMock.mockResolvedValue({ ok: status < 400, status, json: async () => body });

describe("servicio frontend de supervisión", () => {
  it.each([0, 1, 2])("admite los nombres de %i funcionarios en un caso prioritario", async (quantity) => {
    const data: any = empty();
    data.prioritarios = [{ id: "case-1", paciente: { nombre: "Caso sintético" }, problemaSalud: "Diabetes", nombreGarantia: "Tratamiento", establecimiento: "Centro Norte", fechaLimite: "2026-11-17", estadoGestion: "EN_GESTION", estadoVencimiento: "vencida", diasRestantes: -1, cantidadProfesionalesCoincidentes: quantity, profesionalesCoincidentes: Array.from({ length: quantity }, (_, index) => ({ usuarioId: `user-${index}`, nombre: `Funcionario de prueba ${index}` })), motivosPrioridad: ["VENCIDA"], prioridad: 1 }];
    respond({ data });
    expect(await getSupervisionSummary()).toEqual(data);
    if (quantity) {
      data.prioritarios[0].profesionalesCoincidentes.pop();
      await expect(getSupervisionSummary()).rejects.toMatchObject({ code: "INVALID_SUPERVISION_RESPONSE" });
    }
  });
  it("consulta exclusivamente el endpoint real con sesión, señal de cancelación y sin caché", async () => {
    const data = empty(); respond({ data });
    const controller = new AbortController();
    expect(await getSupervisionSummary(controller.signal)).toEqual(data);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/supervision/resumen");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include", cache: "no-store", signal: controller.signal });
  });
  it.each(["UNAUTHENTICATED", "FORBIDDEN", "SUPERVISION_UNAVAILABLE"])("conserva el error %s sin devolver indicadores alternativos", async (code) => {
    respond({ error: { code, message: "Consulta no disponible", details: [] } }, code === "UNAUTHENTICATED" ? 401 : code === "FORBIDDEN" ? 403 : 503);
    await expect(getSupervisionSummary()).rejects.toMatchObject({ code, message: "Consulta no disponible" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["missing", "negative", "wrong-count", "missing-distribution", "invalid-time"])("rechaza una respuesta incompleta o inválida: %s", async (kind) => {
    const data: any = empty();
    if (kind === "missing") delete data.indicadores;
    if (kind === "negative") data.cobertura.sinProfesionalNoCumplidas = -1;
    if (kind === "wrong-count") data.indicadores.totalGarantias = "0";
    if (kind === "missing-distribution") delete data.distribuciones.porProfesional;
    if (kind === "invalid-time") data.generadoAt = "invalid";
    respond({ data });
    await expect(getSupervisionSummary()).rejects.toMatchObject({ code: "INVALID_SUPERVISION_RESPONSE" });
  });
  it("propaga una cancelación sin reintentar ni inventar datos", async () => {
    fetchMock.mockRejectedValue(new DOMException("Aborted", "AbortError"));
    await expect(getSupervisionSummary()).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
