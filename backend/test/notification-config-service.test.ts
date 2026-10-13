import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  row: null as { id: string; emailDestinatario: string | null; updatedAt: Date } | null,
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("../src/db/prisma.js", () => ({
  prisma: {
    configuracionNotificaciones: {
      findUnique: database.findUnique,
      upsert: database.upsert,
    },
  },
}));

import { getNotificationEmailConfig, saveNotificationEmail } from "../src/modules/notificaciones/notification-config-service.js";

describe("persistencia de configuración de correo", () => {
  beforeEach(() => {
    database.row = null;
    database.findUnique.mockImplementation(async () => database.row);
    database.upsert.mockImplementation(async ({ create, update }: { create: { id: string; emailDestinatario: string }; update: { emailDestinatario: string } }) => {
      database.row = { id: "global", emailDestinatario: create.emailDestinatario ?? update.emailDestinatario, updatedAt: new Date("2026-10-13T12:00:00.000Z") };
      return database.row;
    });
  });

  it("devuelve configuración vacía sin inventar un destinatario desde el entorno", async () => {
    const config = await getNotificationEmailConfig();
    expect(config.email).toBeNull();
    expect(config.automaticEnabled).toBe(false);
  });

  it("persiste la dirección en la fila global y puede volver a cargarla", async () => {
    const saved = await saveNotificationEmail("Equipo.QA@Example.Test");
    const afterRestart = await getNotificationEmailConfig();
    expect(saved.email).toBe("equipo.qa@example.test");
    expect(database.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "global" } }));
    expect(afterRestart.email).toBe("equipo.qa@example.test");
  });
});
