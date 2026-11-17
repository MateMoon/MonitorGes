import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => {
  const tx = {
    usuario: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    tipoGarantia: { findMany: vi.fn() },
    problemaSalud: { findMany: vi.fn() },
    establecimiento: { findMany: vi.fn() },
    garantia: { findMany: vi.fn() },
    nombreGarantiaAsignable: { findMany: vi.fn(), upsert: vi.fn() },
    usuarioTipoGarantia: { deleteMany: vi.fn(), createMany: vi.fn() },
    sesionUsuario: { deleteMany: vi.fn() },
  }
  return { tx, transaction: vi.fn() }
})
vi.mock("../src/db/prisma.js", () => ({
  prisma: { ...mocks.tx, $transaction: mocks.transaction },
}))
import {
  createManagedUser,
  updateManagedUser,
  listGuaranteeTypes,
  listUsers,
} from "../src/modules/usuarios/repository.js"
import { createSchema, updateSchema } from "../src/modules/usuarios/schema.js"

const user = {
  id: "user-test",
  nombre: "Nombre Completo Anterior",
  nombres: null,
  apellido: null,
  email: "user@example.test",
  username: "user.test",
  rol: "PROFESIONAL",
  activo: true,
  puedeCargarNominas: true,
  recibirInformeAutomatico: false,
  tiposGarantia: [],
}
const input = {
  nombre: user.nombre,
  email: user.email,
  rol: user.rol,
  activo: true,
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.transaction.mockImplementation((work) => work(mocks.tx))
  mocks.tx.usuario.findUnique.mockResolvedValue(user)
  mocks.tx.usuario.findUniqueOrThrow.mockResolvedValue(user)
  mocks.tx.usuario.create.mockResolvedValue({ id: user.id })
  mocks.tx.usuario.findMany.mockResolvedValue([user])
  mocks.tx.tipoGarantia.findMany.mockResolvedValue([{ nombre: "Tratamiento" }])
  mocks.tx.garantia.findMany.mockResolvedValue([
    { nombreGarantia: " TRATÁMIENTO!!! " },
    { nombreGarantia: "Confirmación diagnóstica" },
  ])
  mocks.tx.nombreGarantiaAsignable.findMany.mockResolvedValue([])
  mocks.tx.problemaSalud.findMany.mockResolvedValue([{ nombre: "Diabetes" }])
  mocks.tx.establecimiento.findMany.mockResolvedValue([{ nombre: "Centro Norte" }])
})

describe("servicio persistente de usuarios y nombres de garantías", () => {
  it("guarda y deduplica las reglas junto con el usuario sin alterar las asignaciones omitidas", async () => {
    mocks.tx.garantia.findMany.mockResolvedValue([])
    const rule = { problemaSalud: "diabetes", establecimiento: "centro norte", tipoGarantia: "tratamiento" }
    await updateManagedUser(user.id, updateSchema.parse({ ...input, reglasAsignacion: [rule, rule] }))
    expect(mocks.tx.usuario.update).toHaveBeenLastCalledWith({ where: { id: user.id }, data: { reglasAsignacion: [rule] }, select: { id: true } })
    expect(mocks.tx.usuarioTipoGarantia.deleteMany).not.toHaveBeenCalled()
  })

  it("rechaza reglas inventadas y filas vacías; un conjunto vacío sí revoca asignaciones", async () => {
    mocks.tx.garantia.findMany.mockResolvedValue([])
    await expect(updateManagedUser(user.id, updateSchema.parse({ ...input, reglasAsignacion: [{ problemaSalud: "inventado", establecimiento: "", tipoGarantia: "" }] }))).rejects.toMatchObject({ code: "INVALID_ASSIGNMENT_RULE" })
    expect(updateSchema.safeParse({ ...input, reglasAsignacion: [{ problemaSalud: "", establecimiento: "", tipoGarantia: "" }] }).success).toBe(false)
    await updateManagedUser(user.id, updateSchema.parse({ ...input, reglasAsignacion: [] }))
    expect(mocks.tx.usuario.update).toHaveBeenLastCalledWith({ where: { id: user.id }, data: { reglasAsignacion: [] }, select: { id: true } })
  })

  it("combina catálogo y nóminas con la identidad del importador sin usar combinaciones", async () => {
    expect(await listGuaranteeTypes()).toEqual([
      {
        claveNormalizada: "confirmacion diagnostica",
        nombre: "Confirmación diagnóstica",
      },
      { claveNormalizada: "tratamiento", nombre: "Tratamiento" },
    ])
    expect(mocks.tx.nombreGarantiaAsignable.upsert).not.toHaveBeenCalled()
  })

  it("guarda varias selecciones sin duplicados en la misma transacción del usuario", async () => {
    await createManagedUser(
      createSchema.parse({
        nombre: "Ana",
        apellido: "Pérez",
        username: "ana.perez",
        email: "ana@example.test",
        rol: "LECTOR",
        password: "a-long-test-password",
        tiposGarantia: [
          "tratamiento",
          "tratamiento",
          "confirmacion diagnostica",
        ],
      }),
      "scrypt$hash",
    )
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    })
    expect(mocks.tx.usuario.create.mock.calls[0][0].data).toMatchObject({
      nombre: "Ana Pérez",
      nombres: "Ana",
      apellido: "Pérez",
      recibirInformeAutomatico: false,
      passwordHash: "scrypt$hash",
    })
    expect(mocks.tx.usuario.create.mock.calls[0][0].data).not.toHaveProperty(
      "password",
    )
    expect(mocks.tx.usuarioTipoGarantia.createMany).toHaveBeenCalledWith({
      data: [
        { usuarioId: user.id, claveNormalizada: "tratamiento" },
        { usuarioId: user.id, claveNormalizada: "confirmacion diagnostica" },
      ],
    })
  })

  it("la actualización anterior conserva nombre, preferencias y selecciones omitidas", async () => {
    await updateManagedUser(user.id, updateSchema.parse(input))
    const data = mocks.tx.usuario.update.mock.calls[0][0].data
    expect(data.nombre).toBe(user.nombre)
    expect(data).not.toHaveProperty("nombres")
    expect(data).not.toHaveProperty("apellido")
    expect(data).not.toHaveProperty("recibirInformeAutomatico")
    expect(mocks.tx.usuarioTipoGarantia.deleteMany).not.toHaveBeenCalled()
  })

  it("quitar todas las selecciones solo elimina vínculos del usuario actual", async () => {
    await updateManagedUser(
      user.id,
      updateSchema.parse({ ...input, tiposGarantia: [] }),
    )
    expect(mocks.tx.usuarioTipoGarantia.deleteMany).toHaveBeenCalledWith({
      where: { usuarioId: user.id },
    })
    expect(mocks.tx.usuarioTipoGarantia.createMany).not.toHaveBeenCalled()
    expect(mocks.tx.nombreGarantiaAsignable.upsert).not.toHaveBeenCalled()
  })

  it("rechaza nombres inventados mediante validación del backend", async () => {
    await expect(
      updateManagedUser(
        user.id,
        updateSchema.parse({ ...input, tiposGarantia: ["inventado"] }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_GUARANTEE_TYPE" })
    expect(mocks.tx.usuarioTipoGarantia.deleteMany).not.toHaveBeenCalled()
  })

  it("reintenta conflictos serializables y vuelve a comprobar el último ADMIN", async () => {
    mocks.transaction.mockRejectedValueOnce({ code: "P2034" })
    mocks.tx.usuario.findUnique.mockResolvedValue({ ...user, rol: "ADMIN" })
    mocks.tx.usuario.count.mockResolvedValue(1)
    await expect(
      updateManagedUser(user.id, updateSchema.parse(input)),
    ).rejects.toMatchObject({ code: "LAST_ADMIN" })
    expect(mocks.transaction).toHaveBeenCalledTimes(2)
    expect(mocks.tx.usuario.update).not.toHaveBeenCalled()
  })

  it("limita reintentos y devuelve un conflicto que puede recuperar la interfaz", async () => {
    mocks.transaction.mockRejectedValue({ code: "P2034" })
    await expect(
      updateManagedUser(user.id, updateSchema.parse(input)),
    ).rejects.toMatchObject({ code: "CONCURRENT_USER_UPDATE", statusCode: 409 })
    expect(mocks.transaction).toHaveBeenCalledTimes(3)
  })

  it("desactivar revoca sesiones sin alterar los tipos omitidos", async () => {
    await updateManagedUser(
      user.id,
      updateSchema.parse({ ...input, activo: false }),
    )
    expect(mocks.tx.sesionUsuario.deleteMany).toHaveBeenCalledWith({
      where: { usuarioId: user.id },
    })
    expect(mocks.tx.usuarioTipoGarantia.deleteMany).not.toHaveBeenCalled()
  })

  it("calcula el resumen con los usuarios persistidos y cuenta preferencias, no envíos", async () => {
    mocks.tx.usuario.findMany.mockResolvedValue([
      user,
      {
        ...user,
        id: "inactive",
        activo: false,
        recibirInformeAutomatico: true,
      },
    ])
    expect((await listUsers()).resumen).toEqual({
      total: 2,
      activos: 1,
      informesHabilitados: 1,
    })
  })
})
