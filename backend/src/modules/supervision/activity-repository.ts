import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { eventSelect, timelineOrder } from "../garantias/management-repository.js";

export const SUPERVISION_ACTIVITY_LIMIT = 30;

/** Existing persisted events only; current guarantee context is not a historical snapshot. */
export async function readSupervisionActivity() {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const rows = await tx.eventoGarantia.findMany({
      orderBy: timelineOrder,
      take: SUPERVISION_ACTIVITY_LIMIT,
      select: {
        ...eventSelect,
        garantia: {
          select: { id: true, problemaSalud: true, nombreGarantia: true, responsable: true, estadoGestion: true, paciente: { select: { nombre: true } } },
        },
      },
    });
    return rows.map(({ garantia, createdAt, ...event }) => ({
      ...event,
      createdAt: createdAt.toISOString(),
      garantia: {
        id: garantia.id, problemaSalud: garantia.problemaSalud, nombreGarantia: garantia.nombreGarantia,
        establecimiento: garantia.responsable, estadoGestion: garantia.estadoGestion, paciente: garantia.paciente,
      },
    }));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
}
