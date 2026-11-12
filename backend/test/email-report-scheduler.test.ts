import { afterEach, describe, expect, it, vi } from "vitest";
import { startEmailReportScheduler } from "../src/modules/notificaciones/email-report-scheduler.js";
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
async function settle() { await vi.advanceTimersByTimeAsync(0); }

describe("programador exclusivamente individual", () => {
  it("apagado no consulta usuarios ni crea transportes", async () => {
    const run = vi.fn();
    const scheduler = startEmailReportScheduler(logger, { config: { enabled: false, time: "08:00", dedupEnabled: true }, run });
    expect(run).not.toHaveBeenCalled();
    await scheduler.stop();
  });
  it("espera la hora de Santiago y permite reservas nuevas por usuario", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-05T10:59:00Z"));
    const run = vi.fn().mockResolvedValue({ aceptadosSmtp: 2 });
    const scheduler = startEmailReportScheduler(logger, { config: { enabled: true, time: "08:00", dedupEnabled: true }, run });
    await settle(); expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledWith("2026-11-05", true, "diario");
    await scheduler.stop();
  });
  it("un arranque tardío solo recupera reservas individuales existentes", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
    const run = vi.fn().mockResolvedValue({});
    const scheduler = startEmailReportScheduler(logger, { config: { enabled: true, time: "08:00", dedupEnabled: true }, run });
    await settle(); expect(run).toHaveBeenCalledWith("2026-11-05", false, "diario");
    vi.setSystemTime(new Date("2026-11-06T11:00:00Z")); await vi.advanceTimersByTimeAsync(30000);
    expect(run).toHaveBeenLastCalledWith("2026-11-06", true, "diario");
    await scheduler.stop();
  });
  it("un fallo permite volver a consultar, sin marcar todo el día como completo", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-05T11:00:00Z"));
    const run = vi.fn().mockRejectedValueOnce(new Error("fallo de consulta")).mockResolvedValue({});
    const scheduler = startEmailReportScheduler(logger, { config: { enabled: true, time: "08:00", dedupEnabled: true }, run });
    await settle(); await vi.advanceTimersByTimeAsync(300000);
    expect(run).toHaveBeenCalledTimes(2); expect(logger.error).toHaveBeenCalledTimes(1);
    await scheduler.stop();
  });
  it("evita solapamientos y espera el trabajo activo al detenerse", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-05T11:00:00Z"));
    let finish!: () => void;
    const run = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const scheduler = startEmailReportScheduler(logger, { config: { enabled: true, time: "08:00", dedupEnabled: true }, run });
    await vi.advanceTimersByTimeAsync(600000); expect(run).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stopping = scheduler.stop().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false); finish(); await stopping; expect(stopped).toBe(true);
  });
  it("sin deduplicación mantiene la clave del horario entre sondeos y reinicios", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-05T12:59:00Z"));
    const run = vi.fn().mockResolvedValue({});
    const config = { enabled: true, time: "10:00", dedupEnabled: false };
    const scheduler = startEmailReportScheduler(logger, { config, run });
    await settle(); expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledWith("2026-11-05", true, "programado:10:00");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(run).toHaveBeenLastCalledWith("2026-11-05", true, "programado:10:00");
    await scheduler.stop();
    const restarted = startEmailReportScheduler(logger, { config, run });
    await settle(); expect(run).toHaveBeenLastCalledWith("2026-11-05", false, "programado:10:00");
    await restarted.stop();
    vi.setSystemTime(new Date("2026-11-05T13:09:00Z"));
    const next = startEmailReportScheduler(logger, { config: { ...config, time: "10:10" }, run });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenLastCalledWith("2026-11-05", true, "programado:10:10");
    await next.stop();
  });
});
