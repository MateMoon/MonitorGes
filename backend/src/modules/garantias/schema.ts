import { z } from "zod";

const civilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, "Debe ser una fecha válida YYYY-MM-DD");

export const listQuerySchema = z.object({
  rut: z.string().trim().optional(), nombre: z.string().trim().optional(),
  estado: z.union([z.string(), z.array(z.string())]).optional(), responsable: z.string().trim().optional(),
  problemaSalud: z.string().trim().optional(), nombreGarantia: z.string().trim().optional(),
  fechaLimiteDesde: civilDate.optional(), fechaLimiteHasta: civilDate.optional(),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(["fechaLimite", "fechaInicio", "nombreGarantia", "responsable", "createdAt"]).default("fechaLimite"),
  order: z.enum(["asc", "desc"]).default("asc"),
}).superRefine((query, context) => {
  const allowed = new Set(["vencida", "critica", "proxima", "atencion", "normal"]);
  const states = query.estado ? (Array.isArray(query.estado) ? query.estado : query.estado.split(",")) : [];
  states.forEach((state) => {
    if (!allowed.has(state.trim().toLowerCase())) context.addIssue({ code: "custom", path: ["estado"], message: `Estado inválido: ${state}` });
  });
  if (query.fechaLimiteDesde && query.fechaLimiteHasta && query.fechaLimiteDesde > query.fechaLimiteHasta) {
    context.addIssue({ code: "custom", path: ["fechaLimiteHasta"], message: "No puede ser anterior a fechaLimiteDesde" });
  }
});
export type ListQuery = z.infer<typeof listQuerySchema>;
