import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, Bot, CheckCircle2, ChevronLeft, ChevronRight, FileSpreadsheet, FileX, Loader2, Mail, Plus, UploadCloud, X, Eye } from 'lucide-react'
import { STATUS, STATUS_ORDER, type Status } from '../data'
import { CONTEOS } from '../data/mockData'
import { IMPORTS, NOTIFS, RESPONSABLES, USUARIOS, GARANTIAS_DATA } from '../data/mockData'
import type { Nav } from './pages1'
import { getImportHistory, importFile, validateImportFile, type ImportHistoryItem, type ImportPagination, type ImportResult, type ImportValidationResult } from '../services/importaciones'
import { Btn, Card, CardHeader, Check2, StatusBadge, Th, cx, inputCls, tdCls } from '../ui'

type Toast = (m: string) => void

/* ---------------- IMPORTAR ---------------- */
type Step = 'idle' | 'selected' | 'validating' | 'result' | 'importing' | 'done'

export function Importar({ nav, toast }: { nav: Nav; toast: Toast }) {
  const [step, setStep] = useState<Step>('idle')
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<ImportValidationResult | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [over, setOver] = useState(false)
  const [bad, setBad] = useState<string | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const importLock = useRef(false)

  const pick = (selected?: File | null) => {
    if (!selected) return
    if (!selected.name.toLowerCase().endsWith('.xlsx')) { setBad('Solo se permiten archivos .xlsx.'); return }
    if (selected.size > 10 * 1024 * 1024) { setBad('El archivo supera el límite de 10 MB.'); return }
    setBad(null)
    setRequestError(null)
    setResult(null)
    setImportResult(null)
    setFile(selected)
    setStep('selected')
  }
  const validate = async () => {
    if (!file) return
    setRequestError(null)
    setStep('validating')
    try {
      const validation = await validateImportFile(file)
      setResult(validation)
      setStep('result')
      toast('Validación completada. Revisa las filas antes de confirmar.')
    } catch (cause) {
      setStep('selected')
      setRequestError(cause instanceof Error ? cause.message : 'No fue posible validar el archivo.')
    }
  }
  const confirmImport = async () => {
    if (!file || importLock.current) return
    importLock.current = true
    setRequestError(null)
    setStep('importing')
    try {
      const persisted = await importFile(file)
      setImportResult(persisted)
      setStep('done')
      toast('El resultado de la importación fue guardado.')
    } catch (cause) {
      setStep('result')
      setRequestError(cause instanceof Error ? cause.message : 'No fue posible completar la importación.')
    } finally {
      importLock.current = false
    }
  }
  const reset = () => {
    setStep('idle')
    setBad(null)
    setRequestError(null)
    setResult(null)
    setImportResult(null)
    setFile(null)
    if (input.current) input.current.value = ''
  }
  const stepIdx = { idle: 0, selected: 1, validating: 1, result: 2, importing: 3, done: 3 }[step]
  const steps = ['Seleccionar archivo', 'Validar', 'Revisar resultado', 'Confirmar']
  const sizeLabel = file ? `${Math.max(1, Math.round(file.size / 1024))} KB` : ''

  return (
    <div className="page-in mx-auto max-w-4xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Importar nómina de garantías</h2>
        <p className="mt-1 text-sm text-muted">Seleccione, valide y revise el Excel antes de confirmar sus cambios en PostgreSQL.</p>
      </div>
      <ol className="flex items-center gap-2">
        {steps.map((label, index) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span className={cx('grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold', index < stepIdx ? 'bg-[#3c9a67] text-white' : index === stepIdx ? 'bg-brand text-white' : 'bg-[#e4e8ee] text-muted')}>{index < stepIdx ? '✓' : index + 1}</span>
            <span className={cx('text-sm', index === stepIdx ? 'font-semibold' : 'text-muted')}>{label}</span>
            {index < steps.length - 1 && <span className="h-px flex-1 bg-line" />}
          </li>
        ))}
      </ol>
      <div className="flex items-start gap-3 rounded-xl border border-[#efdc9a] bg-[#fffbec] px-4 py-3.5 text-sm text-[#6b4f06]">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <p><strong>Importante:</strong> La <strong>Fecha Límite</strong> es la fuente de verdad para calcular el estado. La columna de días restantes del Excel no determina el estado.</p>
      </div>

      {(step === 'idle' || step === 'selected' || step === 'validating') && (
        <Card className="p-6">
          {step === 'idle' ? (
            <div onDragOver={(event) => { event.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
              onDrop={(event) => { event.preventDefault(); setOver(false); pick(event.dataTransfer.files[0]) }}
              className={cx('flex flex-col items-center rounded-xl border-2 border-dashed px-8 py-16 text-center transition', over ? 'border-brand bg-brand-soft' : bad ? 'border-[#cc4339] bg-[#fff7f6]' : 'border-[#c4ccd8] bg-[#fafbfc]')}>
              <div className={cx('grid size-16 place-items-center rounded-full', bad ? 'bg-[#fbe7e5] text-[#a12a22]' : 'bg-brand-soft text-brand')}>{bad ? <FileX className="size-8" /> : <UploadCloud className="size-8" />}</div>
              <p className="mt-5 text-lg font-semibold">Arrastra aquí el archivo Excel</p><p className="my-2 text-sm text-muted">o</p>
              <Btn variant="primary" onClick={() => input.current?.click()}>Seleccionar archivo</Btn>
              <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(event) => pick(event.target.files?.[0])} />
              <p className="mt-5 text-xs text-muted">Formato permitido: <span className="rounded bg-white px-1.5 py-0.5 font-mono ring-1 ring-line">.xlsx</span> · Tamaño máximo 10 MB</p>
              {bad && <p role="alert" className="mt-3 text-sm font-medium text-[#a12a22]">{bad}</p>}
            </div>
          ) : <>
            <CardHeader title="Archivo seleccionado" />
            <div className="flex items-center gap-4 p-5">
              <span className="grid size-12 place-items-center rounded-lg bg-[#e6f4ec] text-[#256b45]"><FileSpreadsheet className="size-6" /></span>
              <div className="min-w-0 flex-1"><p className="text-xs uppercase tracking-wider text-muted">Archivo</p><p className="truncate font-mono text-sm font-medium">{file?.name}</p></div>
              <div><p className="text-xs uppercase tracking-wider text-muted">Tamaño</p><p className="text-sm font-medium">{sizeLabel}</p></div>
            </div>
            {requestError && <p role="alert" className="mx-5 mb-4 rounded-lg bg-[#fbe7e5] px-4 py-3 text-sm text-[#a12a22]">{requestError}</p>}
            <div className="flex justify-between border-t border-line p-4">
              <Btn onClick={reset} disabled={step === 'validating'}>Cambiar archivo</Btn>
              <Btn variant="primary" onClick={validate} disabled={step === 'validating'}>{step === 'validating' ? <><Loader2 className="size-4 animate-spin" />Validando archivo…</> : 'Validar archivo'}</Btn>
            </div>
          </>}
        </Card>
      )}

      {(step === 'result' || step === 'importing') && result && (
        <Card>
          <CardHeader title="Resultado de la validación" sub={result.nombreArchivo} />
          <div className="grid grid-cols-1 gap-3 border-b border-line p-5 sm:grid-cols-3">
            <div><p className="text-xs uppercase tracking-wider text-muted">Filas leídas</p><p className="tnum mt-1 text-2xl font-semibold">{result.filasLeidas}</p></div>
            <div><p className="text-xs uppercase tracking-wider text-muted">Filas válidas</p><p className="tnum mt-1 text-2xl font-semibold text-[#256b45]">{result.filasValidas}</p></div>
            <div><p className="text-xs uppercase tracking-wider text-muted">Filas con errores</p><p className="tnum mt-1 text-2xl font-semibold text-[#a12a22]">{result.filasConErrores}</p></div>
          </div>
          {requestError && <p role="alert" className="mx-5 mt-4 rounded-lg bg-[#fbe7e5] px-4 py-3 text-sm text-[#a12a22]">{requestError}</p>}
          {result.errores.length > 0 && <div className="mx-5 mt-5 rounded-lg bg-[#fff5ec] px-4 py-3 text-sm text-[#7a3d0d"><p className="font-medium">Errores de validación</p><ul className="mt-2 space-y-1">{result.errores.map((error, index) => <li key={`${error.numeroFila}-${error.codigo}-${index}`}>Fila {error.numeroFila}{error.campo ? ` · ${error.campo}` : ''}: {error.mensaje}</li>)}</ul></div>}
          <div className="overflow-x-auto p-5">
            <p className="mb-3 text-sm font-medium">Vista previa de filas válidas (máximo 10)</p>
            {result.vistaPrevia.length ? <table className="w-full"><thead><tr><Th>RUT</Th><Th>Nombre</Th><Th>Problema de salud</Th><Th>Garantía</Th><Th>Fecha límite</Th></tr></thead>
              <tbody className="divide-y divide-line">{result.vistaPrevia.map((row) => <tr key={row.numeroFila}><td className={cx(tdCls, 'font-mono text-[13px]')}>{row.rut}-{row.dv}</td><td className={tdCls}>{row.nombre}</td><td className={tdCls}>{row.problemaSalud}</td><td className={tdCls}>{row.nombreGarantia}</td><td className={cx(tdCls, 'tnum')}>{new Date(`${row.fechaLimite}T00:00:00`).toLocaleDateString('es-CL')}</td></tr>)}</tbody></table> : <p className="rounded-lg bg-canvas px-4 py-3 text-sm text-muted">No hay filas válidas para mostrar.</p>}
          </div>
          <div className="mx-5 mb-5 rounded-lg border border-[#efdc9a] bg-[#fffbec] px-4 py-3 text-sm text-[#6b4f06]">
            <p className="font-medium">Al confirmar, el backend volverá a validar el archivo y guardará solo las filas válidas.</p>
            <p className="mt-1 text-xs">Las filas con errores o coincidencias ambiguas se registrarán en el informe y no se aplicarán.</p>
          </div>
          <div className="flex justify-between border-t border-line p-4">
            <Btn onClick={reset} disabled={step === 'importing'}>Cancelar</Btn>
            <Btn variant="primary" onClick={confirmImport} disabled={step === 'importing'}>{step === 'importing' ? <><Loader2 className="size-4 animate-spin" />Importando…</> : 'Confirmar e importar'}</Btn>
          </div>
        </Card>
      )}

      {step === 'done' && importResult && (
        <Card className="p-10 text-center">
          <div className={cx('mx-auto grid size-16 place-items-center rounded-full', importResult.estado === 'FALLIDA' ? 'bg-[#fbe7e5] text-[#a12a22]' : 'bg-[#e6f4ec] text-[#3c9a67]')}><CheckCircle2 className="size-9" /></div>
          <h3 className="mt-4 text-xl font-semibold">{importResult.estado === 'COMPLETADA' ? 'Importación completada' : importResult.estado === 'COMPLETADA_CON_OBSERVACIONES' ? 'Importación completada con observaciones' : 'Importación fallida'}</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">{importResult.nombreArchivo} · {importResult.filasLeidas} filas leídas.</p>
          <ul className="mx-auto mt-5 max-w-sm space-y-2 text-left text-sm">
            <li className="flex justify-between"><span>Registros nuevos</span><strong>{importResult.registrosNuevos}</strong></li>
            <li className="flex justify-between"><span>Registros actualizados</span><strong>{importResult.registrosActualizados}</strong></li>
            <li className="flex justify-between"><span>Sin cambios</span><strong>{importResult.registrosSinCambios}</strong></li>
            <li className="flex justify-between"><span>Con errores</span><strong>{importResult.registrosConError}</strong></li>
          </ul>
          {importResult.errores.length > 0 && <div className="mx-auto mt-5 max-w-xl rounded-lg bg-[#fff5ec] px-4 py-3 text-left text-sm text-[#7a3d0d]"><p className="font-medium">Filas omitidas</p><ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">{importResult.errores.map((error, index) => <li key={`${error.numeroFila}-${error.codigo}-${index}`}>Fila {error.numeroFila}{error.campo ? ` · ${error.campo}` : ''}: {error.mensaje}</li>)}</ul></div>}
          <div className="mt-6 flex justify-center gap-3"><Btn onClick={() => nav('historial')}>Ver historial</Btn><Btn variant="primary" onClick={() => nav('dashboard')}>Ir al Dashboard</Btn></div>
        </Card>
      )}
    </div>
  )
}
/* ---------------- HISTORIAL ---------------- */
export function Historial() {
  const [rows, setRows] = useState<ImportHistoryItem[]>([])
  const [pagination, setPagination] = useState<ImportPagination>({ page: 1, limit: 25, total: 0, totalPages: 0 })
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<ImportHistoryItem | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    getImportHistory(page, 25, controller.signal)
      .then((result) => { setRows(result.data); setPagination(result.pagination) })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'No fue posible cargar el historial.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [page])

  const badge = (status: ImportHistoryItem['estado']) => status === 'COMPLETADA' ? 'bg-[#e6f4ec] text-[#256b45] ring-[#bfe1cd]' : status === 'FALLIDA' ? 'bg-[#fbe7e5] text-[#a12a22] ring-[#f1b9b4]' : 'bg-[#fcf4d9] text-[#7d5c07] ring-[#efdc9a]'
  const statusLabel = (status: ImportHistoryItem['estado']) => status === 'COMPLETADA' ? 'Completada' : status === 'FALLIDA' ? 'Fallida' : 'Con observaciones'
  const formatDate = (value: string) => new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))

  return (
    <div className="page-in space-y-5">
      <div><h2 className="text-2xl font-semibold">Historial de importaciones</h2><p className="mt-1 text-sm text-muted">Registro de importaciones guardadas en PostgreSQL.</p></div>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto"><table className="w-full">
          <thead><tr><Th>Fecha</Th><Th>Usuario</Th><Th>Archivo</Th><Th className="text-right">Registros</Th><Th className="text-right">Nuevos</Th><Th className="text-right">Actualizados</Th><Th className="text-right">Errores</Th><Th>Estado</Th><Th /></tr></thead>
          <tbody className="divide-y divide-line">
            {loading ? <tr><td colSpan={9} className={`${tdCls} py-8 text-center text-muted`}>Cargando historial…</td></tr> : error ? <tr><td colSpan={9} className={`${tdCls} py-8 text-center text-[#a12a22]`}>{error}</td></tr> : rows.length === 0 ? <tr><td colSpan={9} className={`${tdCls} py-8 text-center text-muted`}>Todavía no hay importaciones guardadas.</td></tr> : rows.map((row) => (
              <tr key={row.id} className="hover:bg-canvas">
                <td className={cx(tdCls, 'tnum')}>{formatDate(row.fechaImportacion)}</td><td className={tdCls}>—</td><td className={cx(tdCls, 'font-mono text-[13px]')}>{row.nombreArchivo}</td>
                <td className={cx(tdCls, 'tnum text-right')}>{row.filasLeidas}</td><td className={cx(tdCls, 'tnum text-right')}>{row.registrosNuevos}</td><td className={cx(tdCls, 'tnum text-right')}>{row.registrosActualizados}</td>
                <td className={cx(tdCls, 'tnum text-right', row.registrosConError > 0 && 'font-semibold text-[#a12a22]')}>{row.registrosConError}</td>
                <td className={tdCls}><span className={cx('rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', badge(row.estado))}>{statusLabel(row.estado)}</span></td>
                <td className={cx(tdCls, 'text-right')}><Btn variant="ghost" onClick={() => setOpen(row)} className="!py-1"><Eye className="size-4" />Ver detalle</Btn></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {!loading && !error && pagination.totalPages > 1 && <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm">
          <span className="text-muted">Página {pagination.page} de {pagination.totalPages} · {pagination.total} importaciones</span>
          <div className="flex gap-2"><Btn onClick={() => setPage((value) => value - 1)} disabled={page <= 1} className="!px-2 !py-1.5"><ChevronLeft className="size-4" /></Btn><Btn onClick={() => setPage((value) => value + 1)} disabled={page >= pagination.totalPages} className="!px-2 !py-1.5"><ChevronRight className="size-4" /></Btn></div>
        </div>}
      </Card>
      {open && <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-6" onClick={() => setOpen(null)}>
        <Card className="w-full max-w-lg"><div onClick={(event) => event.stopPropagation()}>
          <CardHeader title="Detalle de importación" sub={open.nombreArchivo} right={<button onClick={() => setOpen(null)}><X className="size-5 text-muted" /></button>} />
          <dl className="grid grid-cols-2 gap-4 p-5 text-sm">
            {[["Fecha", formatDate(open.fechaImportacion)], ["Usuario", "—"], ["Filas leídas", open.filasLeidas], ["Nuevos", open.registrosNuevos], ["Actualizados", open.registrosActualizados], ["Sin cambios", open.registrosSinCambios], ["Errores", open.registrosConError], ["Estado", statusLabel(open.estado)]].map(([label, value]) => <div key={String(label)}><dt className="text-xs uppercase tracking-wider text-muted">{label}</dt><dd className="mt-0.5 font-medium">{value}</dd></div>)}
          </dl>
          <div className="flex justify-end border-t border-line p-4"><Btn variant="primary" onClick={() => setOpen(null)}>Cerrar</Btn></div>
          </div></Card>
      </div>}
    </div>
  )
}
/* ---------------- ALERTAS ---------------- */
function NotifBadge({ s }: { s: string }) {
  const c = s === 'Enviado' ? 'bg-[#e6f4ec] text-[#256b45] ring-[#bfe1cd]' : s === 'Pendiente' ? 'bg-[#fcf4d9] text-[#7d5c07] ring-[#efdc9a]' : 'bg-[#fbe7e5] text-[#a12a22] ring-[#f1b9b4]'
  return <span className={cx('rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', c)}>{s}</span>
}

export function Alertas({ initialTab, toast }: { initialTab?: string; toast: Toast }) {
  const [tab, setTab] = useState(initialTab ?? 'config')
  const [days, setDays] = useState([true, true, true, true, true, false])
  const [resumen, setResumen] = useState(true)
  const [ind, setInd] = useState(true)
  const [filtro, setFiltro] = useState('Todos')
  const labels = ['30 días antes', '15 días antes', '7 días antes', '1 día antes', 'Día de vencimiento', '1 día después del vencimiento']
  const rows = NOTIFS.filter((n) => filtro === 'Todos' || n.estado === filtro)
  const tabs = [['config', 'Configuración de alertas'], ['bandeja', 'Bandeja de notificaciones'], ['monitoreo', 'Monitoreo automático']]

  return (
    <div className="page-in space-y-5">
      <div><h2 className="text-2xl font-semibold">Sistema de alertas</h2></div>
      <Card className="grid grid-cols-4 divide-x divide-line">
        <div className="flex items-center gap-3 p-5"><span className="relative flex size-3"><span className="absolute inline-flex size-full animate-ping rounded-full bg-[#3c9a67] opacity-50" /><span className="relative inline-flex size-3 rounded-full bg-[#3c9a67]" /></span><div><p className="font-semibold text-[#256b45]">Sistema automático activo</p><p className="text-xs text-muted">Funciona sin sesión abierta</p></div></div>
        {[['Última revisión', '06/10/2026 08:00'], ['Próxima revisión', '07/10/2026 08:00'], ['Correos enviados hoy', '14']].map(([k, v]) => <div key={k} className="p-5"><p className="text-xs uppercase tracking-wider text-muted">{k}</p><p className="tnum mt-1 text-lg font-semibold">{v}</p></div>)}
      </Card>

      <div className="flex gap-1 border-b border-line">
        {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={cx('-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition', tab === k ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink')}>{l}</button>)}
      </div>

      {tab === 'config' && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader title="Configuración de alertas" sub="Momentos en que se notifica al responsable" />
            <div className="space-y-3.5 p-5">{labels.map((l, i) => <Check2 key={l} label={l} checked={days[i]} onChange={(v) => setDays(days.map((d, j) => (j === i ? v : d)))} />)}</div>
            <div className="border-t border-line p-5">
              <p className="mb-2 text-sm font-medium">Frecuencia de revisión</p>
              <select className={cx(inputCls, 'max-w-xs')} defaultValue="1"><option value="1">Una vez al día — 08:00</option><option>Dos veces al día — 08:00 y 15:00</option></select>
            </div>
          </Card>
          <div className="space-y-5">
            <Card>
              <CardHeader title="Tipo de notificación" />
              <div className="space-y-3.5 p-5"><Check2 checked={resumen} onChange={setResumen} label="Resumen diario" /><Check2 checked={ind} onChange={setInd} label="Alertas individuales para casos críticos" /></div>
            </Card>
            <div className="flex justify-end"><Btn variant="primary" onClick={() => toast('Configuración de alertas guardada')}>Guardar cambios</Btn></div>
          </div>
        </div>
      )}

      {tab === 'bandeja' && (
        <Card className="overflow-hidden">
          <CardHeader title="Bandeja de notificaciones" sub="Historial de correos y alertas emitidas"
            right={<div className="flex gap-1.5">{['Todos', 'Enviado', 'Pendiente', 'Error'].map((f) => <button key={f} onClick={() => setFiltro(f)} className={cx('rounded-full border px-3 py-1 text-sm', filtro === f ? 'border-brand/40 bg-brand-soft font-medium text-brand-dark' : 'border-line text-muted hover:bg-canvas')}>{f}</button>)}</div>} />
          <table className="w-full"><thead><tr><Th>Fecha</Th><Th>Garantía</Th><Th>Paciente</Th><Th>Tipo de alerta</Th><Th>Destinatario</Th><Th>Canal</Th><Th>Estado</Th></tr></thead>
            <tbody className="divide-y divide-line">{rows.map((n, i) => (
              <tr key={i} className="hover:bg-canvas"><td className={cx(tdCls, 'tnum')}>{n.fecha}</td><td className={tdCls}>{n.garantia}</td><td className={tdCls}>{n.paciente}</td><td className={tdCls}>{n.tipo}</td><td className={cx(tdCls, 'font-mono text-[13px]')}>{n.dest}</td>
                <td className={tdCls}><span className="inline-flex items-center gap-1.5"><Mail className="size-3.5 text-muted" />{n.canal}</span></td><td className={tdCls}><NotifBadge s={n.estado} /></td></tr>))}
            </tbody></table>
        </Card>
      )}

      {tab === 'monitoreo' && <Monitoreo />}
    </div>
  )
}

function Monitoreo() {
  const flow = ['Nueva fecha límite', 'Cálculo automático de días restantes', 'Actualización del estado', 'Evaluación de alertas', 'Envío de correo', 'Registro de notificación']
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_1fr]">
      <Card>
        <CardHeader title="Monitoreo automático" right={<span className="inline-flex items-center gap-1.5 rounded-full bg-[#e6f4ec] px-3 py-1 text-sm font-medium text-[#256b45]"><span className="size-2 rounded-full bg-[#3c9a67]" />Activo</span>} />
        <div className="p-5">
          <p className="mb-5 text-sm text-muted">El sistema ejecuta este flujo todos los días, aunque nadie tenga la aplicación abierta.</p>
          <ol>
            {flow.map((f, i) => (
              <li key={f}>
                <div className="flex items-center gap-3 rounded-lg border border-line bg-[#fafbfc] px-4 py-2.5"><span className="grid size-6 place-items-center rounded-full bg-brand text-xs font-semibold text-white">{i + 1}</span><span className="text-sm font-medium">{f}</span></div>
                {i < flow.length - 1 && <div className="flex justify-center py-1 text-[#98a2b3]"><ArrowDown className="size-4" /></div>}
              </li>
            ))}
          </ol>
        </div>
      </Card>
      <Card className="self-start">
        <CardHeader title="Ejemplo de ejecución" sub="Garantía de Juan Pérez" />
        <dl className="divide-y divide-line text-sm">
          {[['Fecha límite', '15/10/2026'], ['Hoy', '08/10/2026'], ['Días restantes', '7']].map(([k, v]) => <div key={k} className="flex justify-between px-5 py-3"><dt className="text-muted">{k}</dt><dd className="tnum font-semibold">{v}</dd></div>)}
          <div className="flex items-center justify-between px-5 py-3"><dt className="text-muted">Estado</dt><dd><StatusBadge s="critica" /></dd></div>
          <div className="flex items-center justify-between px-5 py-3"><dt className="text-muted">Alerta</dt><dd className="inline-flex items-center gap-1.5 font-medium text-[#256b45]"><CheckCircle2 className="size-4" />Correo enviado automáticamente</dd></div>
        </dl>
        <div className="m-5 flex items-start gap-2.5 rounded-lg bg-brand-soft px-4 py-3 text-sm text-brand-dark"><Bot className="mt-0.5 size-4 shrink-0" />Sistema revisó automáticamente las garantías hoy a las 08:00.</div>
      </Card>
    </div>
  )
}

/* ---------------- ESTADÍSTICAS ---------------- */
function Donut() {
  const total = STATUS_ORDER.reduce((a, s) => a + CONTEOS[s], 0)
  let acc = 0
  const R = 70, C = 2 * Math.PI * R
  return (
    <div className="flex items-center gap-8 p-6">
      <svg viewBox="0 0 180 180" className="size-44 shrink-0 -rotate-90">
        {STATUS_ORDER.map((s) => { const len = (CONTEOS[s] / total) * C; const el = <circle key={s} cx="90" cy="90" r={R} fill="none" stroke={STATUS[s].hex} strokeWidth="26" strokeDasharray={`${len - 1.5} ${C - len + 1.5}`} strokeDashoffset={-acc} />; acc += len; return el })}
        <text x="90" y="90" transform="rotate(90 90 90)" textAnchor="middle" className="fill-ink text-[28px] font-semibold">{total}</text>
        <text x="90" y="108" transform="rotate(90 90 90)" textAnchor="middle" className="fill-muted text-[10px]">garantías</text>
      </svg>
      <ul className="flex-1 space-y-2.5">{STATUS_ORDER.map((s) => <li key={s} className="flex items-center gap-2.5 text-sm"><span className={cx('size-2.5 rounded-sm', STATUS[s].dot)} /><span className="flex-1">{STATUS[s].label}</span><span className="tnum font-semibold">{CONTEOS[s]}</span><span className="tnum w-12 text-right text-muted">{((CONTEOS[s] / total) * 100).toFixed(1)}%</span></li>)}</ul>
    </div>
  )
}

function HBars() {
  const data = RESPONSABLES.map((r) => ({ r, n: GARANTIAS_DATA.filter((g) => g.responsable === r).length * 5 + 3 })).sort((a, b) => b.n - a.n)
  const max = Math.max(...data.map((d) => d.n))
  return <ul className="space-y-3.5 p-6">{data.map((d) => <li key={d.r} className="flex items-center gap-3 text-sm"><span className="w-28 shrink-0">{d.r}</span><div className="h-5 flex-1 rounded bg-[#eef1f5]"><div className="h-full rounded bg-brand" style={{ width: `${(d.n / max) * 100}%` }} /></div><span className="tnum w-8 text-right font-semibold">{d.n}</span></li>)}</ul>
}

const NEXT30 = [0, 1, 2, 1, 1, 0, 0, 2, 1, 0, 1, 1, 2, 3, 1, 0, 0, 1, 1, 2, 2, 1, 0, 0, 3, 2, 1, 1, 2, 1].map((n, i) => ({ n, d: i + 1 }))
function DayBars() {
  const max = 4
  return (
    <div className="p-6">
      <div className="flex h-44 items-end gap-1 border-b border-line">
        {NEXT30.map((x) => (
          <div key={x.d} className="group relative flex flex-1 flex-col justify-end" title={`Día ${x.d}: ${x.n}`}>
            <div className="rounded-t" style={{ height: `${(x.n / max) * 100}%`, background: STATUS[x.d <= 7 ? 'critica' : x.d <= 15 ? 'proxima' : 'atencion'].hex, minHeight: x.n ? 3 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted tnum"><span>Hoy</span><span>+7</span><span>+15</span><span>+30 días</span></div>
      <div className="mt-3 flex gap-4 text-xs text-muted">{(['critica', 'proxima', 'atencion'] as Status[]).map((s) => <span key={s} className="inline-flex items-center gap-1.5"><span className={cx('size-2 rounded-sm', STATUS[s].dot)} />{STATUS[s].short}</span>)}</div>
    </div>
  )
}

const MESES = ['Nov', 'Dic', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct']
const EVO = [168, 175, 181, 176, 190, 198, 194, 205, 211, 207, 214, 215]
function Line() {
  const W = 520, H = 170, p = 28, min = 150, max = 230
  const pts = EVO.map((v, i) => [p + (i * (W - p * 2)) / 11, H - 24 - ((v - min) / (max - min)) * (H - 44)])
  const d = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0]},${q[1]}`).join(' ')
  return (
    <div className="p-4">
      <svg viewBox={`0 0 ${W} ${H + 10}`} className="w-full">
        {[150, 190, 230].map((v) => { const y = H - 24 - ((v - min) / (max - min)) * (H - 44); return <g key={v}><line x1={p} x2={W - p} y1={y} y2={y} stroke="#e3e7ee" /><text x={p - 6} y={y + 3} textAnchor="end" className="fill-muted text-[9px]">{v}</text></g> })}
        <path d={`${d} L${pts[11][0]},${H - 24} L${pts[0][0]},${H - 24} Z`} fill="#1d4a73" opacity="0.08" />
        <path d={d} fill="none" stroke="#1d4a73" strokeWidth="2.2" strokeLinejoin="round" />
        {pts.map((q, i) => <g key={i}><circle cx={q[0]} cy={q[1]} r="3" fill="#fff" stroke="#1d4a73" strokeWidth="2" /><text x={q[0]} y={H} textAnchor="middle" className="fill-muted text-[9px]">{MESES[i]}</text></g>)}
      </svg>
    </div>
  )
}

export function Estadisticas() {
  const total = STATUS_ORDER.reduce((a, s) => a + CONTEOS[s], 0)
  const cards: [string, number, string][] = [['Total de garantías', total, 'border-t-brand'], ['Vigentes', total - CONTEOS.vencida, STATUS.normal.card], ['Próximas a vencer', CONTEOS.proxima, STATUS.proxima.card], ['Críticas', CONTEOS.critica, STATUS.critica.card], ['Vencidas', CONTEOS.vencida, STATUS.vencida.card]]
  return (
    <div className="page-in space-y-5">
      <div><h2 className="text-2xl font-semibold">Estadísticas</h2><p className="mt-1 text-sm text-muted">Indicadores generales al 06/10/2026.</p></div>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">{cards.map(([l, n, c]) => <Card key={l} className={cx('border-t-4 p-5', c)}><p className="text-sm text-muted">{l}</p><p className="tnum mt-2 text-3xl font-semibold">{n}</p></Card>)}</div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card><CardHeader title="Distribución por estado" /><Donut /></Card>
        <Card><CardHeader title="Garantías por responsable" /><HBars /></Card>
        <Card><CardHeader title="Vencimientos en los próximos 30 días" sub="Garantías que vencen cada día" /><DayBars /></Card>
        <Card><CardHeader title="Evolución mensual" sub="Garantías vigentes, últimos 12 meses" /><Line /></Card>
      </div>
    </div>
  )
}

/* ---------------- CONFIGURACIÓN ---------------- */
export function Configuracion({ toast }: { toast: Toast }) {
  const [cfg, setCfg] = useState<Record<Status, { min: string; max: string; color: string }>>({
    normal: { min: '31', max: '', color: STATUS.normal.hex }, atencion: { min: '16', max: '30', color: STATUS.atencion.hex },
    proxima: { min: '8', max: '15', color: STATUS.proxima.hex }, critica: { min: '0', max: '7', color: STATUS.critica.hex }, vencida: { min: '', max: '-1', color: STATUS.vencida.hex },
  })
  const [modal, setModal] = useState(false)
  const set = (s: Status, k: 'min' | 'max' | 'color', v: string) => setCfg({ ...cfg, [s]: { ...cfg[s], [k]: v } })
  const desc = (s: Status) => s === 'normal' ? 'Más de 30 días' : s === 'vencida' ? 'Menos de 0 días' : STATUS[s].range
  return (
    <div className="page-in space-y-6">
      <div><h2 className="text-2xl font-semibold">Configuración</h2></div>
      <Card>
        <CardHeader title="Estados" sub="Rangos de días restantes y color de cada estado" right={<Btn variant="primary" onClick={() => toast('Configuración de estados guardada')}>Guardar</Btn>} />
        <table className="w-full"><thead><tr><Th>Estado</Th><Th>Regla actual</Th><Th>Desde (días)</Th><Th>Hasta (días)</Th><Th>Color</Th></tr></thead>
          <tbody className="divide-y divide-line">{STATUS_ORDER.slice().reverse().map((s) => (
            <tr key={s}><td className={tdCls}><StatusBadge s={s} /></td><td className={cx(tdCls, 'text-muted')}>{desc(s)}</td>
              <td className={tdCls}><input className={cx(inputCls, 'w-24')} value={cfg[s].min} disabled={s === 'vencida'} placeholder="—" onChange={(e) => set(s, 'min', e.target.value)} /></td>
              <td className={tdCls}><input className={cx(inputCls, 'w-24')} value={cfg[s].max} disabled={s === 'normal'} placeholder="—" onChange={(e) => set(s, 'max', e.target.value)} /></td>
              <td className={tdCls}><label className="inline-flex cursor-pointer items-center gap-2.5"><input type="color" value={cfg[s].color} onChange={(e) => set(s, 'color', e.target.value)} className="size-9 cursor-pointer rounded-lg border border-line bg-white p-0.5" /><span className="font-mono text-xs uppercase text-muted">{cfg[s].color}</span></label></td></tr>))}
          </tbody></table>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader title="Usuarios" right={<Btn variant="primary" onClick={() => setModal(true)}><Plus className="size-4" />Agregar usuario</Btn>} />
        <table className="w-full"><thead><tr><Th>Nombre</Th><Th>Usuario</Th><Th>Rol</Th><Th>Estado</Th><Th>Último acceso</Th></tr></thead>
          <tbody className="divide-y divide-line">{USUARIOS.map((u) => <tr key={u[1]} className="hover:bg-canvas"><td className={cx(tdCls, 'font-medium')}>{u[0]}</td><td className={cx(tdCls, 'font-mono text-[13px]')}>{u[1]}</td><td className={tdCls}>{u[2]}</td>
            <td className={tdCls}><span className={cx('rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', u[3] === 'Activo' ? 'bg-[#e6f4ec] text-[#256b45] ring-[#bfe1cd]' : 'bg-[#e4e7ec] text-[#2c3542] ring-[#c5cad3]')}>{u[3]}</span></td><td className={cx(tdCls, 'tnum text-muted')}>{u[4]}</td></tr>)}</tbody></table>
      </Card>
      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-6" onClick={() => setModal(false)}>
          <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <Card>
              <CardHeader title="Agregar usuario" right={<button onClick={() => setModal(false)}><X className="size-5 text-muted" /></button>} />
              <div className="space-y-4 p-5">
                <label className="block text-sm font-medium">Nombre completo<input className={cx(inputCls, 'mt-1.5 font-normal')} /></label>
                <label className="block text-sm font-medium">Usuario<input className={cx(inputCls, 'mt-1.5 font-normal')} /></label>
                <label className="block text-sm font-medium">Rol<select className={cx(inputCls, 'mt-1.5 font-normal')}><option>Operador</option><option>Consulta</option><option>Administrador</option></select></label>
              </div>
              <div className="flex justify-end gap-2 border-t border-line p-4"><Btn onClick={() => setModal(false)}>Cancelar</Btn><Btn variant="primary" onClick={() => { setModal(false); toast('Usuario agregado (simulado)') }}>Agregar</Btn></div>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
