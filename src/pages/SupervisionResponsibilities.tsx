import { useEffect, useId, useRef, useState, type FormEvent } from "react"
import { AlertCircle, Loader2, Pencil, RefreshCw, ShieldCheck, Users } from "lucide-react"
import { ApiError } from "../services/api"
import { getResponsibilities, saveResponsibilities, type Responsibilities, type ResponsibilityStaff } from "../services/responsabilidades"
import { assignmentGroupsFromRules, expandAssignmentGroups, validateAssignmentGroups } from "../services/assignment-groups"
import type { AssignmentOptions } from "../services/usuarios"
import UserAssignmentRules from "../components/UserAssignmentRules"
import UserModal from "../components/UserModal"
import { Btn, Card, CardHeader, Empty } from "../ui"
import type { Nav } from "./pages1"

function RuleEditor({ staff, options, onClose, onSaved, onSessionExpired }: {
  staff: ResponsibilityStaff
  options: AssignmentOptions
  onClose: () => void
  onSaved: (value: ResponsibilityStaff) => void
  onSessionExpired: () => void
}) {
  const [initial] = useState(() => assignmentGroupsFromRules(staff.reglasAsignacion))
  const [groups, setGroups] = useState(initial)
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState<string>()
  const id = useId()
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving.current) return
    const invalid = validateAssignmentGroups(groups)
    if (invalid) { setError(invalid); return }
    saving.current = true; setBusy(true); setError(null); setCode(undefined)
    try { onSaved(await saveResponsibilities(staff, expandAssignmentGroups(groups).rules)) }
    catch (cause) {
      setCode(cause instanceof ApiError ? cause.code : undefined)
      setError(cause instanceof ApiError ? cause.message : "No fue posible guardar las reglas. Intenta nuevamente.")
    } finally { saving.current = false; setBusy(false) }
  }
  return <UserModal wide title="Editar responsabilidades" description={staff.nombre} dirty={JSON.stringify(groups) !== JSON.stringify(initial)} busy={busy} onClose={onClose} actions={<Btn type="submit" form={`${id}-form`} variant="primary" disabled={busy || code === "STALE_ASSIGNMENT_RULES" || code === "FORBIDDEN" || code === "UNAUTHENTICATED"}>{busy && <Loader2 className="size-4 animate-spin" />}{busy ? "Guardando…" : "Guardar reglas"}</Btn>}>
    <form id={`${id}-form`} onSubmit={(event) => void submit(event)} className="space-y-4 p-5">
      {error && <div role="alert" className="space-y-2 rounded-lg border border-[#f1b9b4] bg-[#fbe7e5] p-3 text-sm text-[#a12a22]"><p>{error}</p>{code === "STALE_ASSIGNMENT_RULES" && <p>Conserva una copia de tu selección si la necesitas. Cierra el editor y actualiza la lista para revisar la configuración guardada antes de volver a editar.</p>}{code === "UNAUTHENTICATED" && <Btn onClick={onSessionExpired}>Volver a iniciar sesión</Btn>}</div>}
      <UserAssignmentRules options={options} groups={groups} onChange={(value) => { setGroups(value); if (!code) setError(null) }} disabled={busy || Boolean(code && ["STALE_ASSIGNMENT_RULES", "FORBIDDEN", "UNAUTHENTICATED"].includes(code))} />
      <p className="text-xs text-muted">Guardar aplica esta configuración a las garantías existentes y futuras que coincidan con las reglas. Limpiar todos los grupos y guardar elimina las reglas de este funcionario. Guardar no envía correos.</p>
    </form>
  </UserModal>
}

type State = { status: "loading" } | { status: "ready"; data: Responsibilities } | { status: "error"; message: string; code?: string }
const roleLabel = { ADMIN: "Administrador", COORDINADOR_SOME: "Coordinador", PROFESIONAL: "Profesional gestor", LECTOR: "Lector" }
function groupLabels(staff: ResponsibilityStaff, options: AssignmentOptions) {
  return assignmentGroupsFromRules(staff.reglasAsignacion).map((group) => [
    [group.problemasSalud, options.problemasSalud, "Cualquier problema"],
    [group.establecimientos, options.establecimientos, "Cualquier establecimiento"],
    [group.tiposGarantia, options.tiposGarantia, "Cualquier tipo"],
  ].map(([values, choices, any]) => {
    const selected = values as string[]
    const catalog = choices as AssignmentOptions["tiposGarantia"]
    return selected.length ? selected.map((key) => catalog.find((option) => option.claveNormalizada === key)?.nombre ?? key).join(", ") : any
  }).join(" · "))
}

export default function SupervisionResponsibilities({ nav, onSessionExpired, onRulesChanged }: { nav: Nav; onSessionExpired: () => void; onRulesChanged?: () => void }) {
  const [state, setState] = useState<State>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [editing, setEditing] = useState<ResponsibilityStaff | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    setState({ status: "loading" })
    getResponsibilities(controller.signal).then((data) => { if (!controller.signal.aborted) setState({ status: "ready", data }) }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ status: "error", message: error instanceof ApiError ? error.message : "No fue posible cargar las responsabilidades. Intenta nuevamente.", code: error instanceof ApiError ? error.code : undefined })
    })
    return () => controller.abort()
  }, [attempt])
  if (state.status === "loading") return <p role="status" aria-busy="true" className="inline-flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" />Cargando responsabilidades…</p>
  if (state.status === "error") return <Card className="space-y-3 p-5"><div role="alert" className="flex items-start gap-2 text-sm"><AlertCircle className="size-5 shrink-0 text-[#a12a22]" /><p>{state.code === "UNAUTHENTICATED" ? "Tu sesión no es válida o ha expirado." : state.code === "FORBIDDEN" ? "Tu cuenta no tiene permiso para administrar estas responsabilidades." : state.message}</p></div>{state.code === "UNAUTHENTICATED" ? <Btn onClick={onSessionExpired}>Volver a iniciar sesión</Btn> : state.code === "FORBIDDEN" ? <Btn onClick={() => nav("dashboard")}>Volver al dashboard</Btn> : <Btn onClick={() => setAttempt((value) => value + 1)}>Reintentar</Btn>}</Card>
  const { data } = state
  const staff = data.funcionarios.filter((user) => user.rol !== "ADMIN")
  return <section aria-label="Responsabilidades de funcionarios" className="space-y-4">
    {saved && <p role="status" className="rounded-lg bg-brand-soft px-4 py-3 text-sm text-brand">Reglas guardadas para {saved}.</p>}
    <div className="grid items-start gap-5 xl:grid-cols-[1.4fr_1fr]">
      <Card className="min-w-0 overflow-hidden">
        <CardHeader title="Reglas de asignación" sub="Configuración compartida con Gestión de usuarios" right={<Btn aria-label="Actualizar responsabilidades" disabled={Boolean(editing)} onClick={() => { setSaved(null); setAttempt((value) => value + 1) }}><RefreshCw className="size-4" /><span className="hidden sm:inline">Actualizar</span></Btn>} />
        {staff.length ? <ul aria-label="Funcionarios autorizados" className="divide-y divide-line">{staff.map((staff) => <li key={staff.id} className="space-y-3 p-4 [overflow-wrap:anywhere] sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="flex items-start gap-2 font-semibold"><Users className="mt-0.5 size-4 shrink-0 text-muted" />{staff.nombre}</h3><p className="mt-1 text-xs text-muted">{roleLabel[staff.rol]} · {staff.activo ? "Activo" : "Inactivo"} · {staff.reglasAsignacion.length} {staff.reglasAsignacion.length === 1 ? "regla" : "reglas"}</p></div><Btn aria-label={`Editar reglas de ${staff.nombre}`} onClick={() => { setSaved(null); setEditing(staff) }}><Pencil className="size-3.5" />Editar reglas</Btn></div>
          {staff.reglasAsignacion.length ? <ul className="space-y-2 text-xs text-muted">{groupLabels(staff, data.opciones).slice(0, 3).map((label, index) => <li key={index} className="rounded-lg bg-canvas px-3 py-2">{label}</li>)}{groupLabels(staff, data.opciones).length > 3 && <li>Más grupos disponibles al editar.</li>}</ul> : <p className="text-sm text-muted">Sin reglas de asignación.</p>}
        </li>)}</ul> : <Empty title="Sin funcionarios autorizados" text="No hay funcionarios disponibles para administrar sus reglas con tu perfil actual." />}
      </Card>
      <Card className="min-w-0"><CardHeader title="Alcance de las responsabilidades" right={<ShieldCheck className="size-5 shrink-0 text-muted" />} /><div className="space-y-4 p-5 text-sm text-muted">
        <p>Combina problema de salud, establecimiento y tipo de garantía. Cada grupo reúne todas las combinaciones seleccionadas; varios grupos amplían las coincidencias.</p>
        <p>En profesionales y lectores, las reglas delimitan las garantías visibles y el contenido de los informes individuales. Administradores y coordinadores conservan la vista global; sus reglas delimitan únicamente los informes individuales por correo. Las cuentas administradoras se configuran exclusivamente desde Gestión de usuarios.</p>
        <p>Los cambios solo se aplican al pulsar Guardar reglas. Esta pestaña permite administrar coberturas, sin cambiar datos de acceso ni asignar garantías individuales.</p>
      </div></Card>
    </div>
    {editing && <RuleEditor key={editing.id} staff={editing} options={data.opciones} onClose={() => setEditing(null)} onSessionExpired={onSessionExpired} onSaved={(staff) => {
      setState({ status: "ready", data: { ...data, funcionarios: data.funcionarios.map((current) => current.id === staff.id ? staff : current) } }); setEditing(null); setSaved(staff.nombre); onRulesChanged?.()
    }} />}
  </section>
}
