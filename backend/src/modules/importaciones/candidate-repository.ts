import { prisma } from "../../db/prisma.js";
import { dateToCivil } from "../../utils/dates.js";
import { normalizeIdentityRut } from "./identity-normalization.js";
import type { PreviewRow } from "./validation-service.js";
import type { MatchCandidate } from "./row-matching.js";

export type ExistingMatchCandidate = MatchCandidate & { fechaLimite: string; responsable: string };

/** Lee únicamente garantías de los RUT de la planilla; no escribe ni devuelve nombres de pacientes. */
export async function findExistingMatchCandidates(rows: readonly PreviewRow[]): Promise<ExistingMatchCandidate[]> {
  const patientKeys = new Map<string, { rutNumero: string; dv: string }>();
  for (const row of rows) {
    const normalized = normalizeIdentityRut(row.rut, row.dv);
    patientKeys.set(`${normalized.rutNumero}-${normalized.dv}`, normalized);
  }
  if (patientKeys.size === 0) return [];

  const records = await prisma.garantia.findMany({
    where: { paciente: { is: { OR: [...patientKeys.values()] } } },
    select: {
      id: true,
      problemaSalud: true,
      nombreGarantia: true,
      fechaInicio: true,
      fechaLimite: true,
      responsable: true,
      paciente: { select: { rutNumero: true, dv: true } },
    },
  });

  return records.map(({ paciente, fechaInicio, fechaLimite, ...record }) => ({
    ...record,
    rut: paciente.rutNumero,
    dv: paciente.dv,
    fechaInicio: dateToCivil(fechaInicio),
    fechaLimite: dateToCivil(fechaLimite),
  }));
}
