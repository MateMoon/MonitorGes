import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  createDelivery: vi.fn(),
  findDelivery: vi.fn(),
  updateMany: vi.fn(),
  createAttempt: vi.fn(),
  findNotificationConfig: vi.fn(),
}));

vi.mock("../src/db/prisma.js", () => ({
  prisma: {
    configuracionNotificaciones: { findUnique: prismaMocks.findNotificationConfig },
    envioInformeCorreo: { create: prismaMocks.createDelivery, findUnique: prismaMocks.findDelivery },
    intentoEnvioCorreo: { create: prismaMocks.createAttempt },
    $transaction: (work: (tx: unknown) => unknown) => typeof work === "function"
      ? work({ envioInformeCorreo: { updateMany: prismaMocks.updateMany }, intentoEnvioCorreo: { create: prismaMocks.createAttempt } })
      : Promise.all(work as Promise<unknown>[]),
  },
}));

import { emailReportDeliveryStore, findConfiguredEmailRecipients } from "../src/modules/notificaciones/email-report-repository.js";

const date = "2026-10-13";
const reserved = { id: "reservation", estado: "EN_PROCESO", iniciadoAt: new Date(), intentos: 1, destinatario: "qa@example.test", codigoError: null };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
  vi.resetAllMocks();
  prismaMocks.createDelivery.mockRejectedValue({ code: "P2002" });
  prismaMocks.findDelivery.mockResolvedValue({ ...reserved });
  prismaMocks.updateMany.mockResolvedValue({ count: 0 });
  prismaMocks.createAttempt.mockResolvedValue({});
  prismaMocks.findNotificationConfig.mockResolvedValue({ emailDestinatario: "legacy@example.test", emailDestinatarios: [] });
});

describe("reservas persistidas de informes", () => {
  it("lee la lista nueva y conserva respaldo al destinatario legado", async () => {
    prismaMocks.findNotificationConfig.mockResolvedValueOnce({ emailDestinatario: "legacy@example.test", emailDestinatarios: [] });
    expect(await findConfiguredEmailRecipients()).toEqual(["legacy@example.test"]);
    prismaMocks.findNotificationConfig.mockResolvedValueOnce({ emailDestinatario: "legacy@example.test", emailDestinatarios: ["First@example.test", "second@example.test"] });
    expect(await findConfiguredEmailRecipients()).toEqual(["first@example.test", "second@example.test"]);
  });
  it("no recupera una reserva reciente y la vuelve a considerar tras 15 minutos", async () => {
    expect(await emailReportDeliveryStore.claim(date, reserved.destinatario)).toBe("deferred");
    expect(prismaMocks.updateMany.mock.calls[0][0].where.OR[1].iniciadoAt.lt).toEqual(new Date("2026-10-13T11:45:00Z"));
    vi.advanceTimersByTime(15 * 60_000);
    prismaMocks.updateMany.mockResolvedValueOnce({ count: 1 });
    expect(await emailReportDeliveryStore.claim(date, reserved.destinatario)).toBe("claimed");
    expect(prismaMocks.createAttempt).toHaveBeenCalledWith({ data: { envioId: "reservation", numero: 2 } });
  });

  it("no vuelve a reservar un error permanente ni supera cinco intentos", async () => {
    prismaMocks.findDelivery.mockResolvedValueOnce({ ...reserved, estado: "FALLIDO", codigoError: "EAUTH" });
    expect(await emailReportDeliveryStore.claim(date, reserved.destinatario)).toBe("permanent_failure");
    prismaMocks.findDelivery.mockResolvedValueOnce({ ...reserved, intentos: 5, estado: "FALLIDO", codigoError: "ETIMEDOUT" });
    expect(await emailReportDeliveryStore.claim(date, reserved.destinatario)).toBe("attempts_exhausted");
    expect(prismaMocks.updateMany).not.toHaveBeenCalled();
  });

  it("solo permite que una de dos reservas concurrentes adquiera el informe", async () => {
    let acquired = false;
    prismaMocks.updateMany.mockImplementation(async () => {
      if (acquired) return { count: 0 };
      acquired = true;
      return { count: 1 };
    });
    const results = await Promise.all([
      emailReportDeliveryStore.claim(date, reserved.destinatario),
      emailReportDeliveryStore.claim(date, reserved.destinatario),
    ]);
    expect(results.sort()).toEqual(["claimed", "deferred"]);
    expect(prismaMocks.createAttempt).toHaveBeenCalledTimes(1);
  });
});
