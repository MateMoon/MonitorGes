export type GuaranteeStatus = "vencida" | "critica" | "proxima" | "atencion" | "normal";
export type StatusConfiguration = Partial<Record<GuaranteeStatus, { min?: number; max?: number }>>;

const DEFAULTS: Record<GuaranteeStatus, { min?: number; max?: number }> = {
  vencida: { max: -1 },
  critica: { min: 0, max: 7 },
  proxima: { min: 8, max: 15 },
  atencion: { min: 16, max: 30 },
  normal: { min: 31 },
};

export function getGuaranteeStatus(
  fechaLimite: string,
  fechaActual: string,
  configuracion: StatusConfiguration = {},
): GuaranteeStatus {
  const [year, month, day] = fechaLimite.split("-").map(Number);
  if (!year || !month || !day) throw new Error("fechaLimite debe usar el formato YYYY-MM-DD");
  const [cy, cm, cd] = fechaActual.split("-").map(Number);
  const days = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(cy, cm - 1, cd)) / 86_400_000);
  for (const status of ["vencida", "critica", "proxima", "atencion", "normal"] as const) {
    const range = { ...DEFAULTS[status], ...configuracion[status] };
    if ((range.min === undefined || days >= range.min) && (range.max === undefined || days <= range.max)) return status;
  }
  throw new Error(`No existe un estado configurado para ${days} días restantes`);
}

export function getDaysRemaining(fechaLimite: string, fechaActual: string): number {
  const [y, m, d] = fechaLimite.split("-").map(Number);
  const [cy, cm, cd] = fechaActual.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(cy, cm - 1, cd)) / 86_400_000);
}
