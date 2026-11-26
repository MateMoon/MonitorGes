// Runs only inside the fresh isolated cluster created by the PowerShell runner.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";

const isolated = process.env.GES_ROWS_TEST_DATABASE_URL;
if (!isolated) throw new Error("EXPLICIT_ISOLATED_DATABASE_REQUIRED");
const url = new URL(isolated);
if (url.hostname !== "127.0.0.1" || Number(url.port) < 55000 || url.pathname !== "/ges_rows_isolated" || process.env.AUTO_EMAIL_ENABLED !== "false") throw new Error("ISOLATED_DATABASE_GUARD_FAILED");
process.env.DATABASE_URL = isolated;
process.env.CORS_ORIGINS = "http://localhost:8443";
process.env.IMPORT_RETENTION_ENABLED = "false";
const { PrismaClient } = await import("@prisma/client");
const { createQualityResolutionService } = await import("../src/modules/calidad-datos/resolution-service.js");
const { importWorkbookWithRetention } = await import("../src/modules/importaciones/retained-import-service.js");
const { importWorkbook } = await import("../src/modules/importaciones/import-service.js");
const { prisma: operationalClient } = await import("../src/db/prisma.js");
const { hash } = await import("../src/modules/calidad-datos/candidate-evidence.js");
const { normalizeIdentityRut } = await import("../src/modules/importaciones/identity-normalization.js");
const db = new PrismaClient({ datasourceUrl: isolated, log: [] }), service = createQualityResolutionService(db);
let checks = 0, activeCheck = "cluster_identity", nextPerson = 30000000;
let app: Awaited<ReturnType<typeof import("../src/app.js")["buildApp"]>> | undefined;
async function check(name: string, work: () => Promise<void>) { activeCheck = name; await work(); checks++; console.log(JSON.stringify({ check: name, passed: true })); }
function person() {
  const rut = String(nextPerson++); let sum = 0, factor = 2;
  for (const digit of [...rut].reverse()) { sum += Number(digit) * factor; factor = factor === 7 ? 2 : factor + 1; }
  const result = 11 - sum % 11;
  return { rut, dv: result === 11 ? "0" : result === 10 ? "K" : String(result) };
}
type Person = ReturnType<typeof person>;
const row = (p: Person, patch: { start?: string; limit?: string; responsible?: string; name?: string; guarantee?: string } = {}) => ["Problema de resolución sintético", p.rut, p.dv, patch.name ?? "Paciente de resolución sintético", patch.start ?? "2026-10-02", patch.limit ?? "2026-12-01", 0, patch.guarantee ?? "Garantía de resolución sintética", patch.responsible ?? "Centro sintético"];
async function workbook(rows: Array<Array<string | number>>) {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("Origen de resolución");
  sheet.addRow(["Problema de salud", "RUT", "DV", "Nombre", "Fecha de Inicio", "Fecha Limite", "Dias que faltan para el Vencimiento de la Garantia", "Nombre de la garantia", "Responsable de la garantia"]);
  rows.forEach(values => sheet.addRow(values)); return Buffer.from(await book.xlsx.writeBuffer());
}
async function fixture() {
  const p = person(), patient = await db.paciente.create({ data: { rutNumero: p.rut, dv: p.dv, nombre: "Paciente de resolución sintético" } });
  const guarantee = await db.garantia.create({ data: { pacienteId: patient.id, problemaSalud: "Problema de resolución sintético", nombreGarantia: "Garantía de resolución sintética", fechaInicio: new Date("2026-10-01"), fechaLimite: new Date("2026-12-01"), responsable: "Centro sintético", estadoGestion: "EN_GESTION", version: 3, revisionGestion: 2 } });
  return { p, patient, guarantee };
}
const snapshot = async (id: string) => JSON.stringify(await db.garantia.findUniqueOrThrow({ where: { id }, include: { paciente: true, eventos: true } }));
const command = (detail: { version: number; huellaRevision: string }, decision: "MISMA" | "DISTINTA", candidate?: string) => ({
  version: detail.version, huellaRevision: detail.huellaRevision, solicitudId: randomUUID(), decision, justificacion: "Antecedentes sintéticos revisados y confirmados",
  ...(decision === "MISMA" ? { garantiaExistenteId: candidate } : { confirmaDistintaDeTodas: true as const }),
});
try {
  const [identity] = await db.$queryRaw<Array<{ database: string; cluster: string }>>`SELECT current_database() AS database,current_setting('cluster_name') AS cluster`;
  assert.deepEqual(identity, { database: "ges_rows_isolated", cluster: "ges_rows_isolated" });
  const actors = await Promise.all((["ADMIN", "COORDINADOR_SOME", "PROFESIONAL", "LECTOR"] as const).map((rol, index) => db.usuario.create({ data: { nombre: `Resolución sintética ${rol}`, username: `resolution-${index}`, email: `resolution-${index}@example.test`, rol } })));
  const [admin, coordinator, professional, reader] = actors;
  const retain = async (rows: Array<Array<string | number>>) => {
    const result = await importWorkbookWithRetention(db, await workbook(rows), "resolucion-sintetica.xlsx", professional.id);
    assert.ok(result.registrosPendientesRevision > 0);
    return db.filaImportacion.findMany({ where: { importacionId: result.id }, orderBy: { numeroFila: "asc" } });
  };
  const pendingFixture = async () => { const source = await fixture(), [pending] = await retain([row(source.p)]); return { ...source, pending }; };
  const assertPending = async (id: string) => {
    const value = await db.filaImportacion.findUniqueOrThrow({ where: { id }, include: { resolucion: true } });
    assert.equal(value.estado, "PENDIENTE"); assert.equal(value.version, 1); assert.equal(value.garantiaResultadoId, null); assert.equal(value.resolucion, null);
  };
  await check("same_single_candidate_preserves_every_source_and_management_field", async () => {
    const source = await pendingFixture();
    await db.eventoGarantia.create({ data: { garantiaId: source.guarantee.id, usuarioId: admin.id, autorNombre: admin.nombre, tipo: "ACTUACION", tipoActuacion: "CITACION", comentario: "Actuación sintética conservada", estadoNuevo: "EN_GESTION" } });
    const before = await snapshot(source.guarantee.id), count = await db.garantia.count();
    const detail = await service.getPending(admin, source.pending.id);
    assert.equal(detail.candidatas.length, 1); assert.equal(detail.candidatas[0].actuacionesDisponibles, 1);
    assert.ok(detail.candidatas[0].diferencias.includes("fechaInicio"));
    const result = await service.resolve(admin, source.pending.id, command(detail, "MISMA", source.guarantee.id));
    assert.equal(result.resolucion.garantiaResultadoId, source.guarantee.id); assert.equal(await snapshot(source.guarantee.id), before); assert.equal(await db.garantia.count(), count);
    const saved = await db.filaImportacion.findUniqueOrThrow({ where: { id: source.pending.id }, include: { resolucion: true } });
    assert.equal(saved.estado, "RESUELTA"); assert.equal(saved.version, 2); assert.equal(saved.resolucion!.usuarioId, admin.id);
    assert.ok(saved.resolucion!.antecedentesRevisados); assert.equal(saved.garantiaResultadoId, source.guarantee.id);
  });
  await check("same_multiple_candidates_requires_an_explicit_valid_selection", async () => {
    const source = await fixture();
    const second = await db.garantia.create({ data: { pacienteId: source.patient.id, problemaSalud: source.guarantee.problemaSalud, nombreGarantia: source.guarantee.nombreGarantia, fechaInicio: source.guarantee.fechaInicio, fechaLimite: source.guarantee.fechaLimite, responsable: "Otra candidata sintética" } });
    const [pending] = await retain([row(source.p, { start: "2026-10-01" })]), detail = await service.getPending(coordinator, pending.id);
    assert.equal(detail.candidatas.length, 2);
    await assert.rejects(service.resolve(coordinator, pending.id, command(detail, "MISMA")), { code: "INVALID_PERSISTENCE_INPUT" });
    const foreign = await fixture();
    await assert.rejects(service.resolve(coordinator, pending.id, command(detail, "MISMA", foreign.guarantee.id)), { code: "INVALID_CANDIDATE" });
    await assertPending(pending.id);
    const before = [await snapshot(source.guarantee.id), await snapshot(second.id)];
    const result = await service.resolve(coordinator, pending.id, command(detail, "MISMA", second.id));
    assert.equal(result.resolucion.garantiaResultadoId, second.id);
    assert.deepEqual([await snapshot(source.guarantee.id), await snapshot(second.id)], before);
  });
  await check("distinct_existing_patient_creates_one_clean_episode_without_overwriting_anything", async () => {
    const source = await fixture();
    await db.garantia.update({ where: { id: source.guarantee.id }, data: { gestionadaAt: new Date("2026-11-01"), gestionadaPorUsuarioId: admin.id } });
    await db.eventoGarantia.create({ data: { garantiaId: source.guarantee.id, usuarioId: admin.id, autorNombre: admin.nombre, tipo: "ACTUACION", tipoActuacion: "CITACION", comentario: "No copiar actuación sintética", estadoNuevo: "EN_GESTION" } });
    const [pending] = await retain([row(source.p, { name: "Nombre recibido que no debe sobrescribir", responsible: "Centro recibido", limit: "2027-01-01" })]);
    const before = await snapshot(source.guarantee.id), detail = await service.getPending(admin, pending.id), count = await db.garantia.count();
    const result = await service.resolve(admin, pending.id, command(detail, "DISTINTA"));
    const created = await db.garantia.findUniqueOrThrow({ where: { id: result.resolucion.garantiaResultadoId }, include: { eventos: true } });
    assert.equal(await db.garantia.count(), count + 1); assert.equal(created.pacienteId, source.patient.id); assert.notEqual(created.id, source.guarantee.id);
    assert.equal(created.fechaInicio.toISOString().slice(0, 10), "2026-10-02"); assert.equal(created.fechaLimite.toISOString().slice(0, 10), "2027-01-01"); assert.equal(created.responsable, "Centro recibido");
    assert.equal(created.estadoGestion, "SIN_GESTION"); assert.equal(created.version, 1); assert.equal(created.revisionGestion, 0); assert.equal(created.gestionadaAt, null); assert.equal(created.gestionadaPorUsuarioId, null); assert.equal(created.eventos.length, 0);
    assert.equal(await snapshot(source.guarantee.id), before);
  });
  await check("distinct_new_patient_reuses_the_patient_for_a_second_explicit_episode", async () => {
    const p = person(), rows = await retain([row(p), row(p, { start: "2026-10-03" })]);
    assert.equal(await db.paciente.count({ where: { rutNumero: p.rut } }), 0);
    const first = await service.resolve(admin, rows[0].id, command(await service.getPending(admin, rows[0].id), "DISTINTA"));
    const secondDetail = await service.getPending(coordinator, rows[1].id);
    assert.equal(secondDetail.antecedentesCambiaron, true); assert.equal(secondDetail.candidatas.length, 1);
    const second = await service.resolve(coordinator, rows[1].id, command(secondDetail, "DISTINTA"));
    assert.notEqual(first.resolucion.garantiaResultadoId, second.resolucion.garantiaResultadoId);
    assert.equal(await db.paciente.count({ where: { rutNumero: p.rut } }), 1);
    assert.equal(await db.garantia.count({ where: { paciente: { rutNumero: p.rut } } }), 2);
  });
  await check("double_submit_and_lost_response_replay_have_one_effect_and_one_audit", async () => {
    const source = await pendingFixture(), body = command(await service.getPending(admin, source.pending.id), "DISTINTA"), count = await db.garantia.count();
    const results = await Promise.all([service.resolve(admin, source.pending.id, body), service.resolve(admin, source.pending.id, body)]);
    assert.equal(results[0].resolucion.id, results[1].resolucion.id); assert.equal(await db.garantia.count(), count + 1);
    assert.equal(await db.resolucionFilaImportacion.count({ where: { filaId: source.pending.id } }), 1);
    assert.equal((await service.resolve(admin, source.pending.id, body)).repetida, true);
    await assert.rejects(service.resolve(admin, source.pending.id, { ...body, justificacion: "Contenido de solicitud diferente" }), { code: "IDEMPOTENCY_CONFLICT" });
    await assert.rejects(service.resolve(coordinator, source.pending.id, body), { code: "IDEMPOTENCY_CONFLICT" });
  });
  await check("two_supervisors_cannot_commit_opposing_terminal_decisions", async () => {
    const source = await pendingFixture(), detail = await service.getPending(admin, source.pending.id), count = await db.garantia.count();
    const results = await Promise.allSettled([service.resolve(admin, source.pending.id, command(detail, "DISTINTA")), service.resolve(coordinator, source.pending.id, command(detail, "MISMA", source.guarantee.id))]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected" && result.reason.code === "STALE_ROW").length, 1);
    const audit = await db.resolucionFilaImportacion.findUniqueOrThrow({ where: { filaId: source.pending.id } });
    assert.equal(await db.garantia.count(), count + (audit.decision === "DISTINTA" ? 1 : 0));
  });
  await check("stale_source_or_management_evidence_is_rejected_then_a_fresh_review_can_resolve", async () => {
    const source = await pendingFixture(), old = await service.getPending(admin, source.pending.id);
    const original = await db.candidatoFilaImportacion.findMany({ where: { filaId: source.pending.id } });
    await db.garantia.update({ where: { id: source.guarantee.id }, data: { responsable: "Cambio sintético posterior", version: { increment: 1 }, revisionGestion: { increment: 1 } } });
    await assert.rejects(service.resolve(admin, source.pending.id, command(old, "DISTINTA")), { code: "STALE_CANDIDATES" });
    await assertPending(source.pending.id);
    const refreshed = await service.getPending(admin, source.pending.id);
    assert.equal(refreshed.antecedentesCambiaron, true); assert.notEqual(refreshed.huellaRevision, old.huellaRevision);
    await service.resolve(admin, source.pending.id, command(refreshed, "MISMA", source.guarantee.id));
    assert.deepEqual(await db.candidatoFilaImportacion.findMany({ where: { filaId: source.pending.id } }), original);
    const audit = await db.resolucionFilaImportacion.findUniqueOrThrow({ where: { filaId: source.pending.id } });
    const evidence = audit.antecedentesRevisados as { candidatas: Array<{ datos: { responsable: string } }> };
    assert.equal(evidence.candidatas[0].datos.responsable, "Cambio sintético posterior");
  });
  await check("new_relevant_candidate_requires_review_of_the_entire_changed_set", async () => {
    const source = await pendingFixture(), old = await service.getPending(admin, source.pending.id);
    const second = await db.garantia.create({ data: { pacienteId: source.patient.id, problemaSalud: source.guarantee.problemaSalud, nombreGarantia: source.guarantee.nombreGarantia, fechaInicio: new Date("2026-10-03"), fechaLimite: source.guarantee.fechaLimite, responsable: source.guarantee.responsable } });
    await assert.rejects(service.resolve(admin, source.pending.id, command(old, "DISTINTA")), { code: "STALE_CANDIDATES" });
    const fresh = await service.getPending(admin, source.pending.id);
    assert.equal(fresh.candidatas.length, 2);
    const result = await service.resolve(admin, source.pending.id, command(fresh, "DISTINTA"));
    const audit = await db.resolucionFilaImportacion.findUniqueOrThrow({ where: { id: result.resolucion.id } });
    const evidence = audit.antecedentesRevisados as { distintaDeTodas: boolean; candidatas: Array<{ id: string }> };
    assert.equal(evidence.distintaDeTodas, true); assert.deepEqual(evidence.candidatas.map(candidate => candidate.id).sort(), [source.guarantee.id, second.id].sort());
  });
  await check("new_history_also_invalidates_the_review_even_without_a_revision_increment", async () => {
    const source = await pendingFixture(), old = await service.getPending(admin, source.pending.id);
    await db.eventoGarantia.create({ data: { garantiaId: source.guarantee.id, usuarioId: admin.id, autorNombre: admin.nombre, tipo: "ACTUACION", tipoActuacion: "CITACION", comentario: "Actuación posterior a la revisión", estadoNuevo: "EN_GESTION" } });
    await assert.rejects(service.resolve(admin, source.pending.id, command(old, "DISTINTA")), { code: "STALE_CANDIDATES" });
    const fresh = await service.getPending(admin, source.pending.id);
    assert.equal(fresh.candidatas[0].actuacionesDisponibles, 1);
    await service.resolve(admin, source.pending.id, command(fresh, "MISMA", source.guarantee.id));
  });
  await check("new_import_of_the_same_family_and_resolution_share_the_identity_lock", async () => {
    const source = await pendingFixture(), detail = await service.getPending(admin, source.pending.id), buffer = await workbook([row(source.p)]);
    const identity = normalizeIdentityRut(source.p.rut, source.p.dv);
    let resolution!: ReturnType<typeof service.resolve>, imported!: ReturnType<typeof importWorkbookWithRetention>;
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(identity)}, 0))::text`;
      resolution = service.resolve(admin, source.pending.id, command(detail, "DISTINTA"));
      imported = importWorkbookWithRetention(db, buffer, "concurrente-resolucion.xlsx", professional.id);
      // Give both operations a chance to reach the shared lock, without holding
      // the test connection open while awaiting their completion.
      for (let attempt = 0; attempt < 100; attempt++) {
        const [waiting] = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM pg_stat_activity WHERE datname = 'ges_rows_isolated' AND wait_event = 'advisory'`;
        if (Number(waiting.count) >= 2) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }, { timeout: 10000 });
    const [result, importResult] = await Promise.all([resolution, imported]);
    assert.equal(importResult.registrosNuevos, 0); assert.equal(await db.garantia.count({ where: { pacienteId: source.patient.id } }), 2);
    assert.ok(importResult.registrosPendientesRevision === 1 || importResult.registrosSinCambios === 1);
    assert.equal(await db.resolucionFilaImportacion.count({ where: { id: result.resolucion.id } }), 1);
  });
  await check("legacy_import_cannot_silently_change_a_review_that_already_read_old_evidence", async () => {
    const source = await pendingFixture(), old = await service.getPending(admin, source.pending.id);
    const result = await importWorkbook(await workbook([row(source.p, { start: "2026-10-01", responsible: "Cambio por importador anterior" })]), "anterior-sintetico.xlsx", professional.id);
    assert.equal(result.registrosActualizados, 1); assert.equal(result.registrosPendientesRevision, 0);
    await assert.rejects(service.resolve(admin, source.pending.id, command(old, "MISMA", source.guarantee.id)), { code: "STALE_CANDIDATES" });
    await assertPending(source.pending.id);
  });
  await check("creation_failure_rolls_back_new_patient_guarantee_row_and_audit", async () => {
    const p = person(), [pending] = await retain([row(p), row(p, { start: "2026-10-03" })]), body = command(await service.getPending(admin, pending.id), "DISTINTA");
    const count = await db.garantia.count();
    await db.$executeRawUnsafe(`CREATE FUNCTION resolution_test_fail_creation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic guarantee creation failure'; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER resolution_test_fail_creation BEFORE INSERT ON "Garantia" FOR EACH ROW EXECUTE FUNCTION resolution_test_fail_creation()`);
    try {
      await assert.rejects(service.resolve(admin, pending.id, body), { code: "PERSISTENCE_UNAVAILABLE" });
      await assertPending(pending.id); assert.equal(await db.paciente.count({ where: { rutNumero: p.rut } }), 0); assert.equal(await db.garantia.count(), count);
    } finally { await db.$executeRawUnsafe(`DROP TRIGGER resolution_test_fail_creation ON "Garantia"`); await db.$executeRawUnsafe(`DROP FUNCTION resolution_test_fail_creation()`); }
    await service.resolve(admin, pending.id, body);
    assert.equal(await db.garantia.count(), count + 1);
  });
  await check("audit_failure_rolls_back_the_real_operational_writer_and_patient", async () => {
    const p = person(), [pending] = await retain([row(p), row(p, { start: "2026-10-03" })]), detail = await service.getPending(admin, pending.id), count = await db.garantia.count();
    await db.$executeRawUnsafe(`CREATE FUNCTION resolution_test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic resolution audit failure'; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER resolution_test_fail_audit BEFORE INSERT ON "ResolucionFilaImportacion" FOR EACH ROW EXECUTE FUNCTION resolution_test_fail_audit()`);
    try {
      await assert.rejects(service.resolve(admin, pending.id, command(detail, "DISTINTA")), { code: "PERSISTENCE_UNAVAILABLE" });
      await assertPending(pending.id); assert.equal(await db.garantia.count(), count); assert.equal(await db.paciente.count({ where: { rutNumero: p.rut } }), 0);
    } finally { await db.$executeRawUnsafe(`DROP TRIGGER resolution_test_fail_audit ON "ResolucionFilaImportacion"`); await db.$executeRawUnsafe(`DROP FUNCTION resolution_test_fail_audit()`); }
  });
  await check("retained_data_integrity_and_dv_are_revalidated_before_resolution", async () => {
    const source = await pendingFixture(), detail = await service.getPending(admin, source.pending.id), changed = { ...(source.pending.datosValidados as Prisma.JsonObject), dv: "Z" };
    await db.filaImportacion.update({ where: { id: source.pending.id }, data: { datosValidados: changed, huellaDatos: hash(changed) } });
    await assert.rejects(service.resolve(admin, source.pending.id, command(detail, "DISTINTA")), { code: "INVALID_RETAINED_ROW" });
    await assertPending(source.pending.id);
  });
  for (const estadoGestion of ["SIN_GESTION", "EN_GESTION", "PENDIENTE_RESOLUCION", "CUMPLIDA"] as const) {
    await check(`source_update_preserves_${estadoGestion}_patient_and_management_history`, async () => {
      const source = await fixture();
      await db.garantia.update({ where: { id: source.guarantee.id }, data: { estadoGestion, gestionadaAt: new Date("2026-11-01"), gestionadaPorUsuarioId: admin.id } });
      await db.eventoGarantia.create({ data: { garantiaId: source.guarantee.id, usuarioId: admin.id, autorNombre: admin.nombre, tipo: "ACTUACION", tipoActuacion: "CITACION", comentario: "Gestión ficticia que debe conservarse al actualizar", estadoNuevo: estadoGestion } });
      const [pending] = await retain([row(source.p, { limit: "2027-01-01", responsible: "Centro actualizado ficticio", name: "Nombre recibido que no debe reemplazar al paciente" })]);
      const before = await db.garantia.findUniqueOrThrow({ where: { id: source.guarantee.id }, include: { paciente: true, eventos: true } }), count = await db.garantia.count();
      const originalEvidence = await db.candidatoFilaImportacion.findMany({ where: { filaId: pending.id } });
      const detail = await service.getPending(coordinator, pending.id);
      assert.equal(detail.puedeActualizarDatos, true);
      const result = await service.resolve(coordinator, pending.id, { ...command(detail, "MISMA", source.guarantee.id), actualizarDatos: true });
      assert.equal(result.resolucion.actualizarDatos, true); assert.equal(result.resolucion.garantiaResultadoId, source.guarantee.id);
      const after = await db.garantia.findUniqueOrThrow({ where: { id: source.guarantee.id }, include: { paciente: true, eventos: true } });
      assert.equal(after.fechaInicio.toISOString().slice(0, 10), "2026-10-02"); assert.equal(after.fechaLimite.toISOString().slice(0, 10), "2027-01-01"); assert.equal(after.responsable, "Centro actualizado ficticio"); assert.equal(after.version, before.version + 1);
      assert.deepEqual({ ...after, problemaSalud: before.problemaSalud, nombreGarantia: before.nombreGarantia, fechaInicio: before.fechaInicio, fechaLimite: before.fechaLimite, responsable: before.responsable, version: before.version, updatedAt: before.updatedAt }, before);
      assert.equal(await db.garantia.count(), count);
      assert.deepEqual(await db.candidatoFilaImportacion.findMany({ where: { filaId: pending.id } }), originalEvidence);
      const saved = await db.filaImportacion.findUniqueOrThrow({ where: { id: pending.id }, include: { resolucion: true } });
      assert.equal(saved.estado, "RESUELTA");
      const evidence = saved.resolucion!.antecedentesRevisados as { accion: string; actualizacion: { campos: string[]; antes: { fechaInicio: string }; despues: { fechaInicio: string } } };
      assert.equal(evidence.accion, "ACTUALIZAR_DATOS"); assert.deepEqual(evidence.actualizacion.campos, ["fechaInicio", "fechaLimite", "responsable"]); assert.equal(evidence.actualizacion.antes.fechaInicio, "2026-10-01"); assert.equal(evidence.actualizacion.despues.fechaInicio, "2026-10-02");
      assert.equal((await service.getPending(admin, pending.id)).resolucion?.actualizarDatos, true);
      assert.equal((await service.listDecisions(admin, { importacionId: pending.importacionId })).data[0].actualizarDatos, true);
    });
  }
  await check("source_update_retries_have_one_effect_one_version_increment_and_one_audit", async () => {
    const source = await pendingFixture(), detail = await service.getPending(admin, source.pending.id);
    const body = { ...command(detail, "MISMA", source.guarantee.id), actualizarDatos: true as const }, count = await db.garantia.count();
    const results = await Promise.all([service.resolve(admin, source.pending.id, body), service.resolve(admin, source.pending.id, body)]);
    assert.equal(results[0].resolucion.id, results[1].resolucion.id); assert.equal(results[0].resolucion.actualizarDatos, true);
    assert.equal((await db.garantia.findUniqueOrThrow({ where: { id: source.guarantee.id } })).version, source.guarantee.version + 1); assert.equal(await db.garantia.count(), count);
    assert.equal((await service.resolve(admin, source.pending.id, body)).repetida, true);
    await assert.rejects(service.resolve(admin, source.pending.id, { ...body, actualizarDatos: undefined }), { code: "IDEMPOTENCY_CONFLICT" });
  });
  await check("source_update_rejects_foreign_candidate_identical_data_and_episode_collisions", async () => {
    const source = await pendingFixture(), detail = await service.getPending(admin, source.pending.id), foreign = await fixture();
    await assert.rejects(service.resolve(admin, source.pending.id, { ...command(detail, "MISMA", foreign.guarantee.id), actualizarDatos: true }), { code: "INVALID_CANDIDATE" });
    await db.garantia.update({ where: { id: source.guarantee.id }, data: { fechaInicio: new Date("2026-10-02") } });
    const identical = await service.getPending(admin, source.pending.id);
    await assert.rejects(service.resolve(admin, source.pending.id, { ...command(identical, "MISMA", source.guarantee.id), actualizarDatos: true }), { code: "NO_SOURCE_CHANGES" });
    await db.garantia.update({ where: { id: source.guarantee.id }, data: { fechaInicio: source.guarantee.fechaInicio } });
    await db.garantia.create({ data: { pacienteId: source.patient.id, problemaSalud: source.guarantee.problemaSalud, nombreGarantia: source.guarantee.nombreGarantia, fechaInicio: new Date("2026-10-02"), fechaLimite: source.guarantee.fechaLimite, responsable: source.guarantee.responsable } });
    const collision = await service.getPending(admin, source.pending.id), current = await snapshot(source.guarantee.id);
    await assert.rejects(service.resolve(admin, source.pending.id, { ...command(collision, "MISMA", source.guarantee.id), actualizarDatos: true }), { code: "UPDATE_IDENTITY_CONFLICT" });
    assert.equal(await snapshot(source.guarantee.id), current); await assertPending(source.pending.id);
  });
  await check("source_update_requires_fresh_review_after_management_changes", async () => {
    const source = await pendingFixture(), detail = await service.getPending(admin, source.pending.id);
    await db.eventoGarantia.create({ data: { garantiaId: source.guarantee.id, usuarioId: admin.id, autorNombre: admin.nombre, tipo: "ACTUACION", tipoActuacion: "CITACION", comentario: "Cambio posterior ficticio" } });
    const before = await snapshot(source.guarantee.id);
    await assert.rejects(service.resolve(admin, source.pending.id, { ...command(detail, "MISMA", source.guarantee.id), actualizarDatos: true }), { code: "STALE_CANDIDATES" });
    assert.equal(await snapshot(source.guarantee.id), before); await assertPending(source.pending.id);
    const refreshed = await service.getPending(admin, source.pending.id);
    await service.resolve(admin, source.pending.id, { ...command(refreshed, "MISMA", source.guarantee.id), actualizarDatos: true });
    assert.equal(await db.eventoGarantia.count({ where: { garantiaId: source.guarantee.id } }), 1);
  });
  await check("source_update_competing_with_DISTINTA_has_one_terminal_effect", async () => {
    const source = await pendingFixture(), detail = await service.getPending(admin, source.pending.id), count = await db.garantia.count();
    const results = await Promise.allSettled([service.resolve(admin, source.pending.id, { ...command(detail, "MISMA", source.guarantee.id), actualizarDatos: true }), service.resolve(coordinator, source.pending.id, command(detail, "DISTINTA"))]);
    assert.equal(results.filter(x => x.status === "fulfilled").length, 1); assert.equal(results.filter(x => x.status === "rejected" && x.reason.code === "STALE_ROW").length, 1);
    const audit = await db.resolucionFilaImportacion.findUniqueOrThrow({ where: { filaId: source.pending.id } });
    assert.equal(await db.garantia.count(), count + (audit.decision === "DISTINTA" ? 1 : 0));
    const after = await db.garantia.findUniqueOrThrow({ where: { id: source.guarantee.id } }); assert.equal(after.version, source.guarantee.version + (audit.decision === "MISMA" ? 1 : 0));
  });
  await check("source_update_audit_failure_rolls_back_guarantee_pending_row_and_version", async () => {
    const source = await pendingFixture(), detail = await service.getPending(admin, source.pending.id), before = await snapshot(source.guarantee.id);
    const body = { ...command(detail, "MISMA", source.guarantee.id), actualizarDatos: true as const };
    await db.$executeRawUnsafe(`CREATE FUNCTION update_test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic update audit failure'; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER update_test_fail_audit BEFORE INSERT ON "ResolucionFilaImportacion" FOR EACH ROW EXECUTE FUNCTION update_test_fail_audit()`);
    try { await assert.rejects(service.resolve(admin, source.pending.id, body), { code: "PERSISTENCE_UNAVAILABLE" }); assert.equal(await snapshot(source.guarantee.id), before); await assertPending(source.pending.id); }
    finally { await db.$executeRawUnsafe(`DROP TRIGGER update_test_fail_audit ON "ResolucionFilaImportacion"`); await db.$executeRawUnsafe(`DROP FUNCTION update_test_fail_audit()`); }
    await service.resolve(admin, source.pending.id, body);
  });
  await check("source_update_executor_cannot_silently_reset_management", async () => {
    const source = await pendingFixture(), detail = await service.getPending(admin, source.pending.id), before = await snapshot(source.guarantee.id);
    const { createImportRowPersistence } = await import("../src/modules/calidad-datos/persistence-service.js"), { operationalResolutionEffects } = await import("../src/modules/calidad-datos/resolution-writer.js");
    const store = createImportRowPersistence(db);
    await assert.rejects(store.registerResolution(admin, { ...command(detail, "MISMA", source.guarantee.id), filaId: source.pending.id, actualizarDatos: true }, {
      ...operationalResolutionEffects,
      async actualizarGarantiaExistente(tx, context) { await operationalResolutionEffects.actualizarGarantiaExistente!(tx, context); await tx.garantia.update({ where: { id: context.garantiaExistenteId }, data: { estadoGestion: "SIN_GESTION", revisionGestion: 0 } }); },
    }), { code: "EFFECT_NOT_COMPLETED" });
    assert.equal(await snapshot(source.guarantee.id), before); await assertPending(source.pending.id);
  });
  await check("services_validate_db_roles_and_active_accounts", async () => {
    const source = await pendingFixture(), detail = await service.getPending(admin, source.pending.id);
    for (const actor of [professional, reader]) {
      await assert.rejects(service.listPending(actor), { code: "FORBIDDEN" });
      await assert.rejects(service.getPending(actor, source.pending.id), { code: "FORBIDDEN" });
      await assert.rejects(service.listDecisions(actor), { code: "FORBIDDEN" });
      await assert.rejects(service.resolve(actor, source.pending.id, command(detail, "DISTINTA")), { code: "FORBIDDEN" });
    }
    await assert.rejects(service.getPending({ id: reader.id, rol: "ADMIN" }, source.pending.id), { code: "FORBIDDEN" });
    await db.usuario.update({ where: { id: coordinator.id }, data: { activo: false } });
    try { await assert.rejects(service.getPending(coordinator, source.pending.id), { code: "FORBIDDEN" }); }
    finally { await db.usuario.update({ where: { id: coordinator.id }, data: { activo: true } }); }
  });
  await check("real_http_routes_permissions_filters_detail_and_resolution_contracts", async () => {
    const { buildApp } = await import("../src/app.js"), { createSession } = await import("../src/modules/auth/auth-service.js");
    app = buildApp(); await app.ready();
    const cookies = new Map<string, string>();
    for (const actor of actors) cookies.set(actor.rol, `ges_session=${(await createSession(actor.id)).token}`);
    const source = await pendingFixture(), paths = ["/pendientes", `/pendientes/${source.pending.id}`, `/pendientes/${source.pending.id}/resolver`, "/decisiones"];
    const request = (path: string, cookie?: string, body?: object) => app!.inject({ method: path.endsWith("resolver") ? "POST" : "GET", url: "/api/calidad-datos" + path, headers: { origin: "http://localhost:8443", ...(cookie ? { cookie } : {}) }, ...(path.endsWith("resolver") ? { payload: body ?? {} } : {}) });
    process.env.DATA_QUALITY_ENABLED = "false";
    assert.equal((await request(paths[0], cookies.get("ADMIN"))).statusCode, 503);
    process.env.DATA_QUALITY_ENABLED = "true";
    for (const actor of actors) for (const path of paths) {
      const response = await request(path, cookies.get(actor.rol));
      const allowed = actor.rol === "ADMIN" || actor.rol === "COORDINADOR_SOME";
      assert.equal(response.statusCode, allowed ? path.endsWith("resolver") ? 400 : 200 : 403);
    }
    for (const path of paths) assert.equal((await request(path)).statusCode, 401);
    const listed = (await request(`/pendientes?importacionId=${source.pending.importacionId}&motivo=FECHA_INICIO_DISTINTA&page=1&limit=1`, cookies.get("ADMIN"))).json();
    assert.equal(listed.data.length, 1); assert.equal(listed.pagination.total, 1); assert.ok(listed.pendientesTotales >= 1);
    const response = await request(paths[1], cookies.get("ADMIN")), detail = response.json().data;
    assert.equal(response.headers["cache-control"], "no-store"); assert.equal(detail.candidatas.length, 1); assert.ok(detail.candidatas[0].comparacion.length > 0);
    for (const key of ["huellaDatos", "huellaCandidatos", "passwordHash", "huellaSolicitud", "pacienteId"]) assert.ok(!response.body.includes(`"${key}"`));
    const resolved = await request(paths[2], cookies.get("COORDINADOR_SOME"), command(detail, "DISTINTA"));
    assert.equal(resolved.statusCode, 200); assert.equal(resolved.json().data.resolucion.decision, "DISTINTA");
    const history = (await request(`/decisiones?importacionId=${source.pending.importacionId}&decision=DISTINTA`, cookies.get("ADMIN"))).json();
    assert.equal(history.pagination.total, 1); assert.equal(history.data[0].origen.numeroFila, source.pending.numeroFila);
    const historyCard = history.data[0];
    assert.equal(historyCard.origen.archivo, "resolucion-sintetica.xlsx");
    assert.equal(historyCard.garantia.id, resolved.json().data.resolucion.garantiaResultadoId);
    assert.equal(historyCard.garantia.paciente.nombre, source.patient.nombre);
    assert.equal(historyCard.garantia.nombreGarantia, source.guarantee.nombreGarantia);
    assert.equal(historyCard.garantia.fechaInicio, "2026-10-02"); assert.equal(historyCard.garantia.estadoGestion, "SIN_GESTION");
    for (const key of ["datosValidados", "antecedentesRevisados", "passwordHash", "rutNumero", "huellaDatos"]) assert.ok(!JSON.stringify(historyCard).includes(`"${key}"`));
    assert.equal((await request(paths[1], cookies.get("ADMIN"))).json().data.puedeResolver, false);
    const updateSource = await pendingFixture(), updatePath = `/pendientes/${updateSource.pending.id}/resolver`;
    const updateDetail = (await request(`/pendientes/${updateSource.pending.id}`, cookies.get("ADMIN"))).json().data;
    const updateBody = { ...command(updateDetail, "MISMA", updateSource.guarantee.id), actualizarDatos: true };
    for (const role of ["PROFESIONAL", "LECTOR"]) assert.equal((await request(updatePath, cookies.get(role), updateBody)).statusCode, 403);
    const updated = await request(updatePath, cookies.get("COORDINADOR_SOME"), updateBody);
    assert.equal(updated.statusCode, 200); assert.equal(updated.json().data.resolucion.actualizarDatos, true);
    const updateHistory = (await request(`/decisiones?importacionId=${updateSource.pending.importacionId}`, cookies.get("ADMIN"))).json();
    assert.equal(updateHistory.data[0].actualizarDatos, true);
    assert.equal(updateHistory.data[0].garantia.id, updateSource.guarantee.id);
    assert.equal(updateHistory.data[0].garantia.estadoGestion, updateSource.guarantee.estadoGestion);
    process.env.DATA_QUALITY_ENABLED = "false";
  });
  console.log(JSON.stringify({ passed: true, isolatedPostgres: true, checks, qaAccessed: false, productionAccessed: false, retentionEnabled: process.env.IMPORT_RETENTION_ENABLED === "true", operationalApiEnabledOutsideTest: false }));
} catch (error) {
  console.log(JSON.stringify({ passed: false, check: activeCheck, checks, code: (error as { code?: string }).code ?? "ISOLATED_CHECK_FAILED", type: error instanceof assert.AssertionError ? "ASSERTION_FAILED" : "INTEGRATION_FAILED" }));
  process.exitCode = 1;
} finally { await app?.close(); await operationalClient.$disconnect(); await db.$disconnect(); }
