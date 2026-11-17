import { useId, useRef, useState } from "react"
import { Check, ChevronDown, Search, X } from "lucide-react"
import type { GuaranteeTypeOption } from "../services/usuarios"
import { cx, inputCls } from "../ui"

const searchKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()

export default function AssignmentMultiSelect({
  label,
  name,
  anyLabel,
  options,
  selected,
  onChange,
  disabled = false,
}: {
  label: string
  name: string
  anyLabel: string
  options: GuaranteeTypeOption[]
  selected: string[]
  onChange: (values: string[]) => void
  disabled?: boolean
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const choices = [
    ...options,
    ...selected
      .filter(
        (key) => !options.some((option) => option.claveNormalizada === key),
      )
      .map((key) => ({ claveNormalizada: key, nombre: key })),
  ]
  const filtered = choices.filter((option) =>
    searchKey(option.nombre).includes(searchKey(query)),
  )
  const entries = [{ claveNormalizada: "", nombre: anyLabel }, ...filtered]
  const choose = (key: string) => {
    if (disabled) return
    onChange(
      !key
        ? []
        : selected.includes(key)
          ? selected.filter((value) => value !== key)
          : [...selected, key],
    )
    setQuery("")
    setActive(0)
  }
  return (
    <div
      className="min-w-0 space-y-2"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false)
          setQuery("")
        }
      }}
    >
      <label htmlFor={`${id}-input`} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted"
        />
        <input
          ref={input}
          id={`${id}-input`}
          role="combobox"
          aria-label={name}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? `${id}-list` : undefined}
          aria-activedescendant={
            open
              ? `${id}-option-${Math.min(active, entries.length - 1)}`
              : undefined
          }
          disabled={disabled}
          autoComplete="off"
          className={cx(inputCls, "pl-9 pr-9")}
          placeholder={
            selected.length
              ? `${selected.length} seleccionados · buscar…`
              : anyLabel
          }
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
              setQuery("")
              return
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault()
              const next = open
                ? (Math.min(active, entries.length - 1) +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    entries.length) %
                  entries.length
                : 0
              setActive(next)
              setOpen(true)
              document
                .getElementById(`${id}-option-${next}`)
                ?.scrollIntoView?.({ block: "nearest" })
            }
            if (event.key === "Enter") {
              event.preventDefault()
              if (open)
                choose(
                  entries[Math.min(active, entries.length - 1)]
                    .claveNormalizada,
                )
              else setOpen(true)
            }
          }}
        />
        <button
          type="button"
          aria-label={`${open ? "Cerrar" : "Abrir"} ${name}`}
          disabled={disabled}
          className="absolute right-2 top-2 rounded p-0.5 text-muted hover:text-brand"
          onClick={() => {
            setOpen(!open)
            setActive(0)
            if (!open) input.current?.focus()
          }}
        >
          <ChevronDown className="size-4" />
        </button>
      </div>
      {open && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={`Opciones de ${name}`}
          aria-multiselectable="true"
          className="max-h-48 overflow-y-auto rounded-lg border border-line bg-white p-1 shadow-sm"
        >
          {entries.map((option, index) => {
            const checked = option.claveNormalizada
              ? selected.includes(option.claveNormalizada)
              : selected.length === 0
            return (
              <li
                key={option.claveNormalizada}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={checked}
                className={cx(
                  "flex cursor-pointer items-start gap-2 rounded px-2 py-2 text-sm",
                  index === active && "bg-brand-soft",
                  checked && "font-medium text-brand",
                )}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setActive(index)}
                onClick={() => choose(option.claveNormalizada)}
              >
                <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded border border-line">
                  {checked && <Check className="size-3" />}
                </span>
                <span className="break-words">{option.nombre}</span>
              </li>
            )
          })}
          {!filtered.length && (
            <li role="presentation" className="px-2 py-2 text-xs text-muted">
              No hay opciones que coincidan.
            </li>
          )}
        </ul>
      )}
      <div className="flex flex-wrap gap-1.5">
        {selected.map((key) => {
          const title =
            choices.find((option) => option.claveNormalizada === key)?.nombre ??
            key
          return (
            <span
              key={key}
              className="inline-flex max-w-full items-start gap-1 rounded-lg bg-brand-soft px-2 py-1 text-xs font-medium text-brand"
            >
              <span className="break-words">{title}</span>
              <button
                type="button"
                disabled={disabled}
                aria-label={`Quitar ${title} de ${name}`}
                className="shrink-0 rounded p-0.5 hover:bg-white/60"
                onClick={() =>
                  onChange(selected.filter((value) => value !== key))
                }
              >
                <X className="size-3" />
              </button>
            </span>
          )
        })}
        {!selected.length && (
          <span className="text-xs text-muted">{anyLabel}</span>
        )}
      </div>
    </div>
  )
}
