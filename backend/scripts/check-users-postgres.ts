// Prueba real sobre un clúster temporal dedicado. No carga .env ni importa server.ts.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import fs from "node:fs"

const isolated = process.env.GES_USERS_TEST_DATABASE_URL
if (!isolated)
  throw new Error("Se requiere una conexión de pruebas aislada explícita.")
const connection = new URL(isolated)
if (
  connection.hostname !== "127.0.0.1" ||
  Number(connection.port) < 55000 ||
  connection.pathname !== "/ges_users_isolated" ||
  process.env.AUTO_EMAIL_ENABLED !== "false"
)
  throw new Error(
    "El destino no es la instancia temporal autorizada o la automatización no está deshabilitada.",
  )
process.env.DATABASE_URL = isolated
const { prisma } = await import("../src/db/prisma.js")
const ids = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
]

try {
  const [identity] = await prisma.$queryRaw<Array<{
    cluster: string
  }>>`SELECT current_setting('cluster_name') AS cluster`
  assert.equal(identity.cluster, "ges_users_isolated")
  for (const [index, id] of ids.entries()) {
    await prisma.$executeRaw`INSERT INTO "Usuario" (id, nombre, username, email, rol, "updatedAt") VALUES (${id}::uuid, ${
      index === 2 ? "Juan Carlos del Río" : "Administrador de prueba " + index
    }, ${"legacy." + index}, ${"legacy" + index + "@example.test"}, ${
      index === 2 ? "PROFESIONAL" : "ADMIN"
    }::"RolUsuario", CURRENT_TIMESTAMP)`
  }
  const legacyBefore =
    await prisma.$queryRaw`SELECT id, nombre, username, email, rol FROM "Usuario" ORDER BY id`
  let migration = new URL(
    "../prisma/migrations/20261104120000_user_guarantee_type_assignments/migration.sql",
    import.meta.url,
  )
  if (!fs.existsSync(fileURLToPath(migration)))
    migration = new URL(
      "../../prisma/migrations/20261104120000_user_guarantee_type_assignments/migration.sql",
      import.meta.url,
    )
  assert.ok(process.env.GES_TEST_PSQL)
  const applied = spawnSync(
    process.env.GES_TEST_PSQL!,
    [
      "-X",
      "-h",
      "127.0.0.1",
      "-p",
      connection.port,
      "-U",
      "ges_test",
      "-d",
      "ges_users_isolated",
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      fileURLToPath(migration),
    ],
    { windowsHide: true, encoding: "utf8" },
  )
  assert.equal(
    applied.status,
    0,
    "La nueva migración debe aplicarse sobre las cuentas antiguas.",
  )
  assert.deepEqual(
    await prisma.$queryRaw`SELECT id, nombre, username, email, rol FROM "Usuario" ORDER BY id`,
    legacyBefore,
  )

  const ruleMigration = new URL("../20261117120000_user_assignment_rules/migration.sql", migration)
  const rulesApplied = spawnSync(process.env.GES_TEST_PSQL!, ["-X", "-h", "127.0.0.1", "-p", connection.port, "-U", "ges_test", "-d", "ges_users_isolated", "-v", "ON_ERROR_STOP=1", "-f", fileURLToPath(ruleMigration)], { windowsHide: true, encoding: "utf8" })
  assert.equal(rulesApplied.status, 0, "Se aplica la migración de reglas de asignación.")

  const {
    createManagedUser,
    updateManagedUser,
    getUser,
    listUsers,
    listGuaranteeTypes,
    changePassword,
  } = await import("../src/modules/usuarios/repository.js")
  const { createSchema, updateSchema } = await import(
    "../src/modules/usuarios/schema.js"
  )
  const { hashPassword, verifyPassword, authenticateUser } = await import(
    "../src/modules/auth/auth-service.js"
  )
  const old = await getUser(ids[2])
  assert.equal(old.nombre, "Juan Carlos del Río")
  assert.equal(old.nombres, null)
  assert.equal(old.apellido, null)
  assert.equal(old.recibirInformeAutomatico, false)
  assert.deepEqual(old.tiposGarantia, [])

  for (const nombre of [
    "Consulta de especialidad",
    "Tratamiento",
    "Tratamiento inicial",
    "Fallo controlado",
  ])
    await prisma.tipoGarantia.create({
      data: { nombre, claveNormalizada: nombre.toLowerCase() },
    })
  const patient = await prisma.paciente.create({
    data: { rutNumero: "12345678", dv: "5", nombre: "Paciente aislado" },
  })
  for (const nombreGarantia of [
    " CONSULTA de ESPECIALIDAD!!! ",
    "Confirmación diagnóstica",
  ])
    await prisma.garantia.create({
      data: {
        pacienteId: patient.id,
        problemaSalud: "Problema de prueba",
        nombreGarantia,
        fechaInicio: new Date("2026-01-01"),
        fechaLimite: new Date("2026-11-01"),
        responsable: "Centro de origen",
        gestionadaPorUsuarioId: old.id,
      },
    })
  const guarantee = await prisma.garantia.findFirstOrThrow()
  await prisma.eventoGarantia.create({
    data: {
      garantiaId: guarantee.id,
      usuarioId: old.id,
      autorNombre: old.nombre,
      tipo: "ACTUACION",
      tipoActuacion: "OTRA_GESTION",
      comentario: "Actuación de prueba",
    },
  })
  await prisma.importacion.create({
    data: {
      usuarioId: old.id,
      nombreArchivo: "prueba-aislada.xlsx",
      estado: "COMPLETADA",
    },
  })
  const options = await listGuaranteeTypes()
  assert.equal(options.length, 5) // Solo se unifican variantes según el importador.
  assert.ok(
    options.some(
      (item) => item.claveNormalizada === "confirmacion diagnostica",
    ),
  )
  assert.ok(
    options.some((item) => item.claveNormalizada === "tratamiento inicial"),
  )
  assert.equal(
    await prisma.nombreGarantiaAsignable.count(),
    0,
    "Consultar opciones no escribe registros.",
  )

  const password = "a-long-isolated-password"
  const passwordHash = await hashPassword(password)
  const create = (username: string, tiposGarantia: string[]) =>
    createManagedUser(
      createSchema.parse({
        nombre: "María",
        apellido: "Pérez",
        username,
        email: username + "@example.test",
        rol: "PROFESIONAL",
        password,
        tiposGarantia,
      }),
      passwordHash,
    )
  const first = await create("prueba.uno", [
    "tratamiento",
    "confirmacion diagnostica",
    "tratamiento",
  ])
  const second = await create("prueba.dos", ["tratamiento"])
  assert.equal(first.nombre, "María Pérez")
  assert.equal(first.nombres, "María")
  assert.equal(first.apellido, "Pérez")
  assert.equal(first.recibirInformeAutomatico, false)
  assert.equal(first.tiposGarantia.length, 2)
  assert.equal(second.tiposGarantia.length, 1)
  assert.equal(
    await prisma.usuarioTipoGarantia.count({
      where: { claveNormalizada: "tratamiento" },
    }),
    2,
  )
  const stored = await prisma.usuario.findUniqueOrThrow({
    where: { id: first.id },
  })
  assert.notEqual(stored.passwordHash, password)
  assert.equal(await verifyPassword(password, stored.passwordHash), true)
  assert.ok(!("passwordHash" in first) && !("password" in first))
  assert.ok(await authenticateUser("prueba.uno", password))
  assert.equal(
    await authenticateUser(first.email, password),
    null,
    "El login sigue utilizando username.",
  )

  const edit = (user: typeof first, patch: Record<string, unknown> = {}) =>
    updateSchema.parse({
      nombre: user.nombre,
      email: user.email,
      rol: user.rol,
      activo: user.activo,
      ...patch,
    })
  await updateManagedUser(
    first.id,
    edit(first, {
      recibirInformeAutomatico: true,
      tiposGarantia: ["tratamiento"],
      email: "nuevo@example.test",
    }),
  )
  const queried = await getUser(first.id)
  assert.equal(queried.email, "nuevo@example.test")
  assert.equal(queried.recibirInformeAutomatico, true)
  assert.equal(queried.tiposGarantia.length, 1)
  assert.equal(queried.nombres, "María")
  assert.equal((await getUser(second.id)).tiposGarantia.length, 1)
  assert.ok(
    await prisma.nombreGarantiaAsignable.findUnique({
      where: { claveNormalizada: "confirmacion diagnostica" },
    }),
  )
  assert.equal(await prisma.tipoGarantia.count(), 4)
  await assert.rejects(
    prisma.usuarioTipoGarantia.create({
      data: { usuarioId: second.id, claveNormalizada: "tratamiento" },
    }),
    { code: "P2002" },
  )
  await assert.rejects(create("prueba.dos", []), { code: "P2002" })
  await assert.rejects(
    updateManagedUser(first.id, edit(queried, { email: second.email })),
    { code: "P2002" },
  )
  await assert.rejects(
    updateManagedUser(
      first.id,
      edit(queried, {
        nombre: "Cambio inválido",
        tiposGarantia: ["no existe"],
      }),
    ),
    { code: "INVALID_GUARANTEE_TYPE" },
  )
  assert.deepEqual(
    await getUser(first.id),
    queried,
    "El fallo de validación revierte nombre y asociaciones.",
  )

  // Falla después de actualizar usuario, crear el tipo y quitar sus selecciones anteriores.
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION reject_test_assignment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."claveNormalizada" = 'fallo controlado' THEN RAISE EXCEPTION 'Fallo aislado de prueba'; END IF; RETURN NEW; END $$`,
  )
  await prisma.$executeRawUnsafe(
    'CREATE TRIGGER reject_test_assignment BEFORE INSERT ON "UsuarioTipoGarantia" FOR EACH ROW EXECUTE FUNCTION reject_test_assignment()',
  )
  await assert.rejects(
    updateManagedUser(
      first.id,
      edit(queried, {
        nombre: "No persistir",
        recibirInformeAutomatico: false,
        tiposGarantia: ["fallo controlado"],
      }),
    ),
  )
  assert.deepEqual(
    await getUser(first.id),
    queried,
    "La transacción revierte también una falla posterior al borrado de relaciones.",
  )
  assert.equal(
    await prisma.nombreGarantiaAsignable.findUnique({
      where: { claveNormalizada: "fallo controlado" },
    }),
    null,
  )

  const splitOld = await updateManagedUser(
    old.id,
    edit(old, {
      nombres: "Juan Carlos",
      apellido: "del Río",
      tiposGarantia: ["tratamiento"],
      recibirInformeAutomatico: true,
    }),
  )
  assert.equal(splitOld.nombre, old.nombre)
  assert.equal(splitOld.apellido, "del Río")
  await prisma.sesionUsuario.create({
    data: {
      usuarioId: old.id,
      tokenHash: "isolated-session",
      expiraAt: new Date(Date.now() + 60000),
    },
  })
  await updateManagedUser(old.id, edit(splitOld, { activo: false }))
  assert.equal(
    await prisma.sesionUsuario.count({ where: { usuarioId: old.id } }),
    0,
  )
  assert.equal(
    await prisma.importacion.count({ where: { usuarioId: old.id } }),
    1,
  )
  assert.equal(
    await prisma.eventoGarantia.count({ where: { usuarioId: old.id } }),
    1,
  )
  assert.equal((await getUser(old.id)).tiposGarantia.length, 1)
  assert.equal((await getUser(old.id)).recibirInformeAutomatico, true)
  assert.equal(
    (await prisma.garantia.findUniqueOrThrow({ where: { id: guarantee.id } }))
      .responsable,
    "Centro de origen",
  )
  const reactivated = await updateManagedUser(old.id, edit(splitOld))
  assert.equal(reactivated.activo, true)
  assert.equal(reactivated.tiposGarantia.length, 1)

  await prisma.sesionUsuario.create({
    data: {
      usuarioId: first.id,
      tokenHash: "password-session",
      expiraAt: new Date(Date.now() + 60000),
    },
  })
  await changePassword(
    first.id,
    await hashPassword("another-isolated-password"),
  )
  assert.equal(
    await prisma.sesionUsuario.count({ where: { usuarioId: first.id } }),
    0,
  )
  assert.ok(await authenticateUser("prueba.uno", "another-isolated-password"))

  const admins = await Promise.all(ids.slice(0, 2).map(getUser))
  const concurrent = await Promise.allSettled(
    admins.map((admin) =>
      updateManagedUser(admin.id, edit(admin, { activo: false })),
    ),
  )
  assert.equal(
    concurrent.filter((result) => result.status === "fulfilled").length,
    1,
  )
  assert.equal(
    await prisma.usuario.count({ where: { rol: "ADMIN", activo: true } }),
    1,
  )
  const last = (await listUsers()).data.find(
    (user) => user.rol === "ADMIN" && user.activo,
  )!
  await assert.rejects(
    updateManagedUser(last.id, edit(last, { rol: "LECTOR" })),
    { code: "LAST_ADMIN" },
  )
  await assert.rejects(
    updateManagedUser(last.id, edit(last, { activo: false })),
    { code: "LAST_ADMIN" },
  )
  const summary = (await listUsers()).resumen
  assert.equal(summary.total, 5)
  assert.equal(summary.activos, 4)
  assert.equal(summary.informesHabilitados, 2)
  assert.equal(await prisma.envioInformeCorreo.count(), 0)
  assert.equal(await prisma.configuracionNotificaciones.count(), 0)
  const { guaranteeScopeFor, canAccessGuarantee } = await import("../src/modules/garantias/assignment-scope.js")
  const { listAssignmentOptions } = await import("../src/modules/usuarios/repository.js")
  const assignmentOptions = await listAssignmentOptions()
  assert.ok(assignmentOptions.establecimientos.some((option) => option.claveNormalizada === "centro de origen"))
  const rules = [{ problemaSalud: "problema de prueba", establecimiento: "centro de origen", tipoGarantia: "consulta de especialidad" }]
  const scopedUser = await updateManagedUser(first.id, edit(await getUser(first.id), { reglasAsignacion: rules }))
  assert.deepEqual(scopedUser.reglasAsignacion, rules)
  const visible = await prisma.garantia.findMany({ where: await guaranteeScopeFor(scopedUser) })
  assert.equal(visible.length, 1, "PostgreSQL combina los tres criterios de la regla.")
  const foreign = await prisma.garantia.create({ data: { pacienteId: patient.id, problemaSalud: "Problema de prueba", nombreGarantia: "Consulta de especialidad", responsable: "Otro establecimiento", fechaInicio: new Date("2026-01-01"), fechaLimite: new Date("2026-11-01") } })
  assert.equal(await canAccessGuarantee(scopedUser, foreign), false)
  assert.equal(await prisma.garantia.count({ where: await guaranteeScopeFor(scopedUser) }), 1)
  await updateManagedUser(first.id, edit(scopedUser, { reglasAsignacion: [] }))
  assert.equal(await prisma.garantia.count({ where: await guaranteeScopeFor(scopedUser) }), 0, "Quitar todas las reglas no reactiva tipos anteriores.")
  console.info(
    "PostgreSQL aislado: migración con nombres anteriores, nombres separados, unicidad, relaciones múltiples, persistencia, eliminación de selecciones, rollback real, preferencias, sesiones, antecedentes y protección concurrente del último ADMIN verificados. Sin SMTP ni escrituras en QA.",
  )
} finally {
  await prisma.$disconnect()
}
