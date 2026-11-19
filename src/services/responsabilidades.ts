import { apiRequest } from "./api"
import type { AssignmentOptions, AssignmentRule, UserRole } from "./usuarios"

export interface ResponsibilityStaff {
  id: string
  nombre: string
  rol: UserRole
  activo: boolean
  reglasAsignacion: AssignmentRule[]
  revision: string
}
export interface Responsibilities {
  funcionarios: ResponsibilityStaff[]
  opciones: AssignmentOptions
}
export async function getResponsibilities(signal?: AbortSignal): Promise<Responsibilities> {
  return (await apiRequest<{ data: Responsibilities }>("/api/supervision/responsabilidades", { signal, cache: "no-store" })).data
}
export async function saveResponsibilities(staff: ResponsibilityStaff, reglasAsignacion: AssignmentRule[]): Promise<ResponsibilityStaff> {
  return (await apiRequest<{ data: ResponsibilityStaff }>(`/api/supervision/responsabilidades/${encodeURIComponent(staff.id)}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reglasAsignacion, revision: staff.revision }), cache: "no-store",
  })).data
}
