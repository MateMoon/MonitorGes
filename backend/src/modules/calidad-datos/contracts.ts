import { z } from "zod";
import { normalizeIdentityDate } from "../importaciones/identity-normalization.js";
import type { RetentionInput } from "../importaciones/retention-policy.js";
import type { Prisma } from "@prisma/client";
import type { PreviewRow } from "../importaciones/validation-service.js";

export class RowPersistenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 409) { super(message); this.name = "RowPersistenceError"; }
}
export interface PersistenceActor { id: string; rol: string }
export const identifierSchema = z.uuid();
const date = z.string().refine(value => { try { normalizeIdentityDate(value); return true; } catch { return false; } });
const text = z.string().min(1).refine(value => value.trim().length > 0);
/** This schema protects the internal DTO. Workbook validation (including RUT DV)
 * remains the unchanged parser's responsibility, exactly as in retention-policy.
 */
export const validatedRowSchema = z.object({
  numeroFila: z.number().int().positive(), problemaSalud: text, rut: text, dv: text, nombre: text,
  fechaInicio: date, fechaLimite: date, nombreGarantia: text, responsable: text,
}).strict().refine(row => row.fechaInicio <= row.fechaLimite);
export const originSchema = z.object({ importacionId: z.uuid(), hoja: text.max(255), numeroFila: z.number().int().positive() }).strict();
export interface SavePendingInput extends z.infer<typeof originSchema> {
  /** Complete frozen parser result from prepareValidatedImportContext. */
  contextoValidado: RetentionInput;
}
export const resolutionSchema = z.object({
  filaId: z.uuid(), version: z.number().int().positive(), solicitudId: z.uuid(),
  decision: z.enum(["MISMA", "DISTINTA"]), garantiaExistenteId: z.uuid().optional(),
  actualizarDatos: z.literal(true).optional(),
  huellaRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  justificacion: z.string().trim().min(5).max(4000),
}).strict().refine(input => input.decision === "MISMA" ? !!input.garantiaExistenteId : !input.garantiaExistenteId && input.actualizarDatos === undefined)
  .refine(input => !input.actualizarDatos || !!input.huellaRevision);
export type ResolutionInput = z.infer<typeof resolutionSchema>;
export const pageSchema = z.object({ page: z.number().int().min(1).max(1000000).default(1), limit: z.number().int().min(1).max(100).default(20), importacionId: z.uuid().optional() }).strict();
export type PageInput = z.input<typeof pageSchema>;
export const pendingPageSchema = pageSchema.extend({ motivo: z.enum(["FECHA_INICIO_DISTINTA", "MULTIPLES_COINCIDENCIAS_EXACTAS", "FILAS_CONTRADICTORIAS", "NOMBRE_PACIENTE_CONTRADICTORIO", "FECHAS_DISTINTAS_EN_ARCHIVO"]).optional() });
export type PendingPageInput = z.input<typeof pendingPageSchema>;
export const decisionsPageSchema = pageSchema.extend({ decision: z.enum(["MISMA", "DISTINTA"]).optional() });
export type DecisionsPageInput = z.input<typeof decisionsPageSchema>;

/** Trusted internal unit-of-work adapter. The low-level store has no default;
 * the operational service supplies resolution-writer.ts. Never accept a callback or
 * result guarantee ID from a request. DISTINCT must INSERT the supplied fresh
 * ID. An explicit source update must preserve patient/management/history and
 * only change the source allowlist. Both effects are validated before audit.
 */
export interface FutureResolutionEffects {
  crearGarantiaDistinta(tx: Prisma.TransactionClient, context: { nuevaGarantiaId: string; datosValidados: Readonly<PreviewRow> }): Promise<void>;
  actualizarGarantiaExistente?(tx: Prisma.TransactionClient, context: { garantiaExistenteId: string; datosValidados: Readonly<PreviewRow> }): Promise<void>;
}

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new RowPersistenceError("INVALID_PERSISTENCE_INPUT", "Revisa la procedencia, la versión y la justificación de la fila.", 400);
  return parsed.data;
}
