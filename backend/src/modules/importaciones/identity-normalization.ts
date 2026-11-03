/** Normalización compartida con la clave provisional actual del importador. */
export function normalizeIdentityText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/** Conserva las reglas actuales para RUT separado o compuesto (por ejemplo, 12.345.678-5). */
export function normalizeIdentityRut(rut: string, dv: string): { rutNumero: string; dv: string } {
  const raw = rut.toUpperCase();
  const clean = raw.replace(/[.\-\s]/g, "");
  const combined = (raw.includes("-") || clean.length > 8) ? /^(\d{1,8})([0-9K])$/.exec(clean) : null;
  return { rutNumero: combined?.[1] ?? clean.replace(/\D/g, ""), dv: dv.toUpperCase() || combined?.[2] || "" };
}

/** Las filas válidas entregadas por el validador usan YYYY-MM-DD, sin componente horario. */
export function normalizeIdentityDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("fechaInicio debe usar YYYY-MM-DD");
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error("fechaInicio no es una fecha civil válida");
  }
  return value;
}
