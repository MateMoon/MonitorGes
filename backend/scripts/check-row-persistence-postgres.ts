// Opt-in integration check. Never starts HTTP/SMTP or uses an implicit DB URL.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import type { Prisma, PrismaClient } from "@prisma/client";

const isolated = process.env.GES_ROWS_TEST_DATABASE_URL;
if (!isolated) throw new Error("EXPLICIT_ISOLATED_DATABASE_REQUIRED");
const url = new URL(isolated);
if (url.hostname !== "127.0.0.1" || Number(url.port) < 55000 || url.pathname !== "/ges_rows_isolated" || process.env.AUTO_EMAIL_ENABLED !== "false") throw new Error("ISOLATED_DATABASE_GUARD_FAILED");
process.env.DATABASE_URL = isolated;
const { PrismaClient: Client } = await import("@prisma/client");
const { createImportRowPersistence } = await import("../src/modules/calidad-datos/persistence-service.js");
const { hash } = await import("../src/modules/calidad-datos/candidate-evidence.js");
const { prepareValidatedImportContext } = await import("../src/modules/calidad-datos/validated-context.js");
const { readSupervisionActivity } = await import("../src/modules/supervision/activity-repository.js");
const prisma = new Client({ datasourceUrl: isolated, log: [] });
const store = createImportRowPersistence(prisma);
let operationalClient: PrismaClient | undefined, checks = 0;
async function check(name: string, work: () => Promise<void>) { await work(); checks++; console.log(JSON.stringify({ check: name, passed: true })); }
const q = (name: string) => '"' + name.replaceAll('"', '""') + '"';
async function oldSnapshot(names: string[]) {
  const output = [];
  for (const name of names) {
    const structure = await prisma.$queryRawUnsafe(`SELECT a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS default_value FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, name);
    const data = await prisma.$queryRawUnsafe(`SELECT count(*)::text AS count,md5(coalesce(string_agg(row_hash,'' ORDER BY row_hash),'')) AS digest FROM (SELECT md5(to_jsonb(t)::text) AS row_hash FROM public.${q(name)} t) rows`);
    output.push({ name, structure, data });
  }
  return JSON.stringify(output);
}

try {
  const [identity] = await prisma.$queryRaw<Array<{ database: string; cluster: string }>>`SELECT current_database() AS database,current_setting('cluster_name') AS cluster`;
  assert.deepEqual(identity, { database: "ges_rows_isolated", cluster: "ges_rows_isolated" });
  const actors = await Promise.all((["ADMIN", "COORDINADOR_SOME", "PROFESIONAL", "LECTOR"] as const).map((rol, i) => prisma.usuario.create({ data: { id: randomUUID(), nombre: `Cuenta sintética ${rol}`, username: `isolated-${i}`, email: `isolated-${i}@example.test`, rol } })));
  const [admin, coordinator, professional, reader] = actors;
  const patient = await prisma.paciente.create({ data: { rutNumero: "12345678", dv: "5", nombre: "Paciente sintético" } });
  const makeGuarantee = (extra: Partial<Prisma.GarantiaUncheckedCreateInput> = {}) => prisma.garantia.create({ data: { pacienteId: patient.id, problemaSalud: "Problema sintético", nombreGarantia: "Tratamiento", fechaInicio: new Date("2026-10-01"), fechaLimite: new Date("2026-12-01"), responsable: "Centro sintético", estadoGestion: "EN_GESTION", version: 3, revisionGestion: 2, ...extra } });
  const first = await makeGuarantee(), second = await makeGuarantee({ estadoGestion: "CUMPLIDA" });
  await prisma.eventoGarantia.create({ data: { garantiaId: first.id, usuarioId: admin.id, autorNombre: admin.nombre, tipo: "ACTUACION", tipoActuacion: "CITACION", comentario: "Gestión sintética conservada", estadoNuevo: "EN_GESTION" } });
  const oldCase = await prisma.casoCalidad.create({ data: { origen: "EXCEL", motivo: "Histórico sintético", huella: "a".repeat(64), creadoPorId: admin.id, detectadoAt: new Date(), evidencias: { create: { posicion: 0, tipo: "FILA_EXCEL", datos: { antecedente: "Evidencia sintética anterior" }, huella: "b".repeat(64) } }, eventos: { create: { usuarioId: admin.id, autorNombre: admin.nombre, tipo: "DETECCION", estadoNuevo: "PENDIENTE", solicitudId: randomUUID(), huellaSolicitud: "c".repeat(64) } } } });
  const imports = async (actor = professional) => prisma.importacion.create({ data: { nombreArchivo: "nomina-sintetica.xlsx", usuarioId: actor.id, estado: "COMPLETADA_CON_OBSERVACIONES", registrosLeidos: 1 } });
  const importation = await imports();
  await check("disabled_importer_works_before_quality_migrations_exist", async () => {
    assert.equal(process.env.IMPORT_RETENTION_ENABLED, "false");
    const [tables] = await prisma.$queryRaw<Array<{ absent: boolean }>>`SELECT to_regclass('public."FilaImportacion"') IS NULL AND to_regclass('public."ControlRetencionImportacion"') IS NULL AS absent`;
    assert.equal(tables.absent, true);
    const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("Compatibilidad sintética");
    sheet.addRow(["Problema de salud", "RUT", "DV", "Nombre", "Fecha de Inicio", "Fecha Limite", "Dias que faltan para el Vencimiento de la Garantia", "Nombre de la garantia", "Responsable de la garantia"]);
    sheet.addRow(["Problema de compatibilidad", "11111111", "1", "Paciente sintético anterior", "2026-10-01", "2026-12-01", 0, "Garantía de compatibilidad", "Centro sintético"]);
    const { importWorkbook } = await import("../src/modules/importaciones/import-service.js");
    operationalClient = (await import("../src/db/prisma.js")).prisma;
    const result = await importWorkbook(Buffer.from(await book.xlsx.writeBuffer()), "compatibilidad.xlsx", professional.id);
    assert.equal(result.registrosNuevos, 1);
    assert.equal(result.registrosPendientesRevision, 0);
    assert.equal(result.registrosRepetidosOmitidos, 0);
  });
  const oldNames = (await prisma.$queryRaw<Array<{ name: string }>>`SELECT tablename AS name FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename`).map(t => t.name);
  await check("supervision_reads_legacy_history_without_quality_tables_or_activation", async () => {
    const count = await prisma.eventoGarantia.count();
    const rows = await readSupervisionActivity(prisma);
    assert.equal(rows.length, count); assert.ok(rows.every(row => row.tipo !== "REVISION_IMPORTACION"));
    assert.equal(await prisma.eventoGarantia.count(), count);
  });
  const beforeMigration = await oldSnapshot(oldNames);
  await check("additive_migration_over_previous_history_and_synthetic_records", async () => {
    const deployed = spawnSync(process.execPath, [fileURLToPath(new URL("../../node_modules/prisma/build/index.js", import.meta.url)), "migrate", "deploy", "--schema", fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url))], { cwd: fileURLToPath(new URL("../../", import.meta.url)), env: { ...process.env, DATABASE_URL: isolated }, encoding: "utf8", windowsHide: true });
    assert.equal(deployed.status, 0, "ISOLATED_PRISMA_DEPLOY_FAILED");
    assert.equal(await oldSnapshot(oldNames), beforeMigration);
    const [migration] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM "_prisma_migrations" WHERE "migration_name" = '20261125120000_import_row_persistence' AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`;
    assert.equal(Number(migration.count), 1);
    const constraints = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM pg_constraint WHERE conrelid IN ('"FilaImportacion"'::regclass,'"CandidatoFilaImportacion"'::regclass,'"ResolucionFilaImportacion"'::regclass) AND contype='f' AND convalidated`;
    assert.equal(Number(constraints[0].count), 7);
  });
  const header = ["Problema de salud", "RUT", "DV", "Nombre", "Fecha de Inicio", "Fecha Limite", "Dias que faltan para el Vencimiento de la Garantia", "Nombre de la garantia", "Responsable de la garantia"];
  await check("supervision_reads_migrated_schema_with_no_resolutions", async () => {
    assert.equal(await prisma.resolucionFilaImportacion.count(), 0);
    const rows = await readSupervisionActivity(prisma);
    assert.ok(rows.length > 0); assert.ok(rows.every(row => row.tipo !== "REVISION_IMPORTACION"));
  });
  async function workbook(start = "2026-10-01", guarantee = "Tratamiento", responsible = "Centro recibido") {
    const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("Nómina sintética"); sheet.addRow(header);
    sheet.addRow(["Problema sintético", "12345678", "5", "Paciente sintético", start, "2026-12-15", 0, guarantee, responsible]);
    return Buffer.from(await book.xlsx.writeBuffer());
  }
  const buffer = await workbook(), parsed = await prepareValidatedImportContext(buffer, "nomina-sintetica.xlsx");
  const origin = { importacionId: importation.id, hoja: "Nómina sintética", numeroFila: 2, contextoValidado: parsed };
  const save = async () => store.savePendingRow(professional, { ...origin, importacionId: (await imports()).id });
  const command = (filaId: string, extra: Record<string, unknown> = {}) => ({ filaId, version: 1, solicitudId: randomUUID(), decision: "MISMA" as const, garantiaExistenteId: first.id, justificacion: "Antecedentes sintéticos verificados", ...extra });
  const originalGuarantees = JSON.stringify(await prisma.garantia.findMany({ where: { id: { in: [first.id, second.id] } }, orderBy: { id: "asc" } }));
  const originalPatient = JSON.stringify(await prisma.paciente.findUnique({ where: { id: patient.id } }));
  const originalHistory = JSON.stringify(await prisma.eventoGarantia.findMany());
  const originalLegacy = JSON.stringify(await prisma.casoCalidad.findUnique({ where: { id: oldCase.id }, include: { evidencias: true, eventos: true } }));
  let rowId = "";
  await check("save_reload_original_data_candidates_and_origin", async () => {
    const saved = await store.savePendingRow(professional, origin); rowId = saved.id;
    assert.equal(saved.estado, "PENDIENTE");
    const recovered = await store.getRow(admin, rowId);
    assert.deepEqual(recovered.datosValidados, parsed.registrosValidos[0]);
    assert.equal(recovered.importacionId, importation.id); assert.equal(recovered.hoja, origin.hoja);
    assert.equal(recovered.candidatos.length, 2); assert.equal(recovered.antecedentesVigentes, true);
    assert.ok(recovered.candidatos.every(c => !JSON.stringify(c.datos).includes(patient.rutNumero)));
    await prisma.$disconnect();
    assert.equal((await store.getRow(coordinator, rowId)).id, rowId);
    assert.equal((await store.listPendingRows(admin)).pagination.total, 1);
  });
  await check("duplicate_origin_is_idempotent_and_changed_payload_is_rejected", async () => {
    const result = await Promise.all([store.savePendingRow(professional, origin), store.savePendingRow(professional, origin)]);
    assert.ok(result.every(r => r.id === rowId && r.reutilizada));
    const changed = await prepareValidatedImportContext(await workbook("2026-10-01", "Tratamiento", "Otro dato recibido"), "nomina-sintetica.xlsx");
    await assert.rejects(store.savePendingRow(professional, { ...origin, contextoValidado: changed }), { code: "SOURCE_ROW_CONFLICT" });
    assert.equal(await prisma.filaImportacion.count(), 1);
  });
  await check("real_roles_ownership_active_account_and_read_only_queries", async () => {
    for (const actor of [professional, reader]) for (const work of [() => store.listPendingRows(actor), () => store.getRow(actor, rowId), () => store.listResolutions(actor), () => store.registerResolution(actor, command(rowId))]) await assert.rejects(work(), { code: "FORBIDDEN" });
    await assert.rejects(store.savePendingRow(reader, origin), { code: "FORBIDDEN" });
    await assert.rejects(store.savePendingRow(coordinator, origin), { code: "IMPORT_OWNER_MISMATCH" });
    await assert.rejects(store.listPendingRows({ id: reader.id, rol: "ADMIN" }), { code: "FORBIDDEN" });
    await prisma.usuario.update({ where: { id: coordinator.id }, data: { activo: false } });
    try { await assert.rejects(store.getRow(coordinator, rowId), { code: "FORBIDDEN" }); }
    finally { await prisma.usuario.update({ where: { id: coordinator.id }, data: { activo: true } }); }
    await assert.rejects(store.savePendingRow(professional, { ...origin, importacionId: randomUUID() }), { code: "IMPORT_NOT_FOUND" });
    for (const actor of [admin, coordinator]) assert.equal((await store.getRow(actor, rowId)).id, rowId);
  });
  await check("only_pending_representatives_are_saved_using_the_complete_workbook", async () => {
    const normal = await prepareValidatedImportContext(await workbook("2026-10-01", "Garantía sin candidatas"), "nomina-sintetica.xlsx");
    const sourceImport = await imports(), count = await prisma.filaImportacion.count();
    await assert.rejects(store.savePendingRow(professional, { ...origin, importacionId: sourceImport.id, contextoValidado: normal }), { code: "ROW_NOT_PENDING" });
    assert.equal(await prisma.filaImportacion.count(), count);
    const repeatedBook = new ExcelJS.Workbook();
    await repeatedBook.xlsx.load(buffer as never);
    repeatedBook.worksheets[0].addRow(repeatedBook.worksheets[0].getRow(2).values);
    const repeated = await prepareValidatedImportContext(Buffer.from(await repeatedBook.xlsx.writeBuffer()), "nomina-sintetica.xlsx");
    await assert.rejects(store.savePendingRow(professional, { ...origin, importacionId: sourceImport.id, numeroFila: 3, contextoValidado: repeated }), { code: "ROW_NOT_PENDING" });
    const representative = await store.savePendingRow(professional, { ...origin, importacionId: sourceImport.id, contextoValidado: repeated });
    assert.equal((await store.getRow(admin, representative.id)).candidatos.length, 2);
    const contradictoryBook = new ExcelJS.Workbook(), sheet = contradictoryBook.addWorksheet(origin.hoja);
    sheet.addRow(header);
    for (const start of ["2026-10-01", "2026-10-02"]) sheet.addRow(["Problema sintético", "12345678", "5", "Paciente sintético", start, "2026-12-15", 0, "Familia sintética sin candidatas", "Centro recibido"]);
    const contradictory = await prepareValidatedImportContext(Buffer.from(await contradictoryBook.xlsx.writeBuffer()), "nomina-sintetica.xlsx");
    const contradictoryImport = await imports();
    for (const numeroFila of [2, 3]) {
      const saved = await store.savePendingRow(professional, { ...origin, importacionId: contradictoryImport.id, numeroFila, contextoValidado: contradictory });
      const recovered = await store.getRow(admin, saved.id);
      assert.equal(recovered.candidatos.length, 0);
      assert.ok(recovered.motivos.includes("FECHAS_DISTINTAS_EN_ARCHIVO"));
    }
  });
  await check("version_check_and_same_resolution_preserve_all_source_records", async () => {
    await assert.rejects(store.registerResolution(admin, command(rowId, { version: 2 })), { code: "STALE_ROW" });
    const result = await store.registerResolution(admin, command(rowId));
    assert.equal(result.resolucion.garantiaResultadoId, first.id); assert.equal(result.resolucion.usuarioId, admin.id); assert.equal(result.resolucion.autorNombre, admin.nombre);
    const recovered = await store.getRow(coordinator, rowId);
    assert.equal(recovered.estado, "RESUELTA"); assert.equal(recovered.version, 2);
    assert.equal(JSON.stringify(await prisma.garantia.findMany({ where: { id: { in: [first.id, second.id] } }, orderBy: { id: "asc" } })), originalGuarantees);
    assert.equal(JSON.stringify(await prisma.paciente.findUnique({ where: { id: patient.id } })), originalPatient);
    assert.equal(JSON.stringify(await prisma.eventoGarantia.findMany()), originalHistory);
  });
  await check("request_replay_and_contradictory_resolution_are_distinguished", async () => {
    const saved = await save(), input = command(saved.id);
    const result = await store.registerResolution(coordinator, input), count = await prisma.resolucionFilaImportacion.count();
    assert.equal((await store.registerResolution(coordinator, input)).resolucion.id, result.resolucion.id);
    await assert.rejects(store.registerResolution(coordinator, { ...input, justificacion: "Otro motivo sintético" }), { code: "IDEMPOTENCY_CONFLICT" });
    await assert.rejects(store.registerResolution(admin, input), { code: "IDEMPOTENCY_CONFLICT" });
    await assert.rejects(store.registerResolution(admin, command(saved.id, { decision: "DISTINTA", garantiaExistenteId: undefined })), { code: "STALE_ROW" });
    assert.equal(await prisma.resolucionFilaImportacion.count(), count);
  });
  await check("two_supervisors_resolve_once_with_different_candidates", async () => {
    const saved = await save();
    const result = await Promise.allSettled([store.registerResolution(admin, command(saved.id)), store.registerResolution(coordinator, command(saved.id, { garantiaExistenteId: second.id }))]);
    assert.equal(result.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(result.filter(r => r.status === "rejected" && r.reason.code === "STALE_ROW").length, 1);
    assert.equal(await prisma.resolucionFilaImportacion.count({ where: { filaId: saved.id } }), 1);
  });
  await check("changed_fields_patient_followup_and_new_candidates_block_resolution", async () => {
    const saved = await save();
    await prisma.garantia.update({ where: { id: first.id }, data: { responsable: "Cambio de preparación aislada", version: { increment: 1 } } });
    assert.equal((await store.getRow(admin, saved.id)).antecedentesVigentes, false);
    await assert.rejects(store.registerResolution(admin, command(saved.id)), { code: "STALE_CANDIDATES" });
    await prisma.garantia.update({ where: { id: first.id }, data: { responsable: first.responsable, version: first.version, updatedAt: first.updatedAt } });
    await prisma.garantia.update({ where: { id: second.id }, data: { revisionGestion: { increment: 1 } } });
    await assert.rejects(store.registerResolution(admin, command(saved.id)), { code: "STALE_CANDIDATES" });
    await prisma.garantia.update({ where: { id: second.id }, data: { revisionGestion: second.revisionGestion, updatedAt: second.updatedAt } });
    await prisma.paciente.update({ where: { id: patient.id }, data: { nombre: "Nombre cambiado en preparación" } });
    await assert.rejects(store.registerResolution(admin, command(saved.id)), { code: "STALE_CANDIDATES" });
    await prisma.paciente.update({ where: { id: patient.id }, data: { nombre: patient.nombre, updatedAt: patient.updatedAt } });
    const extra = await makeGuarantee();
    await assert.rejects(store.registerResolution(admin, command(saved.id)), { code: "STALE_CANDIDATES" });
    await prisma.garantia.update({ where: { id: extra.id }, data: { problemaSalud: "Otra familia de preparación" } });
    assert.equal((await store.getRow(admin, saved.id)).estado, "PENDIENTE");
  });
  const syntheticEffect = { crearGarantiaDistinta: async (tx: Prisma.TransactionClient, context: { nuevaGarantiaId: string; datosValidados: { fechaInicio: string; fechaLimite: string; responsable: string; problemaSalud: string; nombreGarantia: string } }) => {
    // Test adapter only, never imported into the product module or HTTP app.
    await tx.garantia.create({ data: { id: context.nuevaGarantiaId, pacienteId: patient.id, problemaSalud: context.datosValidados.problemaSalud, nombreGarantia: context.datosValidados.nombreGarantia, fechaInicio: new Date(context.datosValidados.fechaInicio), fechaLimite: new Date(context.datosValidados.fechaLimite), responsable: context.datosValidados.responsable } });
  } };
  await check("distinct_is_disabled_without_an_effect_and_rejects_a_no_op", async () => {
    const saved = await save(), input = command(saved.id, { decision: "DISTINTA", garantiaExistenteId: undefined });
    await assert.rejects(store.registerResolution(admin, input), { code: "DISTINCT_EFFECT_NOT_CONFIGURED" });
    await assert.rejects(store.registerResolution(admin, input, { crearGarantiaDistinta: async () => undefined }), { code: "EFFECT_NOT_COMPLETED" });
    assert.equal((await store.getRow(admin, saved.id)).estado, "PENDIENTE");
  });
  await check("audit_failure_rolls_back_state_version_and_the_synthetic_effect", async () => {
    const saved = await save(), count = await prisma.garantia.count();
    await prisma.$executeRawUnsafe(`CREATE FUNCTION rows_test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."justificacion" = 'Fallo de auditoria sintetico' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER rows_test_fail_audit BEFORE INSERT ON "ResolucionFilaImportacion" FOR EACH ROW EXECUTE FUNCTION rows_test_fail_audit()`);
    try {
      await assert.rejects(store.registerResolution(admin, command(saved.id, { decision: "DISTINTA", garantiaExistenteId: undefined, justificacion: "Fallo de auditoria sintetico" }), syntheticEffect), { code: "PERSISTENCE_UNAVAILABLE" });
      const unchanged = await store.getRow(admin, saved.id);
      assert.equal(unchanged.version, 1); assert.equal(unchanged.estado, "PENDIENTE"); assert.equal(unchanged.resolucion, null);
      assert.equal(await prisma.garantia.count(), count);
    } finally { await prisma.$executeRawUnsafe(`DROP TRIGGER rows_test_fail_audit ON "ResolucionFilaImportacion"`); await prisma.$executeRawUnsafe(`DROP FUNCTION rows_test_fail_audit()`); }
  });
  await check("future_effect_contract_is_atomic_and_retry_creates_nothing_twice", async () => {
    const saved = await save(), input = command(saved.id, { decision: "DISTINTA", garantiaExistenteId: undefined }), count = await prisma.garantia.count();
    const result = await store.registerResolution(admin, input, syntheticEffect);
    assert.equal(result.resolucion.decision, "DISTINTA");
    assert.ok(![first.id, second.id].includes(result.resolucion.garantiaResultadoId));
    assert.equal(await prisma.garantia.count(), count + 1);
    assert.equal((await store.registerResolution(admin, input)).resolucion.id, result.resolucion.id);
    assert.equal(await prisma.garantia.count(), count + 1);
    assert.equal((await store.getRow(admin, saved.id)).antecedentesVigentes, true);
    // Keep later preparations in the original family; do not delete test guarantees.
    await prisma.garantia.update({ where: { id: result.resolucion.garantiaResultadoId }, data: { problemaSalud: "Resultado sintético de otra preparación" } });
  });
  await check("foreign_keys_terminal_uniqueness_constraints_and_immutable_audit", async () => {
    await assert.rejects(prisma.importacion.delete({ where: { id: importation.id } }));
    await assert.rejects(prisma.candidatoFilaImportacion.create({ data: { filaId: rowId, garantiaId: randomUUID(), datos: {}, huella: "d".repeat(64), versionGarantia: 1, revisionGestion: 0 } }));
    const resolution = await prisma.resolucionFilaImportacion.findUniqueOrThrow({ where: { filaId: rowId } });
    await assert.rejects(prisma.resolucionFilaImportacion.update({ where: { id: resolution.id }, data: { justificacion: "No debe sustituirse el motivo" } }));
    await assert.rejects(prisma.resolucionFilaImportacion.delete({ where: { id: resolution.id } }));
    await assert.rejects(prisma.resolucionFilaImportacion.create({ data: { filaId: rowId, decision: "DISTINTA", usuarioId: coordinator.id, autorNombre: coordinator.nombre, justificacion: "Otra conclusión no permitida", solicitudId: randomUUID(), huellaSolicitud: "e".repeat(64), garantiaResultadoId: second.id } }));
    assert.equal(await prisma.resolucionFilaImportacion.count({ where: { filaId: rowId } }), 1);
    const history = await store.listResolutions(coordinator, { limit: 1 });
    assert.equal(history.resoluciones.length, 1); assert.ok(history.pagination.total >= 4);
  });
  await check("normal_importer_is_unchanged_and_does_not_create_pending_rows", async () => {
    const before = await prisma.filaImportacion.count();
    const { importWorkbook } = await import("../src/modules/importaciones/import-service.js");
    operationalClient = (await import("../src/db/prisma.js")).prisma;
    const result = await importWorkbook(await workbook("2026-11-05"), "importacion-sintetica-normal.xlsx", professional.id);
    assert.equal(result.registrosNuevos, 1); // Existing behavior; stage 2 does NOT enable retention.
    assert.equal(await prisma.filaImportacion.count(), before);
    assert.equal(JSON.stringify(await prisma.garantia.findMany({ where: { id: { in: [first.id, second.id] } }, orderBy: { id: "asc" } })), originalGuarantees);
    assert.equal(JSON.stringify(await prisma.eventoGarantia.findMany()), originalHistory);
    assert.equal(JSON.stringify(await prisma.casoCalidad.findUnique({ where: { id: oldCase.id }, include: { evidencias: true, eventos: true } })), originalLegacy);
  });
  console.log(JSON.stringify({ passed: true, isolatedPostgres: true, checks, qaAccessed: false, productionAccessed: false, productGuaranteeWriterRegistered: false }));
} catch (error) {
  console.log(JSON.stringify({ passed: false, isolatedPostgres: true, checks, code: (error as { code?: string }).code ?? "ISOLATED_CHECK_FAILED", errorType: error instanceof assert.AssertionError ? "ASSERTION_FAILED" : "INTEGRATION_FAILED" }));
  process.exitCode = 1;
} finally { await operationalClient?.$disconnect(); await prisma.$disconnect(); }
