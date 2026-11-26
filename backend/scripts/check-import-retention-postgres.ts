// Explicit isolated cluster only. No HTTP server, SMTP, QA or production URL.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import type { Prisma, PrismaClient } from "@prisma/client";

const isolated = process.env.GES_ROWS_TEST_DATABASE_URL;
if (!isolated) throw new Error("EXPLICIT_ISOLATED_DATABASE_REQUIRED");
const url = new URL(isolated);
if (url.hostname !== "127.0.0.1" || Number(url.port) < 55000 || url.pathname !== "/ges_rows_isolated" || process.env.AUTO_EMAIL_ENABLED !== "false") throw new Error("ISOLATED_DATABASE_GUARD_FAILED");
process.env.DATABASE_URL = isolated;
const { PrismaClient: Client } = await import("@prisma/client");
const { importWorkbook } = await import("../src/modules/importaciones/import-service.js");
const { importWorkbookWithRetention } = await import("../src/modules/importaciones/retained-import-service.js");
const { createImportRowPersistence } = await import("../src/modules/calidad-datos/persistence-service.js");
const { prisma: operationalClient } = await import("../src/db/prisma.js");
const db = new Client({ datasourceUrl: isolated, log: [] });
let checks = 0, activeCheck = "isolated_identity", nextPerson = 20000000;
async function check(name: string, work: () => Promise<void>) { activeCheck = name; await work(); checks++; console.log(JSON.stringify({ check: name, passed: true })); }
const header = ["Problema de salud", "RUT", "DV", "Nombre", "Fecha de Inicio", "Fecha Limite", "Dias que faltan para el Vencimiento de la Garantia", "Nombre de la garantia", "Responsable de la garantia"];
function person() {
  const rut = String(nextPerson++); let total = 0, factor = 2;
  for (const digit of [...rut].reverse()) { total += Number(digit) * factor; factor = factor === 7 ? 2 : factor + 1; }
  const remainder = 11 - total % 11;
  return { rut, dv: remainder === 11 ? "0" : remainder === 10 ? "K" : String(remainder) };
}
type Person = ReturnType<typeof person>;
const row = (p: Person, patch: { start?: string; limit?: string; responsible?: string; guarantee?: string; name?: string; dv?: string; problem?: string } = {}) => [patch.problem ?? "Problema de integración sintético", p.rut, patch.dv ?? p.dv, patch.name ?? "Paciente de integración sintético", patch.start ?? "2026-10-01", patch.limit ?? "2026-12-01", 0, patch.guarantee ?? "Tratamiento de prueba", patch.responsible ?? "Centro de prueba"];
async function workbook(rows: Array<Array<string | number>>) {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("Origen sintético real");
  sheet.addRow(header); rows.forEach(item => sheet.addRow(item));
  const ignored = book.addWorksheet("No importada"); ignored.addRow(["Esta hoja no es la fuente"]);
  return Buffer.from(await book.xlsx.writeBuffer());
}
async function existing(p = person(), patch: Partial<Prisma.GarantiaUncheckedCreateInput> = {}) {
  const patient = await db.paciente.create({ data: { rutNumero: p.rut, dv: p.dv, nombre: "Paciente de integración sintético" } });
  const guarantee = await db.garantia.create({ data: { pacienteId: patient.id, problemaSalud: "Problema de integración sintético", nombreGarantia: "Tratamiento de prueba", fechaInicio: new Date("2026-10-01"), fechaLimite: new Date("2026-12-01"), responsable: "Centro de prueba", ...patch } });
  return { p, patient, guarantee };
}
try {
  const [identity] = await db.$queryRaw<Array<{ database: string; cluster: string }>>`SELECT current_database() AS database,current_setting('cluster_name') AS cluster`;
  assert.deepEqual(identity, { database: "ges_rows_isolated", cluster: "ges_rows_isolated" });
  process.env.IMPORT_RETENTION_ENABLED = "true";
  const [admin, coordinator, professional, reader] = await Promise.all((["ADMIN", "COORDINADOR_SOME", "PROFESIONAL", "LECTOR"] as const).map((rol, i) => db.usuario.create({ data: { nombre: `Integración sintética ${rol}`, username: `retention-${i}`, email: `retention-${i}@example.test`, rol } })));
  const run = async (rows: Array<Array<string | number>>, solicitudId = randomUUID(), user = professional) => importWorkbook(await workbook(rows), "integracion-sintetica.xlsx", user.id, { solicitudId });
  const pending = (importacionId: string) => db.filaImportacion.findMany({ where: { importacionId }, include: { candidatos: true }, orderBy: { numeroFila: "asc" } });
  const snapshot = async (id: string) => JSON.stringify(await db.garantia.findUniqueOrThrow({ where: { id }, include: { paciente: true, eventos: true } }));

  await check("new_exact_unchanged_and_source_updates_preserve_management_history", async () => {
    const p = person(), created = await run([row(p)]);
    assert.equal(created.registrosNuevos, 1); assert.equal(created.registrosPendientesRevision, 0);
    const patient = await db.paciente.findUniqueOrThrow({ where: { rutNumero_dv: { rutNumero: p.rut, dv: p.dv } } });
    const guarantee = await db.garantia.findFirstOrThrow({ where: { pacienteId: patient.id } });
    await db.garantia.update({ where: { id: guarantee.id }, data: { estadoGestion: "EN_GESTION", revisionGestion: 2, gestionadaAt: new Date("2026-11-01"), gestionadaPorUsuarioId: admin.id } });
    await db.eventoGarantia.create({ data: { garantiaId: guarantee.id, usuarioId: admin.id, autorNombre: admin.nombre, tipo: "ACTUACION", tipoActuacion: "CITACION", comentario: "Gestión sintética previa", estadoNuevo: "EN_GESTION" } });
    assert.equal((await run([row(p)])).registrosSinCambios, 1);
    const previous = await db.garantia.findUniqueOrThrow({ where: { id: guarantee.id }, include: { eventos: true } });
    const changed = await run([row(p, { limit: "2027-01-15", responsible: "Centro actualizado" })]);
    assert.equal(changed.registrosActualizados, 1); assert.equal(changed.registrosPendientesRevision, 0);
    const after = await db.garantia.findUniqueOrThrow({ where: { id: guarantee.id }, include: { eventos: true } });
    assert.equal(after.fechaLimite.toISOString().slice(0, 10), "2027-01-15"); assert.equal(after.responsable, "Centro actualizado");
    for (const key of ["estadoGestion", "revisionGestion", "gestionadaAt", "gestionadaPorUsuarioId", "eventos"] as const) assert.deepEqual(after[key], previous[key]);
  });
  await check("different_start_is_persisted_without_any_patient_or_guarantee_update", async () => {
    const fixture = await existing(), before = await snapshot(fixture.guarantee.id);
    const result = await run([row(fixture.p, { start: "2026-10-02", name: "Nombre recibido diferente", limit: "2027-01-01" })]);
    assert.equal(result.estado, "COMPLETADA_CON_OBSERVACIONES"); assert.equal(result.registrosPendientesRevision, 1); assert.equal(result.registrosConError, 0);
    assert.equal(await snapshot(fixture.guarantee.id), before);
    const [saved] = await pending(result.id);
    assert.equal(saved.hoja, "Origen sintético real"); assert.equal(saved.numeroFila, 2); assert.equal(saved.candidatos[0].garantiaId, fixture.guarantee.id);
    assert.ok(saved.motivos.includes("FECHA_INICIO_DISTINTA"));
    await db.$disconnect();
    const store = createImportRowPersistence(db), detail = await store.getRow(coordinator, saved.id);
    assert.equal(detail.estado, "PENDIENTE"); assert.equal(detail.antecedentesVigentes, true);
  });
  await check("multiple_exact_candidates_are_all_preserved_and_none_is_selected", async () => {
    const fixture = await existing();
    await db.garantia.create({ data: { pacienteId: fixture.patient.id, problemaSalud: fixture.guarantee.problemaSalud, nombreGarantia: fixture.guarantee.nombreGarantia, fechaInicio: fixture.guarantee.fechaInicio, fechaLimite: fixture.guarantee.fechaLimite, responsable: "Segunda candidata" } });
    const before = JSON.stringify(await db.garantia.findMany({ where: { pacienteId: fixture.patient.id }, orderBy: { id: "asc" } }));
    const result = await run([row(fixture.p, { responsible: "No aplicar automáticamente" })]);
    const [saved] = await pending(result.id);
    assert.equal(saved.candidatos.length, 2); assert.equal(saved.garantiaResultadoId, null); assert.equal(result.registrosActualizados, 0);
    assert.equal(JSON.stringify(await db.garantia.findMany({ where: { pacienteId: fixture.patient.id }, orderBy: { id: "asc" } })), before);
  });
  await check("equivalent_repetitions_are_omitted_for_normal_and_pending_rows", async () => {
    const p = person(), normal = await run([row(p), row(p), row(p)]);
    assert.equal(normal.registrosNuevos, 1); assert.equal(normal.registrosRepetidosOmitidos, 2);
    const fixture = await existing(), item = row(fixture.p, { start: "2026-10-02" }), retained = await run([item, item]);
    assert.equal(retained.registrosPendientesRevision, 1); assert.equal(retained.registrosRepetidosOmitidos, 1); assert.equal((await pending(retained.id)).length, 1);
    const control = await db.controlRetencionImportacion.findUniqueOrThrow({ where: { importacionId: normal.id } });
    assert.equal(control.registrosRepetidosOmitidos, 2); assert.equal(control.completada, true);
    assert.ok(!JSON.stringify(control.resultados).includes(p.rut));
  });
  await check("contradictory_rows_and_reversed_order_never_update_the_source", async () => {
    const fixture = await existing(), before = await snapshot(fixture.guarantee.id);
    const rows = [row(fixture.p, { limit: "2026-12-02" }), row(fixture.p, { responsible: "Establecimiento contradictorio" })];
    const first = await run(rows), reversed = await run([...rows].reverse());
    for (const result of [first, reversed]) { assert.equal(result.registrosPendientesRevision, 2); assert.equal(result.registrosActualizados, 0); assert.equal(result.registrosNuevos, 0); }
    const logical = async (id: string) => (await pending(id)).map(saved => { const { numeroFila: _, ...data } = saved.datosValidados as Record<string, unknown>; return JSON.stringify({ data, motivos: saved.motivos, candidatos: saved.candidatos.map(candidate => candidate.garantiaId) }); }).sort();
    assert.deepEqual(await logical(first.id), await logical(reversed.id)); assert.equal(await snapshot(fixture.guarantee.id), before);
  });
  await check("unmatched_dates_retain_the_entire_family_before_the_exact_row_can_write", async () => {
    const fixture = await existing(), before = await snapshot(fixture.guarantee.id);
    const result = await run([row(fixture.p, { limit: "2026-12-02" }), row(fixture.p, { start: "2026-10-02" })]);
    assert.equal(result.registrosPendientesRevision, 2); assert.equal(result.registrosActualizados, 0); assert.equal(await snapshot(fixture.guarantee.id), before);
    const newPerson = person(), noSources = await run([row(newPerson), row(newPerson, { start: "2026-10-02" })]);
    assert.equal(noSources.registrosPendientesRevision, 2);
    assert.equal(await db.paciente.count({ where: { rutNumero: newPerson.rut } }), 0);
  });
  await check("contradictory_names_across_families_retain_every_involved_row", async () => {
    const fixture = await existing(), before = await snapshot(fixture.guarantee.id);
    const result = await run([row(fixture.p, { name: "Nombre sintético A", limit: "2026-12-02" }), row(fixture.p, { name: "Nombre sintético B", guarantee: "Otra familia sintética" })]);
    assert.equal(result.registrosPendientesRevision, 2); assert.equal(result.registrosNuevos, 0); assert.equal(result.registrosActualizados, 0);
    assert.equal(await snapshot(fixture.guarantee.id), before);
    assert.ok((await pending(result.id)).every(saved => saved.motivos.includes("NOMBRE_PACIENTE_CONTRADICTORIO")));
  });
  await check("legitimate_existing_episodes_do_not_block_unique_exact_matches", async () => {
    const fixture = await existing();
    await db.garantia.create({ data: { pacienteId: fixture.patient.id, problemaSalud: fixture.guarantee.problemaSalud, nombreGarantia: fixture.guarantee.nombreGarantia, fechaInicio: new Date("2026-10-02"), fechaLimite: fixture.guarantee.fechaLimite, responsable: fixture.guarantee.responsable } });
    const result = await run([row(fixture.p, { limit: "2026-12-02" }), row(fixture.p, { start: "2026-10-02" })]);
    assert.equal(result.registrosActualizados, 1); assert.equal(result.registrosSinCambios, 1); assert.equal(result.registrosPendientesRevision, 0);
  });
  await check("invalid_rows_are_separate_from_pending_omitted_and_created_counts", async () => {
    const p = person(), fixture = await existing(), invalid = row(person(), { dv: "Z", limit: "fecha inválida" });
    const result = await run([row(p), row(p), row(fixture.p, { start: "2026-10-02" }), invalid]);
    assert.equal(result.registrosNuevos, 1); assert.equal(result.registrosRepetidosOmitidos, 1); assert.equal(result.registrosPendientesRevision, 1); assert.equal(result.registrosInvalidos, 1); assert.equal(result.registrosConError, 1);
    assert.equal(result.filasLeidas, result.registrosNuevos + result.registrosActualizados + result.registrosSinCambios + result.registrosConError + result.registrosPendientesRevision + result.registrosRepetidosOmitidos);
    const onlyInvalid = await run([invalid]); assert.equal(onlyInvalid.estado, "FALLIDA"); assert.equal(onlyInvalid.registrosInvalidos, 1);
  });
  await check("same_request_replay_is_stable_and_changed_file_or_actor_is_rejected", async () => {
    const fixture = await existing(), buffer = await workbook([row(fixture.p, { start: "2026-10-02" })]), requestId = randomUUID();
    const first = await importWorkbook(buffer, "reintento.xlsx", professional.id, { solicitudId: requestId });
    const replay = await importWorkbook(buffer, "reintento.xlsx", professional.id, { solicitudId: requestId });
    assert.deepEqual(replay, first); assert.equal((await pending(first.id)).length, 1);
    await assert.rejects(importWorkbook(buffer, "otro-nombre.xlsx", professional.id, { solicitudId: requestId }), { code: "IMPORT_IDEMPOTENCY_CONFLICT" });
    await assert.rejects(importWorkbook(buffer, "reintento.xlsx", coordinator.id, { solicitudId: requestId }), { code: "IMPORT_IDEMPOTENCY_CONFLICT" });
    await assert.rejects(importWorkbook(await workbook([row(person())]), "reintento.xlsx", professional.id, { solicitudId: requestId }), { code: "IMPORT_IDEMPOTENCY_CONFLICT" });
  });
  await check("simultaneous_same_request_commits_each_group_once", async () => {
    const p = person(), buffer = await workbook([row(p), row(p)]), requestId = randomUUID();
    const results = await Promise.all([importWorkbook(buffer, "concurrente.xlsx", professional.id, { solicitudId: requestId }), importWorkbook(buffer, "concurrente.xlsx", professional.id, { solicitudId: requestId })]);
    assert.deepEqual(results[0], results[1]); assert.equal(results[0].registrosNuevos, 1); assert.equal(results[0].registrosRepetidosOmitidos, 1);
  });
  await check("concurrent_dates_for_a_new_patient_create_only_one_guarantee", async () => {
    const p = person();
    const results = await Promise.all([run([row(p)]), run([row(p, { start: "2026-10-02" })])]);
    assert.equal(results.reduce((sum, result) => sum + result.registrosNuevos, 0), 1);
    assert.equal(results.reduce((sum, result) => sum + result.registrosPendientesRevision, 0), 1);
    assert.equal(await db.garantia.count({ where: { paciente: { rutNumero: p.rut, dv: p.dv } } }), 1);
  });
  await check("catalog_changes_after_preflight_are_reclassified_under_locks", async () => {
    const p = person(); let transactions = 0;
    const wrapped = new Proxy(db, { get(target, key) {
      if (key === "$transaction") return async (...args: Parameters<PrismaClient["$transaction"]>) => {
        transactions++;
        if (transactions === 2) await existing(p, { fechaInicio: new Date("2026-10-02") });
        return (target.$transaction as Function)(...args);
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    const result = await importWorkbookWithRetention(wrapped, await workbook([row(p)]), "reclasificacion.xlsx", professional.id);
    assert.equal(result.registrosNuevos, 0); assert.equal(result.registrosPendientesRevision, 1);
  });
  await check("group_failure_rolls_back_pending_evidence_and_writes_without_losing_other_groups", async () => {
    const fixture = await existing(), unaffected = person(), before = await snapshot(fixture.guarantee.id);
    await db.$executeRawUnsafe(`CREATE FUNCTION retention_test_fail_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."nombreGarantia" = 'Fallo transaccional sintetico' THEN RAISE EXCEPTION 'synthetic write failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER retention_test_fail_write BEFORE INSERT ON "Garantia" FOR EACH ROW EXECUTE FUNCTION retention_test_fail_write()`);
    try {
      const result = await run([row(unaffected), row(fixture.p, { start: "2026-10-02" }), row(fixture.p, { guarantee: "Fallo transaccional sintetico" })]);
      assert.equal(result.registrosNuevos, 1); assert.equal(result.registrosPendientesRevision, 0); assert.equal(result.registrosConError, 2); assert.equal(result.registrosInvalidos, 0);
      assert.equal((await pending(result.id)).length, 0); assert.equal(await snapshot(fixture.guarantee.id), before);
      assert.equal(await db.garantia.count({ where: { nombreGarantia: "Fallo transaccional sintetico" } }), 0);
    } finally { await db.$executeRawUnsafe(`DROP TRIGGER retention_test_fail_write ON "Garantia"`); await db.$executeRawUnsafe(`DROP FUNCTION retention_test_fail_write()`); }
  });
  await check("interrupted_request_resumes_committed_groups_without_recounting", async () => {
    const first = person(), second = person(), buffer = await workbook([row(first), row(second)]), requestId = randomUUID();
    let transactions = 0;
    const wrapped = new Proxy(db, { get(target, key) {
      if (key === "$transaction") return async (...args: Parameters<PrismaClient["$transaction"]>) => {
        transactions++;
        if (transactions >= 3) throw new Error("synthetic interruption");
        return (target.$transaction as Function)(...args);
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    await assert.rejects(importWorkbookWithRetention(wrapped, buffer, "recuperacion.xlsx", professional.id, { solicitudId: requestId }));
    const before = await db.controlRetencionImportacion.findUniqueOrThrow({ where: { solicitudId: requestId }, include: { importacion: true } });
    assert.equal(before.completada, false); assert.equal(before.importacion.registrosNuevos, 1);
    const recovered = await importWorkbook(buffer, "recuperacion.xlsx", professional.id, { solicitudId: requestId });
    assert.equal(recovered.registrosNuevos, 2); assert.equal(recovered.registrosConError, 0); assert.equal(recovered.id, before.importacionId);
    assert.equal(await db.garantia.count({ where: { paciente: { rutNumero: { in: [first.rut, second.rut] } } } }), 2);
  });
  await check("mixed_families_keep_pending_evidence_current_after_a_safe_name_update", async () => {
    const fixture = await existing();
    const result = await run([row(fixture.p, { start: "2026-10-02", name: "Nombre sintético validado" }), row(fixture.p, { guarantee: "Otra familia legítima", name: "Nombre sintético validado" })]);
    assert.equal(result.registrosPendientesRevision, 1); assert.equal(result.registrosNuevos, 1);
    const [saved] = await pending(result.id);
    assert.equal((await createImportRowPersistence(db).getRow(admin, saved.id)).antecedentesVigentes, true);
    assert.equal((await db.paciente.findUniqueOrThrow({ where: { id: fixture.patient.id } })).nombre, "Nombre sintético validado");
  });
  await check("retention_insert_failure_rolls_back_prior_safe_writes_and_patient_changes", async () => {
    const fixture = await existing(), before = await snapshot(fixture.guarantee.id);
    await db.$executeRawUnsafe(`CREATE FUNCTION retention_test_fail_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic evidence failure'; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER retention_test_fail_evidence BEFORE INSERT ON "FilaImportacion" FOR EACH ROW EXECUTE FUNCTION retention_test_fail_evidence()`);
    try {
      const result = await run([row(fixture.p, { start: "2026-10-02", name: "No debe persistir" }), row(fixture.p, { guarantee: "Garantía reversible sintética", name: "No debe persistir" })]);
      assert.equal(result.registrosNuevos, 0); assert.equal(result.registrosActualizados, 0); assert.equal(result.registrosPendientesRevision, 0); assert.equal(result.registrosConError, 2);
      assert.equal((await pending(result.id)).length, 0); assert.equal(await snapshot(fixture.guarantee.id), before);
      assert.equal(await db.garantia.count({ where: { nombreGarantia: "Garantía reversible sintética" } }), 0);
    } finally { await db.$executeRawUnsafe(`DROP TRIGGER retention_test_fail_evidence ON "FilaImportacion"`); await db.$executeRawUnsafe(`DROP FUNCTION retention_test_fail_evidence()`); }
  });
  await check("import_roles_are_preserved_and_review_remains_supervisor_only", async () => {
    for (const user of [admin, coordinator, professional]) assert.equal((await run([row(person())], randomUUID(), user)).registrosNuevos, 1);
    const before = await db.importacion.count();
    await assert.rejects(run([row(person())], randomUUID(), reader), { code: "FORBIDDEN" });
    assert.equal(await db.importacion.count(), before);
    const store = createImportRowPersistence(db);
    await assert.rejects(store.listPendingRows(professional), { code: "FORBIDDEN" });
    assert.ok((await store.listPendingRows(coordinator)).pagination.total > 0);
  });
  await check("disabled_mode_keeps_legacy_behavior_and_creates_no_retention_controls", async () => {
    process.env.IMPORT_RETENTION_ENABLED = "false";
    const fixture = await existing(), before = await db.controlRetencionImportacion.count(), count = await db.filaImportacion.count();
    const result = await run([row(fixture.p, { start: "2026-10-02" })]);
    assert.equal(result.registrosNuevos, 1); assert.equal(result.registrosPendientesRevision, 0);
    assert.equal(await db.controlRetencionImportacion.count(), before); assert.equal(await db.filaImportacion.count(), count);
  });
  console.log(JSON.stringify({ passed: true, isolatedPostgres: true, checks, qaAccessed: false, productionAccessed: false, retentionEnabledOutsideTest: false }));
} catch (error) {
  console.log(JSON.stringify({ passed: false, check: activeCheck, checks, code: (error as { code?: string }).code ?? "ISOLATED_CHECK_FAILED", type: error instanceof assert.AssertionError ? "ASSERTION_FAILED" : "INTEGRATION_FAILED" }));
  process.exitCode = 1;
} finally { await operationalClient.$disconnect(); await db.$disconnect(); }
