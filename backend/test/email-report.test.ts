import { describe, expect, it, vi } from "vitest";
import { readEmailAutomationConfig, timeInSantiago } from "../src/modules/notificaciones/automation-config.js";
import { buildGuaranteeReport, deliverConfiguredDailyReport, deliverDailyReport, formatGuaranteeReport, formatGuaranteeReportHtml, sendManualConfiguredReport, type ReportDeliveryStore } from "../src/modules/notificaciones/report-service.js";
import { isTransientEmailFailure, MAX_EMAIL_ATTEMPTS } from "../src/modules/notificaciones/email-retry-policy.js";

const today = "2026-10-13";
const sample = (id: string, days: number, nombreGarantia = `Garantía ${id}`) => ({
  id,
  nombreGarantia,
  fechaLimite: new Date(Date.parse(`${today}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10),
  responsable: "Centro ficticio",
});

function memoryStore(): ReportDeliveryStore {
  const deliveries = new Map<string, { recipient: string; state: "IN_PROGRESS" | "SENT" | "FAILED" }>();
  return {
    async hasReservation(date) { return deliveries.has(date); },
    async claim(date, recipient) {
      const existing = deliveries.get(date);
      if (existing) {
        if (existing.recipient !== recipient) return "recipient_changed";
        if (existing.state === "SENT") return "already_sent";
        if (existing.state === "IN_PROGRESS") return "deferred";
        existing.state = "IN_PROGRESS";
        return "claimed";
      }
      deliveries.set(date, { recipient, state: "IN_PROGRESS" });
      return "claimed";
    },
    async sent(date, recipient) {
      const delivery = deliveries.get(date);
      if (delivery?.recipient === recipient) delivery.state = "SENT";
    },
    async failed(date, recipient) {
      const delivery = deliveries.get(date);
      if (delivery?.recipient === recipient) delivery.state = "FAILED";
    },
  };
}

describe("informes diarios de correo", () => {
  it("usa los umbrales existentes y excluye garantías normales", () => {
    const report = buildGuaranteeReport([sample("31", 31), sample("30", 30), sample("15", 15), sample("7", 7), sample("0", 0), sample("-1", -1)], today);
    expect(report.map(({ id, estado }) => [id, estado])).toEqual([
      ["-1", "vencida"], ["0", "critica"], ["7", "critica"], ["15", "proxima"], ["30", "atencion"],
    ]);
  });

  it("calcula días civiles y obtiene fecha/hora local de Santiago", () => {
    const report = buildGuaranteeReport([sample("vence-hoy", 0), sample("atrasada", -3)], today);
    expect(report.map(({ diasRestantes }) => diasRestantes)).toEqual([-3, 0]);
    expect(timeInSantiago(new Date("2026-10-13T12:00:00.000Z"))).toEqual({ date: "2026-10-13", time: "09:00" });
  });

  it("ordena por prioridad y luego por fecha límite", () => {
    const report = buildGuaranteeReport([sample("c-7", 7), sample("c-2", 2), sample("expired-1", -1), sample("attention", 20)], today);
    expect(report.map(({ id }) => id)).toEqual(["expired-1", "c-2", "c-7", "attention"]);
  });

  it("mantiene las mismas garantías y el mismo orden en las versiones de texto y HTML", () => {
    const rows = buildGuaranteeReport([sample("z", 7), sample("expired", -1), sample("soon", 15)], today);
    const text = formatGuaranteeReport(rows, today);
    const html = formatGuaranteeReportHtml(rows, today);
    const textOrder = rows.map(({ nombreGarantia }) => text.indexOf(nombreGarantia));
    const htmlOrder = rows.map(({ nombreGarantia }) => html.indexOf(nombreGarantia));
    expect(htmlOrder.every((position) => position >= 0)).toBe(true);
    expect(textOrder).toEqual([...textOrder].sort((a, b) => a - b));
    expect(htmlOrder).toEqual([...htmlOrder].sort((a, b) => a - b));
  });

  it("escapa todos los valores dinámicos del HTML, incluidos valores vacíos", () => {
    const row = {
      ...buildGuaranteeReport([sample("x", 1)], today)[0],
      nombreGarantia: `A&B <C> "D" 'E'`,
      responsable: "",
    };
    const html = formatGuaranteeReportHtml([row], `2026<&>\"'`);
    expect(html).toContain("A&amp;B &lt;C&gt; &quot;D&quot; &#39;E&#39;");
    expect(html).toContain("2026&lt;&amp;&gt;&quot;&#39;");
    expect(html).not.toContain(`A&B <C> "D" 'E'`);
    expect(html).toContain("<td style=\"padding:12px;border-bottom:1px solid #e5e7eb\"></td>");
  });

  it("omite un destinatario que ya recibió el informe y conserva el motivo", async () => {
    const store = memoryStore();
    const mailer = { send: vi.fn().mockResolvedValue({ messageId: "fictitious-id" }) };
    const options = { fechaInforme: today, rows: [sample("a", 1)], recipients: ["qa@example.test"], mailer, store };
    expect(await deliverDailyReport(options)).toMatchObject({ sent: 1, skipped: 0, failed: 0 });
    expect(await deliverDailyReport(options)).toMatchObject({ sent: 0, skipped: 1, failed: 0, skipReasons: { already_sent: 1 } });
    expect(mailer.send).toHaveBeenCalledTimes(1);
    expect(mailer.send.mock.calls[0][0]).toMatchObject({ html: expect.any(String), text: expect.any(String), headers: { "Auto-Submitted": "auto-generated" } });
  });

  it("reserva una sola ejecución cuando dos procesos compiten por la misma fecha", async () => {
    const store = memoryStore();
    const mailer = { send: vi.fn().mockResolvedValue({ messageId: "fictitious-id" }) };
    const options = { fechaInforme: today, rows: [sample("a", 1)], recipients: ["qa@example.test"], mailer, store };
    const results = await Promise.all([deliverDailyReport(options), deliverDailyReport(options)]);
    expect(results.reduce((sum, result) => sum + result.sent, 0)).toBe(1);
    expect(mailer.send).toHaveBeenCalledTimes(1);
  });

  it("registra el fallo SMTP y reintenta al destinatario reservado", async () => {
    const store = memoryStore();
    const send = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("SMTP failure"), { code: "ETIMEDOUT", operation: "send" }))
      .mockResolvedValue({ messageId: "fictitious-id" });
    const onError = vi.fn();
    const options = { fechaInforme: today, rows: [sample("a", 1)], recipients: ["qa1@example.test"], mailer: { send }, store, onError };
    expect(await deliverDailyReport(options)).toMatchObject({ sent: 0, failed: 1 });
    expect(onError).toHaveBeenCalledWith("qa1@example.test", { code: "ETIMEDOUT", operation: "send", retryable: true });
    expect(await deliverDailyReport({ ...options, recipients: ["qa1@example.test"] })).toMatchObject({ sent: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("no marca el informe enviado antes de que SMTP acepte el correo", async () => {
    const store = memoryStore();
    const markSent = vi.fn(store.sent.bind(store));
    store.sent = markSent;
    let accept!: (value: { messageId: string }) => void;
    const send = vi.fn(() => new Promise<{ messageId: string }>((resolve) => { accept = resolve; }));
    const delivery = deliverDailyReport({
      fechaInforme: today, rows: [sample("a", 1)], recipients: ["qa@example.test"], mailer: { send }, store,
    });
    await Promise.resolve();
    expect(markSent).not.toHaveBeenCalled();
    accept({ messageId: "accepted-by-smtp" });
    await delivery;
    expect(markSent).toHaveBeenCalledTimes(1);
  });

  it("usa la dirección guardada y aplaza cambios de destinatario hasta el siguiente día", async () => {
    const store = memoryStore();
    const send = vi.fn().mockResolvedValue({ messageId: "fictitious-id" });
    let configured = "qa-old@example.test";
    const run = (date: string) => deliverConfiguredDailyReport({
      fechaInforme: date,
      rows: [sample("a", 1)],
      getRecipient: async () => configured,
      mailer: { send },
      store,
    });
    expect(await run(today)).toMatchObject({ configured: true, sent: 1 });
    configured = "qa-new@example.test";
    expect(await run(today)).toMatchObject({ configured: true, sent: 0, skipped: 1, skipReasons: { recipient_changed: 1 } });
    expect(await run("2026-10-14")).toMatchObject({ configured: true, sent: 1 });
    expect(send.mock.calls.map(([message]) => message.to)).toEqual(["qa-old@example.test", "qa-new@example.test"]);
  });

  it("no intenta enviar si aún no hay un destinatario guardado", async () => {
    const mailer = { send: vi.fn() };
    const result = await deliverConfiguredDailyReport({
      fechaInforme: today,
      rows: [sample("a", 1)],
      getRecipient: async () => null,
      mailer,
      store: memoryStore(),
    });
    expect(result).toMatchObject({ configured: false, sent: 0 });
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("permite una prueba manual con el destinatario de Alertas sin reservar el envío diario", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "manual-test-id" });
    const store = memoryStore();
    const claim = vi.spyOn(store, "claim");
    const sent = vi.spyOn(store, "sent");
    const failed = vi.spyOn(store, "failed");
    let configured = "alertas@example.test";
    const result = await sendManualConfiguredReport({
      fechaInforme: today,
      rows: [sample("manual", 1)],
      getRecipient: async () => configured,
      mailer: { send },
    });
    expect(result).toMatchObject({ configured: true, acceptedBySmtp: true, eligible: 1, messageId: "manual-test-id" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toBe("alertas@example.test");
    expect(send.mock.calls[0][0].subject).toContain("prueba manual");
    expect(send.mock.calls[0][0]).toMatchObject({ html: expect.any(String), text: expect.any(String) });
    expect(send.mock.calls[0][0].headers).toBeUndefined();
    expect(claim).not.toHaveBeenCalled();
    expect(sent).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    configured = "";
    const missing = await sendManualConfiguredReport({
      fechaInforme: today, rows: [], getRecipient: async () => configured || null, mailer: { send },
    });
    expect(missing).toMatchObject({ configured: false, acceptedBySmtp: false });
    expect(send).toHaveBeenCalledTimes(1);
    const automaticSend = vi.fn().mockResolvedValue({ messageId: "automatic-test-id" });
    const automatic = await deliverDailyReport({
      fechaInforme: today, rows: [sample("automatic", 1)], recipients: ["alertas@example.test"],
      mailer: { send: automaticSend }, store,
    });
    expect(automatic).toMatchObject({ sent: 1 });
    expect(automaticSend).toHaveBeenCalledTimes(1);
  });

  it("deshabilita por defecto y valida la hora", () => {
    expect(readEmailAutomationConfig({}).enabled).toBe(false);
    expect(readEmailAutomationConfig({ AUTO_EMAIL_ENABLED: "true", AUTO_EMAIL_TIME: "07:15" })).toEqual({ enabled: true, time: "07:15" });
    expect(() => readEmailAutomationConfig({ AUTO_EMAIL_ENABLED: "yes" })).toThrow("AUTO_EMAIL_ENABLED");
    expect(() => readEmailAutomationConfig({ AUTO_EMAIL_TIME: "25:00" })).toThrow("AUTO_EMAIL_TIME");
  });

  it("clasifica fallos SMTP y fija un máximo explícito de cinco intentos", () => {
    expect(isTransientEmailFailure({ code: "ETIMEDOUT" })).toBe(true);
    expect(isTransientEmailFailure({ responseCode: 421 })).toBe(true);
    expect(isTransientEmailFailure({ code: "EAUTH", responseCode: 535 })).toBe(false);
    expect(isTransientEmailFailure({ responseCode: 550 })).toBe(false);
    expect(MAX_EMAIL_ATTEMPTS).toBe(5);
  });

  it("no reintenta si SMTP pudo aceptar el mensaje y falla el registro", async () => {
    const store = memoryStore();
    store.sent = async () => { throw new Error("database unavailable"); };
    const send = vi.fn().mockResolvedValue({ messageId: "accepted-by-smtp" });
    const onPersistenceError = vi.fn();
    const result = await deliverDailyReport({
      fechaInforme: today, rows: [sample("a", 1)], recipients: ["qa@example.test"], mailer: { send }, store, onPersistenceError,
    });
    expect(result).toMatchObject({ sent: 0, failed: 0, uncertain: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(onPersistenceError).toHaveBeenCalledTimes(1);
  });
});
