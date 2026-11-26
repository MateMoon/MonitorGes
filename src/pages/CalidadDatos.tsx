import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import type { UserRole } from '../services/usuarios'
import { ApiError } from '../services/api'
import { getPendingQualityRows, type PendingRowsResult } from '../services/calidad-datos'
import { canReviewDataQuality } from '../permissions'
import ReviewGuaranteeModal from '../components/calidad/ReviewGuaranteeModal'
import QualityDecisionHistory from '../components/calidad/QualityDecisionHistory'
import { Btn, Card, Empty } from '../ui'

const REASONS: Record<string, string> = {
  FECHA_INICIO_DISTINTA: 'Fecha de inicio diferente', MULTIPLES_COINCIDENCIAS_EXACTAS: 'Varias garantías coincidentes',
  FILAS_CONTRADICTORIAS: 'Datos contradictorios en la nómina', NOMBRE_PACIENTE_CONTRADICTORIO: 'Nombres diferentes en la nómina',
  FECHAS_DISTINTAS_EN_ARCHIVO: 'Fechas de inicio diferentes en la nómina',
}
export default function CalidadDatos({ role, onSessionExpired }: { role: UserRole; onSessionExpired: () => void }) {
  const [result, setResult] = useState<PendingRowsResult | null>(null), [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null), [page, setPage] = useState(1), [revision, setRevision] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const expired = useRef(onSessionExpired); expired.current = onSessionExpired
  const allowed = canReviewDataQuality(role)
  useEffect(() => {
    if (!allowed) return
    const controller = new AbortController()
    setLoading(true); setError(null)
    getPendingQualityRows(page, controller.signal).then(value => { if (!controller.signal.aborted) setResult(value) }).catch(cause => {
      if (controller.signal.aborted) return
      if (cause instanceof ApiError && cause.code === 'UNAUTHENTICATED') expired.current()
      setError(cause instanceof Error ? cause.message : 'No fue posible cargar las filas pendientes.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [allowed, page, revision])
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  if (!allowed) return <p role="alert" className="text-sm text-muted">No tienes permiso para acceder a Calidad de datos.</p>
  return <div className="page-in mx-auto max-w-5xl space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-2xl font-semibold">Calidad de datos</h2><p className="mt-1 text-sm text-muted">Filas de importación que necesitan revisión antes de incorporarse como garantías.</p></div>
      {result && !error && <span className="rounded-full bg-brand-soft px-3 py-1.5 text-sm font-medium text-brand" role="status">{result.pendientesTotales} {result.pendientesTotales === 1 ? 'pendiente' : 'pendientes'}</span>}
    </div>
    <Card>
      {loading ? <p role="status" className="flex items-center justify-center gap-2 py-14 text-sm text-muted"><Loader2 className="size-4 animate-spin" />Cargando pendientes…</p>
        : error ? <div className="space-y-3 p-6"><p role="alert" className="text-sm text-[#a12a22]">{error}</p><Btn onClick={refresh}>Volver a intentar</Btn></div>
        : !result?.data.length ? <Empty title="No hay filas pendientes" text="Las filas que necesiten revisión aparecerán aquí después de una importación." />
        : <ul className="divide-y divide-line">{result.data.map(row => <li key={row.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0"><p className="break-words text-sm font-medium">{row.nombre}</p><p className="mt-0.5 break-words text-xs text-muted">{row.nombreGarantia} · {row.problemaSalud}</p></div>
          <div className="min-w-0 text-xs leading-5 text-muted"><p>{row.motivos.map(reason => REASONS[reason] ?? 'Requiere revisión').join(' · ')}</p><p>{row.hoja} · Fila {row.numeroFila}</p></div>
          <Btn aria-label={`Revisar fila ${row.numeroFila} de ${row.nombre}`} onClick={() => setSelectedId(row.id)} className="justify-self-start sm:justify-self-end">Revisar</Btn>
        </li>)}</ul>}
      {!loading && !error && result && result.pagination.totalPages > 1 && <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-xs text-muted">
        <span>Página {result.pagination.page} de {result.pagination.totalPages}</span><div className="flex gap-2"><Btn aria-label="Página anterior" disabled={result.pagination.page <= 1} onClick={() => setPage(result.pagination.page - 1)}><ChevronLeft className="size-4" /></Btn><Btn aria-label="Página siguiente" disabled={result.pagination.page >= result.pagination.totalPages} onClick={() => setPage(result.pagination.page + 1)}><ChevronRight className="size-4" /></Btn></div>
      </div>}
    </Card>
    <QualityDecisionHistory revision={revision} onSessionExpired={onSessionExpired} />
    {selectedId && <ReviewGuaranteeModal key={selectedId} rowId={selectedId} onClose={() => setSelectedId(null)} onResolved={refresh} onSessionExpired={onSessionExpired} />}
  </div>
}
