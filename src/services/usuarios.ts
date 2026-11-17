import { apiRequest } from './api'

export type UserRole = 'ADMIN' | 'COORDINADOR_SOME' | 'PROFESIONAL' | 'LECTOR'
export type GuaranteeTypeOption = { claveNormalizada: string; nombre: string }
export type AssignmentRule = { problemaSalud: string; establecimiento: string; tipoGarantia: string }
export type AssignmentOptions = { problemasSalud: GuaranteeTypeOption[]; establecimientos: GuaranteeTypeOption[]; tiposGarantia: GuaranteeTypeOption[] }
export type ManagedUser = { id: string; nombre: string; nombres: string | null; apellido: string | null; username: string; email: string; rol: UserRole; puedeCargarNominas: boolean; recibirInformeAutomatico: boolean; tiposGarantia: GuaranteeTypeOption[]; reglasAsignacion?: AssignmentRule[]; activo: boolean; ultimoAccesoAt: string | null; createdAt: string }
export type UserSummary = { total: number; activos: number; informesHabilitados: number }
export type UserUpdate = Pick<ManagedUser, 'nombre' | 'email' | 'rol' | 'puedeCargarNominas' | 'activo'> & { nombres?: string | null; apellido?: string | null; recibirInformeAutomatico?: boolean; tiposGarantia?: string[]; reglasAsignacion?: AssignmentRule[] }
export type UserInput = UserUpdate & { username: string; password: string; apellido: string }
export async function getUserManagement(signal?: AbortSignal) { return apiRequest<{ data: ManagedUser[]; resumen: UserSummary }>('/api/usuarios', { signal }) }
export async function getUserGuaranteeTypes(signal?: AbortSignal) { return (await apiRequest<{ data: GuaranteeTypeOption[] }>('/api/usuarios/tipos-garantia', { signal })).data }
export async function getUserAssignmentOptions(signal?: AbortSignal) { return (await apiRequest<{ data: AssignmentOptions }>('/api/usuarios/opciones-asignacion', { signal })).data }
export function userAssignmentRules(user?: ManagedUser): AssignmentRule[] { return user?.reglasAsignacion ?? user?.tiposGarantia.map((type) => ({ problemaSalud: '', establecimiento: '', tipoGarantia: type.claveNormalizada })) ?? [] }
export async function getUsers(signal?: AbortSignal) { return (await apiRequest<{ data: ManagedUser[] }>('/api/usuarios', { signal })).data }
export async function createUser(input: UserInput) { return (await apiRequest<{ data: ManagedUser }>('/api/usuarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).data }
export async function updateUser(id: string, input: UserUpdate) { return (await apiRequest<{ data: ManagedUser }>(`/api/usuarios/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).data }
export async function resetUserPassword(id: string, password: string) { await apiRequest<void>(`/api/usuarios/${encodeURIComponent(id)}/contrasena`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }) }
