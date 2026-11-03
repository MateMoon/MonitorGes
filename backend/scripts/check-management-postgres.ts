// Prueba real exclusivamente en el clúster temporal creado por el runner PowerShell.
// No carga .env ni usa DATABASE_URL como fuente de conexión.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

const isolated = process.env.GES_MANAGEMENT_TEST_DATABASE_URL;
if (!isolated) throw new Error("Se requiere una conexión aislada explícita.");
const connection = new URL(isolated);
if (connection.hostname !== "127.0.0.1" || Number(connection.port) < 55000 || connection.pathname !== "/ges_management_isolated") throw new Error("La conexión no identifica la instancia temporal autorizada.");
if (process.env.AUTO_EMAIL_ENABLED !== "false") throw new Error("Las pruebas requieren AUTO_EMAIL_ENABLED=false.");
process.env.DATABASE_URL = isolated;
const { prisma } = await import("../src/db/prisma.js");
const adminId = "00000000-0000-4000-8000-000000000001";
const professionalId = "00000000-0000-4000-8000-000000000002";
const patientId = "00000000-0000-4000-8000-000000000003";
const guaranteeId = "00000000-0000-4000-8000-000000000004";
const legacyId = "00000000-0000-4000-8000-000000000005";
const oldDate = new Date("2026-10-28T12:00:00Z");
const admin = { id: adminId, nombre: "Admin aislado", rol: "ADMIN" };
const professional = { id: professionalId, nombre: "Profesional aislado", rol: "PROFESIONAL" };
let app: FastifyInstance | undefined;

try {
  const cluster = await prisma.$queryRaw<Array<{ cluster: string }>>`SELECT current_setting('cluster_name') AS cluster`;
  assert.equal(cluster[0].cluster, "ges_management_isolated", "No se permite ejecutar esta prueba en otro clúster.");
  // Datos mínimos sintéticos en el esquema anterior: permiten probar el backfill.
  for (const user of [admin, professional]) await prisma.$executeRaw`INSERT INTO "Usuario" ("id", "nombre", "username", "email", "rol", "updatedAt") VALUES (${user.id}::uuid, ${user.nombre}, ${user.id}, ${user.id + '@example.test'}, ${user.rol}::"RolUsuario", CURRENT_TIMESTAMP)`;
  await prisma.$executeRaw`INSERT INTO "Paciente" ("id", "rutNumero", "dv", "nombre", "updatedAt") VALUES (${patientId}::uuid, '12345678', '5', 'Paciente aislado', CURRENT_TIMESTAMP)`;
  for (const id of [guaranteeId, legacyId]) await prisma.$executeRaw`INSERT INTO "Garantia" ("id", "pacienteId", "problemaSalud", "nombreGarantia", "fechaInicio", "fechaLimite", "responsable", "updatedAt", "gestionadaAt", "gestionadaPorUsuarioId") VALUES (${id}::uuid, ${patientId}::uuid, 'Problema aislado', 'Garantía aislada', DATE '2026-10-01', DATE '2026-11-01', 'Centro aislado', CURRENT_TIMESTAMP, (CAST(${id === legacyId ? oldDate : null} AS timestamptz) AT TIME ZONE 'UTC'), ${id === legacyId ? professionalId : null}::uuid)`;
  const psql = process.env.GES_TEST_PSQL;
  assert.ok(psql);
  const applied = spawnSync(psql, ["-X", "-h", "127.0.0.1", "-p", connection.port, "-U", "ges_test", "-d", "ges_management_isolated", "-v", "ON_ERROR_STOP=1", "-f", fileURLToPath(new URL("../prisma/migrations/20261103120000_guarantee_management_timeline/migration.sql", import.meta.url))], { windowsHide: true, encoding: "utf8" });
  assert.equal(applied.status, 0, "La migración nueva debe aplicarse sobre registros anteriores en la instancia aislada.");

  const { writeManagement } = await import("../src/modules/garantias/management-repository.js");
  const { findGuarantee, listGuarantees } = await import("../src/modules/garantias/repository.js");
  const { dashboardData } = await import("../src/modules/dashboard/repository.js");
  const { listQuerySchema } = await import("../src/modules/garantias/schema.js");
  const { findReportGuarantees } = await import("../src/modules/notificaciones/email-report-repository.js");
  const initial = (await findGuarantee(guaranteeId))!;
  const legacy = (await findGuarantee(legacyId))!;
  assert.equal(initial.estadoGestion, "SIN_GESTION"); assert.equal(initial.eventos.length, 0);
  assert.equal(legacy.estadoGestion, "EN_GESTION"); assert.equal(legacy.eventos.length, 1);
  assert.equal(legacy.eventos[0].tipo, "ANTECEDENTE_LEGADO");
  assert.equal(legacy.eventos[0].tipoActuacion, null); assert.equal(legacy.eventos[0].comentario, null);
  assert.equal(legacy.eventos[0].createdAt.toISOString(), oldDate.toISOString());
  assert.equal(legacy.gestionadaPorUsuarioId, professionalId);
  const created = await prisma.garantia.create({ data: { pacienteId: patientId, problemaSalud: "Nuevo caso aislado", nombreGarantia: "Garantía nueva", fechaInicio: initial.fechaInicio, fechaLimite: initial.fechaLimite, responsable: "Centro aislado" } });
  assert.equal(created.estadoGestion, "SIN_GESTION");

  const act = (revisionGestion: number) => ({ operacion: "actuacion" as const, tipoActuacion: "ATENCION_REALIZADA" as const, revisionGestion });
  await writeManagement(guaranteeId, professional, act(0));
  await writeManagement(guaranteeId, professional, act(1));
  let detail = (await findGuarantee(guaranteeId))!;
  assert.equal(detail.estadoGestion, "EN_GESTION"); assert.equal(detail.eventos.length, 2);
  assert.equal(detail.gestionadaAt!.toISOString(), detail.eventos[0].createdAt.toISOString());
  assert.equal(detail.fechaLimite.toISOString(), initial.fechaLimite.toISOString());
  assert.equal(detail.updatedAt.toISOString(), initial.updatedAt.toISOString());
  await assert.rejects(writeManagement(guaranteeId, admin, { operacion: "estado", estadoGestion: "CUMPLIDA", respaldo: " ", revisionGestion: 2 }));
  await writeManagement(guaranteeId, admin, { operacion: "estado", estadoGestion: "CUMPLIDA", respaldo: "Constancia aislada", revisionGestion: 2 });
  assert.equal((await findReportGuarantees("2026-11-03")).some((row) => row.id === guaranteeId), false);
  assert.equal((await findReportGuarantees("2026-11-03")).some((row) => row.id === legacyId), true);
  await assert.rejects(writeManagement(guaranteeId, professional, act(3)));
  await assert.rejects(writeManagement(guaranteeId, admin, { operacion: "reabrir", motivo: " ", revisionGestion: 3 }));
  await writeManagement(guaranteeId, admin, { operacion: "reabrir", motivo: "Revisión aislada", revisionGestion: 3 });
  await writeManagement(guaranteeId, professional, act(4));
  detail = (await findGuarantee(guaranteeId))!;
  assert.equal(detail.estadoGestion, "PENDIENTE_RESOLUCION"); assert.equal(detail.eventos.length, 5);
  assert.equal(detail.eventos.find((event) => event.tipo === "CUMPLIMIENTO")!.respaldo, "Constancia aislada");

  // Dos solicitudes con la misma revisión: el bloqueo de fila serializa y solo una se aplica.
  const concurrent = await Promise.allSettled([writeManagement(guaranteeId, professional, act(5)), writeManagement(guaranteeId, professional, act(5))]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await findGuarantee(guaranteeId))!.eventos.length, 6);

  // Fallo posterior a INSERT del evento: PostgreSQL debe revertir ambas escrituras.
  await prisma.$executeRawUnsafe(`CREATE FUNCTION reject_management_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'failure isolated test'; END $$`);
  await prisma.$executeRawUnsafe('CREATE TRIGGER reject_management_update BEFORE UPDATE ON "Garantia" FOR EACH ROW EXECUTE FUNCTION reject_management_update()');
  await assert.rejects(writeManagement(guaranteeId, admin, { operacion: "estado", estadoGestion: "CUMPLIDA", respaldo: "No debe persistir", revisionGestion: 6 }));
  await prisma.$executeRawUnsafe('DROP TRIGGER reject_management_update ON "Garantia"');
  detail = (await findGuarantee(guaranteeId))!;
  assert.equal(detail.estadoGestion, "PENDIENTE_RESOLUCION"); assert.equal(detail.revisionGestion, 6); assert.equal(detail.eventos.length, 6);

  // Orden estable para instantes iguales, verificado mediante ORDER BY real.
  const tie = new Date("2026-11-03T10:00:00Z");
  await prisma.eventoGarantia.updateMany({ where: { garantiaId: guaranteeId }, data: { createdAt: tie } });
  detail = (await findGuarantee(guaranteeId))!;
  assert.deepEqual(detail.eventos.map((event) => event.secuencia), detail.eventos.map((event) => event.secuencia).sort((a, b) => b - a));
  const dashboard = await dashboardData("2026-11-03");
  for (const [estadoGestion, count] of Object.entries(dashboard.conteosPorGestion)) {
    const filtered = await listGuarantees(listQuerySchema.parse({ estadoGestion }), "2026-11-03");
    assert.equal(filtered.total, count);
  }
  assert.equal((await listGuarantees(listQuerySchema.parse({ estado: "vencida", estadoGestion: "PENDIENTE_RESOLUCION" }), "2026-11-03")).total, 1);
  // Conexión nueva acredita persistencia, sin depender de objetos en memoria.
  await prisma.$disconnect();
  assert.equal((await findGuarantee(guaranteeId))!.estadoGestion, "PENDIENTE_RESOLUCION");
  assert.equal((await findGuarantee(legacyId))!.eventos.filter((event) => event.tipo === "ANTECEDENTE_LEGADO").length, 1);
  // Misma API que usa React, con sesiones y repositorios reales; sin escuchar puertos HTTP.
  const { buildApp } = await import("../src/app.js");
  const { createSession } = await import("../src/modules/auth/auth-service.js");
  const session = await createSession(professionalId);
  app = buildApp(); app.log.level = "silent";
  const headers = { cookie: `ges_session=${session.token}`, origin: "http://localhost:8443" };
  const response = await app.inject({ method: "GET", url: `/api/garantias/${guaranteeId}`, headers });
  assert.equal(response.statusCode, 200); assert.equal(response.json().data.eventos.length, 6);
  const denied = await app.inject({ method: "POST", url: `/api/garantias/${guaranteeId}/estado-gestion`, headers, payload: { estadoGestion: "CUMPLIDA", respaldo: "No autorizado", revisionGestion: 6 } });
  assert.equal(denied.statusCode, 403);
  const registered = await app.inject({ method: "POST", url: `/api/garantias/${guaranteeId}/gestion`, headers, payload: { tipoActuacion: "OTRA_GESTION", comentario: "Registro mediante API", revisionGestion: 6 } });
  assert.equal(registered.statusCode, 200); assert.equal(registered.json().data.estadoGestion, "PENDIENTE_RESOLUCION");
  assert.equal((await findGuarantee(guaranteeId))!.eventos.length, 7);
  const summary = await app.inject({ method: "GET", url: "/api/dashboard", headers });
  const list = await app.inject({ method: "GET", url: "/api/garantias?estadoGestion=PENDIENTE_RESOLUCION", headers });
  assert.equal(summary.statusCode, 200); assert.equal(list.statusCode, 200);
  assert.equal(summary.json().data.conteosPorGestion.PENDIENTE_RESOLUCION, list.json().pagination.total);
  console.info("PostgreSQL aislado: migración con antecedentes, estado inicial, actuaciones, cumplimiento, reapertura, concurrencia, rollback, orden, filtros, conteos y persistencia verificados. Sin SMTP ni acceso a QA.");
} finally { await app?.close(); await prisma.$disconnect(); }
