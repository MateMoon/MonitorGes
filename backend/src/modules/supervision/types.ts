import type { EstadoGestion } from "@prisma/client";
import type { GuaranteeStatus } from "../garantias/status.js";

export type PriorityReason = "VENCIDA" | "CRITICA" | "SIN_PROFESIONAL_ACTIVO";

export interface PriorityCase {
  id: string;
  paciente: { nombre: string };
  problemaSalud: string;
  nombreGarantia: string;
  establecimiento: string;
  fechaLimite: string;
  estadoGestion: EstadoGestion;
  estadoVencimiento: GuaranteeStatus;
  diasRestantes: number;
  cantidadProfesionalesCoincidentes: number;
  profesionalesCoincidentes: { usuarioId: string; nombre: string }[];
  motivosPrioridad: PriorityReason[];
  prioridad: 1 | 2 | 3;
}

export interface SupervisionSummary {
  indicadores: {
    totalGarantias: number;
    pendientesResolucion: number;
    enGestion: number;
    cumplidas: number;
    vencidasNoCumplidas: number;
    proximas15DiasNoCumplidas: number;
  };
  /** Historical field names retained: all active users with rules count, regardless of role.
   * The first three buckets partition all guarantees, including completed ones. */
  cobertura: {
    sinProfesional: number;
    unProfesional: number;
    variosProfesionales: number;
    sinProfesionalNoCumplidas: number;
  };
  criteriosCobertura: {
    rol: "TODOS";
    soloActivos: true;
    profesionalesActivos: number;
    profesionalesConReglasEfectivas: number;
  };
  distribuciones: {
    soloNoCumplidas: true;
    permiteSuperposicionEntreProfesionales: true;
    porProblemaSalud: { problemaSalud: string; cantidad: number }[];
    porEstablecimiento: { establecimiento: string; cantidad: number }[];
    porProfesional: { usuarioId: string; nombre: string; cantidad: number }[];
  };
  prioritarios: PriorityCase[];
}
