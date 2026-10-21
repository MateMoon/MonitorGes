import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  row: null as { id: string; emailDestinatario: string | null; emailDestinatarios: string[]; updatedAt: Date } | null,
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

import { getNotificationEmailConfig, saveNotificationEmails } from "../src/modules/notificaciones/notification-config-service.js";

describe("persistencia de configuración de correo", () => {
  beforeEach(() => {
    database.row = null;
    database.findUnique.mockImplementation(async () => database.row);
    database.upsert.mockImplementation(async ({ create, update }: { create: { id: string; emailDestinatario: string | null; emailDestinatarios: string[] }; update: { emailDestinatario: string | null; emailDestinatarios: string[] } }) => {
      database.row = { id: "global", emailDestinatario: create.emailDestinatario ?? update.emailDestinatario, emailDestinatarios: create.emailDestinatarios ?? update.emailDestinatarios, updatedAt: new Date("2026-10-13T12:00:00.000Z") };
      return database.row;
    });
  });

  it("devuelve configuración vacía sin inventar un destinatario desde el entorno", async () => {
    const config = await getNotificationEmailConfig();
    expect(config.emails).toEqual([]);
    expect(config.email).toBeNull();
    expect(config.automaticEnabled).toBe(false);
  });

  it("persiste la dirección en la fila global y puede volver a cargarla", async () => {
    const saved = await saveNotificationEmails([" Equipo.QA@Example.Test ", "SECOND@example.test", "equipo.qa@example.test"]);
    const afterRestart = await getNotificationEmailConfig();
    expect(saved.emails).toEqual(["equipo.qa@example.test", "second@example.test"]);
    expect(saved.email).toBe("equipo.qa@example.test");
    expect(database.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "global" }, update: { emailDestinatario: "equipo.qa@example.test", emailDestinatarios: ["equipo.qa@example.test", "second@example.test"] } }));
    expect(afterRestart.emails).toEqual(["equipo.qa@example.test", "second@example.test"]);
  });
  it("conserva el destinatario legado si la lista nueva aun esta vacia", async () => {
    database.row = { id: "global", emailDestinatario: "legacy@example.test", emailDestinatarios: [], updatedAt: new Date() };
    const config = await getNotificationEmailConfig();
    expect(config.emails).toEqual(["legacy@example.test"]);
  });
  it("permite quitar todos los destinatarios y pausa la configuracion", async () => {
    const saved = await saveNotificationEmails([]);
    expect(saved.emails).toEqual([]);
    expect(saved.email).toBeNull();
    expect(database.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { emailDestinatario: null, emailDestinatarios: [] } }));
  });});
