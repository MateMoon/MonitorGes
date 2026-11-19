import type { UserRole } from "./services/usuarios"

export const ROLE_LABELS: Record<UserRole, string> = { ADMIN: "Administrador", COORDINADOR_SOME: "Coordinador", PROFESIONAL: "Profesional gestor", LECTOR: "Lector" }
export function hasGlobalAccess(role: UserRole): boolean {
  return role === "ADMIN" || role === "COORDINADOR_SOME"
}

/** Mirrors the backend import guard; role grants do not depend on the saved flag. */
export function canUploadNominations(user: { rol: UserRole; puedeCargarNominas: boolean } | null): boolean {
  return Boolean(user && (hasGlobalAccess(user.rol) || (user.rol === "PROFESIONAL" && user.puedeCargarNominas)))
}
