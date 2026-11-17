import { describe, expect, it } from "vitest"
const modulePath = new URL(
  "../../src/services/assignment-groups.ts",
  import.meta.url,
).href
const {
  assignmentGroupsFromRules,
  expandAssignmentGroups,
  assignmentGroupSize,
} = await import(modulePath)
type Rule = {
  problemaSalud: string
  establecimiento: string
  tipoGarantia: string
}
const sorted = (rules: Rule[]) =>
  rules
    .map((rule) =>
      JSON.stringify([
        rule.problemaSalud,
        rule.establecimiento,
        rule.tipoGarantia,
      ]),
    )
    .sort()

describe("asignaciones mediante grupos de selección múltiple", () => {
  it("expande dos problemas y dos tipos en cuatro combinaciones del mismo establecimiento", () => {
    const group = {
      problemasSalud: ["diabetes", "hipertension"],
      establecimientos: ["centro norte"],
      tiposGarantia: ["diagnostico", "tratamiento"],
    }
    const result = expandAssignmentGroups([group])
    expect(assignmentGroupSize(group)).toBe(4)
    expect(result.exceedsLimit).toBe(false)
    expect(result.rules).toHaveLength(4)
    expect(assignmentGroupsFromRules(result.rules)).toEqual([group])
  })

  it("mantiene separados los grupos de establecimientos distintos sin generar cruces", () => {
    const rules = [
      {
        problemaSalud: "diabetes",
        establecimiento: "norte",
        tipoGarantia: "tratamiento",
      },
      {
        problemaSalud: "hipertension",
        establecimiento: "sur",
        tipoGarantia: "tratamiento",
      },
    ]
    const groups = assignmentGroupsFromRules(rules)
    expect(groups).toHaveLength(2)
    expect(sorted(expandAssignmentGroups(groups).rules)).toEqual(sorted(rules))
  })

  it("recupera exactamente todas las selecciones posibles de un conjunto de ocho combinaciones", () => {
    const universe: Rule[] = []
    for (const problemaSalud of ["a", "b"])
      for (const establecimiento of ["norte", "sur"])
        for (const tipoGarantia of ["diagnostico", "tratamiento"])
          universe.push({ problemaSalud, establecimiento, tipoGarantia })
    for (let mask = 0; mask < 256; mask++) {
      const rules = universe.filter((_, index) => mask & (1 << index))
      expect(
        sorted(expandAssignmentGroups(assignmentGroupsFromRules(rules)).rules),
      ).toEqual(sorted(rules))
    }
  })

  it("conserva el alcance de reglas que combinan criterios abiertos con criterios específicos", () => {
    const rules = [
      {
        problemaSalud: "diabetes",
        establecimiento: "",
        tipoGarantia: "tratamiento",
      },
      {
        problemaSalud: "hipertension",
        establecimiento: "sur",
        tipoGarantia: "",
      },
      {
        problemaSalud: "diabetes",
        establecimiento: "norte",
        tipoGarantia: "tratamiento",
      },
    ]
    const expanded = expandAssignmentGroups(
      assignmentGroupsFromRules(rules),
    ).rules
    const matches = (row: Rule, choices: Rule[]) =>
      choices.some(
        (rule) =>
          (!rule.problemaSalud || rule.problemaSalud === row.problemaSalud) &&
          (!rule.establecimiento ||
            rule.establecimiento === row.establecimiento) &&
          (!rule.tipoGarantia || rule.tipoGarantia === row.tipoGarantia),
      )
    for (const problemaSalud of ["diabetes", "hipertension", "otro"])
      for (const establecimiento of ["norte", "sur", "otro"])
        for (const tipoGarantia of ["diagnostico", "tratamiento", "otro"]) {
          const row = { problemaSalud, establecimiento, tipoGarantia }
          expect(matches(row, expanded)).toBe(matches(row, rules))
        }
  })

  it("un grupo inicial vacío no concede acceso y los grupos repetidos no duplican reglas", () => {
    expect(expandAssignmentGroups(assignmentGroupsFromRules([])).rules).toEqual(
      [],
    )
    const group = {
      problemasSalud: [],
      establecimientos: [],
      tiposGarantia: ["tratamiento", "tratamiento"],
    }
    expect(expandAssignmentGroups([group, group]).rules).toEqual([
      { problemaSalud: "", establecimiento: "", tipoGarantia: "tratamiento" },
    ])
  })

  it("detiene una expansión demasiado grande y permite 1000 combinaciones únicas", () => {
    const group = {
      problemasSalud: Array.from({ length: 100 }, (_, index) => String(index)),
      establecimientos: ["norte"],
      tiposGarantia: Array.from({ length: 100 }, (_, index) => String(index)),
    }
    const result = expandAssignmentGroups([group])
    expect(result.exceedsLimit).toBe(true)
    expect(result.rules).toHaveLength(1001)
    expect(
      expandAssignmentGroups([
        { ...group, tiposGarantia: group.tiposGarantia.slice(0, 10) },
      ]).exceedsLimit,
    ).toBe(false)
  })
})
