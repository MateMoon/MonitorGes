import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../services/api'
import { getQualityDecisions, type QualityDecisionHistory as DecisionHistory } from '../../services/calidad-datos'
import { Btn } from '../../ui'

const timestamp = (value: string) => new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Santiago' }).format(new Date(value))

export default function QualityDecisionHistory({ revision, onSessionExpired }: { revision: number; onSessionExpired: () => void }) {
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
  return <details className="rounded-xl border border-line bg-white" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-brand">Historial de decisiones</summary>
    {expanded && <div className="border-t border-line px-5 py-4">
      {loading ? <p role="status" className="text-sm text-muted">Cargando decisiones…</p>
        : error ? <div className="space-y-3"><p role="alert" className="text-sm text-[#a12a22]">{error}</p><Btn onClick={() => setAttempt(value => value + 1)}>Reintentar historial</Btn></div>
        : !result?.data.length ? <p className="text-sm text-muted">Todavía no hay decisiones registradas.</p>
        : <ol className="divide-y divide-line">{result.data.map(decision => <li key={decision.id} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{decision.actualizarDatos ? 'Datos actualizados · Gestión conservada' : decision.decision === 'MISMA' ? 'MISMA · Garantía conservada' : 'DISTINTA · Nueva garantía'}</span><time className="text-xs text-muted" dateTime={decision.createdAt}>{timestamp(decision.createdAt)}</time></div>
          <p className="break-words text-xs text-muted">{decision.usuario.nombre} · {decision.origen.hoja} · Fila {decision.origen.numeroFila}</p>
          <p className="whitespace-pre-wrap break-words text-sm">{decision.justificacion}</p>
        </li>)}</ol>}
      {!loading && !error && result && result.pagination.totalPages > 1 && <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><span>Página {result.pagination.page} de {result.pagination.totalPages}</span><div className="flex gap-2"><Btn disabled={result.pagination.page <= 1} onClick={() => setPage(result.pagination.page - 1)}>Página anterior de decisiones</Btn><Btn disabled={result.pagination.page >= result.pagination.totalPages} onClick={() => setPage(result.pagination.page + 1)}>Más decisiones</Btn></div></div>}
    </div>}
  </details>
}
