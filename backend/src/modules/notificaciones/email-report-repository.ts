import { prisma } from "../../db/prisma.js";
import type { ReportDeliveryStore, ReportGuarantee } from "./report-service.js";
import { emailAddressSchema } from "./email-config-schema.js";

export async function findReportGuarantees(fechaInforme: string): Promise<ReportGuarantee[]> {
  const limit = new Date(`${fechaInforme}T00:00:00.000Z`);
  limit.setUTCDate(limit.getUTCDate() + 30);
  const rows = await prisma.garantia.findMany({
    where: { fechaLimite: { lte: limit } },
    select: { id: true, nombreGarantia: true, fechaLimite: true, responsable: true },
  });
  return rows.map((row) => ({ ...row, fechaLimite: row.fechaLimite.toISOString().slice(0, 10) }));
}

export async function findConfiguredEmailRecipient(): Promise<string | null> {
  const configuration = await prisma.configuracionNotificaciones.findUnique({
    where: { id: "global" },
    select: { emailDestinatario: true },
  });
  const parsed = emailAddressSchema.safeParse(configuration?.emailDestinatario ?? "");
  return parsed.success ? parsed.data.toLowerCase() : null;
}

export const emailReportDeliveryStore: ReportDeliveryStore = {
  async claim(fechaInforme, destinatario) {
    const date = new Date(`${fechaInforme}T00:00:00.000Z`);
    try {
      await prisma.envioInformeCorreo.create({
        data: { fechaInforme: date, destinatario, intentosDetalle: { create: { numero: 1 } } },
      });
      return true;
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
    }

    const existing = await prisma.envioInformeCorreo.findUnique({
      where: { fechaInforme: date },
      select: { id: true, estado: true, iniciadoAt: true, intentos: true, destinatario: true },
    });
    if (!existing || existing.destinatario !== destinatario || existing.estado === "ENVIADO") return false;

    const staleBefore = new Date(Date.now() - 15 * 60 * 1000);
    const retryBefore = new Date(Date.now() - 5 * 60 * 1000);
    return prisma.$transaction(async (tx) => {
      const claimed = await tx.envioInformeCorreo.updateMany({
        where: {
          id: existing.id,
          OR: [
            { estado: "FALLIDO", updatedAt: { lt: retryBefore } },
            { estado: "EN_PROCESO", iniciadoAt: { lt: staleBefore } },
          ],
        },
        data: {
          estado: "EN_PROCESO",
          intentos: { increment: 1 },
          iniciadoAt: new Date(),
          codigoError: null,
          operacionError: null,
        },
      });
      if (claimed.count !== 1) return false;
      await tx.intentoEnvioCorreo.create({ data: { envioId: existing.id, numero: existing.intentos + 1 } });
      return true;
    });
  },

  async sent(fechaInforme, destinatario, messageId) {
    await updateDeliveryResult(fechaInforme, destinatario, "ENVIADO", { messageId });
  },

  async failed(fechaInforme, destinatario, error) {
    await updateDeliveryResult(fechaInforme, destinatario, "FALLIDO", error);
  },
};

async function updateDeliveryResult(
  fechaInforme: string,
  destinatario: string,
  estado: "ENVIADO" | "FALLIDO",
  details: { messageId?: string; code?: string; operation?: string },
) {
  const where = { fechaInforme: new Date(`${fechaInforme}T00:00:00.000Z`) };
  const current = await prisma.envioInformeCorreo.findUniqueOrThrow({ where, select: { id: true, intentos: true, destinatario: true } });
  if (current.destinatario !== destinatario) throw new Error("El destinatario del intento no coincide con la reserva del informe.");
  await prisma.$transaction([
    prisma.envioInformeCorreo.update({
      where,
      data: {
        estado,
        ...(estado === "ENVIADO" ? { enviadoAt: new Date() } : {}),
        messageId: details.messageId ?? null,
        codigoError: details.code ?? null,
        operacionError: details.operation ?? null,
      },
    }),
    prisma.intentoEnvioCorreo.update({
      where: { envioId_numero: { envioId: current.id, numero: current.intentos } },
      data: {
        estado,
        finalizadoAt: new Date(),
        messageId: details.messageId ?? null,
        codigoError: details.code ?? null,
        operacionError: details.operation ?? null,
      },
    }),
  ]);
}
