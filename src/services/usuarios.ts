import { apiRequest } from './api'

export type UserRole = 'ADMIN' | 'COORDINADOR_SOME' | 'PROFESIONAL' | 'LECTOR'
export type ManagedUser = { id: string; nombre: string; username: string; email: string; rol: UserRole; puedeCargarNominas: boolean; activo: boolean; ultimoAccesoAt: string | null; createdAt: string }
export type UserInput = Pick<ManagedUser, 'nombre' | 'username' | 'email' | 'rol' | 'puedeCargarNominas'> & { password: string }
export async function getUsers(signal?: AbortSignal) { return (await apiRequest<{ data: ManagedUser[] }>('/api/usuarios', { signal })).data }
export async function createUser(input: UserInput) { return (await apiRequest<{ data: ManagedUser }>('/api/usuarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).data }
export async function updateUser(id: string, input: Pick<ManagedUser, 'nombre' | 'email' | 'rol' | 'puedeCargarNominas' | 'activo'>) { return (await apiRequest<{ data: ManagedUser }>(`/api/usuarios/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).data }
export async function resetUserPassword(id: string, password: string) { await apiRequest<void>(`/api/usuarios/${encodeURIComponent(id)}/contrasena`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }) }
