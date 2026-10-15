import { afterEach, describe, expect, it, vi } from "vitest";
import { startEmailReportScheduler } from "../src/modules/notificaciones/email-report-scheduler.js";
import type { ReportDeliveryStore } from "../src/modules/notificaciones/report-service.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const row = { id: "qa-row", nombreGarantia: "Garantía QA", fechaLimite: "2026-10-14", responsable: "Equipo QA" };

function storeFake(initial: Array<[string, "processing" | "failed" | "sent"]> = []): ReportDeliveryStore {
  const statuses = new Map<string, "processing" | "failed" | "sent">(initial);
  return {
    async hasReservation(date) { return statuses.has(date); },
    async claim(date) {
      const status = statuses.get(date);
      if (status === "processing") return "deferred";
      if (status === "sent") return "already_sent";
      statuses.set(date, "processing");
      return "claimed";
    },
    async sent(date) { statuses.set(date, "sent"); },
    async failed(date) { statuses.set(date, "failed"); },
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("scheduler de informes", () => {
  it("espera la hora programada en America/Santiago", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T10:00:00Z")); // 07:00 en Santiago
    const send = vi.fn().mockResolvedValue({ messageId: "test-id" });
    const scheduler = startEmailReportScheduler(logger, {
      config: { enabled: true, time: "08:00" },
      mailer: { send }, store: storeFake(), findRows: async () => [row], getRecipient: async () => "qa@example.test",
    });
    await settle();
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toBe("qa@example.test");
    await scheduler.stop();
  });

  it("no inicia un informe nuevo al arrancar tarde y procesa el siguiente día local", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T12:00:00Z")); // 09:00 en Santiago
    const send = vi.fn().mockResolvedValue({ messageId: "test-id" });
    const store = storeFake();
    const scheduler = startEmailReportScheduler(logger, {
      config: { enabled: true, time: "08:00" },
      mailer: { send }, store, findRows: async () => [row], getRecipient: async () => "qa@example.test",
      checkIntervalMs: 30_000,
    });
    await settle();
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    await settle();
    expect(send).not.toHaveBeenCalled();
    vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
    await vi.advanceTimersByTimeAsync(30_000);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls.map(([message]) => message.subject)).toEqual([
      expect.stringContaining("2026-10-14"),
    ]);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ reason: "late_start_without_daily_reservation" }), expect.any(String));
    await scheduler.stop();
  });

  it("al arrancar tarde solo recupera un envío diario que ya tenía una reserva", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T12:00:00Z")); // 09:00 en Santiago
    const send = vi.fn().mockResolvedValue({ messageId: "retry-id" });
    const scheduler = startEmailReportScheduler(logger, {
      config: { enabled: true, time: "08:00" },
      mailer: { send },
      store: storeFake([["2026-10-13", "failed"]]),
      findRows: async () => [row],
      getRecipient: async () => "qa@example.test",
    });
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    await scheduler.stop();
  });

  it("al reiniciar el mismo día no duplica un informe ya aceptado", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T10:00:00Z")); // 07:00 en Santiago
    const store = storeFake();
    const send = vi.fn().mockResolvedValue({ messageId: "restart-id" });
    const dependencies = {
      config: { enabled: true, time: "08:00" },
      mailer: { send }, store, findRows: async () => [row], getRecipient: async () => "qa@example.test",
    };
    const firstRun = startEmailReportScheduler(logger, dependencies);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    await firstRun.stop();

    vi.setSystemTime(new Date("2026-10-13T12:05:00Z")); // 09:05 en Santiago
    const restarted = startEmailReportScheduler(logger, dependencies);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    await restarted.stop();
  });

  it("reintenta errores SMTP transitorios después del intervalo", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T10:00:00Z")); // 07:00 en Santiago
    const send = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("network"), { code: "ETIMEDOUT", operation: "send" }))
      .mockResolvedValue({ messageId: "test-id" });
    const scheduler = startEmailReportScheduler(logger, {
      config: { enabled: true, time: "08:00" }, retryIntervalMs: 300_000,
      mailer: { send }, store: storeFake(), findRows: async () => [row], getRecipient: async () => "qa@example.test",
    });
    await settle();
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300_000);
    await settle();
    expect(send).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });

  it("no envía sin destinatario y espera nuevos datos; el cierre espera trabajo activo", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T10:00:00Z")); // 07:00 en Santiago
    let recipient: string | null = null;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const send = vi.fn(async () => { await pending; return { messageId: "test-id" }; });
    const scheduler = startEmailReportScheduler(logger, {
      config: { enabled: true, time: "08:00" }, retryIntervalMs: 300_000,
      mailer: { send }, store: storeFake(), findRows: async () => [row], getRecipient: async () => recipient,
    });
    await settle();
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    await settle();
    expect(send).not.toHaveBeenCalled();
    recipient = "qa@example.test";
    await vi.advanceTimersByTimeAsync(300_000);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stopping = scheduler.stop().then(() => { stopped = true; });
    await settle();
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);
  });

  it("evita ejecuciones concurrentes dentro del proceso", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T10:00:00Z")); // 07:00 en Santiago
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const findRows = vi.fn(async () => { await pending; return [row]; });
    const scheduler = startEmailReportScheduler(logger, {
      config: { enabled: true, time: "08:00" }, checkIntervalMs: 100,
      mailer: { send: vi.fn().mockResolvedValue({}) }, store: storeFake(), findRows, getRecipient: async () => "qa@example.test",
    });
    await vi.advanceTimersByTimeAsync(60 * 60_000 + 500);
    expect(findRows).toHaveBeenCalledTimes(1);
    const stopping = scheduler.stop();
    release();
    await stopping;
  });
});
