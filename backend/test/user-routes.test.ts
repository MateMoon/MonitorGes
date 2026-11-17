import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify from "fastify"

const mocks = vi.hoisted(() => ({
  listUsers: vi.fn(),
  getUser: vi.fn(),
  listGuaranteeTypes: vi.fn(),
  listAssignmentOptions: vi.fn(),
  createManagedUser: vi.fn(),
  updateManagedUser: vi.fn(),
  changePassword: vi.fn(),
  hashPassword: vi.fn(),
  getSessionUser: vi.fn(),
}))
vi.mock("../src/modules/auth/auth-service.js", () => ({
  hashPassword: mocks.hashPassword,
  getSessionUser: mocks.getSessionUser,
}))
vi.mock("../src/modules/usuarios/repository.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...Object.fromEntries(
    [
      "listUsers",
      "getUser",
      "listGuaranteeTypes",
      "listAssignmentOptions",
      "createManagedUser",
      "updateManagedUser",
      "changePassword",
    ].map((name) => [name, mocks[(name as keyof typeof mocks)]]),
  ),
}))
import { userRoutes } from "../src/modules/usuarios/routes.js"
import { UserManagementError } from "../src/modules/usuarios/repository.js"

const user = {
  id: "user-id",
  nombre: "María Pérez",
  nombres: "María",
  apellido: "Pérez",
  username: "maria.perez",
  email: "maria@example.test",
  rol: "PROFESIONAL",
  activo: true,
  puedeCargarNominas: true,
  recibirInformeAutomatico: false,
  tiposGarantia: [],
}
const input = {
  nombre: "María Pérez",
  nombres: "María",
  apellido: "Pérez",
  username: "maria.perez",
  email: "maria@example.test",
  rol: "PROFESIONAL",
  password: "a-long-test-password",
  tiposGarantia: ["tratamiento", "consulta", "tratamiento"],
}
const headers = { cookie: "ges_session=test" }

describe("administración de usuarios con autorización real", () => {
  const app = Fastify()
  app.decorateRequest("authUser", null)
  app.register(userRoutes, { prefix: "/api/usuarios" })
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.getSessionUser.mockResolvedValue({ ...user, rol: "ADMIN" })
    mocks.hashPassword.mockResolvedValue("scrypt$test-hash")
    mocks.createManagedUser.mockResolvedValue(user)
    mocks.updateManagedUser.mockResolvedValue(user)
    mocks.getUser.mockResolvedValue(user)
    mocks.listUsers.mockResolvedValue({
      data: [user],
      resumen: { total: 1, activos: 1, informesHabilitados: 0 },
    })
    mocks.listGuaranteeTypes.mockResolvedValue([
      { claveNormalizada: "tratamiento", nombre: "Tratamiento" },
    ])
    mocks.listAssignmentOptions.mockResolvedValue({ problemasSalud: [], establecimientos: [], tiposGarantia: [] })
  })
  afterAll(() => app.close())

  it("ADMIN crea, guarda nombre y apellido y aplica las preferencias por defecto", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/usuarios",
      headers,
      payload: input,
    })
    expect(response.statusCode).toBe(201)
    expect(mocks.hashPassword).toHaveBeenCalledWith(input.password)
    expect(mocks.createManagedUser).toHaveBeenCalledWith(
      expect.objectContaining({
        nombres: "María",
        apellido: "Pérez",
        activo: true,
        recibirInformeAutomatico: false,
        tiposGarantia: ["tratamiento", "consulta"],
      }),
      "scrypt$test-hash",
    )
    expect(response.json().data).toMatchObject({
      nombre: "María Pérez",
      apellido: "Pérez",
    })
    expect(response.body).not.toContain(input.password)
    expect(response.body).not.toContain("passwordHash")
  })

  it.each(["POST", "PUT"] as const)(
    "%s acepta contraseñas de 8 caracteres y rechaza las de 7",
    async (method) => {
      const url = method === "POST"
        ? "/api/usuarios"
        : "/api/usuarios/user-id/contrasena"
      const payload = (password: string) => method === "POST"
        ? { ...input, password }
        : { password }
      const rejected = await app.inject({
        method, url, headers, payload: payload("testpas"),
      })
      expect(rejected.statusCode).toBe(400)
      expect(mocks.hashPassword).not.toHaveBeenCalled()
      expect(mocks.createManagedUser).not.toHaveBeenCalled()
      expect(mocks.changePassword).not.toHaveBeenCalled()

      const accepted = await app.inject({
        method, url, headers, payload: payload("testpass"),
      })
      expect(accepted.statusCode).toBe(method === "POST" ? 201 : 204)
      expect(mocks.hashPassword).toHaveBeenCalledWith("testpass")
    },
  )

  it.each(["LECTOR", "PROFESIONAL", "COORDINADOR_SOME", null])(
    "rechaza todas las operaciones para %s",
    async (role) => {
      mocks.getSessionUser.mockResolvedValue(
        role ? { ...user, rol: role } : null,
      )
      for (const [method, url, payload] of [
        ["GET", "/api/usuarios", undefined],
        ["GET", "/api/usuarios/tipos-garantia", undefined],
        ["GET", "/api/usuarios/opciones-asignacion", undefined],
        ["GET", "/api/usuarios/user-id", undefined],
        ["POST", "/api/usuarios", input],
        [
          "PUT",
          "/api/usuarios/user-id",
          {
            nombre: user.nombre,
            email: user.email,
            rol: "LECTOR",
            activo: true,
          },
        ],
        [
          "PUT",
          "/api/usuarios/user-id/contrasena",
          { password: input.password },
        ],
      ] as const) {
        const response = await app.inject({ method, url, headers, payload })
        expect(response.statusCode).toBe(role ? 403 : 401)
      }
      expect(mocks.createManagedUser).not.toHaveBeenCalled()
      expect(mocks.updateManagedUser).not.toHaveBeenCalled()
      expect(mocks.changePassword).not.toHaveBeenCalled()
      expect(mocks.listGuaranteeTypes).not.toHaveBeenCalled()
    },
  )

  it.each([
    { apellido: "" },
    { apellido: undefined },
    { email: "incorrecto" },
    { username: "no espacios" },
    { password: "corta" },
    { rol: "SUPERADMIN" },
    { rol: "LECTOR", puedeCargarNominas: true },
  ])("valida campos y restricciones existentes: %j", async (patch) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/usuarios",
      headers,
      payload: { ...input, ...patch },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.details.length).toBeGreaterThan(0)
    expect(mocks.createManagedUser).not.toHaveBeenCalled()
  })

  it("conserva el contrato de listado y agrega resumen y opciones reales", async () => {
    const rules = await app.inject({ method: "GET", url: "/api/usuarios/opciones-asignacion", headers })
    expect(rules.statusCode).toBe(200)
    expect(rules.json().data).toEqual({ problemasSalud: [], establecimientos: [], tiposGarantia: [] })
    const list = await app.inject({
      method: "GET",
      url: "/api/usuarios",
      headers,
    })
    expect(list.json()).toEqual({
      data: [user],
      resumen: { total: 1, activos: 1, informesHabilitados: 0 },
    })
    const options = await app.inject({
      method: "GET",
      url: "/api/usuarios/tipos-garantia",
      headers,
    })
    expect(options.json().data[0].nombre).toBe("Tratamiento")
  })

  it("acepta actualizaciones de clientes anteriores sin borrar preferencias", async () => {
    const body = {
      nombre: user.nombre,
      email: user.email,
      rol: "PROFESIONAL",
      activo: true,
    }
    const response = await app.inject({
      method: "PUT",
      url: "/api/usuarios/user-id",
      headers,
      payload: body,
    })
    expect(response.statusCode).toBe(200)
    expect(mocks.updateManagedUser).toHaveBeenCalledWith("user-id", body)
  })

  it("no permite cambiar silenciosamente el username en una edición", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/usuarios/user-id",
      headers,
      payload: {
        nombre: user.nombre,
        email: user.email,
        rol: "PROFESIONAL",
        activo: true,
        username: "otro",
      },
    })
    expect(response.statusCode).toBe(400)
  })

  it.each(["POST", "PUT"] as const)(
    "traduce duplicados de %s a 409",
    async (method) => {
      ;(method === "POST"
        ? mocks.createManagedUser
        : mocks.updateManagedUser
      ).mockRejectedValueOnce({ code: "P2002" })
      const response = await app.inject({
        method,
        url: method === "POST" ? "/api/usuarios" : "/api/usuarios/user-id",
        headers,
        payload:
          method === "POST"
            ? input
            : {
                nombre: user.nombre,
                email: user.email,
                rol: "PROFESIONAL",
                activo: true,
              },
      })
      expect(response.statusCode).toBe(409)
      expect(response.json().error.code).toBe("USER_ALREADY_EXISTS")
    },
  )

  it("presenta el bloqueo del último administrador y los tipos inválidos", async () => {
    for (const [code, status] of [
      ["LAST_ADMIN", 409],
      ["INVALID_GUARANTEE_TYPE", 400],
    ] as const) {
      mocks.updateManagedUser.mockRejectedValueOnce(
        new UserManagementError(code, "Revisa los datos.", status),
      )
      const result = await app.inject({
        method: "PUT",
        url: "/api/usuarios/user-id",
        headers,
        payload: {
          nombre: user.nombre,
          email: user.email,
          rol: "PROFESIONAL",
          activo: true,
        },
      })
      expect(result.statusCode).toBe(status)
      expect(result.json().error.code).toBe(code)
    }
  })

  it("restablece contraseñas por la ruta existente y no agrega DELETE", async () => {
    const result = await app.inject({
      method: "PUT",
      url: "/api/usuarios/user-id/contrasena",
      headers,
      payload: { password: input.password },
    })
    expect(result.statusCode).toBe(204)
    expect(mocks.changePassword).toHaveBeenCalledWith(
      "user-id",
      "scrypt$test-hash",
    )
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/api/usuarios/user-id",
          headers,
        })
      ).statusCode,
    ).toBe(404)
  })
})
