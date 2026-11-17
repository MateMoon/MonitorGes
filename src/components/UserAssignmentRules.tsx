import { useId } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Btn } from "../ui"
import type { AssignmentOptions } from "../services/usuarios"
import {
  assignmentGroupSize,
  emptyAssignmentGroup,
  expandAssignmentGroups,
  isEmptyAssignmentGroup,
  type AssignmentGroup,
} from "../services/assignment-groups"
import AssignmentMultiSelect from "./AssignmentMultiSelect"

export default function UserAssignmentRules({
  groups,
  options,
  onChange,
  disabled = false,
}: {
  groups: AssignmentGroup[]
  options: AssignmentOptions
  onChange: (groups: AssignmentGroup[]) => void
  disabled?: boolean
}) {
  const id = useId()
  const expanded = expandAssignmentGroups(groups)
  const dimensions = [
    {
      key: "problemasSalud",
      label: "Problemas de salud",
      anyLabel: "Cualquier problema",
      choices: options.problemasSalud,
    },
    {
      key: "establecimientos",
      label: "Establecimientos",
      anyLabel: "Cualquier establecimiento",
      choices: options.establecimientos,
    },
    {
      key: "tiposGarantia",
      label: "Tipos de garantía",
      anyLabel: "Cualquier tipo",
      choices: options.tiposGarantia,
    },
  ] as const
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="overflow-hidden rounded-xl border border-line bg-white"
    >
      <div className="space-y-1 border-b border-line bg-canvas/50 px-4 py-3">
        <h4 id={`${id}-title`} className="text-sm font-semibold">
          Reglas de asignación
        </h4>
        <p className="text-xs text-muted">
          Selecciona varias opciones en cada lista. Se incluirán todas las
          combinaciones dentro de cada grupo.
        </p>
      </div>
      <div className="divide-y divide-line">
        {groups.map((group, index) => {
          const count = assignmentGroupSize(group)
          const summary = dimensions
            .map(({ key, anyLabel, choices }) =>
              group[key].length
                ? group[key]
                    .map(
                      (value) =>
                        choices.find(
                          (option) => option.claveNormalizada === value,
                        )?.nombre ?? value,
                    )
                    .join(", ")
                : anyLabel,
            )
            .join(" · ")
          return (
            <div key={index} className="space-y-4 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <h5 className="text-sm font-semibold">Grupo {index + 1}</h5>
                <button
                  type="button"
                  disabled={disabled || (groups.length === 1 && !count)}
                  aria-label={`${
                    groups.length === 1 ? "Limpiar" : "Eliminar"
                  } grupo ${index + 1}`}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted hover:bg-canvas hover:text-[#a12a22] disabled:opacity-50"
                  onClick={() =>
                    onChange(
                      groups.length === 1
                        ? [emptyAssignmentGroup()]
                        : groups.filter((_, position) => position !== index),
                    )
                  }
                >
                  <Trash2 className="size-3.5" />
                  {groups.length === 1 ? "Limpiar" : "Eliminar"}
                </button>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {dimensions.map(({ key, label, anyLabel, choices }) => (
                  <AssignmentMultiSelect
                    key={key}
                    label={label}
                    name={`${label}, grupo ${index + 1}`}
                    anyLabel={anyLabel}
                    options={choices}
                    selected={group[key]}
                    disabled={disabled}
                    onChange={(values) =>
                      onChange(
                        groups.map((current, position) =>
                          position === index
                            ? { ...current, [key]: values }
                            : current,
                        ),
                      )
                    }
                  />
                ))}
              </div>
              <div
                className="rounded-lg bg-canvas px-3 py-2 text-xs"
                aria-live="polite"
              >
                {count ? (
                  <>
                    <p className="font-medium">
                      {count} {count === 1 ? "combinación" : "combinaciones"}
                    </p>
                    <p className="mt-1 break-words text-muted">{summary}</p>
                  </>
                ) : (
                  <p className="text-muted">
                    Sin asignaciones. Selecciona al menos un problema,
                    establecimiento o tipo para comenzar.
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="space-y-3 border-t border-line px-4 py-3">
        <Btn
          disabled={
            disabled ||
            groups.some(isEmptyAssignmentGroup) ||
            expanded.exceedsLimit
          }
          onClick={() => onChange([...groups, emptyAssignmentGroup()])}
        >
          <Plus className="size-4" />
          Agregar otro grupo
        </Btn>
        <p className="text-xs text-muted">
          Usa otro grupo cuando los problemas o tipos correspondan a
          establecimientos diferentes.
        </p>
        <p
          role="status"
          className={`text-xs font-medium ${
            expanded.exceedsLimit ? "text-[#a12a22]" : "text-brand"
          }`}
        >
          {expanded.exceedsLimit
            ? "La selección supera las 1000 combinaciones permitidas. Reduce las opciones seleccionadas."
            : `${expanded.rules.length} ${
                expanded.rules.length === 1
                  ? "combinación asignada"
                  : "combinaciones asignadas"
              } en total, sin duplicados.`}
        </p>
      </div>
    </section>
  )
}
