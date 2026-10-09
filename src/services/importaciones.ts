import { apiRequest } from './api';

export interface ImportValidationError {
  numeroFila: number;
  codigo: string;
  campo?: string;
  mensaje: string;
}

export interface ImportPreviewRow {
  numeroFila: number;
  problemaSalud: string;
  rut: string;
  dv: string;
  nombre: string;
  fechaInicio: string;
  fechaLimite: string;
  nombreGarantia: string;
  responsable: string;
}

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

export interface ImportHistoryItem extends Omit<ImportResult, 'errores'> {}
export interface ImportPagination { page: number; limit: number; total: number; totalPages: number }

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

export async function getImportHistory(page = 1, limit = 25, signal?: AbortSignal) {
  const result = await apiRequest<{ data: ImportHistoryItem[]; pagination: ImportPagination }>(`/api/importaciones?page=${page}&limit=${limit}`, { signal });
  return result;
}
