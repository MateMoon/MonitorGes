import type { Status } from '../data';
import type { Garantia } from '../types';
import { apiRequest } from './api';

export interface GarantiasFiltros {
  rut?: string;
  nombre?: string;
  estado?: Status[];
  responsable?: string;
  problemaSalud?: string;
  nombreGarantia?: string;
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
}

interface ListaApi {
  data: GarantiaApi[];
  pagination: PaginacionGarantias;
}

interface DetalleApi { data: GarantiaApi }

function civilDateToLocalDate(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function mapGarantia(item: GarantiaApi): Garantia {
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

export async function getGarantiaById(id: string | number, signal?: AbortSignal): Promise<Garantia> {
  const result = await apiRequest<DetalleApi>(`/api/garantias/${encodeURIComponent(String(id))}`, { signal });
  return mapGarantia(result.data);
}



