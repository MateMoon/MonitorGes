import { todayInTimeZone } from "../../utils/dates.js";
import { readSupervisionSummary } from "./repository.js";
import { readSupervisionActivity, SUPERVISION_ACTIVITY_LIMIT } from "./activity-repository.js";

export const SUPERVISION_TIME_ZONE = "America/Santiago";

export async function getSupervisionSummary() {
  const now = new Date();
  const fechaReferencia = todayInTimeZone(now, SUPERVISION_TIME_ZONE);
  const summary = await readSupervisionSummary(fechaReferencia);
  return { data: { fechaReferencia, zonaHoraria: SUPERVISION_TIME_ZONE, generadoAt: now.toISOString(), alcance: "GLOBAL" as const, ...summary } };
}


export async function getSupervisionActivity() {
  const now = new Date();
  const eventos = await readSupervisionActivity();
  return { data: { generadoAt: now.toISOString(), zonaHoraria: SUPERVISION_TIME_ZONE, alcance: "GLOBAL" as const, limite: SUPERVISION_ACTIVITY_LIMIT, eventos } };
}
