import type { EstadoGestion, TipoActuacion } from './types';
import type { Status } from './data';

export const MANAGEMENT_ORDER: EstadoGestion[] = ['SIN_GESTION', 'EN_GESTION', 'PENDIENTE_RESOLUCION', 'CUMPLIDA'];
export const MANAGEMENT: Record<EstadoGestion, { label: string; badge: string; desc: string }> = {
  SIN_GESTION: { label: 'Sin gestión', badge: 'bg-[#eef1f5] text-[#4a5463] ring-[#d5dae2]', desc: 'Aún no se registran gestiones.' },
  EN_GESTION: { label: 'En gestión', badge: 'bg-[#e7eff7] text-[#1d4a73] ring-[#bcd3ea]', desc: 'Existe seguimiento activo sobre la garantía.' },
  PENDIENTE_RESOLUCION: { label: 'Pendiente de resolución', badge: 'bg-[#fdeadb] text-[#9a4a10] ring-[#f3c9a4]', desc: 'Falta resolver una situación antes de acreditar el cumplimiento.' },
  CUMPLIDA: { label: 'Cumplida', badge: 'bg-[#e6f4ec] text-[#256b45] ring-[#bfe1cd]', desc: 'El cumplimiento está acreditado con respaldo.' },
};
export const ACTIONS: Record<TipoActuacion, string> = {
  CONTACTO_PACIENTE: 'Contacto con el paciente', CITACION: 'Citación / hora agendada', ATENCION_REALIZADA: 'Atención realizada',
  DERIVACION: 'Derivación a establecimiento', SOLICITUD_RESPALDO: 'Solicitud de respaldo', OTRA_GESTION: 'Otra gestión',
};

/** Los accesos de gestión incluyen todos los plazos; los de plazo excluyen cumplidas. */
export function managementPreset(estadoGestion: EstadoGestion) {
  return { estadoGestion, estados: ['normal', 'atencion', 'proxima', 'critica', 'vencida'] as Status[], soloPendientes: false };
}
