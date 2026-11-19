// Local browser verification only. QA reads are performed by the existing READ ONLY
// repositories. Browser auth/API interception is confined to an isolated headless
// profile; no real session is created and patient/author names are anonymized.
import "dotenv/config";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { prisma } from "../dist/src/db/prisma.js";
import * as supervision from "../dist/src/modules/supervision/service.js";
import { readResponsibilities } from "../dist/src/modules/supervision/responsibility-repository.js";

const connection = new URL(process.env.DATABASE_URL ?? "");
if (!['localhost', '127.0.0.1'].includes(connection.hostname) || connection.pathname !== '/monitor_garantias_qa') throw new Error("EXPECTED_LOCAL_QA_READ_ONLY");
const application = "http://127.0.0.1:8443";
const coordinator = process.argv.includes("--coordinator");
const checkingResponsibilities = coordinator || process.argv.includes("--responsibilities");
const folder = await mkdtemp(path.join(os.tmpdir(), "ges-supervision-visual-"));
const executable = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
if (!executable) throw new Error("NO_LOCAL_BROWSER");
const browser = spawn(executable, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-sync", "--disable-extensions", "--disable-crash-reporter", "--remote-debugging-port=0", `--user-data-dir=${path.join(folder, "profile")}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
let socket;
let browserSocket;
let phase = "START";
let captureFailure;
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = (await readFile(path.join(folder, "profile", "DevToolsActivePort"), "utf8")).split("\n")[0]; break; }
    catch { await pause(100); }
  }
  if (!port) throw new Error("BROWSER_START_TIMEOUT");
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  socket.onclose = () => { for (const callbacks of pending.values()) callbacks.reject(new Error("CDP_SOCKET_CLOSED")); pending.clear(); };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    if (socket.readyState !== WebSocket.OPEN) { pending.delete(id); reject(new Error("CDP_SOCKET_CLOSED")); return; }
    socket.send(JSON.stringify({ id, method, params }));
  });
  const original = (await supervision.getSupervisionSummary()).data;
  const summary = structuredClone(original);
  summary?.prioritarios.forEach((row, index) => {
    row.paciente = { nombre: `Caso ${index + 1} · identidad reservada` };
    row.profesionalesCoincidentes.forEach((professional) => { professional.nombre = "Funcionario de revisión visual con nombre extenso"; });
  });
  summary?.distribuciones.porProfesional.forEach((row, index) => { row.nombre = `Funcionario ${index + 1}`; });
  let responsibilities = null;
  let coordinatorAuthorizationSimulated = false;
  if (checkingResponsibilities) {
    const actor = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const selected = await tx.usuario.findFirst({ where: { activo: true, rol: coordinator ? "COORDINADOR_SOME" : "ADMIN" }, select: { id: true, rol: true } });
      if (selected || !coordinator) return selected;
      return tx.usuario.findFirst({ where: { activo: true, rol: "ADMIN" }, select: { id: true, rol: true } });
    });
    if (!actor) throw new Error("NO_QA_ACTOR_FOR_VISUAL_CHECK");
    responsibilities = await readResponsibilities(actor.id);
    if (coordinator && actor.rol !== "COORDINADOR_SOME") {
      // QA may have no coordinator. Use the actual read-only staff snapshot for
      // layout only; authorization is verified separately by real route tests.
      coordinatorAuthorizationSimulated = true;
    }
    responsibilities.funcionarios.forEach((row, index) => { row.nombre = `Funcionario ${index + 1} · identidad reservada`; });
  }
  let activity = null;
  if ((process.argv.includes("--activity") || coordinator) && supervision.getSupervisionActivity) {
    activity = (await supervision.getSupervisionActivity()).data;
    activity.eventos.forEach((row, index) => {
      row.autorNombre = row.autorNombre ? "Autor de la actuación" : null;
      if (row.garantia?.paciente) row.garantia.paciente = { nombre: `Caso ${index + 1} · identidad reservada` };
      if (row.comentario) row.comentario = "Comentario reservado para esta revisión visual";
      if (row.respaldo) row.respaldo = "Respaldo reservado para esta revisión visual";
    });
  }
  const requests = [];
  socket.onmessage = async ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const callbacks = pending.get(message.id); pending.delete(message.id);
      if (message.error) callbacks.reject(new Error(`CDP_${message.error.code}`)); else callbacks.resolve(message.result);
    }
    if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      const url = new URL(request.url);
      if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
        await send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }); return;
      }
      if (!url.pathname.startsWith("/api/")) { await send("Fetch.continueRequest", { requestId }); return; }
      requests.push({ method: request.method, path: url.pathname });
      let body; let responseCode = 200;
      if (request.method !== "GET") { responseCode = 403; body = { error: { code: "FORBIDDEN", message: "La revisión visual no permite escrituras." } }; }
      else if (url.pathname === "/api/auth/me") body = { data: { user: { id: "visual-check", nombre: "Revisión visual", username: "visual-check", email: "visual@example.test", rol: coordinator ? "COORDINADOR_SOME" : "ADMIN", puedeCargarNominas: false } } };
      else if (url.pathname === "/api/supervision/resumen" && summary) body = { data: summary };
      else if (url.pathname === "/api/supervision/eventos" && activity) body = { data: activity };
      else if (url.pathname === "/api/supervision/responsabilidades" && responsibilities) body = { data: responsibilities };
      else { responseCode = 403; body = { error: { code: "FORBIDDEN", message: "Solo se verifica Supervisión SOME en este navegador aislado." } }; }
      await send("Fetch.fulfillRequest", { requestId, responseCode, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
    }
  };
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error("BROWSER_EVALUATION_FAILED");
    return result.result.value;
  };
  captureFailure = async () => {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    const filename = path.join(folder, "visual-failure.png");
    await writeFile(filename, Buffer.from(shot.data, "base64"));
    return filename;
  };
  const until = async (expression) => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(expression)) return; await pause(100); }
    throw new Error("BROWSER_RENDER_TIMEOUT");
  };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: application });
  phase = "MENU";
  await until(`Array.from(document.querySelectorAll('aside button')).some(button => button.title === 'Supervisión SOME')`);
  await evaluate(`Array.from(document.querySelectorAll('aside button')).find(button => button.title === 'Supervisión SOME').click()`);
  phase = "SUMMARY";
  await until(`document.querySelector('[aria-label="Indicadores de supervisión"]') !== null`);
  if (coordinator && await evaluate(`Array.from(document.querySelectorAll('aside button')).some(button => button.title === 'Gestión de usuarios')`)) throw new Error("COORDINATOR_USER_MANAGEMENT_VISIBLE");
  const capture = async (name, width, height, viewportOnly = false) => {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await pause(200);
    const metrics = await send("Page.getLayoutMetrics");
    const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: !viewportOnly, clip: { x: 0, y: 0, width, height: viewportOnly ? height : Math.ceil(metrics.cssContentSize.height), scale: 1 } });
    const filename = path.join(folder, name);
    await writeFile(filename, Buffer.from(result.data, "base64"));
    const layout = await evaluate(`({ viewport: innerWidth, document: document.documentElement.scrollWidth, overflowingCells: Array.from(document.querySelectorAll('td,th')).filter(cell => cell.scrollWidth > cell.clientWidth + 1).length, boxes: Array.from(document.querySelectorAll('main,main>div,table,table~p')).concat(document.querySelector('table')?.parentElement ?? []).map(el => ({ tag: el.tagName, width: el.clientWidth, scroll: el.scrollWidth, right: Math.round(el.getBoundingClientRect().right), overflow: getComputedStyle(el).overflowX })) })`);
    return { filename, ...layout };
  };
  const screenshots = [];
  screenshots.push(await capture("resumen-desktop.png", 1440, 1000));
  screenshots.push(await capture("resumen-mobile.png", 390, 844));
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.querySelector('table')?.parentElement.scrollIntoView(); if (document.querySelector('table')) document.querySelector('table').parentElement.scrollLeft = document.querySelector('table').scrollWidth;`);
  await pause(100);
  const right = await send("Page.captureScreenshot", { format: "png" });
  const rightFile = path.join(folder, "resumen-table-right.png");
  await writeFile(rightFile, Buffer.from(right.data, "base64"));
  screenshots.push({ filename: rightFile });
  if (responsibilities) {
    phase = "RESPONSIBILITIES";
    await evaluate(`Array.from(document.querySelectorAll('[role="tab"]')).find(button => button.textContent.includes('Responsabilidades')).click(); window.scrollTo(0,0)`);
    await until(`document.querySelector('[aria-label="Responsabilidades de funcionarios"]') !== null`);
    screenshots.push(await capture("responsabilidades-desktop.png", 1440, 1000));
    screenshots.push(await capture("responsabilidades-mobile.png", 390, 844));
    const hasStaff = await evaluate(`document.querySelector('[aria-label^="Editar reglas de"]') !== null`);
    if (hasStaff) {
      phase = "RULE_EDITOR";
      await evaluate(`document.querySelector('[aria-label^="Editar reglas de"]').click()`);
      await until(`document.querySelector('dialog[open]') !== null`);
      screenshots.push(await capture("reglas-desktop.png", 1440, 1000, true));
      screenshots.push(await capture("reglas-mobile.png", 390, 844, true));
      await evaluate(`document.querySelector('dialog button[aria-label="Cerrar ventana"]').click()`);
    }
  }
  if (activity) {
    phase = "ACTIVITY";
    await evaluate(`Array.from(document.querySelectorAll('[role="tab"]')).find(button => button.textContent.includes('Gestiones y cambios')).click()`);
    await until(`document.querySelector('[aria-label="Actividad de supervisión"]') !== null`);
    screenshots.push(await capture("gestiones-desktop.png", 1440, 1000));
    screenshots.push(await capture("gestiones-mobile.png", 390, 844));
  }
  console.log(JSON.stringify({ readOnly: true, namesAnonymized: true, coordinator, coordinatorAuthorizationSimulated, requests, screenshots }));
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  browserSocket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { browserSocket.onopen = resolve; browserSocket.onerror = reject; });
  browserSocket.send(JSON.stringify({ id: 1, method: "Browser.close" }));
} catch (error) {
  const screenshot = await captureFailure?.().catch(() => undefined);
  console.log(JSON.stringify({ visualCheck: false, phase, screenshot, error: error instanceof Error && /^[A-Z_0-9]+$/.test(error.message) ? error.message : "VISUAL_CHECK_FAILED" }));
  process.exitCode = 1;
} finally {
  socket?.close(); browserSocket?.close(); browser.kill(); await prisma.$disconnect();
}
