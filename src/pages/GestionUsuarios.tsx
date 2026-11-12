import { useEffect, useState, type FormEvent } from "react"
import {
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Search,
  UserCheck,
  Users,
  Mail,
} from "lucide-react"
import {
  getUserManagement,
  getUserGuaranteeTypes,
  resetUserPassword,
  updateUser,
  type GuaranteeTypeOption,
  type ManagedUser,
  type UserSummary,
} from "../services/usuarios"
import { Btn, Card, Th, cx, inputCls, tdCls } from "../ui"
import UserEditor from "../components/UserEditor"
import UserModal from "../components/UserModal"
import { getIndividualReportResults, type IndividualReportResults } from "../services/notificaciones"

type Toast = (message: string) => void
const reportLabels = { RESERVADO: 'Reservado', EN_PROCESO: 'En proceso', ACEPTADO_SMTP: 'Aceptado por SMTP; entrega no confirmada', FALLIDO: 'Fallido', OMITIDO: 'Omitido', INCIERTO: 'Resultado incierto; requiere revisión' }
const roleLabels = {
  ADMIN: "Administrador",
  COORDINADOR_SOME: "Coordinador SOME",
  PROFESIONAL: "Profesional gestor",
  LECTOR: "Lector",
}
type Action = { kind: "edit" | "password" | "state", user: ManagedUser } | {
  kind: "create"
}

function PasswordEditor({
  user,
  onClose,
  onSaved,
}: {
  user: ManagedUser
  onClose: () => void
  onSaved: () => void
}) {
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (password.length < 8 || password.length > 128) {
      setError("La contraseña debe tener entre 8 y 128 caracteres.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await resetUserPassword(user.id, password)
      onSaved()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No fue posible restablecer la contraseña.",
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <UserModal
      title="Restablecer contraseña"
      description={user.nombre}
      onClose={onClose}
      busy={busy}
      dirty={Boolean(password)}
    >
      <form noValidate className="space-y-4 p-5" onSubmit={submit}>
        <p className="text-sm text-muted">
          Se cerrarán todas las sesiones de esta cuenta al guardar.
        </p>
        <label className="block text-sm font-medium">
          Nueva contraseña
          <input
            data-autofocus
            required
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            disabled={busy}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              setError(null)
            }}
            className={cx(inputCls, "mt-1")}
          />
        </label>
        <p className="text-xs text-muted">Entre 8 y 128 caracteres.</p>
        {error && (
          <p role="alert" className="text-sm text-[#a12a22]">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Btn type="submit" variant="primary" disabled={busy}>
            {busy ? "Guardando…" : "Guardar contraseña"}
          </Btn>
        </div>
      </form>
    </UserModal>
  )
}

function UserStateConfirmation({
  user,
  onClose,
  onSaved,
}: {
  user: ManagedUser
  onClose: () => void
  onSaved: (user: ManagedUser) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await updateUser(user.id, {
        nombre: user.nombre,
        email: user.email,
        rol: user.rol,
        puedeCargarNominas: user.puedeCargarNominas,
        activo: !user.activo,
      })
      onSaved(result)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No fue posible cambiar el estado.",
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <UserModal
      title={user.activo ? "Desactivar usuario" : "Reactivar usuario"}
      description={user.nombre}
      onClose={onClose}
      busy={busy}
    >
      <div className="space-y-4 p-5">
        <p className="text-sm">
          {user.activo
            ? "Se cerrarán sus sesiones y no podrá ingresar. Sus importaciones, actuaciones y tipos de garantías se conservarán."
            : "El usuario podrá volver a ingresar con sus credenciales y conservará sus tipos de garantías."}
        </p>
        {error && (
          <p role="alert" className="text-sm text-[#a12a22]">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Btn
            variant={user.activo ? "danger" : "primary"}
            disabled={busy}
            onClick={() => void save()}
          >
            {busy
              ? "Guardando…"
              : user.activo
                ? "Confirmar desactivación"
                : "Confirmar reactivación"}
          </Btn>
        </div>
      </div>
    </UserModal>
  )
}

export default function GestionUsuarios({
  isAdmin,
  toast,
}: {
  isAdmin: boolean
  toast: Toast
}) {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [summary, setSummary] = useState<UserSummary | null>(null)
  const [options, setOptions] = useState<GuaranteeTypeOption[]>([])
  const [reportResults, setReportResults] = useState<IndividualReportResults | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<Action | null>(null)
  const [query, setQuery] = useState("")
  const [role, setRole] = useState("")
  const [state, setState] = useState("")
  const load = async (signal?: AbortSignal, background = false) => {
    if (!background) setLoading(true)
    try {
      const [result, choices, reports] = await Promise.all([
        getUserManagement(signal),
        getUserGuaranteeTypes(signal),
        getIndividualReportResults(signal).catch(() => null),
      ])
      if (!signal?.aborted) {
        setUsers(result.data)
        setSummary(result.resumen)
        setOptions(choices)
        setReportResults(reports)
        setError(null)
      }
    } catch (cause) {
      if (!signal?.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "No fue posible cargar los usuarios.",
        )
    } finally {
      if (!signal?.aborted && !background) setLoading(false)
    }
  }
  useEffect(() => {
    if (!isAdmin) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [isAdmin])
  const saved = (message: string) => {
    setAction(null)
    toast(message)
    // Mantiene los botones de origen montados para restaurar el foco del modal.
    void load(undefined, true)
  }
  const normalized = (text: string) =>
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
  const visible = users.filter(
    (user) =>
      normalized(
        `${user.nombre} ${user.apellido ?? ""} ${user.email}`,
      ).includes(normalized(query)) &&
      (!role || user.rol === role) &&
      (!state || user.activo === (state === "activo")),
  )
  if (!isAdmin)
    return (
      <Card className="p-6">
        <h2 className="text-lg font-semibold">Acceso restringido</h2>
        <p className="mt-2 text-sm text-muted">
          Solo administradores pueden gestionar usuarios.
        </p>
      </Card>
    )
  return (
    <div className="page-in space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Gestión de usuarios</h2>
          <p className="mt-1 text-sm text-muted">
            Administra las cuentas, permisos y tipos de garantías de los
            funcionarios.
          </p>
        </div>
        <Btn
          variant="primary"
          disabled={loading || Boolean(error)}
          onClick={() => setAction({ kind: "create" })}
        >
          <Plus className="size-4" />
          Nuevo usuario
        </Btn>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Total de usuarios", value: summary?.total, icon: Users },
          {
            label: "Usuarios activos",
            value: summary?.activos,
            icon: UserCheck,
          },
          {
            label: "Con recepción de informes habilitada",
            value: summary?.informesHabilitados,
            icon: Mail,
          },
        ].map((item) => (
          <Card key={item.label} className="flex items-center gap-4 p-5">
            <span className="rounded-lg bg-brand-soft p-2.5 text-brand">
              <item.icon className="size-5" />
            </span>
            <div>
              <p className="text-xs text-muted">{item.label}</p>
              <p className="tnum mt-1 text-2xl font-semibold">
                {loading || error ? "—" : (item.value ?? "—")}
              </p>
            </div>
          </Card>
        ))}
      </div>
      <p className="rounded-lg bg-brand-soft px-4 py-3 text-sm text-brand">
        Cada cuenta activa con recepción habilitada recibe únicamente sus tipos de garantías.
        Guardar no envía correos. {reportResults ? (reportResults.automaticEnabled ? 'Envío automático habilitado en configuración.' : 'Envío automático deshabilitado.') : 'No se pudo consultar el estado del envío automático.'}
      </p>
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[#fbe7e5] px-4 py-3 text-sm text-[#a12a22]"
        >
          <span>{error}</span>
          <Btn onClick={() => void load()}>Reintentar</Btn>
        </div>
      )}
      <Card className="overflow-hidden">
        <div className="grid gap-3 border-b border-line p-4 md:grid-cols-[1fr_200px_160px]">
          <label className="relative">
            <span className="sr-only">Buscar usuarios</span>
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted" />
            <input
              className={cx(inputCls, "pl-9")}
              placeholder="Buscar por nombre, apellido o correo…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label>
            <span className="sr-only">Filtrar por perfil</span>
            <select
              className={inputCls}
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              <option value="">Todos los perfiles</option>
              {Object.entries(roleLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Filtrar por estado</span>
            <select
              className={inputCls}
              value={state}
              onChange={(event) => setState(event.target.value)}
            >
              <option value="">Todos los estados</option>
              <option value="activo">Activos</option>
              <option value="inactivo">Inactivos</option>
            </select>
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <Th>Usuario</Th>
                <Th>Correo</Th>
                <Th>Perfil</Th>
                <Th>Tipos de garantías</Th>
                <Th>Informe</Th>
                <Th>Estado</Th>
                <Th>Acciones</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading ? (
                <tr>
                  <td
                    colSpan={7}
                    className={cx(tdCls, "py-10 text-center text-muted")}
                  >
                    <Loader2 className="mr-2 inline size-4 animate-spin" />
                    Cargando usuarios…
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td
                    colSpan={7}
                    className={cx(tdCls, "py-10 text-center text-muted")}
                  >
                    No fue posible obtener los datos actuales.
                  </td>
                </tr>
              ) : !visible.length ? (
                <tr>
                  <td
                    colSpan={7}
                    className={cx(tdCls, "py-10 text-center text-muted")}
                  >
                    {users.length
                      ? "No hay usuarios que coincidan con los filtros."
                      : "Todavía no hay usuarios registrados."}
                  </td>
                </tr>
              ) : (
                visible.map((user) => (
                  <tr key={user.id} className="hover:bg-canvas">
                    <td className={tdCls}>
                      <p className="font-medium">{user.nombre}</p>
                      <p className="mt-0.5 font-mono text-xs text-muted">
                        {user.username}
                      </p>
                      {!user.apellido && (
                        <p className="mt-1 text-xs text-muted">
                          Apellido por completar
                        </p>
                      )}
                    </td>
                    <td className={tdCls}>{user.email}</td>
                    <td className={tdCls}>{roleLabels[user.rol]}</td>
                    <td
                      className={tdCls}
                      title={user.tiposGarantia
                        .map((type) => type.nombre)
                        .join(", ")}
                    >
                      <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand">
                        {user.tiposGarantia.length} asignados
                      </span>
                      {user.tiposGarantia.length > 0 && (
                        <p className="mt-1 max-w-48 truncate text-xs text-muted">
                          {user.tiposGarantia
                            .map((type) => type.nombre)
                            .join(", ")}
                        </p>
                      )}
                    </td>
                    <td className={tdCls}>
                      <span
                        className={cx(
                          "rounded-full px-2.5 py-1 text-xs",
                          user.recibirInformeAutomatico
                            ? "bg-brand-soft text-brand"
                            : "bg-canvas text-muted",
                        )}
                      >
                        {user.recibirInformeAutomatico
                          ? "Habilitado"
                          : "Deshabilitado"}
                      </span>
                      <p className="mt-1 max-w-56 whitespace-normal text-xs text-muted">
                        {!reportResults ? 'Último resultado no disponible' : !reportResults.disponible ? 'Historial individual pendiente de migración' : reportResults.data.find((item) => item.usuarioId === user.id) ? reportLabels[reportResults.data.find((item) => item.usuarioId === user.id)!.estado] : 'Sin registros individuales'}
                      </p>
                    </td>
                    <td className={tdCls}>
                      <span
                        className={cx(
                          "rounded-full px-2.5 py-1 text-xs",
                          user.activo
                            ? "bg-[#e6f4ec] text-[#256b45]"
                            : "bg-[#e4e7ec] text-[#3d4756]",
                        )}
                      >
                        {user.activo ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className={tdCls}>
                      <div className="flex flex-wrap gap-1">
                        <Btn
                          variant="ghost"
                          aria-label={`Editar ${user.nombre}`}
                          className="!px-2 !py-1.5"
                          onClick={() => setAction({ kind: "edit", user })}
                        >
                          <Pencil className="size-3.5" />
                          Editar
                        </Btn>
                        <Btn
                          variant="ghost"
                          aria-label={`Restablecer contraseña de ${user.nombre}`}
                          className="!px-2 !py-1.5"
                          onClick={() => setAction({ kind: "password", user })}
                        >
                          <KeyRound className="size-3.5" />
                          Contraseña
                        </Btn>
                        <Btn
                          variant={user.activo ? "danger" : "secondary"}
                          className="!px-2 !py-1.5"
                          aria-label={`${
                            user.activo ? "Desactivar" : "Reactivar"
                          } ${user.nombre}`}
                          onClick={() => setAction({ kind: "state", user })}
                        >
                          {user.activo ? "Desactivar" : "Reactivar"}
                        </Btn>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && !error && (
          <p className="border-t border-line px-4 py-3 text-xs text-muted">
            {visible.length} de {users.length} usuarios
          </p>
        )}
      </Card>
      {(action?.kind === "create" || action?.kind === "edit") && (
        <UserEditor
          user={action.kind === "edit" ? action.user : undefined}
          options={options}
          onClose={() => setAction(null)}
          onSaved={() =>
            saved(
              "Configuración guardada. Guardar no envía correos.",
            )
          }
        />
      )}
      {action?.kind === "password" && (
        <PasswordEditor
          user={action.user}
          onClose={() => setAction(null)}
          onSaved={() =>
            saved("Contraseña actualizada; se cerraron sus sesiones.")
          }
        />
      )}
      {action?.kind === "state" && (
        <UserStateConfirmation
          user={action.user}
          onClose={() => setAction(null)}
          onSaved={(user) =>
            saved(
              user.activo
                ? "Usuario reactivado."
                : "Usuario desactivado; se cerraron sus sesiones.",
            )
          }
        />
      )}
    </div>
  )
}
