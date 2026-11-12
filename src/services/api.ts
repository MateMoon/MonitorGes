export const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message: string, public details: { path?: (string | number)[]; message?: string }[] = [], public code?: string) { super(message); }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`, {
    ...init,
    credentials: 'include',
    headers: { Accept: 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string; code?: string; details?: { path?: (string | number)[]; message?: string }[] } } | null;
    throw new ApiError(body?.error?.message ?? `Error HTTP ${response.status}`, Array.isArray(body?.error?.details) ? body.error.details : [], body?.error?.code);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
