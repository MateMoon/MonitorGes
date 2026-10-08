import { dateToCivil, todayInTimeZone } from "../../utils/dates.js";
import { findGuarantee, listGuarantees } from "./repository.js";
import { getDaysRemaining, getGuaranteeStatus } from "./status.js";

export function serializeGuarantee(row: any, today: string) {
  const fechaLimite = dateToCivil(row.fechaLimite);
  const diasRestantes = getDaysRemaining(fechaLimite, today);
  return { id: row.id, paciente: { id: row.paciente.id, rut: `${row.paciente.rutNumero}-${row.paciente.dv}`, nombre: row.paciente.nombre }, problemaSalud: row.problemaSalud, nombreGarantia: row.nombreGarantia, fechaInicio: dateToCivil(row.fechaInicio), fechaLimite, diasRestantes, estado: getGuaranteeStatus(fechaLimite, today), responsable: row.responsable, gestionadaAt: row.gestionadaAt, gestionadaPor: row.gestionadaPor, version: row.version };
}

export async function getGuarantees(query: Parameters<typeof listGuarantees>[0]) {
  const today = todayInTimeZone();
  const { rows, total } = await listGuarantees(query, today);
  return { data: rows.map((row) => serializeGuarantee(row, today)), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
}

export async function getGuarantee(id: string) {
  const today = todayInTimeZone();
  const row = await findGuarantee(id);
  return row ? serializeGuarantee(row, today) : null;
}
