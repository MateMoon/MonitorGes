import { describe, expect, it, vi } from "vitest";
import { readEmailAutomationConfig, timeInSantiago } from "../src/modules/notificaciones/automation-config.js";
import { buildGuaranteeReport, deliverConfiguredDailyReport, deliverDailyReport, type ReportDeliveryStore } from "../src/modules/notificaciones/report-service.js";

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
    async claim(date, recipient) {
      const existing = deliveries.get(date);
      if (existing) {
        if (existing.recipient !== recipient || existing.state === "SENT" || existing.state === "IN_PROGRESS") return false;
        existing.state = "IN_PROGRESS";
        return true;
      }
      deliveries.set(date, { recipient, state: "IN_PROGRESS" });
      return true;
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

  it("omite un destinatario que ya recibió el informe de esa fecha", async () => {
    const store = memoryStore();
    const mailer = { send: vi.fn().mockResolvedValue({ messageId: "fictitious-id" }) };
    const options = { fechaInforme: today, rows: [sample("a", 1)], recipients: ["qa@example.test"], mailer, store };
    expect(await deliverDailyReport(options)).toMatchObject({ sent: 1, skipped: 0, failed: 0 });
    expect(await deliverDailyReport(options)).toMatchObject({ sent: 0, skipped: 1, failed: 0 });
    expect(mailer.send).toHaveBeenCalledTimes(1);
  });

  it("registra el fallo SMTP y reintenta al destinatario reservado", async () => {
    const store = memoryStore();
    const send = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("SMTP credentials must not be logged"), { code: "EAUTH", operation: "send" }))
      .mockResolvedValue({ messageId: "fictitious-id" });
    const onError = vi.fn();
    const options = { fechaInforme: today, rows: [sample("a", 1)], recipients: ["qa1@example.test"], mailer: { send }, store, onError };
    expect(await deliverDailyReport(options)).toMatchObject({ sent: 0, failed: 1 });
    expect(onError).toHaveBeenCalledWith("qa1@example.test", { code: "EAUTH", operation: "send" });
    expect(await deliverDailyReport({ ...options, recipients: ["qa1@example.test"] })).toMatchObject({ sent: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
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
    expect(await run(today)).toMatchObject({ configured: true, sent: 0, skipped: 1 });
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

  it("deshabilita por defecto y valida la hora", () => {
    expect(readEmailAutomationConfig({}).enabled).toBe(false);
    expect(readEmailAutomationConfig({ AUTO_EMAIL_ENABLED: "true", AUTO_EMAIL_TIME: "07:15" })).toEqual({ enabled: true, time: "07:15" });
    expect(() => readEmailAutomationConfig({ AUTO_EMAIL_ENABLED: "yes" })).toThrow("AUTO_EMAIL_ENABLED");
    expect(() => readEmailAutomationConfig({ AUTO_EMAIL_TIME: "25:00" })).toThrow("AUTO_EMAIL_TIME");
  });
});
