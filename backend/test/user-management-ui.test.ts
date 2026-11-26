// @vitest-environment jsdom
import { createElement, type ComponentType } from "react"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"

const api = vi.hoisted(() => ({
  getUserManagement: vi.fn(),
  getUserGuaranteeTypes: vi.fn(),
  getUserAssignmentOptions: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  resetUserPassword: vi.fn(),
  getIndividualReportResults: vi.fn(),
}))
vi.mock("../../src/services/usuarios", async (importOriginal) => ({ ...await importOriginal<object>(), ...api }))
vi.mock("../../src/services/notificaciones", () => ({ getIndividualReportResults: api.getIndividualReportResults }))
const pageModule = "../../src/pages/GestionUsuarios.tsx"
const apiModule = "../../src/services/api.ts"
const { default: GestionUsuarios } = (await import(pageModule)) as {
  default: ComponentType<{ isAdmin: boolean, toast: (message: string) => void }>
}
const { ApiError } = await import(apiModule)

const types = [
  {
    claveNormalizada: "consulta de especialidad",
    nombre: "Consulta de especialidad",
  },
  { claveNormalizada: "tratamiento", nombre: "Tratamiento" },
]
const legacy = {
  id: "test-1",
  nombre: "Juan Carlos del Río",
  nombres: null,
  apellido: null,
  username: "juan.legacy",
  email: "juan@example.test",
  rol: "PROFESIONAL",
  activo: true,
  puedeCargarNominas: true,
  recibirInformeAutomatico: false,
  tiposGarantia: [types[0]],
  ultimoAccesoAt: null,
  createdAt: "2026-01-01",
}
const toast = vi.fn()
async function chooseAssignment(user: ReturnType<typeof userEvent.setup>, name: string, label: string) {
  await user.click(screen.getByRole("combobox", { name }))
  await user.click(within(screen.getByRole("listbox", { name: `Opciones de ${name}` })).getByRole("option", { name: label }))
}
async function openNew() {
  render(createElement(GestionUsuarios, { isAdmin: true, toast }))
  const button = await screen.findByRole("button", { name: "Nuevo usuario" })
  await waitFor(() =>
    expect((button as HTMLButtonElement).disabled).toBe(false),
  )
  const user = userEvent.setup()
  await user.click(button)
  return user
}
async function fillNew(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Nombre"), "María")
  await user.type(screen.getByLabelText("Apellido"), "Pérez")
  await user.type(
    screen.getByLabelText("Correo electrónico"),
    "maria@example.test",
  )
  await user.type(screen.getByLabelText("Nombre de usuario"), "maria.perez")
  await user.type(
    screen.getByLabelText("Contraseña inicial"),
    "testpass",
  )
}

beforeAll(() => {
  // jsdom no emula la capa modal nativa del navegador. Se comprueba el contrato
  // showModal/close y las interacciones React; el aislamiento nativo requiere navegador.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "")
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open")
  }
})
beforeEach(() => {
  vi.clearAllMocks()
  api.getUserManagement.mockResolvedValue({
    data: [structuredClone(legacy)],
    resumen: { total: 1, activos: 1, informesHabilitados: 0 },
  })
  api.getUserGuaranteeTypes.mockResolvedValue(types)
  api.getUserAssignmentOptions.mockResolvedValue({ tiposGarantia: types, problemasSalud: [{ claveNormalizada: "diabetes", nombre: "Diabetes" }], establecimientos: [{ claveNormalizada: "centro norte", nombre: "Centro Norte" }] })
  api.createUser.mockResolvedValue({
    ...legacy,
    nombres: "María",
    apellido: "Pérez",
    nombre: "María Pérez",
  })
  api.updateUser.mockResolvedValue(legacy)
  api.resetUserPassword.mockResolvedValue(undefined)
  api.getIndividualReportResults.mockResolvedValue({ disponible: true, automaticEnabled: false, data: [] })
})
afterEach(cleanup)

describe("Gestión de usuarios: formularios e interacciones", () => {
  it("protege el perfil y la actividad de ADMIN incluso con varias cuentas administradoras", async () => {
    const admin = { ...legacy, rol: "ADMIN", puedeCargarNominas: false }
    api.getUserManagement.mockResolvedValueOnce({ data: [admin, { ...admin, id: "admin-2", nombre: "Otra administradora", username: "otra.admin" }], resumen: { total: 2, activos: 2, informesHabilitados: 0 } })
    api.updateUser.mockResolvedValueOnce(admin)
    render(createElement(GestionUsuarios, { isAdmin: true, toast }))
    const user = userEvent.setup()
    await screen.findByRole("button", { name: `Editar ${legacy.nombre}` })
    expect(screen.queryByRole("button", { name: `Desactivar ${legacy.nombre}` })).toBeNull()
    expect(screen.queryByRole("button", { name: "Desactivar Otra administradora" })).toBeNull()
    expect(screen.getAllByText("Acceso protegido")).toHaveLength(2)
    await user.click(screen.getByRole("button", { name: `Editar ${legacy.nombre}` }))
    const role = screen.getByLabelText("Perfil de acceso") as HTMLSelectElement
    const active = screen.getByLabelText("Usuario activo") as HTMLInputElement
    expect(role.disabled).toBe(true)
    expect(active.disabled).toBe(true)
    expect((screen.getByLabelText(/Puede cargar nóminas/) as HTMLInputElement).checked).toBe(true)
    await user.selectOptions(role, "LECTOR")
    await user.click(active)
    expect(role.value).toBe("ADMIN")
    expect(active.checked).toBe(true)
    expect(screen.getByText(/El perfil de administrador está protegido/)).toBeTruthy()
    await user.clear(screen.getByLabelText("Correo electrónico"))
    await user.type(screen.getByLabelText("Correo electrónico"), "actualizado@example.test")
    await user.click(screen.getByLabelText("Recibir informe automático por correo"))
    await user.click(screen.getByRole("button", { name: "Limpiar grupo 1" }))
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }))
    await waitFor(() => expect(api.updateUser).toHaveBeenCalledWith(legacy.id, expect.objectContaining({ rol: "ADMIN", activo: true, email: "actualizado@example.test", recibirInformeAutomatico: true, reglasAsignacion: [] })))
  })

  it("permite reactivar una cuenta ADMIN previa inactiva sin ofrecer quitar su perfil", async () => {
    api.getUserManagement.mockResolvedValueOnce({ data: [{ ...legacy, rol: "ADMIN", activo: false }], resumen: { total: 1, activos: 0, informesHabilitados: 0 } })
    render(createElement(GestionUsuarios, { isAdmin: true, toast }))
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: `Reactivar ${legacy.nombre}` }))
    await user.click(screen.getByRole("button", { name: "Confirmar reactivación" }))
    await waitFor(() => expect(api.updateUser).toHaveBeenCalledWith(legacy.id, expect.objectContaining({ rol: "ADMIN", activo: true })))
  })

  it("mantiene editable el perfil de otros usuarios y permite crear administradores", async () => {
    const user = await openNew()
    const role = screen.getByLabelText("Perfil de acceso") as HTMLSelectElement
    expect(role.disabled).toBe(false)
    await fillNew(user)
    await user.selectOptions(role, "ADMIN")
    await user.click(screen.getByRole("button", { name: "Crear usuario" }))
    await waitFor(() => expect(api.createUser).toHaveBeenCalledWith(expect.objectContaining({ rol: "ADMIN", activo: true })))
  })
  it("muestra aceptación SMTP sin afirmar entrega", async () => {
    api.getIndividualReportResults.mockResolvedValueOnce({ disponible: true, automaticEnabled: false, data: [{ usuarioId: legacy.id, fechaInforme: "2026-11-05", estado: "ACEPTADO_SMTP", cantidadGarantias: 2 }] })
    render(createElement(GestionUsuarios, { isAdmin: true, toast }))
    expect(await screen.findByText('Aceptado por SMTP; entrega no confirmada')).toBeTruthy()
    expect(screen.getByText(/Envío automático deshabilitado/)).toBeTruthy()
  })
  it("mantiene la tabla utilizable y comunica la migración pendiente del historial", async () => {
    api.getIndividualReportResults.mockResolvedValueOnce({ disponible: false, automaticEnabled: false, data: [] })
    render(createElement(GestionUsuarios, { isAdmin: true, toast }))
    expect(await screen.findByText('Historial individual pendiente de migración')).toBeTruthy()
    expect(screen.getByRole('button', { name: `Editar ${legacy.nombre}` })).toBeTruthy()
  })
  it("abre, enfoca y cierra el modal limpio restaurando el foco", async () => {
    const user = await openNew()
    expect(screen.getByRole("dialog").hasAttribute("open")).toBe(true)
    expect(document.activeElement).toBe(screen.getByLabelText("Nombre"))
    await user.click(screen.getByRole("button", { name: "Cancelar" }))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Nuevo usuario" }),
    )
  })

  it("confirma cambios pendientes sin perder el borrador y trata Escape", async () => {
    const user = await openNew()
    await user.type(screen.getByLabelText("Nombre"), "Borrador")
    await user.click(screen.getByRole("button", { name: "Cerrar ventana" }))
    expect(screen.getByRole("alertdialog")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Seguir editando" }))
    expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe(
      "Borrador",
    )
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true, bubbles: true }),
    )
    await user.click(screen.getByRole("button", { name: "Descartar cambios" }))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(api.createUser).not.toHaveBeenCalled()
  })

  it("muestra validaciones y envía nombre, apellido, permisos y varias reglas", async () => {
    const user = await openNew()
    await user.click(screen.getByRole("button", { name: "Crear usuario" }))
    expect(screen.getByText("Ingresa el apellido.")).toBeTruthy()
    expect(api.createUser).not.toHaveBeenCalled()
    await fillNew(user)
    await user.selectOptions(
      screen.getByLabelText("Perfil de acceso"),
      "COORDINADOR_SOME",
    )
    expect((screen.getByLabelText(/Puede cargar nóminas/) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText(/Puede cargar nóminas/) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText("Incluido en el perfil de coordinador.")).toBeTruthy()
    expect((screen.getByLabelText("Recibir informe automático por correo") as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText("Recibir informe automático por correo") as HTMLInputElement).disabled).toBe(true)
    expect(within(screen.getByLabelText("Perfil de acceso")).getByRole("option", { name: "Coordinador" })).toBeTruthy()
    await user.click(screen.getByLabelText(/Puede cargar nóminas/))
    await user.click(
      screen.getByLabelText("Recibir informe automático por correo"),
    )
    await chooseAssignment(user, "Problemas de salud, grupo 1", "Diabetes")
    await chooseAssignment(user, "Establecimientos, grupo 1", "Centro Norte")
    await chooseAssignment(user, "Tipos de garantía, grupo 1", "Consulta de especialidad")
    await user.click(screen.getByRole("button", { name: "Agregar otro grupo" }))
    await chooseAssignment(user, "Tipos de garantía, grupo 2", "Tratamiento")
    expect(screen.getByRole("dialog")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Crear usuario" }))
    await waitFor(() => expect(api.createUser).toHaveBeenCalledTimes(1))
    expect(api.createUser.mock.calls[0][0]).toMatchObject({
      nombre: "María Pérez",
      nombres: "María",
      apellido: "Pérez",
      username: "maria.perez",
      puedeCargarNominas: false,
      recibirInformeAutomatico: true,
      reglasAsignacion: [
        { problemaSalud: "diabetes", establecimiento: "centro norte", tipoGarantia: "consulta de especialidad" },
        { problemaSalud: "", establecimiento: "", tipoGarantia: "tratamiento" },
      ],
    })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("Guardar no envía correos"))
  })

  it("bloquea el cierre y evita guardar dos veces mientras espera al backend", async () => {
    let finish!: (value: unknown) => void
    api.createUser.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const user = await openNew()
    await fillNew(user)
    await user.click(screen.getByRole("button", { name: "Crear usuario" }))
    expect(
      (screen.getByRole("button", {
        name: "Cerrar ventana",
      }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (screen.getByRole("button", { name: "Guardando…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true, bubbles: true }),
    )
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(api.createUser).toHaveBeenCalledTimes(1)
    finish(legacy)
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(document.body.style.overflow).toBe("")
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Nuevo usuario" }),
    )
  })

  it("selecciona varios problemas y tipos en un solo grupo y guarda sus cuatro combinaciones", async () => {
    api.getUserAssignmentOptions.mockResolvedValueOnce({ tiposGarantia: types, problemasSalud: [{ claveNormalizada: "diabetes", nombre: "Diabetes" }, { claveNormalizada: "hipertension", nombre: "Hipertensión" }], establecimientos: [{ claveNormalizada: "centro norte", nombre: "Centro Norte" }] })
    const user = await openNew()
    await fillNew(user)
    await chooseAssignment(user, "Problemas de salud, grupo 1", "Diabetes")
    const problems = screen.getByRole("combobox", { name: "Problemas de salud, grupo 1" })
    await user.type(problems, "hipertension")
    await user.keyboard("{ArrowDown}{Enter}{Escape}")
    expect(screen.getByRole("dialog")).toBeTruthy()
    await chooseAssignment(user, "Establecimientos, grupo 1", "Centro Norte")
    await chooseAssignment(user, "Tipos de garantía, grupo 1", "Consulta de especialidad")
    await chooseAssignment(user, "Tipos de garantía, grupo 1", "Tratamiento")
    expect(screen.getByRole("status").textContent).toContain("4 combinaciones asignadas")
    expect(screen.queryByRole("heading", { name: "Grupo 2" })).toBeNull()
    await user.click(screen.getByRole("button", { name: "Crear usuario" }))
    await waitFor(() => expect(api.createUser).toHaveBeenCalledTimes(1))
    expect(api.createUser.mock.calls[0][0].reglasAsignacion).toEqual([
      { problemaSalud: "diabetes", establecimiento: "centro norte", tipoGarantia: "consulta de especialidad" },
      { problemaSalud: "diabetes", establecimiento: "centro norte", tipoGarantia: "tratamiento" },
      { problemaSalud: "hipertension", establecimiento: "centro norte", tipoGarantia: "consulta de especialidad" },
      { problemaSalud: "hipertension", establecimiento: "centro norte", tipoGarantia: "tratamiento" },
    ])
  })

  it("abre reglas compatibles como un grupo y puede cerrar sin cambios ni ampliar el acceso", async () => {
    const rules = [
      { problemaSalud: "diabetes", establecimiento: "centro norte", tipoGarantia: "consulta de especialidad" },
      { problemaSalud: "diabetes", establecimiento: "centro norte", tipoGarantia: "tratamiento" },
    ]
    api.getUserManagement.mockResolvedValueOnce({ data: [{ ...legacy, reglasAsignacion: rules }], resumen: { total: 1, activos: 1, informesHabilitados: 0 } })
    render(createElement(GestionUsuarios, { isAdmin: true, toast }))
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: `Editar ${legacy.nombre}` }))
    expect(screen.getByRole("status").textContent).toContain("2 combinaciones asignadas")
    expect(screen.queryByRole("heading", { name: "Grupo 2" })).toBeNull()
    await user.click(screen.getByRole("button", { name: "Cancelar" }))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(api.updateUser).not.toHaveBeenCalled()
  })

  it("conserva grupos distintos cuando cambian problema y establecimiento", async () => {
    const rules = [
      { problemaSalud: "diabetes", establecimiento: "centro norte", tipoGarantia: "tratamiento" },
      { problemaSalud: "hipertension", establecimiento: "centro sur", tipoGarantia: "tratamiento" },
    ]
    api.getUserManagement.mockResolvedValueOnce({ data: [{ ...legacy, reglasAsignacion: rules }], resumen: { total: 1, activos: 1, informesHabilitados: 0 } })
    render(createElement(GestionUsuarios, { isAdmin: true, toast }))
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: `Editar ${legacy.nombre}` }))
    expect(screen.getByRole("heading", { name: "Grupo 2" })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }))
    await waitFor(() => expect(api.updateUser).toHaveBeenCalledWith(legacy.id, expect.objectContaining({ reglasAsignacion: rules })))
  })

  it("evita guardar un grupo adicional sin criterios y permite eliminarlo", async () => {
    const user = await openNew()
    await fillNew(user)
    await chooseAssignment(user, "Tipos de garantía, grupo 1", "Tratamiento")
    await user.click(screen.getByRole("button", { name: "Agregar otro grupo" }))
    await user.click(screen.getByRole("button", { name: "Crear usuario" }))
    expect(screen.getByText("Selecciona al menos un criterio en cada grupo o elimina el grupo vacío.")).toBeTruthy()
    expect(api.createUser).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Eliminar grupo 2" }))
    await user.click(screen.getByRole("button", { name: "Limpiar grupo 1" }))
    await user.click(screen.getByRole("button", { name: "Crear usuario" }))
    await waitFor(() => expect(api.createUser).toHaveBeenCalledTimes(1))
    expect(api.createUser.mock.calls[0][0].reglasAsignacion).toEqual([])
  })

  it("recupera los tres criterios persistidos al editar y permite cambiarlos", async () => {
    api.getUserManagement.mockResolvedValueOnce({ data: [{ ...legacy, reglasAsignacion: [{ problemaSalud: "diabetes", establecimiento: "centro norte", tipoGarantia: "tratamiento" }] }], resumen: { total: 1, activos: 1, informesHabilitados: 0 } })
    render(createElement(GestionUsuarios, { isAdmin: true, toast }))
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: `Editar ${legacy.nombre}` }))
    expect(screen.getByRole("button", { name: "Quitar Diabetes de Problemas de salud, grupo 1" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Quitar Centro Norte de Establecimientos, grupo 1" })).toBeTruthy()
    await chooseAssignment(user, "Tipos de garantía, grupo 1", "Cualquier tipo")
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }))
    await waitFor(() => expect(api.updateUser).toHaveBeenCalledWith(legacy.id, expect.objectContaining({ reglasAsignacion: [{ problemaSalud: "diabetes", establecimiento: "centro norte", tipoGarantia: "" }] })))
  })

  it("recupera las selecciones al editar y conserva completo el nombre antiguo", async () => {
    const user = userEvent.setup()
    render(createElement(GestionUsuarios, { isAdmin: true, toast }))
    await user.click(
      await screen.findByRole("button", { name: `Editar ${legacy.nombre}` }),
    )
    expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe(
      legacy.nombre,
    )
    expect(
      (screen.getByLabelText("Apellido (por completar)") as HTMLInputElement)
        .value,
    ).toBe("")
    expect(
      (screen.getByLabelText("Nombre de usuario") as HTMLInputElement).readOnly,
    ).toBe(true)
    expect(screen.getByRole("button", { name: "Quitar Consulta de especialidad de Tipos de garantía, grupo 1" })).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "Problemas de salud, grupo 1" }).getAttribute("placeholder")).toBe("Cualquier problema")
    await user.click(
      screen.getByRole("button", { name: "Limpiar grupo 1" }),
    )
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }))
    await waitFor(() =>
      expect(api.updateUser).toHaveBeenCalledWith(
        legacy.id,
        expect.objectContaining({
          nombre: legacy.nombre,
          nombres: null,
          apellido: null,
          reglasAsignacion: [],
        }),
      ),
    )
  })

  it("conserva el formulario y presenta los errores del backend", async () => {
    api.createUser.mockRejectedValueOnce(
      new ApiError(
        "El correo ya está registrado.",
        [{ path: ["email"], message: "Revisa este correo." }],
        "USER_ALREADY_EXISTS",
      ),
    )
    const user = await openNew()
    await fillNew(user)
    await user.click(screen.getByRole("button", { name: "Crear usuario" }))
    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(screen.getByText("Revisa este correo.")).toBeTruthy()
    expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe(
      "María",
    )
  })

  it("pide confirmación para desactivar otros perfiles y presenta errores del backend", async () => {
    const user = userEvent.setup()
    api.updateUser.mockRejectedValueOnce(
      new Error("No fue posible desactivar el usuario."),
    )
    render(createElement(GestionUsuarios, { isAdmin: true, toast }))
    await user.click(
      await screen.findByRole("button", {
        name: `Desactivar ${legacy.nombre}`,
      }),
    )
    expect(api.updateUser).not.toHaveBeenCalled()
    await user.click(
      screen.getByRole("button", { name: "Confirmar desactivación" }),
    )
    expect(
      await screen.findByText("No fue posible desactivar el usuario."),
    ).toBeTruthy()
    expect(screen.getByRole("dialog")).toBeTruthy()
  })

  it("busca por apellido o correo y filtra por perfil y estado", async () => {
    const user = userEvent.setup()
    render(createElement(GestionUsuarios, { isAdmin: true, toast }))
    await screen.findByText(legacy.email)
    const search = screen.getByRole("textbox", { name: "Buscar usuarios" })
    await user.type(search, "rio")
    expect(screen.getByText(legacy.email)).toBeTruthy()
    await user.clear(search)
    await user.type(search, "sin-coincidencia")
    expect(
      screen.getByText("No hay usuarios que coincidan con los filtros."),
    ).toBeTruthy()
    await user.clear(search)
    await user.selectOptions(
      screen.getByLabelText("Filtrar por estado"),
      "inactivo",
    )
    expect(screen.queryByText(legacy.email)).toBeNull()
  })

  it("mantiene las reglas de contraseña y revocación en el modal de acceso", async () => {
    const user = userEvent.setup()
    render(createElement(GestionUsuarios, { isAdmin: true, toast }))
    await user.click(
      await screen.findByRole("button", {
        name: `Restablecer contraseña de ${legacy.nombre}`,
      }),
    )
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }))
    expect(screen.getByRole("alert").textContent).toContain("8 y 128")
    await user.type(
      screen.getByLabelText("Nueva contraseña"),
      "testpas",
    )
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }))
    expect(api.resetUserPassword).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain("8 y 128")
    await user.type(screen.getByLabelText("Nueva contraseña"), "s")
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }))
    await waitFor(() =>
      expect(api.resetUserPassword).toHaveBeenCalledWith(
        legacy.id,
        "testpass",
      ),
    )
  })

  it("no consulta usuarios si falta el permiso ADMIN", () => {
    render(createElement(GestionUsuarios, { isAdmin: false, toast }))
    expect(screen.getByText("Acceso restringido")).toBeTruthy()
    expect(api.getUserManagement).not.toHaveBeenCalled()
  })

  it("presenta error, reintento y estado vacío sin datos de respaldo", async () => {
    api.getUserManagement.mockRejectedValueOnce(
      new Error("Servidor no disponible."),
    )
    const user = userEvent.setup()
    render(createElement(GestionUsuarios, { isAdmin: true, toast }))
    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(screen.queryByText(legacy.email)).toBeNull()
    api.getUserManagement.mockResolvedValueOnce({
      data: [],
      resumen: { total: 0, activos: 0, informesHabilitados: 0 },
    })
    await user.click(screen.getByRole("button", { name: "Reintentar" }))
    expect(
      await screen.findByText("Todavía no hay usuarios registrados."),
    ).toBeTruthy()
  })
})
