import { useId, useRef, useState, type FormEvent } from "react"
import { Loader2 } from "lucide-react"
import { ApiError } from "../services/api"
import {
  createUser,
  updateUser,
  type GuaranteeTypeOption,
  type ManagedUser,
  type UserRole,
} from "../services/usuarios"
import { Btn, inputCls } from "../ui"
import GuaranteeTypeCombobox from "./GuaranteeTypeCombobox"
import UserModal from "./UserModal"

export default function UserEditor({
  user,
  options,
  onClose,
  onSaved,
}: {
  user?: ManagedUser
  options: GuaranteeTypeOption[]
  onClose: () => void
  onSaved: (user: ManagedUser) => void
}) {
  const initial = useRef({
    nombre: user?.nombres ?? user?.nombre ?? "",
    apellido: user?.apellido ?? "",
    email: user?.email ?? "",
    username: user?.username ?? "",
    password: "",
    rol: user?.rol ?? "LECTOR" as UserRole,
    puedeCargarNominas: user?.puedeCargarNominas ?? false,
    recibirInformeAutomatico: user?.recibirInformeAutomatico ?? false,
    activo: user?.activo ?? true,
    tiposGarantia:
      user?.tiposGarantia.map((type) => type.claveNormalizada) ?? [],
  })
  const [form, setForm] = useState(initial.current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [confirmDeactivation, setConfirmDeactivation] = useState(false)
  const id = useId()
  const dirty = JSON.stringify(form) !== JSON.stringify(initial.current)
  const change = <K extends keyof typeof form,>(
    key: K,
    value: typeof form[K],
  ) => {
    setForm((current) => ({ ...current, [key]: value }))
    setFields({})
    setError(null)
    setConfirmDeactivation(false)
  }
  const fieldError = (key: string) =>
    fields[key] ? (
      <p id={`${id}-${key}-error`} className="mt-1 text-xs text-[#a12a22]">
        {fields[key]}
      </p>
    ) : null
  const attrs = (key: string) => ({
    id: `${id}-${key}`,
    "aria-invalid": Boolean(fields[key]),
    "aria-describedby": fields[key] ? `${id}-${key}-error` : undefined,
  })
  const validate = () => {
    const errors: Record<string, string> = {}
    if (!form.nombre.trim()) errors.nombre = "Ingresa el nombre."
    if (!user && !form.apellido.trim()) errors.apellido = "Ingresa el apellido."
    if (`${form.nombre.trim()} ${form.apellido.trim()}`.trim().length > 120)
      errors.nombre = "El nombre completo puede tener hasta 120 caracteres."
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) ||
      form.email.trim().length > 254
    )
      errors.email = "Ingresa un correo válido de hasta 254 caracteres."
    if (!user && !/^[\w.-]{3,100}$/.test(form.username.trim()))
      errors.username =
        "Usa de 3 a 100 letras, números, puntos, guiones o guiones bajos."
    if (!user && (form.password.length < 8 || form.password.length > 128))
      errors.password = "La contraseña debe tener entre 8 y 128 caracteres."
    setFields(errors)
    if (Object.keys(errors).length) {
      setError("Revisa los campos indicados.")
      requestAnimationFrame(() =>
        document.getElementById(`${id}-${Object.keys(errors)[0]}`)?.focus(),
      )
      return false
    }
    return true
  }
  const save = async () => {
    setBusy(true)
    setError(null)
    const split = Boolean(form.apellido.trim())
    const input = {
      nombre: split
        ? `${form.nombre.trim()} ${form.apellido.trim()}`
        : form.nombre.trim(),
      nombres: split ? form.nombre.trim() : null,
      apellido: split ? form.apellido.trim() : null,
      email: form.email.trim(),
      rol: form.rol,
      puedeCargarNominas:
        form.rol === "LECTOR" || form.rol === "ADMIN"
          ? false
          : form.puedeCargarNominas,
      recibirInformeAutomatico: form.recibirInformeAutomatico,
      activo: form.activo,
      tiposGarantia: form.tiposGarantia,
    }
    try {
      const result = user
        ? await updateUser(user.id, input)
        : await createUser({
            ...input,
            apellido: form.apellido.trim(),
            username: form.username.trim(),
            password: form.password,
          })
      onSaved(result)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No fue posible guardar el usuario.",
      )
      if (cause instanceof ApiError)
        setFields(
          Object.fromEntries(
            cause.details
              .filter((detail) => detail.path?.[0])
              .map((detail) => [
                String(detail.path![0]),
                detail.message ?? "Revisa este campo.",
              ]),
          ),
        )
      setConfirmDeactivation(false)
    } finally {
      setBusy(false)
    }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy || !validate()) return
    if (user?.activo && !form.activo) {
      setConfirmDeactivation(true)
      return
    }
    void save()
  }
  return (
    <UserModal
      title={user ? "Editar usuario" : "Nuevo usuario"}
      description={
        user
          ? `Cuenta: ${user.username}`
          : "Registra los datos y permisos del funcionario."
      }
      dirty={dirty}
      busy={busy}
      onClose={onClose}
    >
      <form noValidate onSubmit={submit} className="space-y-5 p-5">
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-[#fbe7e5] px-4 py-3 text-sm text-[#a12a22]"
          >
            {error}
          </p>
        )}
        <fieldset disabled={busy} className="space-y-5">
          <legend className="mb-3 text-sm font-semibold">
            Información personal
          </legend>
          {user && !user.nombres && (
            <p className="rounded-lg bg-canvas p-3 text-xs text-muted">
              El nombre anterior se conserva completo y sin dividir. Puedes
              corregir el campo Nombre y completar el apellido cuando
              corresponda, o conservarlo como está.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor={`${id}-nombre`}
                className="mb-1 block text-sm font-medium"
              >
                Nombre
              </label>
              <input
                {...attrs("nombre")}
                data-autofocus
                required
                maxLength={120}
                autoComplete="given-name"
                className={inputCls}
                value={form.nombre}
                onChange={(event) => change("nombre", event.target.value)}
              />
              {fieldError("nombre")}
            </div>
            <div>
              <label
                htmlFor={`${id}-apellido`}
                className="mb-1 block text-sm font-medium"
              >
                Apellido{user && !user.apellido ? " (por completar)" : ""}
              </label>
              <input
                {...attrs("apellido")}
                required={!user}
                maxLength={120}
                autoComplete="family-name"
                className={inputCls}
                value={form.apellido}
                onChange={(event) => change("apellido", event.target.value)}
              />
              {fieldError("apellido")}
            </div>
            <div className="sm:col-span-2">
              <label
                htmlFor={`${id}-email`}
                className="mb-1 block text-sm font-medium"
              >
                Correo electrónico
              </label>
              <input
                {...attrs("email")}
                required
                type="email"
                maxLength={254}
                autoComplete="email"
                className={inputCls}
                value={form.email}
                onChange={(event) => change("email", event.target.value)}
              />
              {fieldError("email")}
            </div>
          </div>
          <div>
            <label
              htmlFor={`${id}-rol`}
              className="mb-1 block text-sm font-medium"
            >
              Perfil de acceso
            </label>
            <select
              id={`${id}-rol`}
              className={inputCls}
              value={form.rol}
              onChange={(event) => {
                setForm((current) => ({
                  ...current,
                  rol: event.target.value as UserRole,
                  puedeCargarNominas: false,
                }))
                setConfirmDeactivation(false)
              }}
            >
              <option value="ADMIN">Administrador</option>
              <option value="COORDINADOR_SOME">Coordinador SOME</option>
              <option value="PROFESIONAL">Profesional gestor</option>
              <option value="LECTOR">Lector</option>
            </select>
            {fieldError("rol")}
          </div>
          <GuaranteeTypeCombobox
            options={options}
            selected={form.tiposGarantia}
            onChange={(values) => change("tiposGarantia", values)}
            disabled={busy}
          />
          {fieldError("tiposGarantia")}
          <div className="space-y-3 rounded-lg border border-line p-4">
            <p className="text-sm font-semibold">Permisos y estado</p>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.rol === "ADMIN" || form.puedeCargarNominas}
                disabled={form.rol === "ADMIN" || form.rol === "LECTOR"}
                onChange={(event) =>
                  change("puedeCargarNominas", event.target.checked)
                }
              />
              <span>
                Puede cargar nóminas
                {form.rol === "ADMIN" && (
                  <span className="block text-xs text-muted">
                    Incluido en el perfil de administrador.
                  </span>
                )}
                {form.rol === "LECTOR" && (
                  <span className="block text-xs text-muted">
                    No disponible para lectores.
                  </span>
                )}
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.recibirInformeAutomatico}
                onChange={(event) =>
                  change("recibirInformeAutomatico", event.target.checked)
                }
              />
              <span>Recibir informe automático por correo</span>
            </label>
            <p className="text-xs text-muted">
              Recibirá únicamente garantías de los tipos seleccionados si la cuenta
              está activa y el envío automático está habilitado. Se utilizará el correo
              de esta cuenta. Guardar la configuración no envía un correo.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.activo}
                onChange={(event) => change("activo", event.target.checked)}
              />
              Usuario activo
            </label>
          </div>
          <div className="space-y-3 border-t border-line pt-4">
            <h4 className="text-sm font-semibold">Datos de acceso</h4>
            <div>
              <label
                htmlFor={`${id}-username`}
                className="mb-1 block text-sm font-medium"
              >
                Nombre de usuario
              </label>
              <input
                {...attrs("username")}
                readOnly={Boolean(user)}
                required
                minLength={3}
                maxLength={100}
                autoComplete="username"
                className={inputCls}
                value={form.username}
                onChange={(event) => change("username", event.target.value)}
              />
              {fieldError("username")}
              <p className="mt-1 text-xs text-muted">
                Se mantiene el inicio de sesión con usuario y contraseña.
                {user && " El nombre de usuario no se modifica."}
              </p>
            </div>
            {!user && (
              <div>
                <label
                  htmlFor={`${id}-password`}
                  className="mb-1 block text-sm font-medium"
                >
                  Contraseña inicial
                </label>
                <input
                  {...attrs("password")}
                  required
                  type="password"
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  className={inputCls}
                  value={form.password}
                  onChange={(event) => change("password", event.target.value)}
                />
                {fieldError("password")}
                <p className="mt-1 text-xs text-muted">
                  Entre 8 y 128 caracteres.
                </p>
              </div>
            )}
          </div>
        </fieldset>
        {confirmDeactivation && (
          <div
            role="alert"
            className="rounded-lg border border-[#f1b9b4] bg-[#fbe7e5] p-4 text-sm"
          >
            <p>
              ¿Desactivar este usuario? Se cerrarán sus sesiones y se
              conservarán sus antecedentes y tipos de garantías.
            </p>
            <div className="mt-3 flex gap-2">
              <Btn
                disabled={busy}
                onClick={() => setConfirmDeactivation(false)}
              >
                Volver al formulario
              </Btn>
              <Btn variant="danger" disabled={busy} onClick={() => void save()}>
                Confirmar desactivación
              </Btn>
            </div>
          </div>
        )}
        <div className="flex justify-end">
          <Btn
            type="submit"
            variant="primary"
            disabled={busy || confirmDeactivation}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ? "Guardando…" : user ? "Guardar cambios" : "Crear usuario"}
          </Btn>
        </div>
      </form>
    </UserModal>
  )
}
