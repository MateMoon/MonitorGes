import { Prisma } from "@prisma/client"
import { prisma } from "../../db/prisma.js"
import { normalizeIdentityText } from "../importaciones/identity-normalization.js"
import type { CreateUserInput, UpdateUserInput } from "./schema.js"

export class UserManagementError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
  ) {
    super(message)
  }
}

const safeSelect = {
  id: true,
  nombre: true,
  nombres: true,
  apellido: true,
  username: true,
  email: true,
  rol: true,
  puedeCargarNominas: true,
  recibirInformeAutomatico: true,
  activo: true,
  ultimoAccesoAt: true,
  createdAt: true,
  tiposGarantia: {
    select: {
      tipoGarantia: { select: { claveNormalizada: true, nombre: true } },
    },
  },
} as const
type UserRecord = Prisma.UsuarioGetPayload<{ select: typeof safeSelect }>
function publicUser(row: UserRecord) {
  return {
    ...row,
    tiposGarantia: row.tiposGarantia
      .map(({ tipoGarantia }) => tipoGarantia)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
  }
}

/** Solo lectura: las opciones no crean ni alteran catálogos de áreas. */
export async function listGuaranteeTypes(
  db: Pick<Prisma.TransactionClient, "tipoGarantia" | "garantia" | "nombreGarantiaAsignable"> = prisma,
) {
  const [catalog, imported, saved] = await Promise.all([
    db.tipoGarantia.findMany({
      select: { nombre: true },
      orderBy: { nombre: "asc" },
    }),
    db.garantia.findMany({
      distinct: ["nombreGarantia"],
      select: { nombreGarantia: true },
      orderBy: { nombreGarantia: "asc" },
    }),
    db.nombreGarantiaAsignable.findMany({
      select: { nombre: true, claveNormalizada: true },
      orderBy: { nombre: "asc" },
    }),
  ])
  const byKey = new Map<string, { claveNormalizada: string, nombre: string }>()
  for (const entry of [
    ...saved,
    ...catalog,
    ...imported.map((row) => ({ nombre: row.nombreGarantia })),
  ]) {
    const key = normalizeIdentityText(entry.nombre)
    if (key && !byKey.has(key))
      byKey.set(key, { claveNormalizada: key, nombre: entry.nombre.trim() })
  }
  return [...byKey.values()].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, "es"),
  )
}

export async function listUsers() {
  const data = (
    await prisma.usuario.findMany({
      select: safeSelect,
      orderBy: [{ activo: "desc" }, { nombre: "asc" }, { id: "asc" }],
    })
  ).map(publicUser)
  return {
    data,
    resumen: {
      total: data.length,
      activos: data.filter((user) => user.activo).length,
      informesHabilitados: data.filter((user) => user.recibirInformeAutomatico)
        .length,
    },
  }
}

export async function getUser(id: string) {
  const row = await prisma.usuario.findUnique({
    where: { id },
    select: safeSelect,
  })
  if (!row)
    throw new UserManagementError(
      "USER_NOT_FOUND",
      "No se encontró el usuario.",
      404,
    )
  return publicUser(row)
}

// Serializable evita que dos bajas concurrentes dejen el sistema sin ADMIN.
async function transaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      })
    } catch (error) {
      if ((error as { code?: string }).code !== "P2034") throw error
      if (attempt >= 2)
        throw new UserManagementError(
          "CONCURRENT_USER_UPDATE",
          "Otro administrador está modificando usuarios. Intenta nuevamente.",
          409,
        )
    }
  }
}

async function saveTypes(
  tx: Prisma.TransactionClient,
  usuarioId: string,
  keys: string[] | undefined,
) {
  if (keys === undefined) return
  const unique = [...new Set(keys)]
  const options = new Map(
    (await listGuaranteeTypes(tx)).map((option) => [
      option.claveNormalizada,
      option,
    ]),
  )
  if (unique.some((key) => !options.has(key)))
    throw new UserManagementError(
      "INVALID_GUARANTEE_TYPE",
      "Uno o más tipos de garantía no existen. Recarga las opciones.",
    )
  for (const key of unique) {
    await tx.nombreGarantiaAsignable.upsert({
      where: { claveNormalizada: key },
      create: options.get(key)!,
      update: {},
    })
  }
  await tx.usuarioTipoGarantia.deleteMany({ where: { usuarioId } })
  if (unique.length)
    await tx.usuarioTipoGarantia.createMany({
      data: unique.map((claveNormalizada) => ({ usuarioId, claveNormalizada })),
    })
}

export async function createManagedUser(
  input: CreateUserInput,
  passwordHash: string,
) {
  const { password: _password, tiposGarantia, ...fields } = input
  const nombres = input.nombres ?? input.nombre
  return transaction(async (tx) => {
    const user = await tx.usuario.create({
      data: {
        ...fields,
        nombre: `${nombres} ${input.apellido}`,
        nombres,
        passwordHash,
      },
      select: { id: true },
    })
    await saveTypes(tx, user.id, tiposGarantia)
    return publicUser(
      await tx.usuario.findUniqueOrThrow({
        where: { id: user.id },
        select: safeSelect,
      }),
    )
  })
}

export async function updateManagedUser(id: string, input: UpdateUserInput) {
  return transaction(async (tx) => {
    const existing = await tx.usuario.findUnique({
      where: { id },
      select: {
        id: true,
        nombre: true,
        rol: true,
        activo: true,
        puedeCargarNominas: true,
      },
    })
    if (!existing)
      throw new UserManagementError(
        "USER_NOT_FOUND",
        "No se encontró el usuario.",
        404,
      )
    if (
      existing.rol === "ADMIN" &&
      existing.activo &&
      (input.rol !== "ADMIN" || !input.activo)
    ) {
      const admins = await tx.usuario.count({
        where: { rol: "ADMIN", activo: true },
      })
      if (admins <= 1)
        throw new UserManagementError(
          "LAST_ADMIN",
          "Debe quedar al menos un administrador activo.",
          409,
        )
    }
    const { tiposGarantia, ...fields } = input
    const split =
      input.nombres != null && input.apellido != null
        ? {
            nombres: input.nombres,
            apellido: input.apellido,
            nombre: `${input.nombres} ${input.apellido}`,
          }
        : input.nombre !== existing.nombre || input.nombres !== undefined
          ? {
              nombre: input.nombre,
              nombres: null,
              apellido: input.apellido ?? null,
            }
          : {}
    const puedeCargarNominas =
      input.rol === "LECTOR"
        ? false
        : (input.puedeCargarNominas ??
          (input.rol !== existing.rol ? false : existing.puedeCargarNominas))
    await tx.usuario.update({
      where: { id },
      data: { ...fields, ...split, puedeCargarNominas },
      select: { id: true },
    })
    await saveTypes(tx, id, tiposGarantia)
    if (!input.activo)
      await tx.sesionUsuario.deleteMany({ where: { usuarioId: id } })
    return publicUser(
      await tx.usuario.findUniqueOrThrow({ where: { id }, select: safeSelect }),
    )
  })
}

export async function changePassword(id: string, passwordHash: string) {
  return transaction(async (tx) => {
    if (!(await tx.usuario.findUnique({ where: { id }, select: { id: true } })))
      throw new UserManagementError(
        "USER_NOT_FOUND",
        "No se encontró el usuario.",
        404,
      )
    await tx.usuario.update({
      where: { id },
      data: { passwordHash },
      select: { id: true },
    })
    await tx.sesionUsuario.deleteMany({ where: { usuarioId: id } })
  })
}
