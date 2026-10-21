import { beforeEach, describe, expect, it, vi } from "vitest";

const nodemailerMock = vi.hoisted(() => ({ createTransport: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: nodemailerMock.createTransport } }));

import {
  createEmailService,
  EmailConfigurationError,
  EmailTransportError,
  readEmailConfig,
} from "../src/modules/notificaciones/email-service.js";

const validEnv = {
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "587",
  SMTP_SECURE: "false",
  SMTP_USER: "test-user",
  SMTP_PASS: "test-secret",
  EMAIL_FROM: "Monitor <monitor@example.test>",
  EMAIL_TEST_TO: "qa@example.test",
} as NodeJS.ProcessEnv;

const smtp = {
  verify: vi.fn(),
  sendMail: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  smtp.verify.mockResolvedValue(true);
  smtp.sendMail.mockResolvedValue({ messageId: "test-message-id" });
  nodemailerMock.createTransport.mockReturnValue(smtp);
});

describe("servicio de correo SMTP", () => {
  it("rechaza una configuración incompleta sin exponer el secreto", () => {
    const env = { ...validEnv, SMTP_PASS: "" };
    expect(() => readEmailConfig(env)).toThrow(EmailConfigurationError);
    expect(() => readEmailConfig(env)).toThrow("SMTP_PASS");
    expect(() => readEmailConfig(env)).not.toThrow("test-secret");
    expect(() => readEmailConfig({ ...validEnv, SMTP_PASS: "   " })).toThrow("SMTP_PASS");
  });

  it("valida puerto y bandera de seguridad", () => {
    expect(() => readEmailConfig({ ...validEnv, SMTP_PORT: "70000" })).toThrow("SMTP_PORT");
    expect(() => readEmailConfig({ ...validEnv, SMTP_SECURE: "yes" })).toThrow("SMTP_SECURE");
    expect(readEmailConfig({ ...validEnv, SMTP_PORT: "465", SMTP_SECURE: "TRUE" })).toMatchObject({ port: 465, secure: true });
  });

  it("permite usar SMTP para informes sin exigir el destinatario aislado de email:test", () => {
    const { EMAIL_TEST_TO: _testRecipient, ...envWithoutTestRecipient } = validEnv;
    expect(readEmailConfig(envWithoutTestRecipient, { requireTestRecipient: false })).not.toHaveProperty("testTo");
    expect(() => readEmailConfig(envWithoutTestRecipient)).toThrow("EMAIL_TEST_TO");
  });

  it("construye el transporte, verifica la conexión y devuelve el messageId", async () => {
    const config = readEmailConfig(validEnv);
    const service = createEmailService(config);
    expect(nodemailerMock.createTransport).toHaveBeenCalledWith({
      host: "smtp.example.test",
      port: 587,
      secure: false,
      auth: { user: "test-user", pass: "test-secret" },
    });

    await service.verify();
    const result = await service.send({
      to: ["qa@example.test", "second@example.test"], subject: "Asunto", text: "Mensaje de prueba", html: "<p>Mensaje</p>",
      headers: { "Auto-Submitted": "auto-generated" },
    });
    expect(result).toEqual({ messageId: "test-message-id" });
    expect(smtp.sendMail).toHaveBeenCalledWith({
      from: { name: "Monitor de Garantías GES", address: "monitor@example.test" },
      to: ["qa@example.test", "second@example.test"], subject: "Asunto", text: "Mensaje de prueba", html: "<p>Mensaje</p>",
      headers: { "Auto-Submitted": "auto-generated" },
    });
  });

  it("devuelve el envío sin messageId si el servidor no lo provee", async () => {
    smtp.sendMail.mockResolvedValueOnce({});
    const result = await createEmailService(readEmailConfig(validEnv)).send({ to: "qa@example.test", subject: "Asunto", text: "Mensaje" });
    expect(result).toEqual({});
  });

  it("propaga errores controlados de verificación y envío sin mensajes SMTP crudos", async () => {
    smtp.verify.mockRejectedValueOnce(Object.assign(new Error("secret leaked by smtp"), { code: "EAUTH", command: "AUTH PLAIN" }));
    smtp.sendMail.mockRejectedValueOnce(Object.assign(new Error("secret leaked by smtp"), { code: "ECONNECTION", command: "CONN" }));
    const service = createEmailService(readEmailConfig(validEnv));

    const verifyError = await service.verify().catch((error: unknown) => error);
    expect(verifyError).toBeInstanceOf(EmailTransportError);
    expect(verifyError).toMatchObject<Partial<EmailTransportError>>({ operation: "verify", code: "EAUTH", command: "AUTH PLAIN" });
    expect((verifyError as Error).message).not.toContain("secret leaked by smtp");
    const sendError = await service.send({ to: "qa@example.test", subject: "Asunto", text: "Mensaje" }).catch((error: unknown) => error);
    expect(sendError).toBeInstanceOf(EmailTransportError);
    expect(sendError).toMatchObject<Partial<EmailTransportError>>({ operation: "send", code: "ECONNECTION", command: "CONN" });
    expect((sendError as Error).message).not.toContain("secret leaked by smtp");
  });

  it("conserva responseCode SMTP para clasificar respuestas transitorias", async () => {
    smtp.sendMail.mockRejectedValueOnce(Object.assign(new Error("private smtp detail"), { code: "EENVELOPE", responseCode: 421 }));
    const error = await createEmailService(readEmailConfig(validEnv)).send({ to: "qa@example.test", subject: "Asunto", text: "Mensaje" }).catch((caught: unknown) => caught);
    expect(error).toMatchObject<Partial<EmailTransportError>>({ code: "EENVELOPE", responseCode: 421 });
    expect((error as Error).message).not.toContain("private smtp detail");
  });
});
