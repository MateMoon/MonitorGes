// Punto de configuración común para futuras solicitudes HTTP. Sin servidor configurado todavía.
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? '/api';
export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: { 'Content-Type': 'application/json', ...init?.headers }, ...init });
  if (!response.ok) throw new Error(`API request failed: ${response.status}`);
  return response.json() as Promise<T>;
}
