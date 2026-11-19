/** Global operational permissions; user administration remains ADMIN-only. */
export const OPERATIONAL_ROLES = ["ADMIN", "COORDINADOR_SOME"] as const;
export function hasGlobalAccess(role: string): boolean {
  return OPERATIONAL_ROLES.some((allowed) => allowed === role);
}
