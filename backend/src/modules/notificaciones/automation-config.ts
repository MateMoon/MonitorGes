export const AUTOMATION_TIME_ZONE = "America/Santiago";

export interface EmailAutomationConfig {
  enabled: boolean;
  time: string;
}

export function readEmailAutomationConfig(env: NodeJS.ProcessEnv = process.env): EmailAutomationConfig {
  const enabledText = (env.AUTO_EMAIL_ENABLED ?? "false").trim().toLowerCase();
  if (enabledText !== "true" && enabledText !== "false") {
    throw new Error('AUTO_EMAIL_ENABLED debe ser "true" o "false".');
  }
  const time = (env.AUTO_EMAIL_TIME ?? "08:00").trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error("AUTO_EMAIL_TIME debe usar el formato HH:mm (hora de America/Santiago).");
  }
  return { enabled: enabledText === "true", time };
}

export function timeInSantiago(now: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: AUTOMATION_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}
