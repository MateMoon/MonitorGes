import type { FastifyRequest } from "fastify";
import { todayInTimeZone } from "../../utils/dates.js";
import { serializeGuarantee } from "../garantias/service.js";
import { dashboardData, latestImport } from "./repository.js";

export async function getDashboard(request: FastifyRequest) {
  const today = todayInTimeZone();
  const [summary, ultimaImportacion] = await Promise.all([dashboardData(today, request.authUser!), latestImport()]);
  return { data: { total: summary.total, totalPendientes: summary.totalPendientes, conteosPorEstado: summary.conteosPorEstado, conteosPorGestion: summary.conteosPorGestion, garantiasUrgentes: summary.urgentes.map((row) => serializeGuarantee(row, today)), ultimaImportacion } };
}
