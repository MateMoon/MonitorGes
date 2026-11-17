import { apiRequest } from './api'

export type IndividualReportState = 'RESERVADO' | 'EN_PROCESO' | 'ACEPTADO_SMTP' | 'FALLIDO' | 'OMITIDO' | 'INCIERTO'
export interface IndividualReportResults {
  disponible: boolean
  automaticEnabled: boolean
  data: { usuarioId: string; fechaInforme: string; estado: IndividualReportState; aceptadoSmtpAt: string | null; cantidadGarantias: number; codigoResultado: string | null }[]
}
export async function getIndividualReportResults(signal?: AbortSignal) {
  return apiRequest<IndividualReportResults>('/api/notificaciones/ultimos-resultados-individuales', { signal })
}
