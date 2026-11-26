// Explicit fresh isolated PostgreSQL only. Never uses an implicit DB URL.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";

const isolated = process.env.GES_ROWS_TEST_DATABASE_URL;
if (!isolated) throw new Error("EXPLICIT_ISOLATED_DATABASE_REQUIRED");
const url = new URL(isolated);
if (url.hostname !== "127.0.0.1" || Number(url.port) < 55000 || url.pathname !== "/ges_rows_isolated" || process.env.AUTO_EMAIL_ENABLED !== "false") throw new Error("ISOLATED_DATABASE_GUARD_FAILED");
process.env.DATABASE_URL = isolated;
process.env.CORS_ORIGINS = "http://localhost:8443";
process.env.IMPORT_RETENTION_ENABLED = "false"; process.env.DATA_QUALITY_ENABLED = "false";
const { PrismaClient } = await import("@prisma/client");
const { readSupervisionActivity } = await import("../src/modules/supervision/activity-repository.js");
const { createQualityResolutionService } = await import("../src/modules/calidad-datos/resolution-service.js");
const { importWorkbookWithRetention } = await import("../src/modules/importaciones/retained-import-service.js");
const { hash } = await import("../src/modules/calidad-datos/candidate-evidence.js");
const { RETENTION_POLICY_VERSION } = await import("../src/modules/importaciones/retention-policy.js");
const { prisma: operationalClient } = await import("../src/db/prisma.js");
const db = new PrismaClient({ datasourceUrl: isolated, log: [] });
let checks = 0, activeCheck = "cluster_identity";
let app: Awaited<ReturnType<typeof import("../src/app.js")["buildApp"]>> | undefined;
async function check(name: string, work: () => Promise<void>) { activeCheck = name; await work(); checks++; console.log(JSON.stringify({ check: name, passed: true })); }
async function digest() {
  const output = [];
  for (const table of ["Garantia", "Paciente", "EventoGarantia", "FilaImportacion", "ResolucionFilaImportacion", "Importacion", "ControlRetencionImportacion"]) {
    const rows = await db.$queryRawUnsafe(`SELECT count(*)::text AS count,md5(coalesce(string_agg(row_hash,'' ORDER BY row_hash),'')) AS digest FROM (SELECT md5(to_jsonb(t)::text) AS row_hash FROM "${table}" t) hashed`);
    output.push({ table, rows });
  }
  return JSON.stringify(output);
}
try {
  const [identity] = await db.$queryRaw<Array<{ database: string; cluster: string }>>`SELECT current_database() AS database,current_setting('cluster_name') AS cluster`;
  assert.deepEqual(identity, { database: "ges_rows_isolated", cluster: "ges_rows_isolated" });
  const actors = await Promise.all((["ADMIN", "COORDINADOR_SOME", "PROFESIONAL", "LECTOR"] as const).map((rol, index) => db.usuario.create({ data: { nombre: `Cronología sintética ${rol}`, username: `supervision-feed-${index}`, email: `supervision-feed-${index}@example.test`, rol } })));
  const [admin, coordinator, professional] = actors;
  const patient = await db.paciente.create({ data: { rutNumero: "44444444", dv: "4", nombre: "Paciente de cronología sintético" } });
  const guarantee = await db.garantia.create({ data: { pacienteId: patient.id, problemaSalud: "Problema de cronología", nombreGarantia: "Tratamiento de cronología", fechaInicio: new Date("2026-10-01"), fechaLimite: new Date("2026-12-01"), responsable: "Centro de cronología", estadoGestion: "EN_GESTION", version: 3, revisionGestion: 2 } });
  const normal = await db.eventoGarantia.create({ data: { garantiaId: guarantee.id, usuarioId: professional.id, autorNombre: professional.nombre, tipo: "ACTUACION", tipoActuacion: "CITACION", comentario: "Actuación real sintética conservada", estadoNuevo: "EN_GESTION" } });
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("Hoja de revisión sintética");
  sheet.addRow(["Problema de salud", "RUT", "DV", "Nombre", "Fecha de Inicio", "Fecha Limite", "Dias que faltan para el Vencimiento de la Garantia", "Nombre de la garantia", "Responsable de la garantia"]);
  for (const start of ["2026-10-02", "2026-10-03"]) sheet.addRow([guarantee.problemaSalud, patient.rutNumero, patient.dv, patient.nombre, start, "2026-12-01", 0, guarantee.nombreGarantia, guarantee.responsable]);
  const imported = await importWorkbookWithRetention(db, Buffer.from(await book.xlsx.writeBuffer()), "cronologia-sintetica.xlsx", professional.id);
  assert.equal(imported.registrosPendientesRevision, 2);
  const pending = await db.filaImportacion.findMany({ where: { importacionId: imported.id }, orderBy: { numeroFila: "asc" } });
  const resolutionService = createQualityResolutionService(db);
  const sourceBefore = JSON.stringify(await db.garantia.findUniqueOrThrow({ where: { id: guarantee.id }, include: { paciente: true, eventos: true } }));
  const managementCount = await db.eventoGarantia.count();
  const sameDetail = await resolutionService.getPending(admin, pending[0].id);
  const same = await resolutionService.resolve(admin, pending[0].id, { decision: "MISMA", version: 1, solicitudId: randomUUID(), huellaRevision: sameDetail.huellaRevision, justificacion: "Se conserva el episodio existente según revisión sintética", garantiaExistenteId: guarantee.id });
  const distinctDetail = await resolutionService.getPending(coordinator, pending[1].id);
  const distinct = await resolutionService.resolve(coordinator, pending[1].id, { decision: "DISTINTA", version: 1, solicitudId: randomUUID(), huellaRevision: distinctDetail.huellaRevision, justificacion: "Se confirma un episodio independiente según revisión sintética", confirmaDistintaDeTodas: true });
  await check("actual_same_and_distinct_resolutions_appear_with_the_correct_result_and_origin", async () => {
    const events = await readSupervisionActivity(db);
    const sameEvent = events.find(event => event.id === `revision-importacion:${same.resolucion.id}`), distinctEvent = events.find(event => event.id === `revision-importacion:${distinct.resolucion.id}`);
    assert.ok(sameEvent?.tipo === "REVISION_IMPORTACION" && distinctEvent?.tipo === "REVISION_IMPORTACION");
    assert.equal(sameEvent.garantia.id, guarantee.id); assert.equal(distinctEvent.garantia.id, distinct.resolucion.garantiaResultadoId);
    assert.equal(sameEvent.revisionImportacion.descripcion, "Se confirmó que los datos recibidos corresponden a una garantía existente");
    assert.equal(distinctEvent.revisionImportacion.descripcion, "Se confirmó una garantía distinta y se incorporó un nuevo registro");
    assert.equal(sameEvent.autorNombre, admin.nombre); assert.equal(distinctEvent.autorNombre, coordinator.nombre);
    assert.equal(sameEvent.revisionImportacion.justificacion, same.resolucion.justificacion);
    assert.deepEqual(distinctEvent.revisionImportacion.origen, { archivo: "cronologia-sintetica.xlsx", hoja: sheet.name, numeroFila: pending[1].numeroFila, importacionId: imported.id });
    assert.ok(events.some(event => event.id === normal.id && event.tipo === "ACTUACION"));
    assert.equal(await db.eventoGarantia.count(), managementCount);
    assert.equal(JSON.stringify(await db.garantia.findUniqueOrThrow({ where: { id: guarantee.id }, include: { paciente: true, eventos: true } })), sourceBefore);
  });
  await check("disabled_retention_and_api_do_not_hide_existing_decisions_or_write_any_tables", async () => {
    const before = await digest(), first = await readSupervisionActivity(db), second = await readSupervisionActivity(db);
    assert.equal(process.env.IMPORT_RETENTION_ENABLED, "false"); assert.equal(process.env.DATA_QUALITY_ENABLED, "false");
    assert.deepEqual(first, second); assert.equal(await digest(), before);
    assert.equal(first.filter(event => event.id === `revision-importacion:${same.resolucion.id}`).length, 1);
  });
  await check("historical_author_is_preserved_after_the_account_name_changes", async () => {
    await db.usuario.update({ where: { id: admin.id }, data: { nombre: "Nombre actual diferente del autor histórico" } });
    const event = (await readSupervisionActivity(db)).find(event => event.id === `revision-importacion:${same.resolucion.id}`);
    assert.equal(event?.autorNombre, admin.nombre);
  });
  await check("real_endpoint_keeps_authorization_and_no_cache_with_both_flags_disabled", async () => {
    const { buildApp } = await import("../src/app.js"), { createSession } = await import("../src/modules/auth/auth-service.js");
    app = buildApp(); app.log.level = "silent"; await app.ready();
    for (const actor of actors) {
      const cookie = `ges_session=${(await createSession(actor.id)).token}`;
      const response: import("light-my-request").Response = await app.inject({ method: "GET", url: "/api/supervision/eventos", headers: { cookie } });
      const allowed = actor.rol === "ADMIN" || actor.rol === "COORDINADOR_SOME";
      assert.equal(response.statusCode, allowed ? 200 : 403);
      if (allowed) {
        const data = response.json().data;
        assert.equal(data.zonaHoraria, "America/Santiago"); assert.equal(data.limite, 30); assert.equal(response.headers["cache-control"], "no-store");
        assert.ok(data.eventos.some((event: { id: string }) => event.id === `revision-importacion:${distinct.resolucion.id}`));
        for (const key of ["rutNumero", "passwordHash", "huellaSolicitud", "antecedentesRevisados", "email"]) assert.ok(!response.body.includes(`"${key}"`));
      } else assert.equal(response.json().data, undefined);
    }
    assert.equal((await app.inject({ method: "GET", url: "/api/supervision/eventos" })).statusCode, 401);
  });

  // Explicit synthetic persisted fixtures exercise the global boundary and ties.
  // Their future timestamps isolate them from the previous regression fixtures.
  const sourceImport = await db.importacion.create({ data: { nombreArchivo: "limite-cronologia-sintetica.xlsx", usuarioId: professional.id, estado: "COMPLETADA_CON_OBSERVACIONES", registrosLeidos: 50 } });
  let rowNumber = 100;
  async function reviewFixture(createdAt: Date, id = randomUUID()) {
    const numeroFila = rowNumber++;
    return db.$transaction(async tx => {
      const data = { numeroFila, problemaSalud: guarantee.problemaSalud, rut: patient.rutNumero, dv: patient.dv, nombre: patient.nombre, fechaInicio: "2026-10-02", fechaLimite: "2026-12-01", nombreGarantia: guarantee.nombreGarantia, responsable: guarantee.responsable };
      const row = await tx.filaImportacion.create({ data: { importacionId: sourceImport.id, hoja: "Límite sintético", numeroFila, datosValidados: data, motivos: ["FECHA_INICIO_DISTINTA"], versionPolitica: RETENTION_POLICY_VERSION, huellaFila: hash(data), huellaDatos: hash(data), huellaCandidatos: hash([]), estado: "RESUELTA", version: 2, garantiaResultadoId: guarantee.id } });
      return tx.resolucionFilaImportacion.create({ data: { id, filaId: row.id, decision: "MISMA", usuarioId: coordinator.id, autorNombre: coordinator.nombre, justificacion: "Revisión de cronología sintética persistida", solicitudId: randomUUID(), huellaSolicitud: hash(id), garantiaResultadoId: guarantee.id, createdAt } });
    });
  }
  const normalIds: string[] = [], reviewIds: string[] = [], base = Date.UTC(2031, 0, 1, 12);
  for (let index = 0; index < 40; index++) {
    const event = await db.eventoGarantia.create({ data: { garantiaId: guarantee.id, usuarioId: professional.id, autorNombre: professional.nombre, tipo: "ACTUACION", tipoActuacion: "CITACION", comentario: "Límite sintético", estadoNuevo: "EN_GESTION", createdAt: new Date(base + index * 2000) } });
    normalIds.push(event.id); reviewIds.push((await reviewFixture(new Date(base + index * 2000 + 1000))).id);
  }
  await check("single_global_window_returns_the_latest_30_across_80_interleaved_records", async () => {
    const events = await readSupervisionActivity(db), expected: string[] = [];
    for (let index = 39; index >= 25; index--) expected.push(`revision-importacion:${reviewIds[index]}`, normalIds[index]);
    assert.deepEqual(events.map(event => event.id), expected); assert.equal(events.length, 30);
    assert.equal(events.filter(event => event.tipo === "REVISION_IMPORTACION").length, 15);
    assert.equal(new Set(events.map(event => event.id)).size, 30);
    assert.ok(events.every((event, index) => !index || event.createdAt <= events[index - 1].createdAt));
  });
  await check("same_timestamp_and_cross_table_id_collision_have_a_deterministic_unique_order", async () => {
    const stamp = new Date("2032-01-01T12:00:00Z"), id = randomUUID();
    const first = await db.eventoGarantia.create({ data: { id, garantiaId: guarantee.id, usuarioId: professional.id, autorNombre: professional.nombre, tipo: "ACTUACION", tipoActuacion: "CITACION", createdAt: stamp } });
    const second = await db.eventoGarantia.create({ data: { garantiaId: guarantee.id, usuarioId: professional.id, autorNombre: professional.nombre, tipo: "ACTUACION", tipoActuacion: "CITACION", createdAt: stamp } });
    const reviewOne = await reviewFixture(stamp, id), reviewTwo = await reviewFixture(stamp);
    const before = await digest(), events = await readSupervisionActivity(db), repeated = await readSupervisionActivity(db);
    assert.deepEqual(events.slice(0, 4).map(event => event.id), [second.id, first.id, ...[reviewOne.id, reviewTwo.id].sort().reverse().map(value => `revision-importacion:${value}`)]);
    assert.equal(new Set(events.map(event => event.id)).size, events.length); assert.deepEqual(events, repeated); assert.equal(await digest(), before);
  });
  console.log(JSON.stringify({ passed: true, isolatedPostgres: true, checks, qaAccessed: false, productionAccessed: false, retentionEnabled: false, apiEnabled: false, migrationsAdded: false }));
} catch (error) {
  console.log(JSON.stringify({ passed: false, check: activeCheck, checks, code: (error as { code?: string }).code ?? "ISOLATED_CHECK_FAILED", type: error instanceof assert.AssertionError ? "ASSERTION_FAILED" : "INTEGRATION_FAILED" }));
  process.exitCode = 1;
} finally { await app?.close(); await operationalClient.$disconnect(); await db.$disconnect(); }
