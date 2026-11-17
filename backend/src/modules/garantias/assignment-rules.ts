import { normalizeIdentityText } from "../importaciones/identity-normalization.js"

export type AssignmentRule = {
  problemaSalud: string
  establecimiento: string
  tipoGarantia: string
}
export type AssignedGuarantee = {
  problemaSalud?: string
  responsable: string
  nombreGarantia: string
}

export function legacyAssignmentRules(types: string[]): AssignmentRule[] {
  return types.map((tipoGarantia) => ({
    problemaSalud: "",
    establecimiento: "",
    tipoGarantia,
  }))
}

/** Invalid stored rules fail closed. Null denotes an account using legacy assignments. */
export function readAssignmentRules(value: unknown): AssignmentRule[] | null {
  if (value == null) return null
  if (!Array.isArray(value)) return []
  const result: AssignmentRule[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return []
    const rule = entry as Record<string, unknown>
    const keys = ["problemaSalud", "establecimiento", "tipoGarantia"] as const
    if (
      keys.some(
        (key) =>
          typeof rule[key] !== "string" ||
          normalizeIdentityText(rule[key] as string) !== rule[key],
      )
    )
      return []
    if (!keys.some((key) => rule[key])) return []
    result.push({
      problemaSalud: rule.problemaSalud as string,
      establecimiento: rule.establecimiento as string,
      tipoGarantia: rule.tipoGarantia as string,
    })
  }
  return result
}

export function matchesAssignmentRules(
  row: AssignedGuarantee,
  rules: AssignmentRule[],
): boolean {
  const problem = normalizeIdentityText(row.problemaSalud ?? "")
  const establishment = normalizeIdentityText(row.responsable)
  const type = normalizeIdentityText(row.nombreGarantia)
  return rules.some(
    (rule) =>
      Boolean(
        rule.problemaSalud || rule.establecimiento || rule.tipoGarantia,
      ) &&
      (!rule.problemaSalud || rule.problemaSalud === problem) &&
      (!rule.establecimiento || rule.establecimiento === establishment) &&
      (!rule.tipoGarantia || rule.tipoGarantia === type),
  )
}
