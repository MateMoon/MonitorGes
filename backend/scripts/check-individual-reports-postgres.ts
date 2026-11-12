// Integra SQL real con un doble de SMTP, exclusivamente en el clúster temporal dedicado.
// No carga .env, no importa server.ts y no usa transportes SMTP reales.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { setTimeout as pause } from "node:timers/promises";

const isolated = process.env.GES_INDIVIDUAL_REPORT_TEST_DATABASE_URL;
if (!isolated) throw new Error("Falta la conexión aislada explícita.");
const url = new URL(isolated);
if (url.hostname !== "127.0.0.1" || Number(url.port) < 55000 || url.pathname !== "/ges_individual_reports_isolated" || process.env.AUTO_EMAIL_ENABLED !== "false") throw new Error("El destino o la automatización no corresponden a las pruebas aisladas.");
process.env.DATABASE_URL = isolated;
process.env.EMAIL_DEDUP_ENABLED = "true";
const { prisma } = await import("../src/db/prisma.js");
const date = "2026-11-05";
let checks = 0;
const check = (condition: unknown, message: string) => { assert.ok(condition, message); checks++; };

try {
  const [identity] = await prisma.$queryRaw<Array<{ cluster: string }>>`SELECT current_setting('cluster_name') AS cluster`;
  assert.equal(identity.cluster, "ges_individual_reports_isolated");
  const old = await prisma.envioInformeCorreo.create({ data: { fechaInforme: new Date(date), destinatario: "global-anterior@example.test", estado: "ENVIADO", messageId: "historical-only", intentosDetalle: { create: { numero: 1, estado: "ENVIADO" } } } });
  const legacyBefore = JSON.stringify(await prisma.envioInformeCorreo.findMany({ include: { intentosDetalle: true } }));
  let migration = new URL("../prisma/migrations/20261105120000_individual_email_reports/migration.sql", import.meta.url);
  if (!fs.existsSync(fileURLToPath(migration))) migration = new URL("../../prisma/migrations/20261105120000_individual_email_reports/migration.sql", import.meta.url);
  assert.ok(process.env.GES_TEST_PSQL);
  const applied = spawnSync(process.env.GES_TEST_PSQL!, ["-X", "-h", "127.0.0.1", "-p", url.port, "-U", "ges_test", "-d", "ges_individual_reports_isolated", "-v", "ON_ERROR_STOP=1", "-f", fileURLToPath(migration)], { windowsHide: true, encoding: "utf8" });
  assert.equal(applied.status, 0, "La nueva migración se aplica sobre el historial global existente.");
  check(JSON.stringify(await prisma.envioInformeCorreo.findMany({ include: { intentosDetalle: true } })) === legacyBefore, "La migración conserva el historial anterior.");

  const executionMigration = new URL("../20261105150000_scheduled_email_executions/migration.sql", migration);
  const executionApplied = spawnSync(process.env.GES_TEST_PSQL!, ["-X", "-h", "127.0.0.1", "-p", url.port, "-U", "ges_test", "-d", "ges_individual_reports_isolated", "-v", "ON_ERROR_STOP=1", "-f", fileURLToPath(executionMigration)], { windowsHide: true, encoding: "utf8" });
  assert.equal(executionApplied.status, 0, "La migración de claves de ejecución se aplica en el clúster aislado.");

  const { normalizeIdentityText } = await import("../src/modules/importaciones/identity-normalization.js");
  for (const nombre of ["Consulta de especialidad", "Tratamiento", "Confirmación diagnóstica"]) await prisma.nombreGarantiaAsignable.create({ data: { nombre, claveNormalizada: normalizeIdentityText(nombre) } });
  const { hashPassword } = await import("../src/modules/auth/auth-service.js");
  const password = "isolated-admin-password";
  const passwordHash = await hashPassword(password);
  const makeUser = (username: string, keys: string[], extra: Record<string, unknown> = {}) => prisma.usuario.create({ data: { nombre: "Funcionario de prueba", username, email: `${username}@example.test`, activo: true, recibirInformeAutomatico: true, passwordHash, ...extra, tiposGarantia: { create: keys.map((claveNormalizada) => ({ claveNormalizada })) } } });
  const a = await makeUser("a", ["consulta de especialidad"], { rol: "ADMIN" });
  const b = await makeUser("b", ["tratamiento"]);
  const c = await makeUser("c", ["consulta de especialidad"]);
  await makeUser("inactive", ["consulta de especialidad"], { activo: false });
  await makeUser("disabled", ["consulta de especialidad"], { recibirInformeAutomatico: false });
  await makeUser("no-types", []);
  await makeUser("invalid-email", ["consulta de especialidad"], { email: "invalido" });
  await makeUser("no-rows", ["confirmacion diagnostica"]);
  const examples = [
    { label: "CONSÚLTA DE ESPECIALIDAD!!!", offset: 2, state: "SIN_GESTION" },
    { label: "consulta de especialidad", offset: -3, state: "EN_GESTION" },
    { label: "Consulta de especialidad", offset: 31, state: "SIN_GESTION" },
    { label: "Consulta de especialidad", offset: 1, state: "CUMPLIDA" },
    { label: "Tratamiento", offset: 10, state: "PENDIENTE_RESOLUCION" },
    { label: "Tipo ajeno", offset: 1, state: "SIN_GESTION" },
  ] as const;
  const guarantees: { id: string }[] = [];
  for (const [index, example] of examples.entries()) {
    const patient = await prisma.paciente.create({ data: { rutNumero: String(11111110 + index), dv: "5", nombre: `Paciente aislado ${index}` } });
    guarantees.push(await prisma.garantia.create({ data: { pacienteId: patient.id, nombreGarantia: example.label, problemaSalud: "No se usa para asignar", responsable: "No se usa para asignar", fechaInicio: new Date("2026-10-01"), fechaLimite: new Date(Date.parse(date) + example.offset * 86400000), estadoGestion: example.state } }));
  }
  await prisma.configuracionNotificaciones.create({ data: { id: "global", emailDestinatario: "global-anterior@example.test", emailDestinatarios: ["global-anterior@example.test"] } });
  const { individualReportStore, previewIndividualReports, latestIndividualResults } = await import("../src/modules/notificaciones/individual-report-repository.js");
  const { deliverIndividualReports } = await import("../src/modules/notificaciones/individual-report-service.js");
  const { deliverDailyReport, sendManualConfiguredReport } = await import("../src/modules/notificaciones/report-service.js");
  const preview = await previewIndividualReports(date);
  check(preview.correosPrevistos === 3 && preview.garantiasEnInformes === 5, "Vista previa cuenta dos consultas para A y C y un tratamiento para B.");
  check(!/example\.test|Funcionario|Paciente|1111111|usuarioId/.test(JSON.stringify(preview)), "La vista previa no expone identificadores ni datos personales.");
  check(await prisma.envioInformeIndividual.count() === 0 && await prisma.intentoInformeIndividual.count() === 0, "La vista previa no crea reservas ni intentos.");

  type Message = { to: string | string[]; text: string; html?: string };
  const messages: Message[] = [];
  let failB = true;
  const mailer = { async send(message: Message) {
    messages.push(message);
    assert.equal(typeof message.to, "string");
    if (message.to === b.email && failB) { failB = false; throw Object.assign(new Error("Fallo SMTP simulado"), { code: "ECONNECTION" }); }
    return { messageId: `synthetic-${messages.length}` };
  } };
  const run = (fechaInforme = date, store = individualReportStore) => deliverIndividualReports({ fechaInforme, store, mailer });
  const first = await run();
  check(first.aceptadosSmtp === 2 && first.fallidos === 1 && messages.length === 3, "Un fallo SMTP individual no bloquea a los demás.");
  for (const message of messages) {
    for (const body of [message.text, message.html!]) {
      if (message.to === b.email) check(body.includes("Paciente aislado 4") && !/Paciente aislado [012356]/.test(body), "B solo recibe tratamiento.");
      else check(body.includes("Paciente aislado 0") && body.includes("Paciente aislado 1") && !/Paciente aislado [23456]/.test(body), "A y C solo reciben consultas elegibles, sin cumplidas ni normales ni tipos ajenos.");
    }
  }
  check(messages.every((message) => message.to !== "global-anterior@example.test"), "La lista global no recibe ningún mensaje.");
  const empty = await prisma.envioInformeIndividual.findUniqueOrThrow({ where: { usuarioId_fechaInforme_claveEjecucion: { usuarioId: (await prisma.usuario.findUniqueOrThrow({ where: { username: "no-rows" } })).id, fechaInforme: new Date(date), claveEjecucion: "diario" } } });
  check(empty.estado === "OMITIDO" && empty.codigoResultado === "SIN_GARANTIAS_ELEGIBLES", "Los informes vacíos se registran como omitidos sin SMTP.");
  await run(); check(messages.length === 3, "La espera de cinco minutos impide reintentos inmediatos y no duplica a A ni C.");
  await prisma.envioInformeIndividual.updateMany({ where: { usuarioId: b.id, fechaInforme: new Date(date) }, data: { updatedAt: new Date(Date.now() - 360000) } });
  await run(); check(messages.length === 4 && messages[3].to === b.email && !messages[3].text.includes("Paciente aislado 0"), "Reintenta únicamente a B con contenido filtrado.");
  const accepted = await prisma.envioInformeIndividual.findMany({ where: { estado: "ACEPTADO_SMTP" } });
  check(accepted.length === 3 && accepted.every((record) => record.aceptadoSmtpAt !== null), "Se registra aceptación SMTP sin inventar entrega.");
  check((await prisma.intentoInformeIndividual.count({ where: { envio: { usuarioId: b.id } } })) === 2, "Los intentos se registran por usuario.");

  // Cambios confirmados después de reservar pero antes de tomar los bloqueos finales.
  const changes = [
    async () => { await prisma.usuario.update({ where: { id: a.id }, data: { email: "nuevo-a@example.test" } }); },
    async () => { await prisma.usuario.update({ where: { id: a.id }, data: { activo: false } }); },
    async () => { await prisma.usuarioTipoGarantia.deleteMany({ where: { usuarioId: a.id } }); },
    async () => { await prisma.usuario.update({ where: { id: a.id }, data: { recibirInformeAutomatico: false } }); },
  ];
  for (const [index, change] of changes.entries()) {
    await prisma.usuario.update({ where: { id: a.id }, data: { email: a.email, activo: true, recibirInformeAutomatico: true } });
    await prisma.usuarioTipoGarantia.upsert({ where: { usuarioId_claveNormalizada: { usuarioId: a.id, claveNormalizada: "consulta de especialidad" } }, create: { usuarioId: a.id, claveNormalizada: "consulta de especialidad" }, update: {} });
    const before = messages.length;
    const custom = { ...individualReportStore, candidates: async () => [a.id], begin: async (claim: Parameters<typeof individualReportStore.begin>[0]) => { const begun = await individualReportStore.begin(claim); await change(); return begun; } };
    await run(`2026-11-${String(6 + index).padStart(2, "0")}`, custom);
    check(messages.length === before, "Un cambio de correo, estado, tipos o preferencia antes de SMTP impide el envío.");
  }
  await prisma.usuario.update({ where: { id: a.id }, data: { email: a.email, activo: true, recibirInformeAutomatico: true } });
  await prisma.usuarioTipoGarantia.upsert({ where: { usuarioId_claveNormalizada: { usuarioId: a.id, claveNormalizada: "consulta de especialidad" } }, create: { usuarioId: a.id, claveNormalizada: "consulta de especialidad" }, update: {} });
  const onlyA = { ...individualReportStore, candidates: async () => [a.id] };
  const concurrentBefore = messages.length;
  await Promise.all([run("2026-11-10", onlyA), run("2026-11-10", onlyA)]);
  check(messages.length === concurrentBefore + 1, "La clave usuario+fecha evita duplicados entre procesos concurrentes.");

  // Cambiar asignaciones antes de un reintento nunca reutiliza el contenido anterior.
  const retryDate = "2026-11-11";
  const failing = { send: async (_message: Message) => { throw Object.assign(new Error("Fallo simulado"), { code: "ETIMEDOUT", command: "CONN" }); } };
  await deliverIndividualReports({ fechaInforme: retryDate, store: onlyA, mailer: failing });
  await prisma.usuarioTipoGarantia.deleteMany({ where: { usuarioId: a.id } });
  await prisma.usuarioTipoGarantia.create({ data: { usuarioId: a.id, claveNormalizada: "tratamiento" } });
  await prisma.envioInformeIndividual.updateMany({ where: { usuarioId: a.id, fechaInforme: new Date(retryDate) }, data: { updatedAt: new Date(Date.now() - 360000) } });
  const retryBefore = messages.length; await run(retryDate, onlyA);
  check(messages.length === retryBefore, "Cambiar el alcance de un intento fallido omite el informe del día.");

  // Los cambios confirmados durante SMTP quedan ordenados después de su autorización.
  let release!: () => void;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  const held = deliverIndividualReports({ fechaInforme: "2026-11-12", store: onlyA, mailer: { send: async (message) => { check(message.to === a.email, "La autorización fija un destinatario individual."); started(); await new Promise<void>((resolve) => { release = resolve; }); return { messageId: "held-smtp" }; } } });
  await startedPromise;
  let changed = false;
  const edit = prisma.usuario.update({ where: { id: a.id }, data: { email: "despues-smtp@example.test" } }).then(() => { changed = true; });
  await pause(100); check(!changed, "El bloqueo impide confirmar cambios de cuenta mientras se entrega a SMTP.");
  release(); await held; await edit; check(changed, "El cambio se confirma después de terminar SMTP.");

  const user = (await individualReportStore.getRecipient(a.id))!;
  const claim = await individualReportStore.claim(user, "2026-11-13", true);
  assert.ok("claim" in claim); await individualReportStore.begin(claim.claim);
  await prisma.envioInformeIndividual.update({ where: { id: claim.claim.id }, data: { iniciadoAt: new Date(Date.now() - 960000) } });
  const abandonedBefore = messages.length; await run("2026-11-13", onlyA);
  check(messages.length === abandonedBefore && (await prisma.envioInformeIndividual.findUniqueOrThrow({ where: { id: claim.claim.id } })).estado === "INCIERTO", "Un intento abandonado que pudo contactar SMTP no se reenvía tras reiniciar.");

  await prisma.$executeRawUnsafe(`CREATE FUNCTION reject_smtp_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.estado = 'ACEPTADO_SMTP' THEN RAISE EXCEPTION 'Fallo aislado al guardar aceptación'; END IF; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe('CREATE TRIGGER reject_smtp_acceptance BEFORE UPDATE ON "EnvioInformeIndividual" FOR EACH ROW EXECUTE FUNCTION reject_smtp_acceptance()');
  const uncertainBefore = messages.length;
  const uncertain = await run("2026-11-14", onlyA);
  await run("2026-11-14", onlyA);
  check(uncertain.inciertos === 1 && messages.length === uncertainBefore + 1, "Falla posterior a la aceptación SMTP queda incierta y no duplica el correo.");
  await prisma.$executeRawUnsafe('DROP TRIGGER reject_smtp_acceptance ON "EnvioInformeIndividual"');

  const onlyB = { ...individualReportStore, candidates: async () => [b.id] };
  let retryCalls = 0;
  const transient = { send: async (_message: Message) => { retryCalls++; throw Object.assign(new Error("Rechazo temporal simulado"), { responseCode: 450, code: "EMESSAGE", command: "DATA" }); } };
  for (let attempt = 0; attempt < 6; attempt++) {
    await deliverIndividualReports({ fechaInforme: "2026-11-15", store: onlyB, mailer: transient });
    await prisma.envioInformeIndividual.updateMany({ where: { usuarioId: b.id, fechaInforme: new Date("2026-11-15") }, data: { updatedAt: new Date(Date.now() - 360000) } });
  }
  check(retryCalls === 5 && (await prisma.intentoInformeIndividual.count({ where: { envio: { usuarioId: b.id, fechaInforme: new Date("2026-11-15") } } })) === 5, "Los reintentos individuales se limitan a cinco por usuario y día.");
  let permanentCalls = 0;
  const permanent = { send: async (_message: Message) => { permanentCalls++; throw Object.assign(new Error("Credenciales rechazadas en el doble"), { code: "EAUTH", command: "AUTH PLAIN" }); } };
  await deliverIndividualReports({ fechaInforme: "2026-11-16", store: onlyB, mailer: permanent });
  await prisma.envioInformeIndividual.updateMany({ where: { usuarioId: b.id, fechaInforme: new Date("2026-11-16") }, data: { updatedAt: new Date(Date.now() - 360000) } });
  await deliverIndividualReports({ fechaInforme: "2026-11-16", store: onlyB, mailer: permanent });
  check(permanentCalls === 1, "Un fallo permanente no se reintenta.");
  const bRecipient = (await individualReportStore.getRecipient(b.id))!;
  const abandonedReservation = await individualReportStore.claim(bRecipient, "2026-11-17", true);
  assert.ok("claim" in abandonedReservation);
  await prisma.envioInformeIndividual.update({ where: { id: abandonedReservation.claim.id }, data: { updatedAt: new Date(Date.now() - 960000) } });
  const reservationBefore = messages.length;
  await run("2026-11-17", onlyB);
  check(messages.length === reservationBefore + 1, "Solo se recuperan reservas abandonadas que aún no iniciaron SMTP.");
  const fulfilledBefore = messages.length;
  const fulfillBeforeSend = { ...onlyB, begin: async (claim: Parameters<typeof individualReportStore.begin>[0]) => { const begun = await individualReportStore.begin(claim); await prisma.garantia.update({ where: { id: guarantees[4].id }, data: { estadoGestion: "CUMPLIDA" } }); return begun; } };
  await run("2026-11-18", fulfillBeforeSend);
  check(messages.length === fulfilledBefore, "Una garantía cumplida antes de consultar el contenido no se envía.");

  const { buildApp } = await import("../src/app.js");
  const app = buildApp();
  try {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: "http://localhost:8443" }, payload: { username: "a", password } });
    assert.equal(login.statusCode, 200);
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    const response = await app.inject({ method: "GET", url: "/api/notificaciones/vista-previa-individual?fecha=" + date, headers: { cookie } });
    check(response.statusCode === 200 && !/example\.test|Paciente aislado|Funcionario de prueba/.test(response.body), "ADMIN obtiene una vista previa agregada por API.");
    check((await app.inject({ method: "GET", url: "/api/notificaciones/ultimos-resultados-individuales", headers: { cookie } })).statusCode === 200, "ADMIN consulta los últimos resultados reales.");
    check((await app.inject({ method: "GET", url: "/api/notificaciones/vista-previa-individual" })).statusCode === 401, "La vista previa exige autenticación.");
    const otherLogin = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: "http://localhost:8443" }, payload: { username: "b", password } });
    const otherCookie = String(otherLogin.headers["set-cookie"]).split(";")[0];
    check((await app.inject({ method: "GET", url: "/api/notificaciones/vista-previa-individual", headers: { cookie: otherCookie } })).statusCode === 403, "Un usuario no ADMIN no accede a la vista previa.");
  } finally { await app.close(); }
  const { inspectManualIndividualRecipients } = await import("../src/modules/notificaciones/individual-report-repository.js");
  const { sendManualIndividualReport } = await import("../src/modules/notificaciones/manual-individual-report.js");
  const manualDate = "2026-11-19";
  const manualRecordsBefore = await prisma.envioInformeIndividual.count();
  const [manualSelection] = await inspectManualIndividualRecipients(manualDate, c.id);
  check(manualSelection.destinatario === c.email && manualSelection.garantias > 0 && await prisma.envioInformeIndividual.count() === manualRecordsBefore, "La selección manual muestra la cuenta y su alcance sin crear reservas.");
  const manualOptions = { usuarioId: c.id, fechaInforme: manualDate, confirmedEmail: c.email, confirmedFingerprint: manualSelection.huellaConfiguracion, realDataConfirmed: true, store: individualReportStore, mailer };
  const manualBefore = messages.length;
  await assert.rejects(sendManualIndividualReport({ ...manualOptions, realDataConfirmed: false }), /CONFIRMACION_EXPLICITA_REQUERIDA/);
  check(messages.length === manualBefore && await prisma.envioInformeIndividual.count() === manualRecordsBefore, "Sin confirmación de datos reales no hay SMTP ni reserva manual.");
  const manualResult = await sendManualIndividualReport(manualOptions);
  const manualRecord = await prisma.envioInformeIndividual.findUniqueOrThrow({ where: { usuarioId_fechaInforme_claveEjecucion: { usuarioId: c.id, fechaInforme: new Date(manualDate), claveEjecucion: "diario" } }, include: { intentosDetalle: true } });
  check(manualResult.resumen.aceptadosSmtp === 1 && messages.length === manualBefore + 1 && messages.at(-1)!.to === c.email && manualRecord.codigoResultado === "ENVIO_MANUAL" && manualRecord.cantidadGarantias === manualSelection.garantias && manualRecord.intentosDetalle[0].codigoResultado === "ENVIO_MANUAL", "Un envío manual registra destinatario, cantidad, origen y aceptación en la reserva y su intento.");
  await sendManualIndividualReport(manualOptions);
  await run(manualDate, { ...individualReportStore, candidates: async () => [c.id] });
  check(messages.length === manualBefore + 1 && (await prisma.intentoInformeIndividual.count({ where: { envioId: manualRecord.id } })) === 1, "El envío manual y el programador comparten deduplicación sin borrar registros ni iniciar otros usuarios.");
  const dnsDate = "2026-11-20";
  const dnsRecipient = (await individualReportStore.getRecipient(c.id))!;
  const dnsClaim = await individualReportStore.claim(dnsRecipient, dnsDate, true);
  assert.ok("claim" in dnsClaim); await individualReportStore.begin(dnsClaim.claim);
  // Reproduce una clasificación antigua incorrecta sin cambiar registros de QA.
  await individualReportStore.withLockedRecipient(dnsClaim.claim, async () => ({ estado: "FALLIDO", cantidadGarantias: 3, codigoResultado: "EDNS", reintentable: false }));
  const dnsBefore = messages.length;
  const onlyC = { ...individualReportStore, candidates: async () => [c.id] };
  await run(dnsDate, onlyC);
  check(messages.length === dnsBefore, "Un EDNS antiguo tampoco evita la espera de cinco minutos.");
  await prisma.envioInformeIndividual.update({ where: { id: dnsClaim.claim.id }, data: { updatedAt: new Date(Date.now() - 360000) } });
  await run(dnsDate, onlyC);
  const dnsRecord = await prisma.envioInformeIndividual.findUniqueOrThrow({ where: { id: dnsClaim.claim.id }, include: { intentosDetalle: { orderBy: { numero: "asc" } } } });
  check(messages.length === dnsBefore + 1 && dnsRecord.estado === "ACEPTADO_SMTP" && dnsRecord.intentosDetalle.length === 2 && dnsRecord.intentosDetalle[0].estado === "FALLIDO" && dnsRecord.intentosDetalle[0].codigoResultado === "EDNS" && dnsRecord.intentosDetalle[0].reintentable === false, "La política DNS corregida crea otro intento conservando íntegro el intento anterior.");
  await run(dnsDate, onlyC);
  check(messages.length === dnsBefore + 1, "La corrección DNS nunca vuelve a enviar un informe aceptado.");
  check((await latestIndividualResults()).disponible, "Se consultan resultados individuales persistidos.");
  await assert.rejects(deliverDailyReport({ mailer }), /GLOBAL_REPORT_DISABLED/);
  await assert.rejects(sendManualConfiguredReport({ mailer }), /GLOBAL_REPORT_DISABLED/);
  check(JSON.stringify(await prisma.envioInformeCorreo.findMany({ include: { intentosDetalle: true } })) === legacyBefore && (await prisma.envioInformeCorreo.findUniqueOrThrow({ where: { id: old.id } })).messageId === "historical-only", "Los informes individuales no alteran el historial global anterior.");
  console.info(JSON.stringify({ ok: true, checks, database: "ges_individual_reports_isolated", smtp: "doble local, sin envío real", qa: "sin acceso", globalHistoryPreserved: true }));
} finally { await prisma.$disconnect(); }
