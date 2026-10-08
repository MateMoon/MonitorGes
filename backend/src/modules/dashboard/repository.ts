import { prisma } from "../../db/prisma.js";

export async function dashboardData(today: string) {
  const day = new Date(`${today}T00:00:00.000Z`);
  const plus = (days: number) => new Date(day.getTime() + days * 86_400_000);
  const [total, vencida, critica, proxima, atencion, normal, urgentes] = await prisma.$transaction([
    prisma.garantia.count(),
    prisma.garantia.count({ where: { fechaLimite: { lt: day } } }),
    prisma.garantia.count({ where: { fechaLimite: { gte: day, lte: plus(7) } } }),
    prisma.garantia.count({ where: { fechaLimite: { gt: plus(7), lte: plus(15) } } }),
    prisma.garantia.count({ where: { fechaLimite: { gt: plus(15), lte: plus(30) } } }),
    prisma.garantia.count({ where: { fechaLimite: { gt: plus(30) } } }),
    prisma.garantia.findMany({ where: { fechaLimite: { lte: plus(7) } }, include: { paciente: true }, orderBy: { fechaLimite: "asc" }, take: 8 }),
  ]);
  return { total, conteosPorEstado: { vencida, critica, proxima, atencion, normal }, urgentes };
}
export const latestImport = () => prisma.importacion.findFirst({ orderBy: { fechaImportacion: "desc" }, select: { id: true, nombreArchivo: true, fechaImportacion: true, estado: true, registrosLeidos: true, registrosConError: true } });
