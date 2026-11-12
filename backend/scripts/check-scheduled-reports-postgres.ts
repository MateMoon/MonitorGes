// Programador real + repositorio PostgreSQL real. Solo el transporte se sustituye:
// nunca importa server.ts, carga .env, ni conecta a un servidor SMTP.
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import type { EmailMessage } from "../src/modules/notificaciones/email-service.js";
import type { EmailSchedulerHandle } from "../src/modules/notificaciones/email-report-scheduler.js";

const isolated = process.env.GES_SCHEDULED_REPORT_TEST_DATABASE_URL;
assert.ok(isolated);
const url = new URL(isolated);
assert.ok(url.hostname === "127.0.0.1" && Number(url.port) >= 55000 && url.pathname === "/ges_scheduled_reports_isolated" && process.env.AUTO_EMAIL_ENABLED === "false");
process.env.DATABASE_URL = isolated;
process.env.EMAIL_DEDUP_ENABLED = "true";
const { prisma } = await import("../src/db/prisma.js");
let checks = 0;
const check = (condition: unknown, message: string) => { assert.ok(condition, message); checks++; };
const handles = new Set<EmailSchedulerHandle>();
try {
  const [identity] = await prisma.$queryRaw<Array<{ cluster: string }>>`SELECT current_setting('cluster_name') AS cluster`;
  assert.equal(identity.cluster, "ges_scheduled_reports_isolated");
  for (const key of ["consulta", "tratamiento", "sin filas"]) await prisma.nombreGarantiaAsignable.create({ data: { claveNormalizada: key, nombre: key } });
  const makeUser = (username: string, key: string | null, patch = {}) => prisma.usuario.create({ data: { nombre: username, username, email: `${username}@example.test`, activo: true, recibirInformeAutomatico: true, ...patch, ...(key ? { tiposGarantia: { create: { claveNormalizada: key } } } : {}) } });
  const a = await makeUser("a", "consulta");
  const b = await makeUser("b", "tratamiento");
  await makeUser("inactive", "consulta", { activo: false });
  await makeUser("disabled", "consulta", { recibirInformeAutomatico: false });
  await makeUser("invalid", "consulta", { email: "invalido" });
  await makeUser("unassigned", null);
  await makeUser("empty", "sin filas");
  for (const [index, name] of ["CONSÚLTA!!!", "Tratamiento", "Tipo ajeno"].entries()) {
    const patient = await prisma.paciente.create({ data: { rutNumero: String(11111110 + index), dv: "5", nombre: `Paciente sintético ${index}` } });
    await prisma.garantia.create({ data: { pacienteId: patient.id, nombreGarantia: name, problemaSalud: "Prueba", responsable: "No decide la asignación", fechaInicio: new Date("2026-10-01"), fechaLimite: new Date("2026-11-06") } });
  }
  // Historial con el esquema anterior, antes de aplicar la migración nueva.
  for (const user of [a, b]) {
    const id = randomUUID(); const attempt = randomUUID(); const token = randomUUID();
    await prisma.$executeRaw`INSERT INTO "EnvioInformeIndividual" (id,"usuarioId","fechaInforme",destinatario,"huellaConfiguracion","tokenReserva",estado,"aceptadoSmtpAt","cantidadGarantias","messageId","updatedAt") VALUES (${id}::uuid,${user.id}::uuid,'2026-11-05',${user.email},'historia',${token}::uuid,'ACEPTADO_SMTP',CURRENT_TIMESTAMP,1,'manual-anterior',CURRENT_TIMESTAMP)`;
    await prisma.$executeRaw`INSERT INTO "IntentoInformeIndividual" (id,"envioId",numero,estado,"aceptadoSmtpAt","cantidadGarantias","messageId") VALUES (${attempt}::uuid,${id}::uuid,1,'ACEPTADO_SMTP',CURRENT_TIMESTAMP,1,'manual-anterior')`;
  }
  const historical = () => prisma.$queryRaw<Array<{ fingerprint: string }>>`SELECT md5(string_agg((to_jsonb(t)-'claveEjecucion')::text,'' ORDER BY id)) AS fingerprint FROM "EnvioInformeIndividual" t WHERE "messageId"='manual-anterior'`;
  const historyBefore = await historical();
  const attemptsBefore = JSON.stringify(await prisma.$queryRaw`SELECT to_jsonb(t) AS value FROM "IntentoInformeIndividual" t ORDER BY id`);
  let migration = new URL("../prisma/migrations/20261105150000_scheduled_email_executions/migration.sql", import.meta.url);
  if (!fs.existsSync(fileURLToPath(migration))) migration = new URL("../../prisma/migrations/20261105150000_scheduled_email_executions/migration.sql", import.meta.url);
  assert.ok(process.env.GES_TEST_PSQL);
  const applied = spawnSync(process.env.GES_TEST_PSQL!, ["-X", "-h", "127.0.0.1", "-p", url.port, "-U", "ges_test", "-d", "ges_scheduled_reports_isolated", "-v", "ON_ERROR_STOP=1", "-f", fileURLToPath(migration)], { windowsHide: true, encoding: "utf8" });
  assert.equal(applied.status, 0, "Se aplica la migración nueva sobre dos informes ya aceptados.");
  check(JSON.stringify(await historical()) === JSON.stringify(historyBefore), "La migración conserva los envíos anteriores.");
  check(JSON.stringify(await prisma.$queryRaw`SELECT to_jsonb(t) AS value FROM "IntentoInformeIndividual" t ORDER BY id`) === attemptsBefore, "La migración no modifica intentos históricos.");
  check((await prisma.envioInformeIndividual.findMany()).every((entry) => entry.claveEjecucion === "diario"), "Los registros anteriores conservan su ámbito diario.");

  const { startEmailReportScheduler } = await import("../src/modules/notificaciones/email-report-scheduler.js");
  const { readEmailAutomationConfig } = await import("../src/modules/notificaciones/automation-config.js");
  const { createIndividualReportStore, individualReportStore } = await import("../src/modules/notificaciones/individual-report-repository.js");
  const { deliverIndividualReports } = await import("../src/modules/notificaciones/individual-report-service.js");
  const messages: EmailMessage[] = [];
  let failB = false;
  const mailer = { async send(message: EmailMessage) {
    messages.push(message);
    assert.equal(typeof message.to, "string");
    for (const body of [message.text, message.html!]) {
      if (message.to === a.email) assert.ok(body.includes("Paciente sintético 0") && !/Paciente sintético [12]/.test(body));
      else { assert.equal(message.to, b.email); assert.ok(body.includes("Paciente sintético 1") && !/Paciente sintético [02]/.test(body)); }
    }
    if (failB && message.to === b.email) { failB = false; throw Object.assign(new Error("Fallo sintético"), { code: "ECONNECTION" }); }
    return { messageId: `scheduled-mock-${messages.length}` };
  } };
  let clock = new Date("2026-11-05T12:59:00Z");
  let completed = 0;
  const logger = { info(data: object) { if ("result" in data) completed++; }, warn() {}, error() { throw new Error("Falló la ejecución del programador aislado."); } };
  const waitForRuns = async (count: number) => {
    const until = Date.now() + 5000;
    while (completed < count && Date.now() < until) await pause(10);
    assert.ok(completed >= count, "El programador terminó la ejecución esperada.");
  };
  const start = (time: string, dedup = false) => {
    // Esta URL se usa solo para validar la configuración QA; la conexión efectiva
    // del proceso continúa siendo el clúster aislado comprobado arriba.
    const config = readEmailAutomationConfig({ DATABASE_URL: "postgresql://localhost/monitor_garantias_qa", AUTO_EMAIL_ENABLED: "true", AUTO_EMAIL_TIME: time, EMAIL_DEDUP_ENABLED: String(dedup) });
    const handle = startEmailReportScheduler(logger, { config, now: () => clock, mailer, checkIntervalMs: 10, retryIntervalMs: 100 });
    handles.add(handle); return handle;
  };
  const stop = async (handle: EmailSchedulerHandle) => { await handle.stop(); handles.delete(handle); };
  const advance = async (iso: string, runs = 1) => { const goal = completed + runs; clock = new Date(iso); await waitForRuns(goal); };

  const first = start("10:00");
  await pause(30); check(messages.length === 0, "El programador real espera las 10:00 de Santiago.");
  await advance("2026-11-05T13:00:00Z");
  check(messages.length === 2, "Con dedup false envía de nuevo después de las aceptaciones manuales del mismo día.");
  check(await prisma.envioInformeIndividual.count({ where: { claveEjecucion: "programado:10:00", estado: "ACEPTADO_SMTP" } }) === 2, "Registra dos reservas independientes para el nuevo horario.");
  await advance("2026-11-05T13:05:00Z");
  check(messages.length === 2, "Los sondeos y reintentos no repiten los aceptados de esa ejecución.");
  await stop(first);
  const restartGoal = completed + 1; const restarted = start("10:00"); await waitForRuns(restartGoal); await stop(restarted);
  check(messages.length === 2, "Reiniciar el mismo horario no crea un envío nuevo.");

  clock = new Date("2026-11-05T13:14:00Z"); const second = start("10:15");
  await advance("2026-11-05T13:15:00Z"); await stop(second);
  check(messages.length === 4, "Configurar otra hora permite otra ejecución programada el mismo día.");
  check(await prisma.envioInformeIndividual.count({ where: { usuarioId: a.id, estado: "ACEPTADO_SMTP" } }) === 3, "Conserva manual, primer horario y segundo horario sin sobrescribirlos.");
  check(JSON.stringify(await historical()) === JSON.stringify(historyBefore), "Los envíos manuales históricos siguen idénticos tras los automáticos.");

  clock = new Date("2026-11-05T13:29:00Z"); const protectedRun = start("10:30", true);
  await advance("2026-11-05T13:30:00Z"); await stop(protectedRun);
  check(messages.length === 4, "Dedup true bloquea el día completo, incluidas aceptaciones de otros horarios.");

  clock = new Date("2026-11-05T13:44:00Z"); const parallelA = start("10:45"); const parallelB = start("10:45");
  await advance("2026-11-05T13:45:00Z", 2); await stop(parallelA); await stop(parallelB);
  check(messages.length === 6, "Dos instancias simultáneas del mismo horario envían una vez por usuario.");
  check(await prisma.envioInformeIndividual.count({ where: { claveEjecucion: "programado:10:45", usuarioId: { in: [a.id, b.id] } } }) === 2, "La restricción PostgreSQL impide reservas duplicadas de una ejecución.");

  clock = new Date("2026-11-05T13:54:00Z"); failB = true; const retry = start("10:55");
  await advance("2026-11-05T13:55:00Z");
  check(messages.length === 8, "Un fallo de B no impide aceptar el informe de A.");
  await prisma.envioInformeIndividual.updateMany({ where: { usuarioId: b.id, claveEjecucion: "programado:10:55" }, data: { updatedAt: new Date(Date.now() - 360000) } });
  await advance("2026-11-05T14:00:00Z"); await stop(retry);
  check(messages.length === 9 && messages.at(-1)!.to === b.email, "Solo reintenta al usuario fallido, sin crear una nueva ejecución.");
  const retried = await prisma.envioInformeIndividual.findFirstOrThrow({ where: { usuarioId: b.id, claveEjecucion: "programado:10:55" }, include: { intentosDetalle: true } });
  check(retried.estado === "ACEPTADO_SMTP" && retried.intentosDetalle.length === 2, "El reintento conserva ambos resultados de la misma reserva.");

  const manualBefore = messages.length;
  await deliverIndividualReports({ fechaInforme: "2026-11-05", store: individualReportStore, mailer });
  check(messages.length === manualBefore, "El servicio diario/manual conserva su deduplicación.");
  const pending = createIndividualReportStore({ claveEjecucion: "programado:11:15", dedupEnabled: false });
  const currentA = (await pending.getRecipient(a.id))!;
  const held = await pending.claim(currentA, "2026-11-05", true); assert.ok("claim" in held);
  const competing = await createIndividualReportStore({ claveEjecucion: "programado:11:16", dedupEnabled: false }).claim(currentA, "2026-11-05", true);
  check("reason" in competing && competing.reason === "APLAZADO", "Otra ejecución no inicia mientras la cuenta tiene una reserva activa.");

  clock = new Date("2026-11-05T15:01:00Z"); const lateGoal = completed + 1; const late = start("12:00"); await waitForRuns(lateGoal); await stop(late);
  check(messages.length === manualBefore, "Arrancar después de la hora no dispara una tanda nueva accidental.");
  check(messages.every((message) => message.to === a.email || message.to === b.email), "Solo reciben cuentas activas, habilitadas, con correo válido, tipos y garantías propias.");
  check(await prisma.intentoInformeIndividual.count({ where: { messageId: "manual-anterior" } }) === 2, "También conserva los intentos manuales originales.");
  console.info(JSON.stringify({ ok: true, checks, scheduler: "programador real con reloj controlado", database: "ges_scheduled_reports_isolated", smtp: "simulado; ningún correo real", qa: "sin acceso", previousHistoryPreserved: true }));
} finally {
  for (const handle of handles) await handle.stop();
  await prisma.$disconnect();
}
