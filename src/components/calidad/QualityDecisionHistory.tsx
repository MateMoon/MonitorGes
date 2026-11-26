import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, ChevronDown, FileSpreadsheet, History, Loader2 } from 'lucide-react'
import { ApiError } from '../../services/api'
import { getQualityDecisions, type QualityDecisionHistory as DecisionHistory } from '../../services/calidad-datos'
import { MANAGEMENT } from '../../management'
import type { Nav } from '../../pages/pages1'
import { Btn, cx } from '../../ui'

const timestamp = (value: string) => new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Santiago' }).format(new Date(value))
const civilDate = (value: string) => value.split('-').reverse().join('/')

export default function QualityDecisionHistory({ revision, nav, onSessionExpired }: { revision: number; nav: Nav; onSessionExpired: () => void }) {
  const [expanded, setExpanded] = useState(false), [page, setPage] = useState(1), [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<DecisionHistory | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null)
  const expired = useRef(onSessionExpired); expired.current = onSessionExpired
  useEffect(() => {
    if (!expanded) return
    const controller = new AbortController()
    setLoading(true); setError(null)
    getQualityDecisions(page, controller.signal).then(value => { if (!controller.signal.aborted) setResult(value) }).catch(cause => {
      if (controller.signal.aborted) return
      if (cause instanceof ApiError && cause.code === 'UNAUTHENTICATED') expired.current()
      setError(cause instanceof Error ? cause.message : 'No fue posible cargar las decisiones.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [expanded, page, revision, attempt])
  return <details className="group min-w-0 overflow-hidden rounded-xl border border-line bg-white" onToggle={event => { if (event.target === event.currentTarget) setExpanded(event.currentTarget.open) }}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
      <span className="flex min-w-0 items-center gap-3"><History aria-hidden="true" className="size-5 shrink-0 text-muted" /><span><span className="block text-sm font-semibold">Historial de decisiones</span><span className="mt-0.5 block text-xs text-muted">Revisiones de importación registradas</span></span></span>
      <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
    </summary>
    {expanded && <div className="border-t border-line">
      {loading ? <p role="status" className="flex items-center gap-2 p-5 text-sm text-muted"><Loader2 className="size-4 animate-spin" />Cargando decisiones…</p>
        : error ? <div className="space-y-3 p-5"><p role="alert" className="text-sm text-[#a12a22]">{error}</p><Btn onClick={() => setAttempt(value => value + 1)}>Reintentar historial</Btn></div>
        : !result?.data.length ? <p className="p-5 text-sm text-muted">Todavía no hay decisiones registradas.</p>
        : <ol aria-label="Decisiones de calidad de datos" className="divide-y divide-line">{result.data.map(decision => <li key={decision.id} className="space-y-3 p-4 [overflow-wrap:anywhere] sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h4 className="font-semibold">Revisión de importación</h4><p className="mt-1 text-sm text-muted">{decision.usuario.nombre}</p></div><time className="text-xs text-muted" dateTime={decision.createdAt}>{timestamp(decision.createdAt)}</time></div>
          <div className="space-y-2">
            <span className="inline-flex rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand">{decision.actualizarDatos ? 'Datos actualizados · Gestión conservada' : decision.decision === 'MISMA' ? 'MISMA · Garantía conservada' : 'DISTINTA · Nueva garantía'}</span>
            <p className="text-sm">{decision.actualizarDatos ? 'Se actualizaron los datos de la garantía existente y se conservaron su estado, gestiones e historial.' : decision.decision === 'MISMA' ? 'Se conservó la garantía existente con sus datos, gestiones e historial.' : 'Se creó una nueva garantía sin modificar las anteriores.'}</p>
            <p className="flex items-start gap-1.5 text-xs text-muted"><FileSpreadsheet aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /><span>{[decision.origen.archivo, decision.origen.hoja, `Fila ${decision.origen.numeroFila}`].filter(Boolean).join(' · ')}</span></p>
          </div>
          <button type="button" onClick={() => nav('detalle', { id: decision.garantiaResultadoId })} aria-label={decision.garantia ? `Abrir garantía de ${decision.garantia.paciente.nombre}` : 'Abrir garantía de la revisión'} className="flex w-full min-w-0 items-start justify-between gap-3 rounded-lg border border-line bg-canvas px-3 py-2.5 text-left hover:border-brand/40 focus-visible:outline-2 focus-visible:outline-brand">
            {decision.garantia ? <span className="min-w-0">
              <span className="block text-sm font-semibold text-brand">{decision.garantia.paciente.nombre}</span>
              <span className="mt-1 block text-sm">{decision.garantia.problemaSalud} · {decision.garantia.nombreGarantia}</span>
              <span className="mt-1 block text-xs text-muted">{decision.garantia.establecimiento || 'Establecimiento sin información'}</span>
              <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted"><span>Inicio: {civilDate(decision.garantia.fechaInicio)}</span><span>Límite: {civilDate(decision.garantia.fechaLimite)}</span></span>
              <span className={cx('mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', MANAGEMENT[decision.garantia.estadoGestion].badge)}>Estado actual: {MANAGEMENT[decision.garantia.estadoGestion].label}</span>
            </span> : <span className="text-sm font-medium text-brand">Ver garantía {decision.decision === 'DISTINTA' ? 'creada' : 'conservada'}</span>}
            <ArrowUpRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
          </button>
          {decision.justificacion.length > 280 ? <details className="text-sm"><summary className="cursor-pointer font-medium text-brand">Ver justificación</summary><p className="mt-2 whitespace-pre-wrap">{decision.justificacion}</p></details> : <p className="whitespace-pre-wrap text-sm"><strong>Justificación: </strong>{decision.justificacion}</p>}
        </li>)}</ol>}
      {!loading && !error && result && result.pagination.totalPages > 1 && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3 text-xs text-muted"><span>Página {result.pagination.page} de {result.pagination.totalPages}</span><div className="flex gap-2"><Btn disabled={result.pagination.page <= 1} onClick={() => setPage(result.pagination.page - 1)}>Página anterior de decisiones</Btn><Btn disabled={result.pagination.page >= result.pagination.totalPages} onClick={() => setPage(result.pagination.page + 1)}>Más decisiones</Btn></div></div>}
      {!loading && !error && !!result?.data.some(decision => decision.garantia) && <p className="border-t border-line px-5 py-3 text-xs text-muted">Los datos y el estado de la garantía corresponden a su información actual.</p>}
    </div>}
  </details>
}
