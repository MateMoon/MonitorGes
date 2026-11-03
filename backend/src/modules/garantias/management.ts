import { z } from "zod";

export const MANAGEMENT_STATES = ["SIN_GESTION", "EN_GESTION", "PENDIENTE_RESOLUCION", "CUMPLIDA"] as const;
export const ACTION_TYPES = ["CONTACTO_PACIENTE", "CITACION", "ATENCION_REALIZADA", "DERIVACION", "SOLICITUD_RESPALDO", "OTRA_GESTION"] as const;
export type ManagementState = typeof MANAGEMENT_STATES[number];
const comment = z.string().trim().max(4000).optional();
const revisionGestion = z.number().int().min(0);
export const actionSchema = z.object({ tipoActuacion: z.enum(ACTION_TYPES), comentario: comment, revisionGestion }).strict();
export const stateChangeSchema = z.object({ estadoGestion: z.enum(["EN_GESTION", "PENDIENTE_RESOLUCION", "CUMPLIDA"]), comentario: comment, respaldo: z.string().trim().max(4000).optional(), revisionGestion }).strict()
  .refine((input) => input.estadoGestion !== "CUMPLIDA" || Boolean(input.respaldo), { message: "El cumplimiento exige un respaldo.", path: ["respaldo"] })
  .refine((input) => input.estadoGestion === "CUMPLIDA" || !input.respaldo, { message: "El respaldo corresponde exclusivamente al cumplimiento.", path: ["respaldo"] });
export const reopenSchema = z.object({ motivo: z.string().trim().min(1, "Indica el motivo de reapertura.").max(4000), revisionGestion }).strict();
export type ManagementCommand =
  | ({ operacion: "actuacion" } & z.infer<typeof actionSchema>)
  | ({ operacion: "estado" } & z.infer<typeof stateChangeSchema>)
  | ({ operacion: "reabrir" } & z.infer<typeof reopenSchema>);

export class ManagementError extends Error {
  constructor(public code: string, message: string, public statusCode = 409) { super(message); }
}

/** Las decisiones se validan sobre el estado leído dentro de la transacción. */
export function decideManagement(current: ManagementState, command: ManagementCommand) {
  if (command.operacion === "reabrir") {
    if (current !== "CUMPLIDA") throw new ManagementError("INVALID_TRANSITION", "Solo puedes reabrir una garantía cumplida.");
    if (!command.motivo.trim()) throw new ManagementError("REASON_REQUIRED", "Indica el motivo de reapertura.", 400);
    return { estado: "PENDIENTE_RESOLUCION" as const, tipo: "REAPERTURA" as const, comentario: command.motivo.trim(), respaldo: null, tipoActuacion: null };
  }
  if (current === "CUMPLIDA") throw new ManagementError("REOPEN_REQUIRED", "Reabre la garantía antes de continuar el seguimiento.");
  if (command.operacion === "actuacion") {
    return { estado: current === "SIN_GESTION" ? "EN_GESTION" as const : current, tipo: "ACTUACION" as const, tipoActuacion: command.tipoActuacion, comentario: command.comentario || null, respaldo: null };
  }
  if (current === command.estadoGestion) throw new ManagementError("UNCHANGED_STATE", "La garantía ya tiene ese estado de gestión.");
  if (command.estadoGestion === "CUMPLIDA" && !command.respaldo?.trim()) throw new ManagementError("EVIDENCE_REQUIRED", "El cumplimiento exige un respaldo.", 400);
  return { estado: command.estadoGestion, tipo: command.estadoGestion === "CUMPLIDA" ? "CUMPLIMIENTO" as const : "CAMBIO_ESTADO" as const, tipoActuacion: null, comentario: command.comentario || null, respaldo: command.estadoGestion === "CUMPLIDA" ? command.respaldo!.trim() : null };
}
