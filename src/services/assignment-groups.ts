import type { AssignmentRule } from "./usuarios"

export type AssignmentGroup = {
  problemasSalud: string[]
  establecimientos: string[]
  tiposGarantia: string[]
}

const dimensions = [
  "problemasSalud",
  "establecimientos",
  "tiposGarantia",
] as const
export const emptyAssignmentGroup = (): AssignmentGroup => ({
  problemasSalud: [],
  establecimientos: [],
  tiposGarantia: [],
})
export const isEmptyAssignmentGroup = (group: AssignmentGroup) =>
  dimensions.every((key) => group[key].length === 0)

export function validateAssignmentGroups(groups: AssignmentGroup[]): string | null {
  if (groups.length > 1 && groups.some(isEmptyAssignmentGroup)) return "Selecciona al menos un criterio en cada grupo o elimina el grupo vacío."
  if (expandAssignmentGroups(groups).exceedsLimit) return "La selección supera las 1000 combinaciones permitidas. Reduce las opciones seleccionadas."
  return null
}
export function assignmentGroupSize(group: AssignmentGroup): number {
  return isEmptyAssignmentGroup(group)
    ? 0
    : dimensions.reduce(
        (count, key) => count * Math.max(1, new Set(group[key]).size),
        1,
      )
}

/** Merge only rectangles sharing their other dimensions, so editing never widens existing access. */
export function assignmentGroupsFromRules(
  rules: AssignmentRule[],
): AssignmentGroup[] {
  const unique = new Map(
    rules.map((rule) => [
      JSON.stringify([
        rule.problemaSalud,
        rule.establecimiento,
        rule.tipoGarantia,
      ]),
      rule,
    ]),
  )
  let groups = [...unique.values()].map((rule) => ({
    problemasSalud: rule.problemaSalud ? [rule.problemaSalud] : [],
    establecimientos: rule.establecimiento ? [rule.establecimiento] : [],
    tiposGarantia: rule.tipoGarantia ? [rule.tipoGarantia] : [],
  }))
  let changed = true
  while (changed) {
    changed = false
    for (const dimension of dimensions) {
      const merged = new Map<string, AssignmentGroup>()
      for (const group of groups) {
        const signature = JSON.stringify(
          dimensions
            .filter((key) => key !== dimension)
            .map((key) => group[key]),
        )
        const existing = merged.get(signature)
        if (!existing) {
          merged.set(signature, { ...group })
          continue
        }
        // Empty means any value and absorbs specific values in the same rectangle.
        existing[dimension] =
          existing[dimension].length && group[dimension].length
            ? [...new Set([...existing[dimension], ...group[dimension]])].sort()
            : []
        changed = true
      }
      groups = [...merged.values()]
    }
  }
  return groups.length ? groups : [emptyAssignmentGroup()]
}

/** Keep the API's exact rules and bound the expansion before it can exhaust memory. */
export function expandAssignmentGroups(
  groups: AssignmentGroup[],
  limit = 1000,
): {
  rules: AssignmentRule[]
  exceedsLimit: boolean
} {
  const unique = new Map<string, AssignmentRule>()
  for (const group of groups) {
    if (isEmptyAssignmentGroup(group)) continue
    for (const problemaSalud of new Set(
      group.problemasSalud.length ? group.problemasSalud : [""],
    )) {
      for (const establecimiento of new Set(
        group.establecimientos.length ? group.establecimientos : [""],
      )) {
        for (const tipoGarantia of new Set(
          group.tiposGarantia.length ? group.tiposGarantia : [""],
        )) {
          const rule = { problemaSalud, establecimiento, tipoGarantia }
          unique.set(JSON.stringify(rule), rule)
          if (unique.size > limit)
            return { rules: [...unique.values()], exceedsLimit: true }
        }
      }
    }
  }
  return { rules: [...unique.values()], exceedsLimit: false }
}
