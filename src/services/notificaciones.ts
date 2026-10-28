import { apiRequest } from './api'

export interface NotificationEmailConfig {
  emails: string[]
  email: string | null
  updatedAt: string | null
  automaticEnabled: boolean
  scheduledTime: string
}

export interface SavedNotificationEmails {
  emails: string[]
  email: string | null
  updatedAt: string
}

export async function getNotificationEmailConfig(signal?: AbortSignal): Promise<NotificationEmailConfig> {
  const result = await apiRequest<{ data: NotificationEmailConfig }>('/api/notificaciones/configuracion-correo', { signal })
  return result.data
}

export async function saveNotificationEmails(emails: string[]): Promise<SavedNotificationEmails> {
  const result = await apiRequest<{ data: SavedNotificationEmails }>('/api/notificaciones/configuracion-correo', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emails }),
  })
  return result.data
}