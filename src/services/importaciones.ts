import { apiRequest } from './api';

export interface ImportValidationError {
  numeroFila: number;
  codigo: string;
  campo?: string;
  mensaje: string;
}

export interface ImportPreviewRow { numeroFila: number }

export interface ImportValidationResult {
  nombreArchivo: string;
  filasLeidas: number;
  filasValidas: number;
  filasConErrores: number;
  vistaPrevia: ImportPreviewRow[];
  errores: ImportValidationError[];
}

export interface ImportResult {
  id: string;
  nombreArchivo: string;
  fechaImportacion: string;
  estado: 'COMPLETADA' | 'COMPLETADA_CON_OBSERVACIONES' | 'FALLIDA';
  filasLeidas: number;
  registrosNuevos: number;
  registrosActualizados: number;
  registrosSinCambios: number;
  registrosConError: number;
  errores: ImportValidationError[];
}

export interface ImportHistoryItem extends Omit<ImportResult, 'errores'> {
  usuario: { nombre: string; username: string } | null;
}
export interface ImportPagination { page: number; limit: number; total: number; totalPages: number }

export type ImportMatchClassification = 'COINCIDENCIA_EXACTA_UNICA' | 'DUDOSA_FECHA_DISTINTA' | 'DUDOSA_VARIOS_CANDIDATOS' | 'DUDOSA_REPETIDA_EN_ARCHIVO' | 'NUEVA_PROPUESTA'
export type ImportComparisonResult = {
  filasLeidas: number;
  filasValidas: number;
  filasInvalidas: number;
  conteos: Record<ImportMatchClassification, number>;
  filas: Array<{
    numeroFila: number;
    clasificacion: ImportMatchClassification;
    candidatosPosibles: number;
    camposImportadosDiferentes: Array<'fechaLimite' | 'responsableInformado'>;
  }>;
}

export async function validateImportFile(file: File, signal?: AbortSignal): Promise<ImportValidationResult> {
  const body = new FormData();
  body.append('archivo', file, file.name);
  const result = await apiRequest<{ data: ImportValidationResult }>('/api/importaciones/validar', { method: 'POST', body, signal });
  return result.data;
}

export async function importFile(file: File, signal?: AbortSignal): Promise<ImportResult> {
  const body = new FormData();
  body.append('archivo', file, file.name);
  const result = await apiRequest<{ data: ImportResult }>('/api/importaciones', { method: 'POST', body, signal });
  return result.data;
}

/** Solo valida y compara. No invoca el endpoint que persiste la importación. */
export async function compareImportFile(file: File, signal?: AbortSignal): Promise<ImportComparisonResult> {
  const body = new FormData();
  body.append('archivo', file, file.name);
  const result = await apiRequest<{ data: ImportComparisonResult }>('/api/importaciones/comparar', { method: 'POST', body, signal });
  return result.data;
}

export async function getImportHistory(page = 1, limit = 25, signal?: AbortSignal) {
  const result = await apiRequest<{ data: ImportHistoryItem[]; pagination: ImportPagination }>(`/api/importaciones?page=${page}&limit=${limit}`, { signal });
  return result;
}
