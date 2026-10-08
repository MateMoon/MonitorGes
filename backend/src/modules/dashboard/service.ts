import { todayInTimeZone } from "../../utils/dates.js";
import { serializeGuarantee } from "../garantias/service.js";
import { dashboardData, latestImport } from "./repository.js";

export async function getDashboard() {
  const today = todayInTimeZone();
  const [summary, ultimaImportacion] = await Promise.all([dashboardData(today), latestImport()]);
  return { data: { total: summary.total, conteosPorEstado: summary.conteosPorEstado, garantiasUrgentes: summary.urgentes.map((row) => serializeGuarantee(row, today)), ultimaImportacion } };
}
