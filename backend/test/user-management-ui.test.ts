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
  waitFor,
} from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"

const api = vi.hoisted(() => ({
  getUserManagement: vi.fn(),
  getUserGuaranteeTypes: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  resetUserPassword: vi.fn(),
  getIndividualReportResults: vi.fn(),
}))
vi.mock("../../src/services/usuarios", () => api)
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

  it("muestra validaciones y envía nombre, apellido, permisos y varios tipos", async () => {
    const user = await openNew()
    await user.click(screen.getByRole("button", { name: "Crear usuario" }))
    expect(screen.getByText("Ingresa el apellido.")).toBeTruthy()
    expect(api.createUser).not.toHaveBeenCalled()
    await fillNew(user)
    await user.selectOptions(
      screen.getByLabelText("Perfil de acceso"),
      "COORDINADOR_SOME",
    )
    await user.click(screen.getByLabelText("Puede cargar nóminas"))
    await user.click(
      screen.getByLabelText("Recibir informe automático por correo"),
    )
    const combo = screen.getByRole("combobox", { name: "Tipos de garantías" })
    await user.type(combo, "especialidad")
    await user.keyboard("{Enter}")
    await user.clear(combo)
    await user.type(combo, "tratamiento")
    await user.click(screen.getByRole("option", { name: "Tratamiento" }))
    expect(screen.getByText("2 tipos seleccionados")).toBeTruthy()
    await user.keyboard("{Escape}")
    expect(screen.getByRole("dialog")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Crear usuario" }))
    await waitFor(() => expect(api.createUser).toHaveBeenCalledTimes(1))
    expect(api.createUser.mock.calls[0][0]).toMatchObject({
      nombre: "María Pérez",
      nombres: "María",
      apellido: "Pérez",
      username: "maria.perez",
      puedeCargarNominas: true,
      recibirInformeAutomatico: true,
      tiposGarantia: ["consulta de especialidad", "tratamiento"],
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
    expect(screen.getByText("1 tipos seleccionados")).toBeTruthy()
    await user.click(
      screen.getByRole("button", { name: "Quitar Consulta de especialidad" }),
    )
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }))
    await waitFor(() =>
      expect(api.updateUser).toHaveBeenCalledWith(
        legacy.id,
        expect.objectContaining({
          nombre: legacy.nombre,
          nombres: null,
          apellido: null,
          tiposGarantia: [],
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

  it("pide confirmación para desactivar y muestra el bloqueo del último ADMIN", async () => {
    const user = userEvent.setup()
    api.updateUser.mockRejectedValueOnce(
      new Error("Debe quedar al menos un administrador activo."),
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
      await screen.findByText("Debe quedar al menos un administrador activo."),
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
