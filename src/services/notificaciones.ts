import { apiRequest } from './api'

export interface NotificationEmailConfig {
  emails: string[]
  email: string | null
  updatedAt: string | null
  automaticEnabled: boolean
  scheduledTime: string
}

export type IndividualReportState = 'RESERVADO' | 'EN_PROCESO' | 'ACEPTADO_SMTP' | 'FALLIDO' | 'OMITIDO' | 'INCIERTO'
export interface IndividualReportResults {
  disponible: boolean
  automaticEnabled: boolean
  data: { usuarioId: string; fechaInforme: string; estado: IndividualReportState; aceptadoSmtpAt: string | null; cantidadGarantias: number; codigoResultado: string | null }[]
}
export async function getIndividualReportResults(signal?: AbortSignal) {
  return apiRequest<IndividualReportResults>('/api/notificaciones/ultimos-resultados-individuales', { signal })
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
