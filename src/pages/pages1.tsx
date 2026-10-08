import { useEffect, useState } from 'react'
import {
  AlertCircle, ArrowLeft, ArrowRight, Bot, CheckCircle2, ChevronLeft, ChevronRight, Clock, Eye, FileSpreadsheet, Loader2, Lock, Mail, RefreshCw, Search, ShieldCheck, User, X, CircleSlash, Timer,
} from 'lucide-react'
import { STATUS, STATUS_ORDER, fmt, rutFull, type Status } from '../data'

import { getDashboard } from '../services/dashboard'
import type { Garantia } from '../types'
import { Btn, Card, CardHeader, Check2, Days, Empty, StatusBadge, Th, cx, inputCls, tdCls } from '../ui'

export type Page = 'dashboard' | 'garantias' | 'detalle' | 'importar' | 'historial' | 'alertas' | 'estadisticas' | 'configuracion'
export type Nav = (p: Page, o?: { id?: string | number; estados?: Status[]; tab?: string }) => void

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
  const [dashboard, setDashboard] = useState<Awaited<ReturnType<typeof getDashboard>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    getDashboard(controller.signal).then(setDashboard).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'No fue posible cargar el dashboard.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])
  const urgentes = dashboard?.garantiasUrgentes ?? []
  // Actividad reciente sigue siendo mock temporal: /api/dashboard no entrega un feed de actividad.
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
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted"><Clock className="size-3.5" />Última actualización de nómina: <span className="font-medium text-ink">{dashboard?.ultimaImportacion ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(dashboard.ultimaImportacion.fechaImportacion)) : loading ? 'Cargando…' : 'Sin importaciones registradas'}</span></p>
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
            <p className="tnum mt-4 text-4xl font-semibold tracking-tight">{loading || error ? '—' : dashboard?.conteosPorEstado[s] ?? 0}</p>
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
                {loading ? <tr><td colSpan={9} className={`${tdCls} py-8 text-center text-muted`}>Cargando garantías…</td></tr> : error ? <tr><td colSpan={9} className={`${tdCls} py-8 text-center text-[#a12a22]`}>No se pudo cargar el dashboard: {error}</td></tr> : urgentes.length === 0 ? <tr><td colSpan={9} className={`${tdCls} py-8 text-center text-muted`}>No hay garantías que requieran atención.</td></tr> : urgentes.map((g) => (
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
export { Garantias, Detalle } from './GuaranteesPage'
