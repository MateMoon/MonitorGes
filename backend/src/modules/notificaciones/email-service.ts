import nodemailer, { type Transporter } from "nodemailer";

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  testTo?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
}

const FROM_NAME = "Monitor de Garantías GES";

function configuredMailbox(from: string): string {
  const bracketedAddress = from.match(/<\s*([^<>]+?)\s*>/);
  return (bracketedAddress?.[1] ?? from).trim();
}

export class EmailConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigurationError";
  }
}

export class EmailTransportError extends Error {
  constructor(
    public readonly operation: "verify" | "send",
    public readonly code: string | undefined,
    public readonly command: string | undefined,
    public readonly responseCode: number | undefined,
  ) {
    super(operation === "verify" ? "No se pudo verificar la conexión SMTP." : "El transporte SMTP no pudo aceptar el mensaje.");
    this.name = "EmailTransportError";
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new EmailConfigurationError(`Falta configurar ${name} en el entorno.`);
  return value;
}

export function readEmailConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { requireTestRecipient?: boolean } = {},
): EmailConfig {
  const host = required(env, "SMTP_HOST");
  const portText = required(env, "SMTP_PORT");
  const secureText = required(env, "SMTP_SECURE").toLowerCase();
  const user = required(env, "SMTP_USER");
  const pass = env.SMTP_PASS;
  const from = required(env, "EMAIL_FROM");
  const testTo = env.EMAIL_TEST_TO?.trim();
  if ((options.requireTestRecipient ?? true) && !testTo) {
    throw new EmailConfigurationError("Falta configurar EMAIL_TEST_TO en el entorno para la prueba SMTP.");
  }

  if (!pass?.trim()) throw new EmailConfigurationError("Falta configurar SMTP_PASS en el entorno.");
  if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
    throw new EmailConfigurationError("SMTP_PORT debe ser un número entre 1 y 65535.");
  }
  if (secureText !== "true" && secureText !== "false") {
    throw new EmailConfigurationError('SMTP_SECURE debe ser "true" o "false".');
  }

  return { host, port: Number(portText), secure: secureText === "true", user, pass, from, ...(testTo ? { testTo } : {}) };
}

function errorDetails(error: unknown): { code?: string; command?: string; responseCode?: number } {
  if (!error || typeof error !== "object") return {};
  const candidate = error as { code?: unknown; command?: unknown; responseCode?: unknown };
  return {
    ...(typeof candidate.code === "string" ? { code: candidate.code } : {}),
    ...(typeof candidate.command === "string" ? { command: candidate.command } : {}),
    ...(typeof candidate.responseCode === "number" ? { responseCode: candidate.responseCode } : {}),
  };
}

export function createEmailService(config: EmailConfig) {
  const transporter: Transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
  });

  return {
    async verify(): Promise<void> {
      try {
        await transporter.verify();
      } catch (error) {
        const details = errorDetails(error);
        throw new EmailTransportError("verify", details.code, details.command, details.responseCode);
      }
    },

    async send(message: EmailMessage): Promise<{ messageId?: string }> {
      try {
        const result = await transporter.sendMail({
          from: { name: FROM_NAME, address: configuredMailbox(config.from) },
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
          ...(message.headers ? { headers: message.headers } : {}),
        });
        return result.messageId ? { messageId: result.messageId } : {};
      } catch (error) {
        const details = errorDetails(error);
        throw new EmailTransportError("send", details.code, details.command, details.responseCode);
      }
    },
  };
}
