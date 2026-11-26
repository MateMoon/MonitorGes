import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Loader2, X } from 'lucide-react'
import { ApiError } from '../../services/api'
import { getQualityReview, resolveQualityReview, type QualityDecision, type QualityResolution, type QualityReviewDetail, type ResolveQualityInput } from '../../services/calidad-datos'
import { MANAGEMENT } from '../../management'
import { Btn, cx, inputCls } from '../../ui'

const refreshCodes = new Set(['STALE_ROW', 'STALE_CANDIDATES', 'PERSISTENCE_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'INVALID_RETAINED_ROW'])
const formatDate = (date?: string) => date ? date.split('-').reverse().join('/') : '—'
function requestId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
function Field({ label, children, different = false }: { label: string; children: ReactNode; different?: boolean }) {
  return <div className="flex flex-wrap items-baseline gap-x-1 text-xs leading-5"><dt className="text-muted">{label}:</dt><dd className={cx('min-w-0 break-words font-medium', different && 'rounded bg-[#fff1d6] px-1.5 text-[#7a4a08] ring-1 ring-inset ring-[#edcf92]')}>
    {children}{different && <span className="sr-only"> · Valor diferente</span>}
  </dd></div>
}

export default function ReviewGuaranteeModal({ rowId, onClose, onResolved, onSessionExpired }: {
  rowId: string; onClose: () => void; onResolved: (resolution: QualityResolution) => void; onSessionExpired: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId(), subtitleId = useId(), justificationId = useId()
  const [detail, setDetail] = useState<QualityReviewDetail | null>(null)
  const [loading, setLoading] = useState(true), [revision, setRevision] = useState(0)
  const [error, setError] = useState<string | null>(null), [needsRefresh, setNeedsRefresh] = useState(false)
  const [decision, setDecision] = useState<QualityDecision | null>(null), [selectedId, setSelectedId] = useState('')
  const [justification, setJustification] = useState(''), [saving, setSaving] = useState(false)
  const [resolution, setResolution] = useState<QualityResolution | null>(null)
  const submitLock = useRef(false), attempt = useRef<{ signature: string; body: ResolveQualityInput } | null>(null)
  const resolvedCallback = useRef(onResolved), expiredCallback = useRef(onSessionExpired)
  resolvedCallback.current = onResolved; expiredCallback.current = onSessionExpired

  useEffect(() => {
    const element = dialog.current!, opener = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow
    element.showModal(); document.body.style.overflow = 'hidden'
    return () => { element.close(); document.body.style.overflow = overflow; if (opener?.isConnected) opener.focus() }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(null); setNeedsRefresh(false); setDecision(null); attempt.current = null
    getQualityReview(rowId, controller.signal).then(value => {
      if (controller.signal.aborted) return
      setDetail(value); setResolution(value.resolucion)
      setSelectedId(value.resolucion?.decision === 'MISMA' ? value.resolucion.garantiaResultadoId : value.candidatas.length === 1 ? value.candidatas[0].id : '')
      if (value.resolucion) resolvedCallback.current(value.resolucion)
    }).catch(cause => {
      if (controller.signal.aborted) return
      if (cause instanceof ApiError && cause.code === 'UNAUTHENTICATED') expiredCallback.current()
      setDetail(null); setError(cause instanceof Error ? cause.message : 'No fue posible cargar la garantía.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [rowId, revision])

  const candidate = detail?.candidatas.find(value => value.id === selectedId) ?? detail?.candidatas[0]
  const different = (field: 'fechaInicio' | 'fechaLimite' | 'responsable' | 'nombre') => candidate?.diferencias.includes(field) ?? false
  const selectedDecision = resolution ? resolution.actualizarDatos ? 'ACTUALIZAR' : resolution.decision : decision
  const updateFields = ['fechaInicio', 'fechaLimite', 'responsable', 'problemaSalud', 'nombreGarantia'] as const
  const hasSourceChanges = !!detail && !!candidate && updateFields.some(field => candidate.datos[field] !== detail.datosNomina[field])
  const valid = !!detail?.puedeResolver && !resolution && !!decision && justification.trim().length >= 5 && justification.trim().length <= 4000
    && (decision === 'DISTINTA' || !!selectedId) && (decision !== 'ACTUALIZAR' || (!!detail.puedeActualizarDatos && hasSourceChanges)) && !needsRefresh
  const locked = saving || !!resolution
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!valid || !detail || !decision || submitLock.current) return
    submitLock.current = true; setSaving(true); setError(null)
    const command = { version: detail.version, huellaRevision: detail.huellaRevision, justificacion: justification.trim(),
      ...(decision === 'DISTINTA' ? { decision: 'DISTINTA' as const, confirmaDistintaDeTodas: true as const }
        : { decision: 'MISMA' as const, garantiaExistenteId: selectedId, ...(decision === 'ACTUALIZAR' ? { actualizarDatos: true as const } : {}) }),
    }
    const signature = JSON.stringify(command)
    try {
      if (attempt.current?.signature !== signature) attempt.current = { signature, body: { ...command, solicitudId: requestId() } }
      const result = await resolveQualityReview(rowId, attempt.current.body)
      setResolution(result.resolucion); resolvedCallback.current(result.resolucion)
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'UNAUTHENTICATED') expiredCallback.current()
      setNeedsRefresh(cause instanceof ApiError && refreshCodes.has(cause.code ?? ''))
      setError(cause instanceof Error ? cause.message : 'No fue posible confirmar la decisión. Puedes reintentar.')
    } finally { submitLock.current = false; setSaving(false) }
  }

  return <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={subtitleId}
    onCancel={event => { event.preventDefault(); if (!saving) onClose() }}
    className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[620px] overflow-y-auto rounded-2xl border border-line bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/50 backdrop:backdrop-blur-[3px]">
    <header className="flex items-start justify-between gap-4 px-5 pb-3 pt-5 sm:px-6">
      <div><h2 id={titleId} className="text-base font-semibold">Revisar garantía</h2><p id={subtitleId} className="mt-0.5 text-xs text-muted">Posible coincidencia detectada</p></div>
      <button type="button" aria-label="Cerrar revisión" disabled={saving} onClick={onClose} className="-mr-1 -mt-1 rounded-lg p-1.5 text-muted hover:bg-canvas hover:text-ink focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-40"><X className="size-4" /></button>
    </header>
    {loading ? <div role="status" className="flex items-center justify-center gap-2 px-5 py-16 text-sm text-muted"><Loader2 className="size-4 animate-spin" />Cargando garantía…</div> : !detail ? <div className="space-y-4 px-5 pb-5 sm:px-6"><p role="alert" className="text-sm text-[#a12a22]">{error}</p><Btn onClick={() => setRevision(value => value + 1)}>Volver a intentar</Btn></div> :
      <form onSubmit={submit} className="space-y-3.5 px-5 pb-5 sm:px-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <section aria-label="Garantía existente" className="min-w-0 rounded-lg border border-line bg-canvas/35 p-3.5">
            <h3 className="text-[13px] font-semibold">Garantía existente</h3>
            <span className="mt-1.5 inline-flex rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-medium text-brand">{candidate ? 'Prioritaria' : 'Sin coincidencias'}</span>
            {detail.candidatas.length > 1 && <label className="mt-2 block text-xs text-muted">Garantía candidata
              <select aria-label="Garantía candidata" value={selectedId} disabled={locked} onChange={event => setSelectedId(event.target.value)} className={cx(inputCls, 'mt-1 !px-2 !py-1 !text-xs')}>
                <option value="">Seleccionar garantía…</option>
                {detail.candidatas.map((value, index) => <option key={value.id} value={value.id}>{index + 1}. Inicio {formatDate(value.datos.fechaInicio)} · {value.datos.responsable}</option>)}
              </select>
            </label>}
            {candidate ? <dl className="mt-2 space-y-0.5">
              <Field label="Inicio" different={different('fechaInicio')}>{formatDate(candidate.datos.fechaInicio)}</Field>
              <Field label="Límite" different={different('fechaLimite')}>{formatDate(candidate.datos.fechaLimite)}</Field>
              <Field label="Estado">{MANAGEMENT[candidate.estadoGestion].label}</Field>
              {different('responsable') && <Field label="Establecimiento" different>{candidate.datos.responsable}</Field>}
              {different('nombre') && <Field label="Nombre" different>{candidate.datos.nombreEnAplicacion}</Field>}
            </dl> : <p className="mt-2 text-xs leading-5 text-muted">No hay garantías existentes para comparar.</p>}
          </section>
          <section aria-label="Nueva nómina" className="min-w-0 rounded-lg border border-line bg-canvas/35 p-3.5">
            <h3 className="text-[13px] font-semibold">Nueva nómina</h3>
            <span className="mt-1.5 inline-flex rounded-full bg-[#fff1d6] px-2 py-0.5 text-[10px] font-medium text-[#7a4a08]">Por revisar</span>
            <dl className="mt-2 space-y-0.5">
              <Field label="Inicio" different={different('fechaInicio')}>{formatDate(detail.datosNomina.fechaInicio)}</Field>
              <Field label="Límite" different={different('fechaLimite')}>{formatDate(detail.datosNomina.fechaLimite)}</Field>
              <Field label="Estado">No informado</Field>
              {different('responsable') && <Field label="Establecimiento" different>{detail.datosNomina.responsable}</Field>}
              {different('nombre') && <Field label="Nombre" different>{detail.datosNomina.nombre}</Field>}
            </dl>
          </section>
        </div>
        <fieldset disabled={locked || !detail.puedeResolver} className="space-y-2">
          <legend className="mb-2 text-[13px] font-semibold">¿Qué corresponde hacer?</legend>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm"><input type="radio" name={`decision-${titleId}`} value="MISMA" checked={selectedDecision === 'MISMA'} onChange={() => setDecision('MISMA')} disabled={!detail.candidatas.length} className="size-4 accent-brand" />Es la misma garantía</label>
          {detail.puedeActualizarDatos && <label className="flex cursor-pointer items-center gap-2.5 text-sm"><input type="radio" name={`decision-${titleId}`} value="ACTUALIZAR" checked={selectedDecision === 'ACTUALIZAR'} onChange={() => setDecision('ACTUALIZAR')} disabled={!detail.candidatas.length} className="size-4 accent-brand" />Actualizar datos y conservar gestión</label>}
          <label className="flex cursor-pointer items-center gap-2.5 text-sm"><input type="radio" name={`decision-${titleId}`} value="DISTINTA" checked={selectedDecision === 'DISTINTA'} onChange={() => setDecision('DISTINTA')} className="size-4 accent-brand" />Es una garantía distinta</label>
        </fieldset>
        <div role={resolution ? 'status' : undefined} aria-live="polite" className="rounded-lg bg-brand-soft px-3 py-2.5 text-xs leading-5 text-brand">
          {resolution ? resolution.actualizarDatos ? 'Decisión registrada. Se actualizaron los datos de la garantía existente y se conservaron su estado, gestiones e historial.' : resolution.decision === 'MISMA' ? 'Decisión registrada. Se conservó la garantía existente con sus gestiones e historial.' : 'Decisión registrada. Se creó una nueva garantía sin modificar las anteriores.'
            : decision === 'MISMA' ? <>Se conserva la garantía existente con sus gestiones e historial. La nueva fila no crea otra garantía.{detail.candidatas.length > 1 && !selectedId && <span className="mt-1 block font-medium">Selecciona la garantía que corresponde.</span>}</>
            : decision === 'ACTUALIZAR' ? <>Se actualizarán las fechas, el establecimiento, el problema de salud y el nombre de la garantía con los datos de la nómina. Se conservan su identificador, los datos del paciente, el estado, las gestiones y el historial. No se crea otra garantía.
              {!selectedId && <span className="mt-1 block font-medium">Selecciona la garantía que corresponde.</span>}
              {!!selectedId && !hasSourceChanges && <span className="mt-1 block font-medium">La garantía ya tiene esos datos. Puedes conservarla con la opción Es la misma garantía.</span>}</>
            : decision === 'DISTINTA' ? 'Se creará una nueva garantía, distinta de todas las candidatas. Las garantías anteriores y sus gestiones se conservan.'
            : 'Selecciona una opción para revisar qué ocurrirá antes de confirmar.'}
        </div>
        <div><label htmlFor={justificationId} className="mb-1.5 block text-xs font-medium text-muted">Justificación</label>
          <textarea id={justificationId} value={resolution?.justificacion ?? justification} onChange={event => setJustification(event.target.value)} required minLength={5} maxLength={4000} disabled={locked || !detail.puedeResolver} rows={2} placeholder="Explique brevemente su decisión…" className={cx(inputCls, 'min-h-14 resize-y disabled:bg-canvas')} />
        </div>
        {error && <div role="alert" className="rounded-lg border border-[#f1b9b4] bg-[#fff5f4] px-3 py-2 text-xs leading-5 text-[#a12a22]"><p>{error}</p>{needsRefresh && <button type="button" onClick={() => setRevision(value => value + 1)} className="mt-1 font-semibold underline underline-offset-2">Actualizar datos</button>}</div>}
        <Btn type="submit" variant="primary" disabled={!valid || saving} className="w-full !rounded-full !py-2">
          {saving && <Loader2 className="size-4 animate-spin" />}{saving ? 'Confirmando…' : resolution ? 'Decisión registrada' : 'Confirmar decisión'}
        </Btn>
      </form>}
  </dialog>
}
