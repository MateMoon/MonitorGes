import { useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, Bot, CheckCircle2, FileSpreadsheet, FileX, Loader2, Mail, Plus, UploadCloud, X, Eye } from 'lucide-react'
import { STATUS, STATUS_ORDER, type Status } from '../data'
import { CONTEOS } from '../data/mockData'
import { IMPORTS, NOTIFS, RESPONSABLES, USUARIOS } from '../data/mockData'
import { getGarantias } from '../services/garantias'
const GARANTIAS_DATA = getGarantias()
import type { Nav } from './pages1'
import { Btn, Card, CardHeader, Check2, StatusBadge, Th, cx, inputCls, tdCls } from '../ui'

type Toast = (m: string) => void

/* ---------------- IMPORTAR ---------------- */
type Step = 'idle' | 'selected' | 'validating' | 'result' | 'importing' | 'done'

export function Importar({ nav, toast }: { nav: Nav; toast: Toast }) {
  const [step, setStep] = useState<Step>('idle')
  const [file, setFile] = useState({ name: 'Nomina_Garantias_06102026.xlsx', size: '184 KB' })
  const [over, setOver] = useState(false)
  const [bad, setBad] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const pick = (f?: File | null) => {
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.xlsx')) { setBad(f.name); return }
    setBad(null)
    setFile({ name: f.name, size: `${Math.max(1, Math.round(f.size / 1024))} KB` })
    setStep('selected')
  }
  const sample = () => { setBad(null); setFile({ name: 'Nomina_Garantias_06102026.xlsx', size: '184 KB' }); setStep('selected') }
  const validate = () => { setStep('validating'); setTimeout(() => setStep('result'), 1500) }
  const doImport = () => { setStep('importing'); setTimeout(() => { setStep('done'); toast('Nómina importada correctamente') }, 1500) }
  const reset = () => { setStep('idle'); setBad(null) }

  const stepIdx = { idle: 0, selected: 1, validating: 1, result: 2, importing: 2, done: 3 }[step]
  const steps = ['Seleccionar archivo', 'Validar', 'Revisar resultado', 'Importar']

  return (
    <div className="page-in mx-auto max-w-4xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Importar nómina de garantías</h2>
        <p className="mt-1 text-sm text-muted">Cargue el archivo Excel descargado desde FONASA GES para actualizar la base de garantías.</p>
      </div>

      <ol className="flex items-center gap-2">
        {steps.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-2">
            <span className={cx('grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold', i < stepIdx ? 'bg-[#3c9a67] text-white' : i === stepIdx ? 'bg-brand text-white' : 'bg-[#e4e8ee] text-muted')}>{i < stepIdx ? '✓' : i + 1}</span>
            <span className={cx('text-sm', i === stepIdx ? 'font-semibold' : 'text-muted')}>{s}</span>
            {i < 3 && <span className="h-px flex-1 bg-line" />}
          </li>
        ))}
      </ol>

      <div className="flex items-start gap-3 rounded-xl border border-[#efdc9a] bg-[#fffbec] px-4 py-3.5 text-sm text-[#6b4f06]">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <p><strong>Importante:</strong> La aplicación utiliza la <strong>Fecha Límite</strong> como referencia principal para determinar el estado de cada garantía.</p>
      </div>

      {step === 'idle' && (
        <Card className="p-6">
          <div onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]) }}
            className={cx('flex flex-col items-center rounded-xl border-2 border-dashed px-8 py-16 text-center transition', over ? 'border-brand bg-brand-soft' : bad ? 'border-[#cc4339] bg-[#fff7f6]' : 'border-[#c4ccd8] bg-[#fafbfc]')}>
            <div className={cx('grid size-16 place-items-center rounded-full', bad ? 'bg-[#fbe7e5] text-[#a12a22]' : 'bg-brand-soft text-brand')}>{bad ? <FileX className="size-8" /> : <UploadCloud className="size-8" />}</div>
            <p className="mt-5 text-lg font-semibold">Arrastra aquí el archivo Excel</p>
            <p className="my-2 text-sm text-muted">o</p>
            <Btn variant="primary" onClick={() => input.current?.click()}>Seleccionar archivo</Btn>
            <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            <p className="mt-5 text-xs text-muted">Formato permitido: <span className="rounded bg-white px-1.5 py-0.5 font-mono ring-1 ring-line">.xlsx</span> · Tamaño máximo 10 MB</p>
            {bad && <p role="alert" className="mt-3 text-sm font-medium text-[#a12a22]">«{bad}» no es un archivo .xlsx válido.</p>}
          </div>
          <p className="mt-4 text-center text-sm text-muted">¿Solo quiere ver la demo? <button onClick={sample} className="font-medium text-brand underline-offset-2 hover:underline">Usar archivo de ejemplo</button></p>
        </Card>
      )}

      {(step === 'selected' || step === 'validating') && (
        <Card>
          <CardHeader title="Vista previa del archivo" />
          <div className="flex items-center gap-4 p-5">
            <span className="grid size-12 place-items-center rounded-lg bg-[#e6f4ec] text-[#256b45]"><FileSpreadsheet className="size-6" /></span>
            <div className="flex-1"><p className="text-xs uppercase tracking-wider text-muted">Archivo</p><p className="font-mono text-sm font-medium">{file.name}</p></div>
            <div className="px-6"><p className="text-xs uppercase tracking-wider text-muted">Registros</p><p className="tnum text-xl font-semibold">253</p></div>
            <div><p className="text-xs uppercase tracking-wider text-muted">Tamaño</p><p className="text-sm font-medium">{file.size}</p></div>
          </div>
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full"><thead><tr><Th>RUT</Th><Th>Nombre</Th><Th>Problema de salud</Th><Th>Garantía</Th><Th>Fecha límite</Th></tr></thead>
              <tbody className="divide-y divide-line">{GARANTIAS_DATA.slice(0, 3).map((g) => <tr key={g.id}><td className={cx(tdCls, 'font-mono text-[13px]')}>{g.rut}-{g.dv}</td><td className={tdCls}>{g.nombre}</td><td className={tdCls}>{g.problema}</td><td className={tdCls}>{g.garantia}</td><td className={cx(tdCls, 'tnum')}>{g.limite.toLocaleDateString('es-CL')}</td></tr>)}</tbody></table>
          </div>
          <div className="flex justify-between border-t border-line p-4">
            <Btn onClick={reset} disabled={step === 'validating'}>Cambiar archivo</Btn>
            <Btn variant="primary" onClick={validate} disabled={step === 'validating'}>{step === 'validating' ? <><Loader2 className="size-4 animate-spin" />Validando estructura y datos…</> : 'Validar archivo'}</Btn>
          </div>
        </Card>
      )}

      {(step === 'result' || step === 'importing') && (
        <Card>
          <CardHeader title="Resultado de la validación" sub={file.name} />
          <ul className="divide-y divide-line">
            {[
              [CheckCircle2, 'text-[#3c9a67]', '253', 'registros encontrados'],
              [CheckCircle2, 'text-[#3c9a67]', '8', 'registros nuevos'],
              [CheckCircle2, 'text-[#3c9a67]', '32', 'registros actualizados'],
              [CheckCircle2, 'text-[#3c9a67]', '213', 'sin cambios'],
              [AlertTriangle, 'text-[#dd7a2c]', '2', 'registros con errores'],
            ].map(([Ic, c, n, t]) => {
              const I = Ic as typeof CheckCircle2
              return <li key={t as string} className="flex items-center gap-3 px-5 py-3"><I className={cx('size-5', c as string)} /><span className="tnum w-12 text-xl font-semibold">{n as string}</span><span className="text-sm">{t as string}</span></li>
            })}
          </ul>
          <div className="mx-5 mb-5 rounded-lg bg-[#fff5ec] px-4 py-3 text-sm text-[#7a3d0d]">
            <p className="font-medium">2 registros con errores serán omitidos</p>
            <p className="mt-1 text-xs">Fila 118: Fecha límite con formato inválido · Fila 204: RUT con dígito verificador incorrecto.</p>
          </div>
          <div className="flex justify-between border-t border-line p-4">
            <Btn onClick={reset} disabled={step === 'importing'}>Cancelar</Btn>
            <Btn variant="primary" onClick={doImport} disabled={step === 'importing'}>{step === 'importing' ? <><Loader2 className="size-4 animate-spin" />Importando…</> : 'Importar a la base de datos'}</Btn>
          </div>
        </Card>
      )}

      {step === 'done' && (
        <Card className="p-10 text-center">
          <div className="mx-auto grid size-16 place-items-center rounded-full bg-[#e6f4ec] text-[#3c9a67]"><CheckCircle2 className="size-9" /></div>
          <h3 className="mt-4 text-xl font-semibold">Importación completada</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">Se registraron 8 garantías nuevas y se actualizaron 32. Los estados y las alertas se recalcularon automáticamente.</p>
          <div className="mt-6 flex justify-center gap-3"><Btn onClick={() => nav('historial')}>Ver historial</Btn><Btn variant="primary" onClick={() => nav('dashboard')}>Ir al Dashboard</Btn></div>
        </Card>
      )}
    </div>
  )
}

/* ---------------- HISTORIAL ---------------- */
export function Historial({ toast }: { toast: Toast }) {
  const [open, setOpen] = useState<number | null>(null)
  const badge = (s: string) => s === 'Completado' ? 'bg-[#e6f4ec] text-[#256b45] ring-[#bfe1cd]' : s === 'Fallido' ? 'bg-[#fbe7e5] text-[#a12a22] ring-[#f1b9b4]' : 'bg-[#fcf4d9] text-[#7d5c07] ring-[#efdc9a]'
  return (
    <div className="page-in space-y-5">
      <div><h2 className="text-2xl font-semibold">Historial de importaciones</h2><p className="mt-1 text-sm text-muted">Registro de todas las nóminas cargadas en el sistema.</p></div>
      <Card className="overflow-hidden">
        <table className="w-full">
          <thead><tr><Th>Fecha</Th><Th>Usuario</Th><Th>Archivo</Th><Th className="text-right">Registros</Th><Th className="text-right">Nuevos</Th><Th className="text-right">Actualizados</Th><Th className="text-right">Errores</Th><Th>Estado</Th><Th /></tr></thead>
          <tbody className="divide-y divide-line">
            {IMPORTS.map((r, i) => (
              <tr key={i} className="hover:bg-canvas">
                <td className={cx(tdCls, 'tnum')}>{r[0]}</td><td className={tdCls}>{r[1]}</td><td className={cx(tdCls, 'font-mono text-[13px]')}>{r[2]}</td>
                <td className={cx(tdCls, 'tnum text-right')}>{r[3]}</td><td className={cx(tdCls, 'tnum text-right')}>{r[4]}</td><td className={cx(tdCls, 'tnum text-right')}>{r[5]}</td>
                <td className={cx(tdCls, 'tnum text-right', r[6] > 0 && 'font-semibold text-[#a12a22]')}>{r[6]}</td>
                <td className={tdCls}><span className={cx('rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', badge(r[7]))}>{r[7]}</span></td>
                <td className={cx(tdCls, 'text-right')}><Btn variant="ghost" onClick={() => setOpen(i)} className="!py-1"><Eye className="size-4" />Ver detalle</Btn></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {open !== null && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-6" onClick={() => setOpen(null)}>
          <Card className="w-full max-w-lg" >
            <div onClick={(e) => e.stopPropagation()}>
              <CardHeader title="Detalle de importación" sub={IMPORTS[open][2]} right={<button onClick={() => setOpen(null)}><X className="size-5 text-muted" /></button>} />
              <dl className="grid grid-cols-2 gap-4 p-5 text-sm">
                {[['Fecha', IMPORTS[open][0]], ['Usuario', IMPORTS[open][1]], ['Registros', IMPORTS[open][3]], ['Nuevos', IMPORTS[open][4]], ['Actualizados', IMPORTS[open][5]], ['Errores', IMPORTS[open][6]]].map(([k, v]) => <div key={k as string}><dt className="text-xs uppercase tracking-wider text-muted">{k}</dt><dd className="mt-0.5 font-medium">{v}</dd></div>)}
              </dl>
              {IMPORTS[open][6] > 0 && IMPORTS[open][7] !== 'Fallido' && <p className="mx-5 mb-4 rounded-lg bg-[#fff5ec] px-3 py-2 text-xs text-[#7a3d0d]">Registros omitidos por RUT o fecha inválidos.</p>}
              <div className="flex justify-end gap-2 border-t border-line p-4"><Btn onClick={() => toast('Descarga simulada del informe de errores')}>Descargar informe</Btn><Btn variant="primary" onClick={() => setOpen(null)}>Cerrar</Btn></div>
            </div>
          </Card>
        </div>
      )}
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
