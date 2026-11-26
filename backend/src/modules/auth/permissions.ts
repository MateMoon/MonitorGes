/** Global operational permissions; user administration remains ADMIN-only. */
export const OPERATIONAL_ROLES = ["ADMIN", "COORDINADOR_SOME", "PROFESIONAL"] as const;
export const SUPERVISION_ROLES = ["ADMIN", "COORDINADOR_SOME"] as const;
export function canSupervise(role: string): boolean {
  return SUPERVISION_ROLES.some((allowed) => allowed === role);
}
export function hasGlobalAccess(role: string): boolean {
  return OPERATIONAL_ROLES.some((allowed) => allowed === role);
}
