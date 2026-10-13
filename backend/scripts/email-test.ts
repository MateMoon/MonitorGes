import "dotenv/config";
import {
  createEmailService,
  EmailConfigurationError,
  EmailTransportError,
  readEmailConfig,
} from "../src/modules/notificaciones/email-service.js";

async function main() {
  let config;
  try {
    config = readEmailConfig();
  } catch (error) {
    if (error instanceof EmailConfigurationError) {
      console.error(`Configuración de correo incompleta: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const testTo = config.testTo;
  if (!testTo) {
    console.error("Falta configurar EMAIL_TEST_TO en el entorno para la prueba SMTP.");
    process.exitCode = 1;
    return;
  }

  const email = createEmailService(config);
  try {
    await email.verify();
    console.log("Conexión SMTP verificada correctamente.");
  } catch (error) {
    reportTransportError(error, "No se pudo conectar al servidor SMTP.");
    process.exitCode = 1;
    return;
  }

  try {
    const result = await email.send({
      to: testTo,
      subject: "Prueba de correo — Monitor de Garantías GES",
      text: "Este es un mensaje de prueba del servicio de correo del Monitor de Garantías GES. No contiene datos de pacientes.",
    });
    console.log(`El transporte SMTP aceptó el mensaje dirigido a ${testTo}.`);
    console.log("La aceptación del transporte no confirma la entrega en la bandeja de entrada.");
    if (result.messageId) console.log(`Identificador del mensaje: ${result.messageId}`);
    else console.log("El servidor SMTP no devolvió un identificador de mensaje.");
  } catch (error) {
    reportTransportError(error, "El servidor SMTP no aceptó el mensaje de prueba.");
    process.exitCode = 1;
  }
}

function reportTransportError(error: unknown, summary: string) {
  console.error(summary);
  if (error instanceof EmailTransportError) {
    if (error.code) console.error(`Código SMTP/red: ${error.code}`);
    if (error.command) console.error(`Operación SMTP: ${error.command}`);
    console.error(error.message);
    return;
  }
  console.error("Ocurrió un error inesperado sin mostrar detalles que pudieran contener secretos.");
}

main().catch(() => {
  console.error("La prueba de correo terminó con un error inesperado.");
  process.exitCode = 1;
});
