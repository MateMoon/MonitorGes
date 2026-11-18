import { useEffect, useState } from "react"
import { AlertCircle, ArrowRight, ArrowUpRight, Clock, History, Loader2, RefreshCw } from "lucide-react"
import { ApiError } from "../services/api"
import { getSupervisionActivity, type SupervisionActivity, type SupervisionActivityEvent } from "../services/supervision"
import { ACTIONS, MANAGEMENT } from "../management"
import { Btn, Card, CardHeader, Empty, cx } from "../ui"
import type { EstadoGestion } from "../types"
import type { Nav } from "./pages1"

type State = { status: "loading" } | { status: "ready"; data: SupervisionActivity } | { status: "error"; message: string; code?: string }
const labels: Record<SupervisionActivityEvent["tipo"], string> = {
  ACTUACION: "Actuación registrada", CAMBIO_ESTADO: "Cambio de estado", CUMPLIMIENTO: "Cumplimiento acreditado", REAPERTURA: "Garantía reabierta", ANTECEDENTE_LEGADO: "Antecedente legado",
}
const timestamp = (value: string) => new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Santiago" }).format(new Date(value))
function StateBadge({ value }: { value: EstadoGestion }) {
  return <span className={cx("inline-flex max-w-full whitespace-normal rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset", MANAGEMENT[value].badge)}>{MANAGEMENT[value].label}</span>
}

export default function SupervisionActivityPanel({ isAdmin, nav, onSessionExpired }: { isAdmin: boolean; nav: Nav; onSessionExpired: () => void }) {
  const [state, setState] = useState<State>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!isAdmin) return
    const controller = new AbortController()
    setState({ status: "loading" })
    getSupervisionActivity(controller.signal).then((data) => {
      if (!controller.signal.aborted) setState({ status: "ready", data })
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setState({ status: "error", message: error instanceof ApiError ? error.message : "No fue posible cargar las gestiones y cambios. Intenta nuevamente.", code: error instanceof ApiError ? error.code : undefined })
    })
    return () => controller.abort()
  }, [isAdmin, attempt])
  if (!isAdmin) return null
  if (state.status === "loading") return <p role="status" aria-busy="true" className="inline-flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" />Cargando gestiones y cambios…</p>
  if (state.status === "error") return <Card className="p-6"><div role="alert" className="flex items-start gap-3"><AlertCircle className="mt-0.5 size-5 shrink-0 text-[#a12a22]" /><div>
    <h3 className="font-semibold">{state.code === "UNAUTHENTICATED" ? "Sesión no válida" : state.code === "FORBIDDEN" ? "Acceso restringido" : "No fue posible cargar el historial"}</h3>
    <p className="mt-1 max-w-2xl text-sm text-muted">{state.code === "UNAUTHENTICATED" ? "Tu sesión no es válida o ha expirado. Inicia sesión nuevamente para continuar." : state.code === "FORBIDDEN" ? "Tu cuenta no tiene permiso para consultar la supervisión general." : state.message}</p>
    <div className="mt-4">{state.code === "UNAUTHENTICATED" ? <Btn onClick={onSessionExpired}>Volver a iniciar sesión</Btn> : state.code === "FORBIDDEN" ? <Btn onClick={() => nav("dashboard")}>Volver al dashboard</Btn> : <Btn onClick={() => setAttempt((current) => current + 1)}><RefreshCw className="size-4" />Reintentar</Btn>}</div>
  </div></div></Card>
  const data = state.data
  return <section aria-label="Actividad de supervisión" className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-lg font-semibold">Gestiones y cambios</h3><p className="mt-1 text-sm text-muted">Últimos 30 eventos registrados · más recientes primero</p><p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted"><Clock className="size-3.5 shrink-0" />Actualizado: {timestamp(data.generadoAt)} · hora de Santiago</p></div>
      <Btn onClick={() => setAttempt((current) => current + 1)}><RefreshCw className="size-4" />Actualizar historial</Btn>
    </div>
    <Card className="min-w-0 overflow-hidden">
      <CardHeader title="Actividad reciente" sub={`${data.eventos.length} ${data.eventos.length === 1 ? "evento registrado" : "eventos registrados"}`} right={<History className="size-5 shrink-0 text-muted" />} />
      {data.eventos.length ? <ol aria-label="Eventos de gestión" className="divide-y divide-line">{data.eventos.map((event) => <li key={event.id} className="space-y-3 p-4 [overflow-wrap:anywhere] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0"><h4 className="font-semibold">{labels[event.tipo]}</h4><p className="mt-1 text-sm text-muted">{event.autorNombre || "Autor no disponible"}</p></div>
          <time dateTime={event.createdAt} className="text-xs text-muted">{timestamp(event.createdAt)} · Santiago</time>
        </div>
        {event.tipoActuacion && <p className="text-sm font-medium text-brand">{ACTIONS[event.tipoActuacion]}</p>}
        {event.estadoAnterior && event.estadoNuevo && event.estadoAnterior !== event.estadoNuevo && <div aria-label="Cambio de estado de gestión" className="flex flex-wrap items-center gap-2"><StateBadge value={event.estadoAnterior} /><ArrowRight aria-label="a" className="size-4 shrink-0 text-muted" /><StateBadge value={event.estadoNuevo} /></div>}
        <button type="button" onClick={() => nav("detalle", { id: event.garantia.id })} aria-label={`Abrir garantía de ${event.garantia.paciente.nombre}`} className="flex w-full min-w-0 items-start justify-between gap-3 rounded-lg border border-line bg-canvas px-3 py-2.5 text-left hover:border-brand/40 focus-visible:outline-2 focus-visible:outline-brand">
          <span className="min-w-0"><span className="block text-sm font-semibold text-brand">{event.garantia.paciente.nombre}</span><span className="mt-1 block text-sm">{event.garantia.problemaSalud} · {event.garantia.nombreGarantia}</span><span className="mt-1 block text-xs text-muted">{event.garantia.establecimiento || "Establecimiento sin información"}</span></span><ArrowUpRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
        </button>
        {event.tipo === "ANTECEDENTE_LEGADO" && <p className="text-xs text-muted">Antecedente previo al historial detallado. Se muestra únicamente la información registrada; el autor puede no estar disponible.</p>}
        {event.comentario && (event.comentario.length > 280 ? <details className="text-sm"><summary className="cursor-pointer font-medium text-brand">{event.tipo === "REAPERTURA" ? "Ver motivo de reapertura" : "Ver comentario"}</summary><p className="mt-2 whitespace-pre-wrap">{event.comentario}</p></details> : <p className="whitespace-pre-wrap text-sm">{event.tipo === "REAPERTURA" && <strong>Motivo de reapertura: </strong>}{event.comentario}</p>)}
        {event.respaldo && <details className="text-sm"><summary className="cursor-pointer font-medium text-brand">Ver respaldo de cumplimiento</summary><p className="mt-2 whitespace-pre-wrap">{event.respaldo}</p></details>}
      </li>)}</ol> : <Empty title="Sin gestiones ni cambios registrados" text="Los eventos aparecerán aquí cuando se registren actuaciones o cambios de gestión en las garantías." />}
    </Card>
    <p className="text-xs text-muted">Este historial contiene los eventos de gestión guardados. Las importaciones no cuentan con un historial detallado de cambios. Los datos del paciente y la garantía corresponden a su información actual.</p>
  </section>
}
