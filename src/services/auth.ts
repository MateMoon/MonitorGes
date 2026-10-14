import { apiRequest } from './api';

export type AuthUser = { id: string; username: string; nombre: string; email: string; rol: 'ADMIN' | 'PROFESIONAL' | 'LECTOR' };
type AuthResponse = { data: { user: AuthUser; expiresAt: string } };

export async function login(username: string, password: string) {
  const result = await apiRequest<AuthResponse>('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  return result.data.user;
}

export async function getCurrentUser() {
  const result = await apiRequest<{ data: { user: AuthUser } }>('/api/auth/me');
  return result.data.user;
}

export async function logout() {
  await apiRequest<void>('/api/auth/logout', { method: 'POST' });
}
