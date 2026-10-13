import { prisma } from "../../db/prisma.js";
import { readEmailAutomationConfig } from "./automation-config.js";

const CONFIG_ID = "global";

export async function getNotificationEmailConfig() {
  const [stored, automation] = await Promise.all([
    prisma.configuracionNotificaciones.findUnique({ where: { id: CONFIG_ID }, select: { emailDestinatario: true, updatedAt: true } }),
    Promise.resolve(readEmailAutomationConfig()),
  ]);
  return {
    email: stored?.emailDestinatario ?? null,
    updatedAt: stored?.updatedAt ?? null,
    automaticEnabled: automation.enabled,
    scheduledTime: automation.time,
  };
}

export async function saveNotificationEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const saved = await prisma.configuracionNotificaciones.upsert({
    where: { id: CONFIG_ID },
    create: { id: CONFIG_ID, emailDestinatario: normalizedEmail },
    update: { emailDestinatario: normalizedEmail },
    select: { emailDestinatario: true, updatedAt: true },
  });
  return { email: saved.emailDestinatario, updatedAt: saved.updatedAt };
}
