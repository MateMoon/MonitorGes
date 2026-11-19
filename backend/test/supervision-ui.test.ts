// @vitest-environment jsdom
import { createElement, type ComponentType } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

const api = vi.hoisted(() => ({ summary: vi.fn(), activity: vi.fn(), current: vi.fn(), logout: vi.fn(), detail: vi.fn(), responsibilities: vi.fn(), saveRules: vi.fn() }));
vi.mock("../../src/services/supervision", () => ({ getSupervisionSummary: api.summary, getSupervisionActivity: api.activity }));
vi.mock("../../src/services/responsabilidades", () => ({ getResponsibilities: api.responsibilities, saveResponsibilities: api.saveRules }));
vi.mock("../../src/services/auth", () => ({ getCurrentUser: api.current, logout: api.logout, login: vi.fn() }));
vi.mock("../../src/services/garantias", async (original) => ({ ...await original<object>(), getGarantiaById: api.detail }));
vi.mock("../../src/pages/pages1", async (original) => ({
  ...await original<object>(),
  Dashboard: ({ nav }: any) => createElement("button", { onClick: () => nav("supervision") }, "Intentar acceso directo"),
  Login: () => createElement("p", null, "Inicio de sesión de prueba"),
}));
const pagePath = "../../src/pages/SupervisionSome.tsx";
const appPath = "../../src/App.tsx";
const apiPath = "../../src/services/api.ts";
type Props = { isAdmin: boolean; isCoordinator?: boolean; nav: (...args: any[]) => void; onSessionExpired: () => void };
const { default: SupervisionSome } = await import(pagePath) as { default: ComponentType<Props> };
const { default: App } = await import(appPath) as { default: ComponentType };
const { ApiError } = await import(apiPath);

// Synthetic UI fixtures only; runtime data always comes from the authenticated API.
const caseId = "00000000-0000-4000-8000-000000000001";
const summary = {
  fechaReferencia: "2026-11-18", zonaHoraria: "America/Santiago", generadoAt: "2026-11-18T13:00:00.000Z", alcance: "GLOBAL",
  indicadores: { totalGarantias: 81, pendientesResolucion: 13, enGestion: 26, cumplidas: 7, vencidasNoCumplidas: 12, proximas15DiasNoCumplidas: 22 },
  cobertura: { sinProfesional: 10, unProfesional: 31, variosProfesionales: 40, sinProfesionalNoCumplidas: 9 },
  criteriosCobertura: { rol: "PROFESIONAL", soloActivos: true, profesionalesActivos: 3, profesionalesConReglasEfectivas: 2 },
  distribuciones: {
    soloNoCumplidas: true, permiteSuperposicionEntreProfesionales: true,
    porProblemaSalud: [{ problemaSalud: "Diabetes", cantidad: 41 }, { problemaSalud: "Hipertensión", cantidad: 33 }],
    porEstablecimiento: [{ establecimiento: "Centro Norte", cantidad: 54 }, { establecimiento: "Centro Sur", cantidad: 20 }],
    porProfesional: [{ usuarioId: "one", nombre: "Profesional de prueba A", cantidad: 46 }, { usuarioId: "two", nombre: "Profesional de prueba B", cantidad: 37 }],
  },
  prioritarios: [
    { id: caseId, paciente: { nombre: "Caso sintético uno" }, problemaSalud: "Diabetes", nombreGarantia: "Tratamiento", establecimiento: "Centro Norte", fechaLimite: "2026-11-17", estadoGestion: "EN_GESTION", estadoVencimiento: "vencida", diasRestantes: -1, cantidadProfesionalesCoincidentes: 2, profesionalesCoincidentes: [{ usuarioId: "one", nombre: "Profesional de prueba A" }, { usuarioId: "two", nombre: "Profesional de prueba B" }], motivosPrioridad: ["VENCIDA"], prioridad: 1 },
    { id: "00000000-0000-4000-8000-000000000002", paciente: { nombre: "Caso sintético dos" }, problemaSalud: "Hipertensión", nombreGarantia: "Diagnóstico", establecimiento: "Centro Sur", fechaLimite: "2026-12-28", estadoGestion: "SIN_GESTION", estadoVencimiento: "normal", diasRestantes: 40, cantidadProfesionalesCoincidentes: 0, profesionalesCoincidentes: [], motivosPrioridad: ["SIN_PROFESIONAL_ACTIVO"], prioridad: 3 },
  ],
};
const nav = vi.fn();
const activity = {
  generadoAt: "2026-11-18T13:00:00Z", zonaHoraria: "America/Santiago", alcance: "GLOBAL", limite: 30,
  eventos: [
    { id: "reopen", secuencia: 5, tipo: "REAPERTURA", tipoActuacion: null, comentario: "Es necesario corregir el respaldo", estadoAnterior: "CUMPLIDA", estadoNuevo: "EN_GESTION", respaldo: null, createdAt: "2026-11-18T12:30:00Z", autorNombre: "Autor histórico", usuarioId: "user-1" },
    { id: "complete", secuencia: 4, tipo: "CUMPLIMIENTO", tipoActuacion: null, comentario: null, estadoAnterior: "EN_GESTION", estadoNuevo: "CUMPLIDA", respaldo: "Documento de prueba", createdAt: "2026-11-18T12:20:00Z", autorNombre: "Autor histórico", usuarioId: "user-1" },
    { id: "change", secuencia: 3, tipo: "CAMBIO_ESTADO", tipoActuacion: null, comentario: "Requiere resolución", estadoAnterior: "EN_GESTION", estadoNuevo: "PENDIENTE_RESOLUCION", respaldo: null, createdAt: "2026-11-18T12:10:00Z", autorNombre: "Autor histórico", usuarioId: "user-1" },
    { id: "action", secuencia: 2, tipo: "ACTUACION", tipoActuacion: "CITACION", comentario: "Comentario extenso de prueba. ".repeat(30), estadoAnterior: "EN_GESTION", estadoNuevo: "EN_GESTION", respaldo: null, createdAt: "2026-11-18T12:00:00Z", autorNombre: "Autor histórico", usuarioId: "user-1" },
    { id: "legacy", secuencia: 1, tipo: "ANTECEDENTE_LEGADO", tipoActuacion: null, comentario: null, estadoAnterior: null, estadoNuevo: null, respaldo: null, createdAt: "2026-11-17T12:00:00Z", autorNombre: null, usuarioId: null },
  ].map((event) => ({ ...event, garantia: { id: caseId, paciente: { nombre: "Caso sintético uno" }, problemaSalud: "Diabetes", nombreGarantia: "Tratamiento", establecimiento: "Centro Norte", estadoGestion: "EN_GESTION" } })),
};
const expired = vi.fn();
const props = { isAdmin: true, nav, onSessionExpired: expired };
const responsibilities = {
  funcionarios: [{ id: "staff-1", nombre: "Funcionaria sintética", rol: "PROFESIONAL", activo: true, revision: "a".repeat(64), reglasAsignacion: [{ problemaSalud: "diabetes", establecimiento: "centro norte", tipoGarantia: "tratamiento" }] }],
  opciones: { problemasSalud: [{ claveNormalizada: "diabetes", nombre: "Diabetes" }], establecimientos: [{ claveNormalizada: "centro norte", nombre: "Centro Norte" }], tiposGarantia: [{ claveNormalizada: "tratamiento", nombre: "Tratamiento" }] },
};
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
beforeEach(() => {
  vi.resetAllMocks();
  api.summary.mockResolvedValue(structuredClone(summary));
  api.activity.mockResolvedValue(structuredClone(activity));
  api.responsibilities.mockResolvedValue(structuredClone(responsibilities));
  api.saveRules.mockImplementation(async (staff: any, rules: any) => ({ ...staff, reglasAsignacion: rules, revision: "b".repeat(64) }));
  api.current.mockResolvedValue({ id: "admin", nombre: "Cuenta de prueba", username: "test", email: "test@example.test", rol: "ADMIN", puedeCargarNominas: false });
  api.logout.mockResolvedValue(undefined);
  api.detail.mockResolvedValue({ id: caseId, nombre: "Caso sintético uno", rut: "00000000", dv: "0", problema: "Diabetes", garantia: "Tratamiento", responsable: "Centro Norte", inicio: new Date("2026-10-01T12:00:00Z"), limite: new Date("2026-11-17T12:00:00Z"), dias: -1, estado: "vencida", estadoGestion: "EN_GESTION", revisionGestion: 0, gestionadaAt: null, gestionadaPor: null, eventos: [] });
  window.scrollTo = vi.fn();
});
afterEach(cleanup);

describe("Supervisión SOME: datos y estados de la pantalla", () => {
  it("muestra carga sin ceros ni datos de respaldo y cancela la consulta al desmontar", () => {
    api.summary.mockReturnValue(new Promise(() => {}));
    const view = render(createElement(SupervisionSome, props));
    expect(screen.getByRole("status").textContent).toContain("Cargando resumen");
    expect(screen.queryByLabelText("Indicadores de supervisión")).toBeNull();
    const signal = api.summary.mock.calls[0][0] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
  it("muestra los seis indicadores, las distribuciones y la superposición sin sumar profesionales", async () => {
    render(createElement(SupervisionSome, props));
    const indicators = within(await screen.findByLabelText("Indicadores de supervisión"));
    for (const [label, value] of [["Total de garantías", "81"], ["Pendientes de resolución", "13"], ["En gestión", "26"], ["Cumplidas", "7"], ["Vencidas no cumplidas", "12"], ["Próximas a vencer", "22"]]) {
      expect(indicators.getByRole("heading", { name: label }).parentElement?.textContent).toContain(value);
    }
    expect(screen.getByRole("note").textContent).toContain("9 garantías no cumplidas");
    const professionals = within(screen.getByRole("list", { name: "Garantías coincidentes por profesional" }));
    expect(professionals.getByText("Profesional de prueba A")).toBeTruthy();
    expect(professionals.getByText("46")).toBeTruthy();
    expect(professionals.getByText("37")).toBeTruthy();
    expect(screen.getByText(/Las cantidades pueden superponerse/)).toBeTruthy();
    expect(screen.queryByText("83")).toBeNull();
    expect(screen.getByRole("list", { name: "Por establecimiento" }).textContent).toContain("Centro Norte");
    expect(screen.queryByRole("button", { name: /Ver todos los casos/ })).toBeNull();
    expect(screen.getByRole("tab", { name: "Responsabilidades" })).toBeTruthy();
    expect(screen.queryByText("Calidad de datos")).toBeNull();
  });
  it("mantiene el orden recibido y abre el detalle por ID con fila y con botón accesible", async () => {
    render(createElement(SupervisionSome, props));
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows[1].textContent).toContain("Caso sintético uno");
    expect(rows[2].textContent).toContain("Caso sintético dos");
    expect(rows[1].textContent).toContain("En gestión");
    expect(rows[1].textContent).toContain("Tratamiento");
    expect(within(rows[1]).getByRole("list", { name: "Funcionarios a cargo" }).textContent).toContain("Profesional de prueba A");
    expect(rows[1].textContent).toContain("Profesional de prueba B");
    expect(rows[1].textContent).not.toContain("2 profesionales");
    expect(rows[2].textContent).toContain("Sin funcionario asociado");
    fireEvent.click(rows[1]);
    expect(nav).toHaveBeenLastCalledWith("detalle", { id: caseId });
    nav.mockClear();
    await userEvent.setup().click(screen.getByRole("button", { name: "Abrir detalle de Caso sintético uno" }));
    expect(nav).toHaveBeenCalledTimes(1);
    expect(nav).toHaveBeenCalledWith("detalle", { id: caseId });
  });
  it("muestra el nombre completo cuando coincide un solo funcionario", async () => {
    const data = structuredClone(summary);
    data.prioritarios[0].cantidadProfesionalesCoincidentes = 1;
    data.prioritarios[0].profesionalesCoincidentes = [{ usuarioId: "one", nombre: "Funcionaria de prueba con nombres y apellidos extensos" }];
    api.summary.mockResolvedValue(data);
    render(createElement(SupervisionSome, props));
    const table = await screen.findByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Funcionarios a cargo" })).toBeTruthy();
    expect(within(table).getByText("Funcionaria de prueba con nombres y apellidos extensos")).toBeTruthy();
    expect(table.textContent).not.toContain("1 profesional");
  });
  it("un error muestra reintento sin indicadores ficticios y una recuperación carga los datos", async () => {
    api.summary.mockRejectedValueOnce(new ApiError("Resumen temporalmente no disponible.", [], "SUPERVISION_UNAVAILABLE"));
    render(createElement(SupervisionSome, props));
    expect((await screen.findByRole("alert")).textContent).toContain("Resumen temporalmente no disponible");
    expect(screen.queryByLabelText("Indicadores de supervisión")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByLabelText("Indicadores de supervisión");
    expect(api.summary).toHaveBeenCalledTimes(2);
  });
  it("trata una sesión expirada sin reintentar automáticamente y permite volver al login", async () => {
    api.summary.mockRejectedValueOnce(new ApiError("Sesión expirada", [], "UNAUTHENTICATED"));
    render(createElement(SupervisionSome, props));
    expect((await screen.findByRole("alert")).textContent).toContain("Sesión no válida");
    await userEvent.setup().click(screen.getByRole("button", { name: "Volver a iniciar sesión" }));
    expect(expired).toHaveBeenCalledTimes(1);
    expect(api.summary).toHaveBeenCalledTimes(1);
  });
  it("un 403 muestra acceso restringido y no presenta ni conserva datos globales", async () => {
    api.summary.mockRejectedValueOnce(new ApiError("Sin permiso", [], "FORBIDDEN"));
    render(createElement(SupervisionSome, props));
    expect((await screen.findByRole("alert")).textContent).toContain("Acceso restringido");
    expect(screen.queryByLabelText("Indicadores de supervisión")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Volver al dashboard" }));
    expect(nav).toHaveBeenCalledWith("dashboard");
  });
  it("presenta una respuesta vacía real y omite el aviso cuando la cobertura operativa es cero", async () => {
    api.summary.mockResolvedValue({ ...summary, indicadores: Object.fromEntries(Object.keys(summary.indicadores).map((key) => [key, 0])), cobertura: { sinProfesional: 0, unProfesional: 0, variosProfesionales: 0, sinProfesionalNoCumplidas: 0 }, distribuciones: { ...summary.distribuciones, porProblemaSalud: [], porEstablecimiento: [], porProfesional: [] }, prioritarios: [] });
    render(createElement(SupervisionSome, props));
    expect(await screen.findByText("Sin garantías registradas")).toBeTruthy();
    expect(screen.getByText("Sin casos prioritarios")).toBeTruthy();
    expect(screen.queryByRole("note")).toBeNull();
    expect(within(screen.getByLabelText("Indicadores de supervisión")).getAllByText("0")).toHaveLength(6);
  });
  it("no consulta para otros perfiles aunque se intente montar la pantalla directamente", () => {
    render(createElement(SupervisionSome, { ...props, isAdmin: false }));
    expect(screen.getByText("Acceso restringido")).toBeTruthy();
    expect(api.summary).not.toHaveBeenCalled();
  });
  it("no repite la consulta por rerenders y solo actualiza bajo petición", async () => {
    const view = render(createElement(SupervisionSome, props));
    await screen.findByLabelText("Indicadores de supervisión");
    view.rerender(createElement(SupervisionSome, { ...props, nav: vi.fn() }));
    expect(api.summary).toHaveBeenCalledTimes(1);
    await userEvent.setup().click(screen.getByRole("button", { name: "Actualizar" }));
    await waitFor(() => expect(api.summary).toHaveBeenCalledTimes(2));
  });
});

describe("Supervisión SOME: menú y navegación real de App", () => {
  it("ADMIN abre la sección desde el menú y pasa al detalle real mediante el ID", async () => {
    render(createElement(App));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Supervisión SOME" }));
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Abrir detalle de Caso sintético uno" }));
    expect(await screen.findByRole("heading", { name: "Detalle de garantía", level: 2 })).toBeTruthy();
    expect(api.detail).toHaveBeenCalledWith(caseId, expect.any(AbortSignal));
    expect(screen.getByRole("heading", { name: "Información del paciente" })).toBeTruthy();
    expect(api.summary).toHaveBeenCalledTimes(1);
  });
  it.each(["PROFESIONAL", "LECTOR"])("%s no ve el menú ni puede entrar mediante navegación interna", async (role) => {
    api.current.mockResolvedValue({ id: "restricted", nombre: "Cuenta de prueba", rol: role, puedeCargarNominas: true });
    render(createElement(App));
    const attempt = await screen.findByRole("button", { name: "Intentar acceso directo" });
    expect(screen.queryByRole("button", { name: "Supervisión SOME" })).toBeNull();
    await userEvent.setup().click(attempt);
    expect(screen.getByRole("button", { name: "Intentar acceso directo" })).toBeTruthy();
    expect(api.summary).not.toHaveBeenCalled();
  });
});

const openActivity = async () => {
  await userEvent.setup().click(screen.getByRole("tab", { name: "Gestiones y cambios" }));
};

const openResponsibilities = async () => {
  await userEvent.setup().click(screen.getByRole("tab", { name: "Responsabilidades" }));
  await screen.findByLabelText("Responsabilidades de funcionarios");
};
describe("Supervisión SOME: responsabilidades con la configuración compartida", () => {
  it("no presenta administradores ni permite abrir su editor desde Responsabilidades", async () => {
    api.responsibilities.mockResolvedValue({ ...responsibilities, funcionarios: [...responsibilities.funcionarios, { ...responsibilities.funcionarios[0], id: "admin", rol: "ADMIN", nombre: "Cuenta administradora protegida" }] });
    render(createElement(SupervisionSome, props)); await openResponsibilities();
    expect(screen.queryByText("Cuenta administradora protegida")).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar reglas de Cuenta administradora protegida" })).toBeNull();
    expect(screen.getByRole("button", { name: "Editar reglas de Funcionaria sintética" })).toBeTruthy();
  });
  it("COORDINADOR entra desde App únicamente a Responsabilidades, sin consultas globales ni Gestión de usuarios", async () => {
    api.current.mockResolvedValue({ id: "coordinator", nombre: "Cuenta de prueba", rol: "COORDINADOR_SOME", puedeCargarNominas: false });
    render(createElement(App)); const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Supervisión SOME" }));
    await screen.findByLabelText("Responsabilidades de funcionarios");
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "Responsabilidades" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Resumen" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Gestiones y cambios" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Gestión de usuarios" })).toBeNull();
    expect(api.summary).not.toHaveBeenCalled(); expect(api.activity).not.toHaveBeenCalled();
    expect(api.responsibilities).toHaveBeenCalledTimes(1);
  });
  it("ADMIN consulta las reglas reales al visitar la pestaña y no repite la consulta al alternar", async () => {
    render(createElement(SupervisionSome, props));
    await screen.findByLabelText("Indicadores de supervisión");
    expect(api.responsibilities).not.toHaveBeenCalled();
    await openResponsibilities();
    const list = screen.getByRole("list", { name: "Funcionarios autorizados" });
    expect(list.textContent).toContain("Funcionaria sintética");
    expect(list.textContent).toContain("Diabetes · Centro Norte · Tratamiento");
    await userEvent.setup().click(screen.getByRole("tab", { name: "Resumen" }));
    await openResponsibilities();
    expect(api.responsibilities).toHaveBeenCalledTimes(1);
  });
  it("permite agregar y eliminar grupos, valida grupos vacíos y requiere guardado explícito para borrar reglas", async () => {
    render(createElement(SupervisionSome, props)); await openResponsibilities(); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Editar reglas de Funcionaria sintética" }));
    expect(screen.queryByLabelText("Perfil de acceso")).toBeNull();
    expect(screen.queryByLabelText("Correo electrónico")).toBeNull();
    expect(screen.queryByLabelText("Usuario activo")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Agregar otro grupo" }));
    await user.click(screen.getByRole("button", { name: "Guardar reglas" }));
    expect(screen.getByRole("alert").textContent).toContain("Selecciona al menos un criterio");
    expect(api.saveRules).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Eliminar grupo 2" }));
    await user.click(screen.getByRole("button", { name: "Limpiar grupo 1" }));
    expect(api.saveRules).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Guardar reglas" }));
    await waitFor(() => expect(api.saveRules).toHaveBeenCalledWith(responsibilities.funcionarios[0], []));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Sin reglas de asignación.")).toBeTruthy();
    expect(api.summary).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("tab", { name: "Resumen" }));
    await waitFor(() => expect(api.summary).toHaveBeenCalledTimes(2));
  });
  it("edita los criterios con el mismo combolist y conserva los errores sin perder el borrador", async () => {
    api.saveRules.mockRejectedValueOnce(new ApiError("Servicio temporalmente no disponible", [], "RESPONSIBILITIES_UNAVAILABLE"));
    render(createElement(SupervisionSome, props)); await openResponsibilities(); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Editar reglas de Funcionaria sintética" }));
    await user.click(screen.getByRole("combobox", { name: "Establecimientos, grupo 1" }));
    await user.click(within(screen.getByRole("listbox", { name: "Opciones de Establecimientos, grupo 1" })).getByRole("option", { name: "Cualquier establecimiento" }));
    await user.click(screen.getByRole("button", { name: "Guardar reglas" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Servicio temporalmente no disponible");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(api.saveRules).toHaveBeenLastCalledWith(responsibilities.funcionarios[0], [{ problemaSalud: "diabetes", establecimiento: "", tipoGarantia: "tratamiento" }]);
    await user.click(screen.getByRole("button", { name: "Guardar reglas" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("list", { name: "Funcionarios autorizados" }).textContent).toContain("Cualquier establecimiento");
  });
  it("un conflicto conserva la selección y bloquea el guardado hasta recargar", async () => {
    api.saveRules.mockRejectedValueOnce(new ApiError("Las reglas cambiaron", [], "STALE_ASSIGNMENT_RULES"));
    render(createElement(SupervisionSome, props)); await openResponsibilities(); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Editar reglas de Funcionaria sintética" }));
    await user.click(screen.getByRole("button", { name: "Guardar reglas" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Las reglas cambiaron");
    expect((screen.getByRole("button", { name: "Guardar reglas" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Quitar Diabetes de Problemas de salud, grupo 1" })).toBeTruthy();
    expect(api.saveRules).toHaveBeenCalledTimes(1);
  });
  it("evita solicitudes duplicadas mientras guarda y protege el borrador al cerrar", async () => {
    api.saveRules.mockReturnValue(new Promise(() => {}));
    render(createElement(SupervisionSome, props)); await openResponsibilities(); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Editar reglas de Funcionaria sintética" }));
    await user.click(screen.getByRole("button", { name: "Limpiar grupo 1" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Seguir editando" }));
    await user.click(screen.getByRole("button", { name: "Guardar reglas" }));
    expect((screen.getByRole("button", { name: "Guardando…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cerrar ventana" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.saveRules).toHaveBeenCalledTimes(1);
  });
  it.each(["UNAUTHENTICATED", "FORBIDDEN", "RESPONSIBILITIES_UNAVAILABLE"])("trata el error de consulta %s y permite recuperarse", async (code) => {
    api.responsibilities.mockRejectedValueOnce(new ApiError("Consulta no disponible", [], code));
    render(createElement(SupervisionSome, { ...props, isAdmin: false, isCoordinator: true }));
    await screen.findByRole("alert");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: code === "UNAUTHENTICATED" ? "Volver a iniciar sesión" : code === "FORBIDDEN" ? "Volver al dashboard" : "Reintentar" }));
    if (code === "UNAUTHENTICATED") expect(expired).toHaveBeenCalledTimes(1);
    else if (code === "FORBIDDEN") expect(nav).toHaveBeenCalledWith("dashboard");
    else await screen.findByLabelText("Responsabilidades de funcionarios");
    expect(api.summary).not.toHaveBeenCalled();
  });
  it("presenta una lista vacía real sin funcionarios de respaldo", async () => {
    api.responsibilities.mockResolvedValue({ ...responsibilities, funcionarios: [] });
    render(createElement(SupervisionSome, { ...props, isAdmin: false, isCoordinator: true }));
    expect(await screen.findByText("Sin funcionarios autorizados")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Editar reglas de/ })).toBeNull();
  });
  it("muestra carga y cancela la lectura cuando se abandona la pantalla", () => {
    api.responsibilities.mockReturnValue(new Promise(() => {}));
    const view = render(createElement(SupervisionSome, { ...props, isAdmin: false, isCoordinator: true }));
    expect(screen.getByRole("status").textContent).toContain("Cargando responsabilidades");
    const signal = api.responsibilities.mock.calls[0][0] as AbortSignal;
    view.unmount(); expect(signal.aborted).toBe(true);
  });
});
describe("Supervisión SOME: gestiones y cambios", () => {
  it("consulta al abrir la pestaña y conserva ambos paneles al alternar sin nuevas solicitudes", async () => {
    render(createElement(SupervisionSome, props));
    await screen.findByLabelText("Indicadores de supervisión");
    expect(api.activity).not.toHaveBeenCalled();
    await openActivity();
    await screen.findByLabelText("Actividad de supervisión");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("tab", { name: "Gestiones y cambios" }).getAttribute("aria-selected")).toBe("true");
    await userEvent.setup().click(screen.getByRole("tab", { name: "Resumen" }));
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.queryByLabelText("Actividad de supervisión")).toBeTruthy();
    await openActivity();
    expect(api.summary).toHaveBeenCalledTimes(1);
    expect(api.activity).toHaveBeenCalledTimes(1);
    await userEvent.setup().click(screen.getByRole("button", { name: "Actualizar historial" }));
    await waitFor(() => expect(api.activity).toHaveBeenCalledTimes(2));
    expect(api.summary).toHaveBeenCalledTimes(1);
  });
  it("presenta los cinco tipos, autor histórico, fecha, actuación y cambios de estado en el orden recibido", async () => {
    render(createElement(SupervisionSome, props)); await openActivity();
    const list = within(await screen.findByRole("list", { name: "Eventos de gestión" }));
    const rows = list.getAllByRole("listitem");
    expect(rows.map((row) => within(row).getByRole("heading").textContent)).toEqual(["Garantía reabierta", "Cumplimiento acreditado", "Cambio de estado", "Actuación registrada", "Antecedente legado"]);
    expect(rows[0].textContent).toContain("Autor histórico");
    expect(rows[0].querySelector("time")?.dateTime).toBe("2026-11-18T12:30:00Z");
    expect(rows[0].textContent).toContain("Motivo de reapertura: Es necesario corregir el respaldo");
    const states = within(rows[0]).getByLabelText("Cambio de estado de gestión");
    expect(states.textContent).toContain("Cumplida"); expect(states.textContent).toContain("En gestión");
    expect(rows[3].textContent).toContain("Citación / hora agendada");
    expect(within(rows[3]).queryByLabelText("Cambio de estado de gestión")).toBeNull();
    expect(rows[4].textContent).toContain("Autor no disponible");
    expect(rows[4].textContent).toContain("Antecedente previo al historial detallado");
    expect(screen.getByText(/Las importaciones no cuentan/)).toBeTruthy();
  });
  it("permite desplegar el respaldo y comentarios largos, y abre el caso por su ID", async () => {
    render(createElement(SupervisionSome, props)); await openActivity();
    const rows = within(await screen.findByRole("list", { name: "Eventos de gestión" })).getAllByRole("listitem");
    const evidence = rows[1].querySelector("details")!;
    expect(evidence.open).toBe(false);
    fireEvent.click(within(rows[1]).getByText("Ver respaldo de cumplimiento"));
    expect(evidence.open).toBe(true);
    expect(evidence.textContent).toContain("Documento de prueba");
    const comment = rows[3].querySelector("details")!;
    expect(comment.open).toBe(false);
    fireEvent.click(within(rows[3]).getByText("Ver comentario"));
    expect(comment.open).toBe(true);
    await userEvent.setup().click(within(rows[0]).getByRole("button", { name: "Abrir garantía de Caso sintético uno" }));
    expect(nav).toHaveBeenCalledWith("detalle", { id: caseId });
  });
  it("ofrece teclado accesible para las pestañas y enlaza cada panel con su etiqueta", async () => {
    render(createElement(SupervisionSome, props));
    const summaryTab = screen.getByRole("tab", { name: "Resumen" });
    summaryTab.focus(); fireEvent.keyDown(summaryTab, { key: "ArrowRight" });
    const responsibilitiesTab = screen.getByRole("tab", { name: "Responsabilidades" });
    expect(document.activeElement).toBe(responsibilitiesTab);
    fireEvent.keyDown(responsibilitiesTab, { key: "ArrowRight" });
    const activityTab = screen.getByRole("tab", { name: "Gestiones y cambios" });
    expect(document.activeElement).toBe(activityTab);
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(activityTab.id);
    fireEvent.keyDown(activityTab, { key: "Home" }); expect(document.activeElement).toBe(summaryTab);
    fireEvent.keyDown(summaryTab, { key: "End" }); expect(document.activeElement).toBe(activityTab);
    fireEvent.keyDown(activityTab, { key: "ArrowLeft" }); expect(document.activeElement).toBe(responsibilitiesTab);
    fireEvent.keyDown(responsibilitiesTab, { key: "ArrowLeft" }); expect(document.activeElement).toBe(summaryTab);
    await screen.findByLabelText("Indicadores de supervisión");
  });
  it("muestra carga real y cancela la consulta pendiente al desmontar", async () => {
    api.activity.mockReturnValue(new Promise(() => {}));
    const view = render(createElement(SupervisionSome, props)); await openActivity();
    expect(screen.getByRole("status").textContent).toContain("Cargando gestiones y cambios");
    expect(screen.queryByRole("list", { name: "Eventos de gestión" })).toBeNull();
    const signal = api.activity.mock.calls[0][0] as AbortSignal;
    view.unmount(); expect(signal.aborted).toBe(true);
  });
  it("muestra un historial vacío sin datos de ejemplo", async () => {
    api.activity.mockResolvedValue({ ...activity, eventos: [] });
    render(createElement(SupervisionSome, props)); await openActivity();
    expect(await screen.findByText("Sin gestiones ni cambios registrados")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Eventos de gestión" })).toBeNull();
  });
  it("un fallo permite reintentar sin convertirse en un historial vacío", async () => {
    api.activity.mockRejectedValueOnce(new ApiError("Historial temporalmente no disponible", [], "SUPERVISION_ACTIVITY_UNAVAILABLE"));
    render(createElement(SupervisionSome, props)); await openActivity();
    expect((await screen.findByRole("alert")).textContent).toContain("Historial temporalmente no disponible");
    expect(screen.queryByText("Sin gestiones ni cambios registrados")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByRole("list", { name: "Eventos de gestión" });
    expect(api.activity).toHaveBeenCalledTimes(2);
  });
  it.each(["UNAUTHENTICATED", "FORBIDDEN"])("trata %s sin reintentos automáticos", async (code) => {
    api.activity.mockRejectedValueOnce(new ApiError("No disponible", [], code));
    render(createElement(SupervisionSome, props)); await openActivity();
    expect((await screen.findByRole("alert")).textContent).toContain(code === "UNAUTHENTICATED" ? "Sesión no válida" : "Acceso restringido");
    await userEvent.setup().click(screen.getByRole("button", { name: code === "UNAUTHENTICATED" ? "Volver a iniciar sesión" : "Volver al dashboard" }));
    if (code === "UNAUTHENTICATED") expect(expired).toHaveBeenCalledTimes(1);
    else expect(nav).toHaveBeenCalledWith("dashboard");
    expect(api.activity).toHaveBeenCalledTimes(1);
  });
  it("otros perfiles no consultan ninguno de los dos endpoints", () => {
    render(createElement(SupervisionSome, { ...props, isAdmin: false }));
    expect(screen.queryByRole("tab")).toBeNull();
    expect(api.summary).not.toHaveBeenCalled(); expect(api.activity).not.toHaveBeenCalled();
  });
  it("abre el detalle real desde el historial de App", async () => {
    render(createElement(App)); const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Supervisión SOME" }));
    await openActivity();
    const list = await screen.findByRole("list", { name: "Eventos de gestión" });
    await user.click(within(list).getAllByRole("button", { name: "Abrir garantía de Caso sintético uno" })[0]);
    expect(await screen.findByRole("heading", { name: "Detalle de garantía", level: 2 })).toBeTruthy();
    expect(api.detail).toHaveBeenCalledWith(caseId, expect.any(AbortSignal));
  });
});
