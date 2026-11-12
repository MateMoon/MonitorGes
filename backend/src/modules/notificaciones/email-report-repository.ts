import { prisma } from "../../db/prisma.js";
import type { ReportGuarantee } from "./report-service.js";

export async function findReportGuarantees(fechaInforme: string): Promise<ReportGuarantee[]> {
  const limit = new Date(`${fechaInforme}T00:00:00.000Z`);
  limit.setUTCDate(limit.getUTCDate() + 30);
  const rows = await prisma.garantia.findMany({
    where: { estadoGestion: { not: "CUMPLIDA" }, fechaLimite: { lte: limit } },
    select: { id: true, nombreGarantia: true, fechaLimite: true, responsable: true, paciente: { select: { rutNumero: true, dv: true, nombre: true } } },
  });
  return rows.map(({ paciente, ...row }) => ({ ...row, nombrePaciente: paciente.nombre, rut: `${paciente.rutNumero}-${paciente.dv}`, fechaLimite: row.fechaLimite.toISOString().slice(0, 10) }));
}
