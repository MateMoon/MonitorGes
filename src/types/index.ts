import type { Status } from '../data';
export interface Paciente { rut: string; dv: string; nombre: string; }
export interface Garantia extends Paciente { id: number; problema: string; garantia: string; inicio: Date; limite: Date; dias: number; estado: Status; responsable: string; }
export interface Notificacion { fecha: string; garantia: string; paciente: string; tipo: string; dest: string; canal: string; estado: 'Enviado' | 'Pendiente' | 'Error'; }
export type Importacion = readonly [string, string, string, number, number, number, number, string];
export type Usuario = readonly [string, string, string, 'Activo' | 'Inactivo', string];
