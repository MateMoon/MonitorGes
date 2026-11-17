import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { X } from "lucide-react"
import { Btn } from "../ui"

export default function UserModal({
  title,
  description,
  dirty = false,
  busy = false,
  wide = false,
  onClose,
  children,
}: {
  title: string
  description?: string
  dirty?: boolean
  busy?: boolean
  wide?: boolean
  onClose: () => void
  children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const keepEditing = useRef<HTMLButtonElement>(null)
  const previousField = useRef<HTMLElement | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const id = useId()
  useEffect(() => {
    const element = dialog.current
    const previous = document.activeElement as HTMLElement | null
    const scroll = document.body.style.overflow
    element?.showModal()
    element?.querySelector<HTMLElement>("[data-autofocus]")?.focus()
    document.body.style.overflow = "hidden"
    return () => {
      element?.close()
      document.body.style.overflow = scroll
      previous?.focus()
    }
  }, [])
  useEffect(() => {
    if (confirmDiscard) keepEditing.current?.focus()
    else if (previousField.current) {
      previousField.current.focus()
      previousField.current = null
    }
  }, [confirmDiscard])
  useEffect(() => {
    if (!dirty) return
    const preventLoss = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", preventLoss)
    return () => window.removeEventListener("beforeunload", preventLoss)
  }, [dirty])
  const requestClose = () => {
    if (busy) return
    if (dirty) {
      previousField.current = (document.activeElement as HTMLElement)
      setConfirmDiscard(true)
    } else onClose()
  }
  const resume = () => setConfirmDiscard(false)
  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      className={`fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] ${wide ? "max-w-4xl" : "max-w-2xl"} overflow-y-auto rounded-xl border border-line bg-white p-0 text-ink shadow-xl backdrop:bg-ink/40 backdrop:backdrop-blur-sm`}
      onCancel={(event) => {
        event.preventDefault()
        if (confirmDiscard) resume()
        else requestClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !confirmDiscard)
          requestClose()
      }}
    >
      <div hidden={confirmDiscard} inert={confirmDiscard}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-white px-5 py-4">
          <div>
            <h3 id={`${id}-title`} className="text-lg font-semibold">
              {title}
            </h3>
            {description && (
              <p id={`${id}-description`} className="mt-1 text-sm text-muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Cerrar ventana"
            disabled={busy}
            onClick={requestClose}
            className="rounded-lg p-1 text-muted hover:bg-canvas focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50"
          >
            <X className="size-5" />
          </button>
        </div>
        {children}
        <div className="border-t border-line px-5 py-3">
          <Btn disabled={busy} onClick={requestClose}>
            Cancelar
          </Btn>
        </div>
      </div>
      {confirmDiscard && (
        <div
          className="p-6"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`${id}-discard`}
        >
          <div>
            <h4 id={`${id}-discard`} className="text-lg font-semibold">
              ¿Descartar los cambios sin guardar?
            </h4>
            <p className="mt-2 text-sm text-muted">
              Los datos guardados del usuario se conservarán.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                ref={keepEditing}
                type="button"
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
                onClick={resume}
              >
                Seguir editando
              </button>
              <Btn variant="danger" onClick={onClose}>
                Descartar cambios
              </Btn>
            </div>
          </div>
        </div>
      )}
    </dialog>
  )
}
