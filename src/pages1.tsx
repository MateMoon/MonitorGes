import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, ArrowLeft, ArrowRight, Bot, CheckCircle2, ChevronLeft, ChevronRight, Circle, Clock, Eye, FileSpreadsheet, Loader2, Lock, Mail, RefreshCw, Search, ShieldCheck, User, X, CircleSlash, Timer,
} from 'lucide-react'
import { CONTEOS, GARANTIAS_DATA, PROBLEMAS, RESPONSABLES, STATUS, STATUS_ORDER, fmt, rutFull, type Garantia, type Status } from './data'
import { Btn, Card, CardHeader, Check2, Days, Empty, StatusBadge, Th, cx, inputCls, tdCls } from './ui'

export type Page = 'dashboard' | 'garantias' | 'detalle' | 'importar' | 'historial' | 'alertas' | 'estadisticas' | 'configuracion'
export type Nav = (p: Page, o?: { id?: number; estados?: Status[]; tab?: string }) => void

export function Logo({ light, size = 36 }: { light?: boolean; size?: number }) {
  return (
    <div className={cx('grid place-items-center rounded-lg', light ? 'bg-white/10 text-white ring-1 ring-white/20' : 'bg-brand text-white')} style={{ width: size, height: size }}>
      <ShieldCheck style={{ width: size * 0.55, height: size * 0.55 }} />
    </div>
  )
}

/* ---------------- LOGIN ---------------- */
export function Login({ onLogin }: { onLogin: (u: string) => void }) {
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [rem, setRem] = useState(true)
  const [err, setErr] = useState(false)
  const [loading, setLoading] = useState(false)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setErr(false)
    setLoading(true)
    setTimeout(() => {
      setLoading(false)
      if (u.trim() && p === 'ges2026') onLogin(u.trim())
      else setErr(true)
    }, 700)
  }

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-brand-dark p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)', backgroundSize: '44px 44px' }} />
        <div className="relative flex items-center gap-3">
          <Logo light size={40} />
          <div className="leading-tight">
            <p className="text-sm font-semibold">Servicio de Salud Demo</p>
            <p className="text-xs text-white/60">Unidad de Gestión GES</p>
          </div>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-snug">Seguimiento operacional de garantías explícitas en salud.</h2>
          <p className="mt-4 text-white/70">Identifique qué casos requieren atención, conozca sus fechas límite y deje que el sistema revise y avise por usted.</p>
          <div className="mt-8 flex gap-2">
            {STATUS_ORDER.map((s) => <span key={s} className={cx('h-1.5 w-12 rounded-full', STATUS[s].dot)} />)}
          </div>
        </div>
        <p className="relative text-xs text-white/50">Versión de demostración · datos ficticios</p>
      </div>

      <div className="flex items-center justify-center p-8">
        <form onSubmit={submit} className="w-full max-w-sm page-in">
          <div className="mb-8 flex items-center gap-3 lg:hidden"><Logo /><span className="font-semibold">Servicio de Salud Demo</span></div>
          <h1 className="text-2xl font-semibold">Monitor de Garantías GES</h1>
          <p className="mt-1.5 text-sm text-muted">Ingrese con su cuenta institucional.</p>

          {err && (
            <div role="alert" className="mt-6 flex items-start gap-2.5 rounded-lg border border-[#f1b9b4] bg-[#fbe7e5] px-3.5 py-3 text-sm text-[#a12a22]">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>Usuario o contraseña incorrectos. Verifique sus credenciales e intente nuevamente.</span>
            </div>
          )}

          <div className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Usuario</span>
              <div className="relative"><User className="absolute left-3 top-2.5 size-4 text-muted" />
                <input className={cx(inputCls, 'pl-9', err && 'border-[#cc4339]')} value={u} onChange={(e) => setU(e.target.value)} placeholder="nombre.apellido" autoFocus /></div>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Contraseña</span>
              <div className="relative"><Lock className="absolute left-3 top-2.5 size-4 text-muted" />
                <input type="password" className={cx(inputCls, 'pl-9', err && 'border-[#cc4339]')} value={p} onChange={(e) => setP(e.target.value)} placeholder="••••••••" /></div>
            </label>
            <Check2 checked={rem} onChange={setRem} label="Recordarme" />
          </div>

          <Btn type="submit" variant="primary" className="mt-6 w-full py-2.5" disabled={loading}>
            {loading ? <><Loader2 className="size-4 animate-spin" />Verificando…</> : 'Ingresar'}
          </Btn>
          <p className="mt-4 rounded-lg bg-canvas px-3 py-2 text-xs text-muted">Demo: cualquier usuario · contraseña <span className="font-mono text-ink">ges2026</span></p>
          <p className="mt-8 flex items-center gap-1.5 text-xs text-muted"><Lock className="size-3" />Sistema de uso interno. El acceso y las acciones quedan registrados.</p>
        </form>
      </div>
    </div>
  )
}

/* ---------------- TABLA REUTILIZABLE ---------------- */
function RowBar({ s }: { s: Status }) {
  return <td className="w-1 p-0"><div className={cx('h-full min-h-[48px] w-1', STATUS[s].dot)} /></td>
}

/* ---------------- DASHBOARD ---------------- */
export function Dashboard({ nav }: { nav: Nav }) {
  const urgentes = useMemo(() => GARANTIAS_DATA.filter((g) => g.estado !== 'vencida').sort((a, b) => a.dias - b.dias).slice(0, 8), [])
  const feed = [
    { icon: FileSpreadsheet, t: 'Última importación de Excel', d: 'Nomina_06102026.xlsx · hoy 08:32 · Juan Soto', go: () => nav('historial') },
    { icon: RefreshCw, t: '40 registros actualizados', d: '8 nuevos y 32 actualizados en la última nómina', go: () => nav('historial') },
    { icon: Mail, t: 'Últimos correos enviados', d: '14 correos enviados hoy · 1 con error de entrega', go: () => nav('alertas', { tab: 'bandeja' }) },
    { icon: Bot, t: 'Revisión automática', d: 'Sistema revisó automáticamente las garantías hoy a las 08:00.', go: () => nav('alertas') },
  ]
  return (
    <div className="page-in space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Resumen de garantías</h2>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted"><Clock className="size-3.5" />Última actualización de nómina: <span className="font-medium text-ink">06/10/2026 08:32</span></p>
        </div>
        <Btn variant="primary" onClick={() => nav('importar')}><FileSpreadsheet className="size-4" />Importar nómina</Btn>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        {STATUS_ORDER.map((s) => (
          <button key={s} onClick={() => nav('garantias', { estados: [s] })}
            className={cx('group rounded-xl border border-line border-t-4 bg-white p-5 text-left shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:-translate-y-0.5 hover:shadow-md', STATUS[s].card, s === 'normal' && 'col-span-1')}>
            <div className="flex items-center justify-between">
              <StatusBadge s={s} />
              <ArrowRight className="size-4 text-muted opacity-0 transition group-hover:opacity-100" />
            </div>
            <p className="tnum mt-4 text-4xl font-semibold tracking-tight">{CONTEOS[s]}</p>
            <p className="mt-1 text-sm text-muted">garantías · {STATUS[s].range}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1fr_340px]">
        <Card className="overflow-hidden">
          <CardHeader title="Requieren atención" sub="Garantías no vencidas con menor plazo restante"
            right={<Btn variant="ghost" onClick={() => nav('garantias', { estados: ['critica', 'proxima'] })}>Ver todas<ChevronRight className="size-4" /></Btn>} />
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="w-1 bg-[#f8f9fb] p-0" /><Th>Estado</Th><Th>RUT</Th><Th>Paciente</Th><Th>Problema de salud</Th><Th>Garantía</Th><Th>Responsable</Th><Th>Fecha límite</Th><Th>Días restantes</Th></tr></thead>
              <tbody className="divide-y divide-line">
                {urgentes.map((g) => (
                  <tr key={g.id} onClick={() => nav('detalle', { id: g.id })}
                    className={cx('cursor-pointer transition-colors', g.estado === 'critica' ? 'bg-[#fff7f6] hover:bg-[#fdeeec]' : 'hover:bg-canvas')}>
                    <RowBar s={g.estado} />
                    <td className={tdCls}><StatusBadge s={g.estado} short /></td>
                    <td className={cx(tdCls, 'font-mono text-[13px]')}>{rutFull(g)}</td>
                    <td className={cx(tdCls, 'font-medium')}>{g.nombre}</td>
                    <td className={tdCls}>{g.problema}</td>
                    <td className={tdCls}>{g.garantia}</td>
                    <td className={tdCls}>{g.responsable}</td>
                    <td className={cx(tdCls, 'tnum')}>{fmt(g.limite)}</td>
                    <td className={tdCls}><Days d={g.dias} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Actividad reciente" />
          <ul className="divide-y divide-line">
            {feed.map((f) => (
              <li key={f.t}>
                <button onClick={f.go} className="flex w-full items-start gap-3 px-5 py-4 text-left transition hover:bg-canvas">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand"><f.icon className="size-4" /></span>
                  <span><span className="block text-sm font-medium">{f.t}</span><span className="mt-0.5 block text-xs leading-relaxed text-muted">{f.d}</span></span>
                </button>
              </li>
            ))}
          </ul>
          <div className="m-4 flex items-center gap-2 rounded-lg bg-[#e6f4ec] px-3 py-2.5 text-xs text-[#256b45]">
            <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-[#3c9a67] opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-[#3c9a67]" /></span>
            Monitoreo automático activo
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ---------------- GARANTÍAS ---------------- */
const PAGE_SIZE = 12
const CHIP_ORDER: Status[] = ['normal', 'atencion', 'proxima', 'critica', 'vencida']

export function Garantias({ nav, initial, gestionadas }: { nav: Nav; initial?: Status[]; gestionadas: Set<number> }) {
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [estados, setEstados] = useState<Set<Status>>(new Set(initial ?? ['normal', 'atencion', 'proxima', 'critica']))
  const [resp, setResp] = useState('')
  const [prob, setProb] = useState('')
  const [fecha, setFecha] = useState('')
  const [page, setPage] = useState(0)
  const [asc, setAsc] = useState(true)

  useEffect(() => { const t = setTimeout(() => setLoading(false), 450); return () => clearTimeout(t) }, [])
  useEffect(() => setPage(0), [q, estados, resp, prob, fecha])

  const rows = useMemo(() => {
    const qq = q.trim().toLowerCase().replace(/[.\-]/g, '')
    return GARANTIAS_DATA.filter((g) =>
      estados.has(g.estado) &&
      (!qq || g.nombre.toLowerCase().includes(qq) || (g.rut + g.dv).replace(/\./g, '').toLowerCase().includes(qq)) &&
      (!resp || g.responsable === resp) && (!prob || g.problema === prob) &&
      (!fecha || (fecha === '7' ? g.dias >= 0 && g.dias <= 7 : fecha === '15' ? g.dias >= 0 && g.dias <= 15 : fecha === '30' ? g.dias >= 0 && g.dias <= 30 : g.dias > 30)),
    ).sort((a, b) => (asc ? a.dias - b.dias : b.dias - a.dias))
  }, [q, estados, resp, prob, fecha, asc])

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const view = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const clean = () => { setQ(''); setResp(''); setProb(''); setFecha(''); setEstados(new Set(['normal', 'atencion', 'proxima', 'critica'])) }
  const toggle = (s: Status) => setEstados((p) => { const n = new Set(p); n.has(s) ? n.delete(s) : n.add(s); return n })
  const estadoSel = estados.size === 1 ? [...estados][0] : estados.size === 5 ? 'todos' : 'varios'
  const dirty = q || resp || prob || fecha || estados.size !== 4 || estados.has('vencida')

  return (
    <div className="page-in space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Garantías</h2>
        <p className="mt-1 text-sm text-muted">Muestra de demostración con {GARANTIAS_DATA.length} garantías vigentes.</p>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-[1.6fr_1fr_1fr_1fr_1fr_auto]">
          <div className="relative col-span-2 xl:col-span-1">
            <Search className="absolute left-3 top-2.5 size-4 text-muted" />
            <input className={cx(inputCls, 'pl-9')} placeholder="Buscar por RUT o nombre…" value={q} onChange={(e) => setQ(e.target.value)} />
            {q && <button onClick={() => setQ('')} className="absolute right-2.5 top-2.5 text-muted hover:text-ink"><X className="size-4" /></button>}
          </div>
          <select className={inputCls} value={estadoSel} onChange={(e) => setEstados(new Set(e.target.value === 'todos' ? CHIP_ORDER : [e.target.value as Status]))}>
            <option value="todos">Estado: todos</option>
            {estadoSel === 'varios' && <option value="varios">Estado: selección</option>}
            {CHIP_ORDER.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
          </select>
          <select className={inputCls} value={resp} onChange={(e) => setResp(e.target.value)}>
            <option value="">Responsable: todos</option>{RESPONSABLES.map((r) => <option key={r}>{r}</option>)}
          </select>
          <select className={inputCls} value={prob} onChange={(e) => setProb(e.target.value)}>
            <option value="">Problema: todos</option>{PROBLEMAS.map((r) => <option key={r}>{r}</option>)}
          </select>
          <select className={inputCls} value={fecha} onChange={(e) => setFecha(e.target.value)}>
            <option value="">Fecha límite: todas</option><option value="7">Próximos 7 días</option><option value="15">Próximos 15 días</option><option value="30">Próximos 30 días</option><option value="31">Más de 30 días</option>
          </select>
          <Btn onClick={clean} disabled={!dirty}><X className="size-4" />Limpiar filtros</Btn>
        </div>
        <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-line pt-3.5">
          <span className="mr-1 text-xs font-medium uppercase tracking-wider text-muted">Mostrar</span>
          {CHIP_ORDER.map((s) => (
            <button key={s} onClick={() => toggle(s)} aria-pressed={estados.has(s)}
              className={cx('inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition', estados.has(s) ? 'border-brand/40 bg-brand-soft font-medium text-brand-dark' : 'border-line bg-white text-muted hover:bg-canvas')}>
              <span className={cx('size-2 rounded-full', estados.has(s) ? STATUS[s].dot : 'bg-[#cdd3dd]')} />{STATUS[s].short}
            </button>
          ))}
          <span className="ml-auto text-sm text-muted"><span className="tnum font-semibold text-ink">{rows.length}</span> resultados</span>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr>
              <th className="w-1 bg-[#f8f9fb] p-0" /><Th>Estado</Th><Th>RUT</Th><Th>Nombre</Th><Th>Problema de salud</Th><Th>Garantía</Th><Th>Inicio</Th><Th>Fecha límite</Th>
              <Th><button onClick={() => setAsc(!asc)} className="inline-flex items-center gap-1 uppercase hover:text-ink">Días restantes <span>{asc ? '↑' : '↓'}</span></button></Th><Th>Responsable</Th><Th className="text-right">Acciones</Th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {loading && Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}><td colSpan={11} className="px-4 py-3"><div className="h-5 animate-pulse rounded bg-[#eef1f5]" /></td></tr>
              ))}
              {!loading && view.map((g) => (
                <tr key={g.id} onClick={() => nav('detalle', { id: g.id })}
                  className={cx('group cursor-pointer transition-colors', g.estado === 'critica' ? 'bg-[#fff7f6] hover:bg-[#fdeeec]' : 'hover:bg-canvas', g.estado === 'vencida' && 'text-[#4a5463]')}>
                  <RowBar s={g.estado} />
                  <td className={tdCls}><StatusBadge s={g.estado} short /></td>
                  <td className={cx(tdCls, 'font-mono text-[13px]')}>{rutFull(g)}</td>
                  <td className={cx(tdCls, 'font-medium')}>{g.nombre}{gestionadas.has(g.id) && <span className="ml-2 rounded bg-[#e6f4ec] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#256b45]">Gestionada</span>}</td>
                  <td className={tdCls}>{g.problema}</td>
                  <td className={tdCls}>{g.garantia}</td>
                  <td className={cx(tdCls, 'tnum text-muted')}>{fmt(g.inicio)}</td>
                  <td className={cx(tdCls, 'tnum')}>{fmt(g.limite)}</td>
                  <td className={tdCls}><Days d={g.dias} /></td>
                  <td className={tdCls}>{g.responsable}</td>
                  <td className={cx(tdCls, 'text-right')}>
                    <button onClick={(e) => { e.stopPropagation(); nav('detalle', { id: g.id }) }} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-brand hover:bg-brand-soft"><Eye className="size-4" />Ver</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && rows.length === 0 && (
          <Empty title="Sin resultados" text="No hay garantías que coincidan con los filtros aplicados. Pruebe con otro RUT, nombre o amplíe los estados visibles." action={<Btn onClick={clean}>Limpiar filtros</Btn>} />
        )}
        {rows.length > 0 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-muted">
            <span>Mostrando {page * PAGE_SIZE + 1}–{Math.min(rows.length, (page + 1) * PAGE_SIZE)} de {rows.length}</span>
            <div className="flex items-center gap-2">
              <Btn onClick={() => setPage(page - 1)} disabled={page === 0} className="!px-2 !py-1.5"><ChevronLeft className="size-4" /></Btn>
              <span className="tnum">Página {page + 1} de {pages}</span>
              <Btn onClick={() => setPage(page + 1)} disabled={page >= pages - 1} className="!px-2 !py-1.5"><ChevronRight className="size-4" /></Btn>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

/* ---------------- DETALLE ---------------- */
const ETAPAS = [30, 15, 7, 1, 0]
const ETAPA_LABEL = (t: number) => (t === 0 ? 'Vencimiento' : `${t} ${t === 1 ? 'día' : 'días'} antes`)

function etapas(g: Garantia) {
  const pasadas = ETAPAS.filter((t) => g.dias <= t)
  const ultima = pasadas.length ? pasadas[pasadas.length - 1] : -1
  return ETAPAS.map((t) => {
    const fecha = new Date(g.limite.getFullYear(), g.limite.getMonth(), g.limite.getDate() - t)
    if (g.dias > t) return { t, st: 'pend' as const, txt: 'Pendiente' }
    if (t === ultima || (g.dias < 0 && t === 0)) return { t, st: 'ok' as const, txt: `Enviado ${fmt(fecha < new Date(2026, 9, 6) ? fecha : new Date(2026, 9, 6))}` }
    return { t, st: 'na' as const, txt: 'No corresponde' }
  })
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-xs font-medium uppercase tracking-wider text-muted">{label}</dt><dd className="mt-1 text-[15px] font-medium">{children}</dd></div>
}

export function Detalle({ id, nav, gestionadas, onGestionar }: { id: number; nav: Nav; gestionadas: Set<number>; onGestionar: (id: number) => void }) {
  const g = GARANTIAS_DATA.find((x) => x.id === id)
  if (!g) return <Card><Empty title="Garantía no encontrada" text="El registro solicitado no existe." action={<Btn onClick={() => nav('garantias')}>Volver al listado</Btn>} /></Card>
  const done = gestionadas.has(g.id)
  const hero = { normal: 'bg-[#f1f9f4] border-[#bfe1cd]', atencion: 'bg-[#fffbec] border-[#efdc9a]', proxima: 'bg-[#fff5ec] border-[#f3c9a4]', critica: 'bg-[#fff3f2] border-[#f1b9b4]', vencida: 'bg-[#eef0f3] border-[#c5cad3]' }[g.estado]
  const ev = etapas(g)
  return (
    <div className="page-in space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => nav('garantias')} className="grid size-9 place-items-center rounded-lg border border-line bg-white hover:bg-canvas" aria-label="Volver"><ArrowLeft className="size-4" /></button>
          <div><h2 className="text-2xl font-semibold">Detalle de garantía</h2><p className="text-sm text-muted">Garantías / {g.nombre}</p></div>
        </div>
        <div className="flex gap-2">
          <Btn onClick={() => nav('garantias')}>Volver</Btn>
          <Btn onClick={() => nav('alertas', { tab: 'bandeja' })}>Ver historial</Btn>
          <Btn variant="primary" onClick={() => onGestionar(g.id)}>{done ? <><CheckCircle2 className="size-4" />Gestionada</> : 'Marcar como gestionada'}</Btn>
        </div>
      </div>

      <div className={cx('flex items-center justify-between rounded-xl border-2 px-7 py-5', hero)}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Fecha límite</p>
          <p className="tnum text-3xl font-semibold">{fmt(g.limite)}</p>
        </div>
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">{g.dias < 0 ? 'Vencida' : 'Plazo restante'}</p>
          <p className="text-3xl font-semibold">{g.dias < 0 ? `Hace ${-g.dias} días` : g.dias === 0 ? 'Vence hoy' : `Faltan ${g.dias} ${g.dias === 1 ? 'día' : 'días'}`}</p>
        </div>
        <div className="text-right">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Estado</p>
          <span className={cx('inline-block rounded-lg px-4 py-1.5 text-lg font-semibold uppercase tracking-wide ring-1 ring-inset', STATUS[g.estado].badge)}>{STATUS[g.estado].label}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Información del paciente" />
            <dl className="grid grid-cols-3 gap-5 p-5">
              <Field label="Nombre">{g.nombre}</Field>
              <Field label="RUT"><span className="font-mono">{g.rut}</span></Field>
              <Field label="DV">{g.dv}</Field>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Información de la garantía" />
            <dl className="grid grid-cols-2 gap-5 p-5">
              <Field label="Problema de salud">{g.problema}</Field>
              <Field label="Nombre de la garantía">{g.garantia}</Field>
              <Field label="Fecha de inicio"><span className="tnum">{fmt(g.inicio)}</span></Field>
              <Field label="Fecha límite"><span className="tnum">{fmt(g.limite)}</span></Field>
              <Field label="Días restantes"><Days d={g.dias} /></Field>
              <Field label="Estado"><StatusBadge s={g.estado} /></Field>
              <Field label="Responsable">{g.responsable}</Field>
              <Field label="Gestión">{done ? <span className="text-[#256b45]">Marcada como gestionada</span> : <span className="text-muted">Sin gestionar</span>}</Field>
            </dl>
          </Card>
        </div>

        <Card>
          <CardHeader title="Historial de notificaciones" sub="Alertas automáticas programadas para esta garantía" />
          <ol className="p-5">
            {ev.map((e, i) => (
              <li key={e.t} className="relative flex gap-4 pb-6 last:pb-0">
                {i < ev.length - 1 && <span className="absolute left-[13px] top-7 h-[calc(100%-28px)] w-px bg-line" />}
                <span className={cx('z-10 grid size-7 shrink-0 place-items-center rounded-full', e.st === 'ok' ? 'bg-[#3c9a67] text-white' : e.st === 'pend' ? 'border-2 border-[#d9a416] bg-white text-[#d9a416]' : 'bg-[#eef1f5] text-[#98a2b3]')}>
                  {e.st === 'ok' ? <Mail className="size-3.5" /> : e.st === 'pend' ? <Timer className="size-3.5" /> : <CircleSlash className="size-3.5" />}
                </span>
                <div className="flex flex-1 items-center justify-between">
                  <div><p className="text-sm font-medium">{ETAPA_LABEL(e.t)}</p><p className={cx('text-sm', e.st === 'ok' ? 'text-[#256b45]' : 'text-muted')}>{e.txt}</p></div>
                  {e.st === 'ok' && <span className="rounded-full bg-[#e6f4ec] px-2.5 py-0.5 text-xs font-medium text-[#256b45]">Enviado</span>}
                  {e.st === 'pend' && <span className="rounded-full bg-[#fcf4d9] px-2.5 py-0.5 text-xs font-medium text-[#7d5c07]">Pendiente</span>}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  )
}
