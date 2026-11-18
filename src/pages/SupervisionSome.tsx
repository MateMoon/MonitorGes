import { useEffect, useId, useState } from "react"
import { AlertCircle, ArrowUpRight, CheckCircle2, ClipboardList, Clock, Loader2, RefreshCw, Users } from "lucide-react"
import { ApiError } from "../services/api"
import { getSupervisionSummary, type SupervisionSummary } from "../services/supervision"
import { MANAGEMENT } from "../management"
import { Btn, Card, CardHeader, Days, Empty, StatusBadge, Th, cx, tdCls } from "../ui"
import type { Nav } from "./pages1"
import SupervisionActivityPanel from "./SupervisionActivity"

type State = { status: "loading" } | { status: "ready"; data: SupervisionSummary } | { status: "error"; message: string; code?: string }

function Distribution({ title, rows, overlap = false }: { title: string; rows: { id: string; label: string; cantidad: number }[]; overlap?: boolean }) {
  const maximum = Math.max(1, ...rows.map((row) => row.cantidad))
  return <Card className="min-w-0 overflow-hidden">
    <CardHeader title={title} sub={overlap ? "Garantías coincidentes no cumplidas" : "Garantías no cumplidas"} />
    {overlap && <p className="border-b border-line bg-brand-soft/50 px-5 py-3 text-xs text-brand">Una garantía puede coincidir con varios profesionales. Las cantidades pueden superponerse y no deben sumarse como asignaciones exclusivas.</p>}
    {rows.length ? <ul className="max-h-80 space-y-4 overflow-y-auto p-5" aria-label={title}>
      {rows.map((row) => <li key={row.id}>
        <div className="mb-1.5 flex items-start justify-between gap-3 text-sm"><span className="min-w-0 break-words">{row.label || "Sin información"}</span><span className="tnum shrink-0 font-semibold">{row.cantidad.toLocaleString("es-CL")}</span></div>
        <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-canvas"><div className="h-2 rounded-full bg-brand" style={{ width: `${row.cantidad / maximum * 100}%` }} /></div>
      </li>)}
    </ul> : <p className="px-5 py-8 text-sm text-muted">{overlap ? "No hay profesionales activos con reglas efectivas para mostrar." : "No hay garantías no cumplidas para mostrar."}</p>}
  </Card>
}

export default function SupervisionSome({ isAdmin, nav, onSessionExpired }: { isAdmin: boolean; nav: Nav; onSessionExpired: () => void }) {
  const [state, setState] = useState<State>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [tab, setTab] = useState<"resumen" | "actividad">("resumen")
  const [activityVisited, setActivityVisited] = useState(false)
  const tabsId = useId()
  const selectTab = (value: "resumen" | "actividad") => {
    setTab(value)
    if (value === "actividad") setActivityVisited(true)
  }
  useEffect(() => {
    if (!isAdmin) return
    const controller = new AbortController()
    setState({ status: "loading" })
    getSupervisionSummary(controller.signal).then((data) => {
      if (!controller.signal.aborted) setState({ status: "ready", data })
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setState({ status: "error", message: error instanceof ApiError ? error.message : "No fue posible cargar el resumen de supervisión. Intenta nuevamente.", code: error instanceof ApiError ? error.code : undefined })
    })
    return () => controller.abort()
  }, [isAdmin, attempt])

  if (!isAdmin) return <Card className="p-6"><h2 className="text-lg font-semibold">Acceso restringido</h2><p className="mt-2 text-sm text-muted">Supervisión SOME está disponible únicamente para administradores.</p><Btn className="mt-4" onClick={() => nav("dashboard")}>Volver al dashboard</Btn></Card>

  const data = state.status === "ready" ? state.data : null
  const cards = data ? [
    { key: "totalGarantias", label: "Total de garantías", help: "Todas las registradas", color: "text-brand" },
    { key: "pendientesResolucion", label: "Pendientes de resolución", help: "Situaciones por resolver", color: "text-[#9a4a10]" },
    { key: "enGestion", label: "En gestión", help: "Con seguimiento activo", color: "text-brand" },
    { key: "cumplidas", label: "Cumplidas", help: "Cumplimiento acreditado", color: "text-[#256b45]" },
    { key: "vencidasNoCumplidas", label: "Vencidas no cumplidas", help: "Plazo vencido", color: "text-[#a12a22]" },
    { key: "proximas15DiasNoCumplidas", label: "Próximas a vencer", help: "De 0 a 15 días · no cumplidas", color: "text-[#9a4a10]" },
  ] as const : []

  return <div className="page-in space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-2xl font-semibold">Supervisión SOME</h2><p className="mt-1 text-sm text-muted">Vista general de las garantías y su cobertura por profesionales activos.</p>
        {data && tab === "resumen" && <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted"><Clock className="size-3.5" />Actualizado: {new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short", timeZone: data.zonaHoraria }).format(new Date(data.generadoAt))} · hora de Santiago</p>}
      </div>
      {state.status === "ready" && tab === "resumen" && <Btn onClick={() => setAttempt((current) => current + 1)}><RefreshCw className="size-4" />Actualizar</Btn>}
    </div>
    <div role="tablist" aria-label="Vistas de supervisión" className="flex border-b border-line">
      {([ ["resumen", "Resumen"], ["actividad", "Gestiones y cambios"] ] as const).map(([value, label]) => <button key={value} type="button" role="tab" id={`${tabsId}-tab-${value}`} aria-selected={tab === value} aria-controls={`${tabsId}-panel-${value}`} tabIndex={tab === value ? 0 : -1} className={cx("-mb-px border-b-2 px-4 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand", tab === value ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink")} onClick={() => selectTab(value)} onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
        event.preventDefault()
        const next = event.key === "Home" ? "resumen" : event.key === "End" ? "actividad" : tab === "resumen" ? "actividad" : "resumen"
        selectTab(next)
        document.getElementById(`${tabsId}-tab-${next}`)?.focus()
      }}>{label}</button>)}
    </div>
    <div role="tabpanel" id={`${tabsId}-panel-resumen`} aria-labelledby={`${tabsId}-tab-resumen`} hidden={tab !== "resumen"} className="space-y-5">
    {state.status === "loading" && <div aria-busy="true" className="space-y-5">
      <p role="status" className="inline-flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" />Cargando resumen de supervisión…</p>
      <div aria-hidden="true" className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }, (_, index) => <Card key={index} className="space-y-4 p-4"><div className="h-3 w-4/5 animate-pulse rounded bg-line" /><div className="h-8 w-1/2 animate-pulse rounded bg-line" /><div className="h-2 w-full animate-pulse rounded bg-line" /></Card>)}</div>
    </div>}

    {state.status === "error" && <Card className="p-6"><div role="alert" className="flex items-start gap-3"><AlertCircle className="mt-0.5 size-5 shrink-0 text-[#a12a22]" /><div>
      <h3 className="font-semibold">{state.code === "UNAUTHENTICATED" ? "Sesión no válida" : state.code === "FORBIDDEN" ? "Acceso restringido" : "No fue posible cargar la supervisión"}</h3>
      <p className="mt-1 max-w-2xl text-sm text-muted">{state.code === "UNAUTHENTICATED" ? "Tu sesión no es válida o ha expirado. Inicia sesión nuevamente para continuar." : state.code === "FORBIDDEN" ? "Tu cuenta no tiene permiso para consultar la supervisión general." : state.message}</p>
      <div className="mt-4">{state.code === "UNAUTHENTICATED" ? <Btn onClick={onSessionExpired}>Volver a iniciar sesión</Btn> : state.code === "FORBIDDEN" ? <Btn onClick={() => nav("dashboard")}>Volver al dashboard</Btn> : <Btn onClick={() => setAttempt((current) => current + 1)}><RefreshCw className="size-4" />Reintentar</Btn>}</div>
    </div></div></Card>}

    {data && <>
      <section aria-label="Indicadores de supervisión" className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {cards.map((card) => <Card key={card.key} className="p-4"><h3 className="min-h-10 text-xs font-medium text-muted">{card.label}</h3><p className={cx("tnum mt-2 text-3xl font-semibold", card.color)}>{data.indicadores[card.key].toLocaleString("es-CL")}</p><p className="mt-2 text-xs text-muted">{card.help}</p></Card>)}
      </section>
      {data.indicadores.totalGarantias === 0 && <Card><Empty title="Sin garantías registradas" text="El resumen se completará cuando existan garantías importadas en el sistema." /></Card>}
      {data.cobertura.sinProfesionalNoCumplidas > 0 && <div role="note" className="flex items-start gap-3 rounded-xl border border-[#f3c9a4] bg-[#fff5ec] px-4 py-3 text-sm text-[#7a3d0d]"><Users className="mt-0.5 size-5 shrink-0" /><div><p className="font-semibold">{data.cobertura.sinProfesionalNoCumplidas.toLocaleString("es-CL")} {data.cobertura.sinProfesionalNoCumplidas === 1 ? "garantía no cumplida sin profesional asociado" : "garantías no cumplidas sin profesional asociado"}</p><p className="mt-1">No coinciden con las reglas de ningún profesional activo. Revisa las coberturas configuradas en Gestión de usuarios.</p></div></div>}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Distribution title="Por problema de salud" rows={data.distribuciones.porProblemaSalud.map((row) => ({ id: row.problemaSalud, label: row.problemaSalud, cantidad: row.cantidad }))} />
        <Distribution title="Por establecimiento" rows={data.distribuciones.porEstablecimiento.map((row) => ({ id: row.establecimiento, label: row.establecimiento, cantidad: row.cantidad }))} />
        <Distribution title="Garantías coincidentes por profesional" overlap rows={data.distribuciones.porProfesional.map((row) => ({ id: row.usuarioId, label: row.nombre, cantidad: row.cantidad }))} />
      </div>
      <Card className="overflow-hidden">
        <CardHeader title="Casos de atención prioritaria" sub="Hasta 10 garantías no cumplidas: primero vencidas, luego críticas y después sin profesional asociado" right={<ClipboardList className="size-5 shrink-0 text-muted" />} />
        {data.prioritarios.length ? <div className="relative overflow-x-auto"><table className="w-full min-w-[1472px] table-fixed [&_th]:whitespace-normal [&_th]:break-words [&_td]:align-top [&_td]:whitespace-normal [&_td]:[overflow-wrap:anywhere]"><caption className="sr-only">Casos prioritarios de supervisión. Selecciona un paciente o una fila para abrir su detalle.</caption>
          <colgroup><col className="w-32" /><col className="w-40" /><col className="w-48" /><col className="w-56" /><col className="w-56" /><col className="w-48" /><col className="w-36" /><col className="w-40" /><col className="w-12" /></colgroup>
          <thead><tr><Th>Vencimiento</Th><Th>Gestión</Th><Th>Paciente</Th><Th>Problema de salud</Th><Th>Garantía</Th><Th>Establecimiento</Th><Th>Días restantes</Th><Th>Funcionarios a cargo</Th><Th><span className="sr-only">Detalle</span></Th></tr></thead>
          <tbody className="divide-y divide-line">{data.prioritarios.map((row) => <tr key={row.id} onClick={() => nav("detalle", { id: row.id })} className={cx("group cursor-pointer transition-colors hover:bg-canvas", row.estadoVencimiento === "critica" && "bg-[#fff7f6] hover:bg-[#fdeeec]")}>
            <td className={tdCls}><StatusBadge s={row.estadoVencimiento} short /></td>
            <td className={tdCls}><span className={cx("inline-flex max-w-full whitespace-normal rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", MANAGEMENT[row.estadoGestion].badge)}>{MANAGEMENT[row.estadoGestion].label}</span></td>
            <td className={tdCls}><button type="button" className="block w-full whitespace-normal text-left font-medium text-brand [overflow-wrap:anywhere] hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-brand" aria-label={`Abrir detalle de ${row.paciente.nombre}`} onClick={(event) => { event.stopPropagation(); nav("detalle", { id: row.id }) }}>{row.paciente.nombre}</button></td>
            <td className={tdCls}>{row.problemaSalud}</td><td className={tdCls}>{row.nombreGarantia}</td><td className={tdCls}>{row.establecimiento}</td>
            <td className={cx(tdCls, "[&>span]:whitespace-normal")}><Days d={row.diasRestantes} /></td>
            <td className={tdCls}>{row.profesionalesCoincidentes.length ? <ul className="space-y-2" aria-label="Funcionarios a cargo">{row.profesionalesCoincidentes.map((professional) => <li key={professional.usuarioId} className="flex items-start gap-1.5 text-sm text-brand"><Users aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /><span className="min-w-0 [overflow-wrap:anywhere]">{professional.nombre}</span></li>)}</ul> : <span className="inline-flex max-w-full whitespace-normal rounded-full bg-[#fdeadb] px-2.5 py-1 text-xs font-medium text-[#9a4a10]">Sin funcionario asociado</span>}</td>
            <td className={tdCls}><ArrowUpRight aria-hidden="true" className="size-4 text-muted group-hover:text-brand" /></td>
          </tr>)}</tbody>
        </table></div> : <Empty title="Sin casos prioritarios" text="No hay garantías no cumplidas vencidas, críticas o sin coincidencia con profesionales activos." />}
        {data.prioritarios.length > 0 && <p className="border-t border-line px-5 py-3 text-xs text-muted">Mostrando hasta diez casos, en el orden de prioridad del resumen. Los funcionarios corresponden a los profesionales activos cuyas reglas de cobertura coinciden con la garantía.</p>}
      </Card>
      <p className="flex items-center gap-1.5 text-xs text-muted"><CheckCircle2 className="size-3.5" />Los indicadores de gestión y vencimiento pueden superponerse.</p>
    </>}
    </div>
    <div role="tabpanel" id={`${tabsId}-panel-actividad`} aria-labelledby={`${tabsId}-tab-actividad`} hidden={tab !== "actividad"}>
      {activityVisited && <SupervisionActivityPanel isAdmin={isAdmin} nav={nav} onSessionExpired={onSessionExpired} />}
    </div>
  </div>
}
