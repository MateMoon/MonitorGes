import { prisma } from "../../db/prisma.js";
import { emailRecipientListSchema } from "./email-config-schema.js";
import { readEmailAutomationConfig } from "./automation-config.js";

const CONFIG_ID = "global";

function readStoredRecipients(emails: string[] | undefined, legacyEmail: string | null | undefined): string[] {
  const candidates = emails?.length ? emails : legacyEmail ? [legacyEmail] : [];
  const parsed = emailRecipientListSchema.safeParse(candidates);
  return parsed.success ? parsed.data : [];
}

export async function getNotificationEmailConfig() {
  const [stored, automation] = await Promise.all([
    prisma.configuracionNotificaciones.findUnique({ where: { id: CONFIG_ID }, select: { emailDestinatario: true, emailDestinatarios: true, updatedAt: true } }),
    Promise.resolve(readEmailAutomationConfig()),
  ]);
  const emails = readStoredRecipients(stored?.emailDestinatarios, stored?.emailDestinatario);
  return {
    emails,
    email: emails[0] ?? null,
    updatedAt: stored?.updatedAt ?? null,
    automaticEnabled: automation.enabled,
    scheduledTime: automation.time,
  };
}

export async function saveNotificationEmails(input: string[]) {
  const emails = emailRecipientListSchema.parse(input);
  const legacyEmail = emails[0] ?? null;
  const saved = await prisma.configuracionNotificaciones.upsert({
    where: { id: CONFIG_ID },
    create: { id: CONFIG_ID, emailDestinatario: legacyEmail, emailDestinatarios: emails },
    update: { emailDestinatario: legacyEmail, emailDestinatarios: emails },
    select: { emailDestinatario: true, emailDestinatarios: true, updatedAt: true },
  });
  const savedEmails = readStoredRecipients(saved.emailDestinatarios, saved.emailDestinatario);
  return { emails: savedEmails, email: savedEmails[0] ?? null, updatedAt: saved.updatedAt };
}
