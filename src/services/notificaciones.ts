import { apiRequest } from './api'

export interface NotificationEmailConfig {
  email: string | null
  updatedAt: string | null
  automaticEnabled: boolean
  scheduledTime: string
}

export interface SavedNotificationEmail {
  email: string
  updatedAt: string
}

export async function getNotificationEmailConfig(signal?: AbortSignal): Promise<NotificationEmailConfig> {
  const result = await apiRequest<{ data: NotificationEmailConfig }>('/api/notificaciones/configuracion-correo', { signal })
  return result.data
}

export async function saveNotificationEmail(email: string): Promise<SavedNotificationEmail> {
  const result = await apiRequest<{ data: SavedNotificationEmail }>('/api/notificaciones/configuracion-correo', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  return result.data
}