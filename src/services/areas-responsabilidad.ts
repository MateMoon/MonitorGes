import { apiRequest } from './api'

export type StaffOption = { id: string; nombre: string; rol: 'ADMIN' | 'COORDINADOR_SOME' | 'PROFESIONAL' | 'LECTOR' }
export type CatalogEntry = { id: string; nombre: string; claveNormalizada: string; activo: boolean }
export type AllowedCombination = { id: string; activa: boolean; problemaSalud: Pick<CatalogEntry, 'id' | 'nombre' | 'activo'>; tipoGarantia: Pick<CatalogEntry, 'id' | 'nombre' | 'activo'> }
export type ResponsibilityCatalogs = { establecimientos: CatalogEntry[]; problemasSalud: CatalogEntry[]; tiposGarantia: CatalogEntry[]; combinaciones: AllowedCombination[] }
export type ResponsibilityArea = { id: string; usuarioId: string; establecimientoId: string; combinacionId: string; activa: boolean; createdAt: string; updatedAt: string; establecimiento: Pick<CatalogEntry, 'id' | 'nombre' | 'activo'>; combinacion: AllowedCombination }
export type AreaSelection = { establecimientoId: string; combinacionId: string }
const areaKey = ({ establecimientoId, combinacionId }: AreaSelection) => `${establecimientoId}:${combinacionId}`

/** Expands the selected dimensions into the exact coverage rows reviewed before saving. */
export function expandAreaSelection(establishmentIds: string[], combinationIds: string[], existing: AreaSelection[]) {
  const existingKeys = new Set(existing.map(areaKey))
  const seen = new Set<string>()
  const selections: AreaSelection[] = []
  let duplicateCount = 0
  for (const establecimientoId of establishmentIds) {
    for (const combinacionId of combinationIds) {
      const selection = { establecimientoId, combinacionId }
      const key = areaKey(selection)
      if (seen.has(key) || existingKeys.has(key)) { duplicateCount += 1; continue }
      seen.add(key)
      selections.push(selection)
    }
  }
  return { selections, duplicateCount }
}

export async function getActiveStaff(signal?: AbortSignal) {
  return (await apiRequest<{ data: StaffOption[] }>('/api/areas-responsabilidad/usuarios', { signal })).data
}
export async function getResponsibilityCatalogs(signal?: AbortSignal) {
  return (await apiRequest<{ data: ResponsibilityCatalogs; catalogosEditables: boolean }>('/api/areas-responsabilidad/catalogos', { signal }))
}
export async function getUserAreas(userId: string, signal?: AbortSignal) {
  return (await apiRequest<{ data: ResponsibilityArea[] }>(`/api/areas-responsabilidad/usuarios/${encodeURIComponent(userId)}`, { signal })).data
}
export async function saveUserAreas(userId: string, areas: AreaSelection[]) {
  return (await apiRequest<{ data: ResponsibilityArea[] }>(`/api/areas-responsabilidad/usuarios/${encodeURIComponent(userId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ areas }) })).data
}
export async function createResponsibilityCatalogEntry(kind: 'establecimiento' | 'problemaSalud' | 'tipoGarantia', nombre: string) {
  return (await apiRequest<{ data: CatalogEntry }>(`/api/areas-responsabilidad/catalogos/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre }) })).data
}
export async function createAllowedCombination(problemaSaludId: string, tipoGarantiaId: string) {
  return (await apiRequest<{ data: AllowedCombination }>('/api/areas-responsabilidad/catalogos/combinaciones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ problemaSaludId, tipoGarantiaId }) })).data
}
export async function setResponsibilityCatalogActive(kind: 'establecimiento' | 'problemaSalud' | 'tipoGarantia' | 'combinacion', id: string, activo: boolean) {
  await apiRequest<void>(`/api/areas-responsabilidad/catalogos/${kind}/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activo }) })
}
