import { apiRequest } from './api'
import type { EstadoGestion } from '../types'

export type QualityDecision = 'MISMA' | 'DISTINTA' | 'ACTUALIZAR'
export interface PendingImportRow {
  id: string; importacionId: string; hoja: string; numeroFila: number; motivos: string[]
  version: number; createdAt: string; nombre: string; problemaSalud: string; nombreGarantia: string; candidatas: number
}
export interface PendingRowsResult {
  data: PendingImportRow[]; pendientesTotales: number
  pagination: { page: number; limit: number; total: number; totalPages: number }
}
export interface QualityResolution {
  id: string; filaId: string; decision: 'MISMA' | 'DISTINTA'; actualizarDatos?: true; usuario: { id: string; nombre: string }
  justificacion: string; garantiaResultadoId: string; createdAt: string
}
export type ComparisonField = 'problemaSalud' | 'nombreGarantia' | 'nombre' | 'fechaInicio' | 'fechaLimite' | 'responsable'
export interface QualityDecisionHistory {
  data: (QualityResolution & { origen: { importacionId: string; hoja: string; numeroFila: number } })[]
  pagination: PendingRowsResult['pagination']
}
export async function getQualityDecisions(page = 1, signal?: AbortSignal): Promise<QualityDecisionHistory> {
  return apiRequest(`/api/calidad-datos/decisiones?page=${page}&limit=10`, { signal })
}
export interface QualityCandidate {
  id: string
  datos: { problemaSalud: string; nombreGarantia: string; fechaInicio: string; fechaLimite: string; responsable: string; estadoGestion: EstadoGestion; nombreEnAplicacion?: string }
  estadoGestion: EstadoGestion; actuacionesDisponibles: number
  comparacion: { campo: ComparisonField; existente: string; nomina: string; coincide: boolean }[]
  diferencias: ComparisonField[]
}
export interface QualityReviewDetail {
  id: string; importacionId: string; hoja: string; numeroFila: number; estado: 'PENDIENTE' | 'RESUELTA'; version: number
  datosNomina: { numeroFila: number; problemaSalud: string; rut: string; dv: string; nombre: string; fechaInicio: string; fechaLimite: string; nombreGarantia: string; responsable: string }
  motivos: string[]; candidatas: QualityCandidate[]; huellaRevision: string
  antecedentesCambiaron: boolean; puedeResolver: boolean; puedeActualizarDatos?: boolean; significadoDistinta: string; resolucion: QualityResolution | null
}
interface ResolutionBase { version: number; solicitudId: string; huellaRevision: string; justificacion: string }
export type ResolveQualityInput = ResolutionBase & (
  { decision: 'MISMA'; garantiaExistenteId: string; actualizarDatos?: true } |
  { decision: 'DISTINTA'; confirmaDistintaDeTodas: true }
)
export async function getPendingQualityRows(page = 1, signal?: AbortSignal): Promise<PendingRowsResult> {
  return apiRequest(`/api/calidad-datos/pendientes?page=${page}&limit=20`, { signal })
}
export async function getQualityReview(id: string, signal?: AbortSignal): Promise<QualityReviewDetail> {
  return (await apiRequest<{ data: QualityReviewDetail }>(`/api/calidad-datos/pendientes/${encodeURIComponent(id)}`, { signal })).data
}
export async function resolveQualityReview(id: string, body: ResolveQualityInput) {
  return (await apiRequest<{ data: { resolucion: QualityResolution; repetida: boolean } }>(`/api/calidad-datos/pendientes/${encodeURIComponent(id)}/resolver`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })).data
}
