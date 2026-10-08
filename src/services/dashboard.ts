import type { Status } from '../data';
import type { Garantia } from '../types';
import { apiRequest } from './api';

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

interface DashboardApi {
  data: {
    total: number;
    conteosPorEstado: Record<Status, number>;
    garantiasUrgentes: GarantiaApi[];
    ultimaImportacion: {
      id: string;
      nombreArchivo: string;
      fechaImportacion: string;
      estado: string;
      registrosLeidos: number;
      registrosConError: number;
    } | null;
  };
}

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

export async function getDashboard(signal?: AbortSignal) {
  const { data } = await apiRequest<DashboardApi>('/api/dashboard', { signal });
  return { ...data, garantiasUrgentes: data.garantiasUrgentes.map(mapGarantia) };
}
