import { prisma } from "../../db/prisma.js";

export async function dashboardData(today: string) {
  const day = new Date(`${today}T00:00:00.000Z`);
  const plus = (days: number) => new Date(day.getTime() + days * 86_400_000);
  const operational = { estadoGestion: { not: "CUMPLIDA" as const } };
  const [total, vencida, critica, proxima, atencion, normal, urgentes, sinGestion, enGestion, pendiente, cumplida] = await prisma.$transaction([
    prisma.garantia.count(),
    prisma.garantia.count({ where: { ...operational, fechaLimite: { lt: day } } }),
    prisma.garantia.count({ where: { ...operational, fechaLimite: { gte: day, lte: plus(7) } } }),
    prisma.garantia.count({ where: { ...operational, fechaLimite: { gt: plus(7), lte: plus(15) } } }),
    prisma.garantia.count({ where: { ...operational, fechaLimite: { gt: plus(15), lte: plus(30) } } }),
    prisma.garantia.count({ where: { ...operational, fechaLimite: { gt: plus(30) } } }),
    prisma.garantia.findMany({ where: { ...operational, fechaLimite: { lte: plus(7) } }, include: { paciente: true }, orderBy: [{ fechaLimite: "asc" }, { id: "asc" }], take: 8 }),
    prisma.garantia.count({ where: { estadoGestion: "SIN_GESTION" } }),
    prisma.garantia.count({ where: { estadoGestion: "EN_GESTION" } }),
    prisma.garantia.count({ where: { estadoGestion: "PENDIENTE_RESOLUCION" } }),
    prisma.garantia.count({ where: { estadoGestion: "CUMPLIDA" } }),
  ]);
  return { total, totalPendientes: vencida + critica + proxima + atencion + normal, conteosPorEstado: { vencida, critica, proxima, atencion, normal }, conteosPorGestion: { SIN_GESTION: sinGestion, EN_GESTION: enGestion, PENDIENTE_RESOLUCION: pendiente, CUMPLIDA: cumplida }, urgentes };
}
export const latestImport = () => prisma.importacion.findFirst({ orderBy: { fechaImportacion: "desc" }, select: { id: true, nombreArchivo: true, fechaImportacion: true, estado: true, registrosLeidos: true, registrosConError: true } });
