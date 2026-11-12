import { useId, useState } from "react"
import { Check, Search, X } from "lucide-react"
import type { GuaranteeTypeOption } from "../services/usuarios"
import { cx, inputCls } from "../ui"

const searchKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
export default function GuaranteeTypeCombobox({
  options,
  selected,
  onChange,
  disabled = false,
}: {
  options: GuaranteeTypeOption[]
  selected: string[]
  onChange: (values: string[]) => void
  disabled?: boolean
}) {
  const id = useId()
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const filtered = options.filter((option) =>
    searchKey(option.nombre).includes(searchKey(query)),
  )
  const toggle = (key: string) =>
    onChange(
      selected.includes(key)
        ? selected.filter((value) => value !== key)
        : [...selected, key],
    )
  const move = (index: number) => {
    const next = (index + filtered.length) % filtered.length
    setActive(next)
    document
      .getElementById(`${id}-option-${next}`)
      ?.scrollIntoView?.({ block: "nearest" })
  }
  return (
    <div className="space-y-2">
      <label htmlFor={`${id}-input`} className="text-sm font-medium">
        Tipos de garantías
      </label>
      <p id={`${id}-help`} className="text-xs text-muted">
        Busca y selecciona los nombres que corresponden al funcionario. Un tipo
        puede asignarse a varias personas.
      </p>
      <div
        className="relative"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setOpen(false)
        }}
      >
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted"
          />
          <input
            id={`${id}-input`}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={`${id}-list`}
            aria-describedby={`${id}-help`}
            aria-activedescendant={
              open && filtered[active] ? `${id}-option-${active}` : undefined
            }
            autoComplete="off"
            disabled={disabled}
            className={cx(inputCls, "pl-9")}
            placeholder="Buscar tipo de garantía…"
            value={query}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
              setOpen(true)
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && open) {
                event.preventDefault()
                event.stopPropagation()
                setOpen(false)
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault()
                setOpen(true)
                if (filtered.length)
                  move(
                    open
                      ? active + (event.key === "ArrowDown" ? 1 : -1)
                      : event.key === "ArrowDown"
                        ? 0
                        : filtered.length - 1,
                  )
              }
              if (event.key === "Enter" && open) {
                event.preventDefault()
                if (filtered[active]) toggle(filtered[active].claveNormalizada)
              }
            }}
          />
        </div>
        {open && (
          <ul
            id={`${id}-list`}
            role="listbox"
            aria-label="Tipos de garantías disponibles"
            aria-multiselectable="true"
            className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-line bg-white p-1 shadow-sm"
          >
            {filtered.map((option, index) => (
              <li
                key={option.claveNormalizada}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={selected.includes(option.claveNormalizada)}
                className={cx(
                  "flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm",
                  index === active && "bg-brand-soft",
                  selected.includes(option.claveNormalizada) &&
                    "font-medium text-brand",
                )}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setActive(index)}
                onClick={() => {
                  if (!disabled) toggle(option.claveNormalizada)
                }}
              >
                <span className="grid size-4 shrink-0 place-items-center rounded border border-line">
                  {selected.includes(option.claveNormalizada) && (
                    <Check className="size-3" />
                  )}
                </span>
                {option.nombre}
              </li>
            ))}
            {!filtered.length && (
              <li role="presentation" className="px-3 py-3 text-sm text-muted">
                No hay tipos que coincidan con la búsqueda.
              </li>
            )}
          </ul>
        )}
      </div>
      <p role="status" className="text-xs text-muted">
        {selected.length} tipos seleccionados
      </p>
      <div className="flex flex-wrap gap-2">
        {selected.map((key) => (
          <span
            key={key}
            className="inline-flex max-w-full items-center gap-1 rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand"
          >
            <span className="break-words">
              {options.find((option) => option.claveNormalizada === key)
                ?.nombre ?? key}
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                onChange(selected.filter((value) => value !== key))
              }
              aria-label={`Quitar ${options.find((option) => option.claveNormalizada === key)?.nombre ?? key}`}
              className="rounded-full p-0.5 focus-visible:outline-2"
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
      </div>
      {!options.length && (
        <p className="text-xs text-muted">
          No hay nombres de garantías disponibles en el sistema.
        </p>
      )}
    </div>
  )
}
