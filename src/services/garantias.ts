import type { Status } from '../data';
import type { GarantiaSeguimiento, EstadoGestion, TipoActuacion, EventoGarantia } from '../types';
import { apiRequest } from './api';

export interface GarantiasFiltros {
  rut?: string;
  nombre?: string;
  estado?: Status[];
  responsable?: string;
  problemaSalud?: string;
  nombreGarantia?: string;
  estadoGestion?: EstadoGestion;
  soloPendientes?: boolean;
  fechaLimiteDesde?: string;
  fechaLimiteHasta?: string;
  page?: number;
  limit?: number;
  sort?: 'fechaLimite' | 'fechaInicio' | 'nombreGarantia' | 'responsable' | 'createdAt';
  order?: 'asc' | 'desc';
}

export interface PaginacionGarantias {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface GarantiaApi {
  id: string;
  paciente: { id: string; rut: string; nombre: string };
  problemaSalud: string;
  nombreGarantia: string;
  fechaInicio: string;
  fechaLimite: string;
  diasRestantes: number;
  estado: Status;
  responsable: string;
  gestionadaAt: string | null;
  gestionadaPor: { id: string; nombre: string } | null;
  estadoGestion: EstadoGestion;
  revisionGestion: number;
  eventos?: EventoGarantia[];
}

export interface GestionGarantiaResult {
  gestionadaAt: string;
  gestionadaPor: { id: string; nombre: string } | null;
  estadoGestion: EstadoGestion;
  revisionGestion: number;
  evento: EventoGarantia;
}
export interface ActuacionInput { tipoActuacion: TipoActuacion; comentario?: string; revisionGestion: number }
export interface EstadoInput { estadoGestion: Exclude<EstadoGestion, 'SIN_GESTION'>; comentario?: string; respaldo?: string; revisionGestion: number }

interface ListaApi {
  data: GarantiaApi[];
  pagination: PaginacionGarantias;
}

interface DetalleApi { data: GarantiaApi }

export interface GarantiaFilterOptions {
  responsables: string[];
  problemasSalud: string[];
  nombresGarantia: string[];
}

export async function getGarantiaFilterOptions(signal?: AbortSignal): Promise<GarantiaFilterOptions> {
  const result = await apiRequest<{ data: GarantiaFilterOptions }>(`/api/garantias/opciones-filtros`, { signal });
  return result.data;
}

function civilDateToLocalDate(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function mapGarantia(item: GarantiaApi): GarantiaSeguimiento {
  const [rut = item.paciente.rut, dv = ''] = item.paciente.rut.match(/^(.+)-([^-]+)$/)?.slice(1) ?? [];
  return {
    id: item.id,
    rut,
    dv,
    nombre: item.paciente.nombre,
    problema: item.problemaSalud,
    garantia: item.nombreGarantia,
    inicio: civilDateToLocalDate(item.fechaInicio),
    limite: civilDateToLocalDate(item.fechaLimite),
    dias: item.diasRestantes,
    estado: item.estado,
    responsable: item.responsable,
    gestionadaAt: item.gestionadaAt,
    gestionadaPor: item.gestionadaPor,
    estadoGestion: item.estadoGestion,
    revisionGestion: item.revisionGestion,
    eventos: item.eventos,
  };
}

export async function getGarantias(filtros: GarantiasFiltros = {}, signal?: AbortSignal) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filtros)) {
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const query = params.size ? `?${params.toString()}` : '';
  const result = await apiRequest<ListaApi>(`/api/garantias${query}`, { signal });
  return { data: result.data.map(mapGarantia), pagination: result.pagination };
}

export async function getGarantiaById(id: string | number, signal?: AbortSignal): Promise<GarantiaSeguimiento> {
  const result = await apiRequest<DetalleApi>(`/api/garantias/${encodeURIComponent(String(id))}`, { signal });
  return mapGarantia(result.data);
}

async function managementRequest(id: string | number, operation: string, input: object): Promise<GestionGarantiaResult> {
  const result = await apiRequest<{ data: GestionGarantiaResult }>(`/api/garantias/${encodeURIComponent(String(id))}/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  return result.data;
}
export const registrarGestionGarantia = (id: string | number, input: ActuacionInput) => managementRequest(id, 'gestion', input);
export const cambiarEstadoGestion = (id: string | number, input: EstadoInput) => managementRequest(id, 'estado-gestion', input);
export const reabrirGarantia = (id: string | number, motivo: string, revisionGestion: number) => managementRequest(id, 'reabrir', { motivo, revisionGestion });



