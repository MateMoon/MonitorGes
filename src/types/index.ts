import type { Status } from '../data';
export interface Paciente { rut: string; dv: string; nombre: string; }
export interface Garantia extends Paciente { id: string | number; problema: string; garantia: string; inicio: Date; limite: Date; dias: number; estado: Status; responsable: string; gestionadaAt?: string | null; gestionadaPor?: { id: string; nombre: string } | null; }
export type EstadoGestion = 'SIN_GESTION' | 'EN_GESTION' | 'PENDIENTE_RESOLUCION' | 'CUMPLIDA';
export type TipoActuacion = 'CONTACTO_PACIENTE' | 'CITACION' | 'ATENCION_REALIZADA' | 'DERIVACION' | 'SOLICITUD_RESPALDO' | 'OTRA_GESTION';
export interface EventoGarantia {
  id: string; secuencia: number; tipo: 'ACTUACION' | 'CAMBIO_ESTADO' | 'CUMPLIMIENTO' | 'REAPERTURA' | 'ANTECEDENTE_LEGADO';
  tipoActuacion: TipoActuacion | null; comentario: string | null; estadoAnterior: EstadoGestion | null; estadoNuevo: EstadoGestion | null;
  respaldo: string | null; createdAt: string; autorNombre: string | null; usuarioId: string | null;
}
export interface GarantiaSeguimiento extends Garantia { estadoGestion: EstadoGestion; revisionGestion: number; eventos?: EventoGarantia[] }
export interface Notificacion { fecha: string; garantia: string; paciente: string; tipo: string; dest: string; canal: string; estado: 'Enviado' | 'Pendiente' | 'Error'; }
export type Importacion = readonly [string, string, string, number, number, number, number, string];
export type Usuario = readonly [string, string, string, 'Activo' | 'Inactivo', string];
