import { useState } from 'react'
import { Bell, BarChart3, CheckCircle2, History, LayoutDashboard, ListChecks, LogOut, Settings, Siren, Upload } from 'lucide-react'
import type { Status } from './data'
import { Alertas, Configuracion, Estadisticas, Historial, Importar } from './pages/pages2'
import { Dashboard, Detalle, Garantias, Login, Logo, type Nav, type Page } from './pages/pages1'
import { cx } from './ui'

const MENU: { id: Page; label: string; icon: typeof Bell; title: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, title: 'Dashboard' },
  { id: 'garantias', label: 'Garantías', icon: ListChecks, title: 'Garantías' },
  { id: 'importar', label: 'Importar nómina', icon: Upload, title: 'Importar nómina' },
  { id: 'historial', label: 'Historial de importaciones', icon: History, title: 'Historial de importaciones' },
  { id: 'alertas', label: 'Alertas', icon: Siren, title: 'Alertas' },
  { id: 'estadisticas', label: 'Estadísticas', icon: BarChart3, title: 'Estadísticas' },
  { id: 'configuracion', label: 'Configuración', icon: Settings, title: 'Configuración' },
]

export default function App() {
  const [user, setUser] = useState<string | null>(null)
  const [page, setPage] = useState<Page>('dashboard')
  const [sel, setSel] = useState(1)
  const [preset, setPreset] = useState<Status[] | undefined>()
  const [tab, setTab] = useState<string | undefined>()
  const [navKey, setNavKey] = useState(0)
  const [gest, setGest] = useState<Set<number>>(new Set())
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [bell, setBell] = useState(false)

  const toast = (m: string) => { setToastMsg(m); setTimeout(() => setToastMsg(null), 2600) }
  const nav: Nav = (p, o) => {
    setPage(p); setBell(false); setNavKey((k) => k + 1)
    if (o?.id) setSel(o.id)
    setPreset(o?.estados); setTab(o?.tab)
    window.scrollTo({ top: 0 })
  }
  const gestionar = (id: number) => {
    const n = new Set(gest)
    if (n.has(id)) { n.delete(id); toast('Garantía desmarcada como gestionada') } else { n.add(id); toast('Garantía marcada como gestionada') }
    setGest(n)
  }

  if (!user) return <Login onLogin={(u) => { setUser(u); nav('dashboard') }} />

  const active = page === 'detalle' ? 'garantias' : page
  const title = page === 'detalle' ? 'Detalle de garantía' : MENU.find((m) => m.id === page)!.title

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 flex w-[72px] flex-col bg-brand-dark text-white lg:w-64">
        <div className="flex items-center gap-3 px-4 py-5 lg:px-5">
          <Logo light />
          <div className="hidden leading-tight lg:block"><p className="text-sm font-semibold">Monitor de Garantías</p><p className="text-xs text-white/55">GES · Uso interno</p></div>
        </div>
        <nav className="mt-2 flex-1 space-y-1 px-3">
          {MENU.map((m) => (
            <button key={m.id} onClick={() => nav(m.id)} title={m.label}
              className={cx('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors', active === m.id ? 'bg-white/14 font-medium text-white shadow-[inset_3px_0_0_#7fb3e6]' : 'text-white/65 hover:bg-white/8 hover:text-white')}>
              <m.icon className="size-[18px] shrink-0" /><span className="hidden truncate lg:block">{m.label}</span>
            </button>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/15 text-sm font-semibold uppercase">{user.slice(0, 2)}</span>
            <div className="hidden min-w-0 leading-tight lg:block"><p className="truncate text-sm font-medium">{user}</p><p className="text-xs text-white/55">Administrador</p></div>
          </div>
          <button onClick={() => { setUser(null); setGest(new Set()) }} title="Cerrar sesión" className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/65 hover:bg-white/8 hover:text-white">
            <LogOut className="size-[18px]" /><span className="hidden lg:block">Cerrar sesión</span>
          </button>
        </div>
      </aside>

      <div className="pl-[72px] lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-line bg-white/90 px-6 backdrop-blur lg:px-8">
          <h1 className="text-[15px] font-semibold">{title}</h1>
          <div className="flex items-center gap-5">
            <span className="hidden items-center gap-2 text-sm text-muted md:flex"><span className="size-2 rounded-full bg-[#3c9a67]" />Actualizado: 06/10/2026 08:32</span>
            <div className="relative">
              <button onClick={() => setBell(!bell)} className="relative grid size-9 place-items-center rounded-lg border border-line hover:bg-canvas" aria-label="Notificaciones">
                <Bell className="size-[18px]" /><span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-[#cc4339] text-[10px] font-semibold text-white">3</span>
              </button>
              {bell && (
                <div className="absolute right-0 top-11 w-80 overflow-hidden rounded-xl border border-line bg-white shadow-xl">
                  <p className="border-b border-line px-4 py-3 text-sm font-semibold">Notificaciones</p>
                  {[['6 garantías críticas requieren gestión', 'Hace 2 h'], ['Importación completada: 253 registros', 'Hoy 08:32'], ['1 correo no pudo ser entregado', 'Hoy 08:05']].map(([t, h]) => (
                    <button key={t} onClick={() => nav(t.startsWith('6') ? 'garantias' : t.startsWith('Imp') ? 'historial' : 'alertas', t.startsWith('6') ? { estados: ['critica'] } : { tab: 'bandeja' })} className="block w-full border-b border-line px-4 py-3 text-left last:border-0 hover:bg-canvas"><p className="text-sm">{t}</p><p className="text-xs text-muted">{h}</p></button>
                  ))}
                  <button onClick={() => nav('alertas', { tab: 'bandeja' })} className="w-full bg-canvas px-4 py-2.5 text-sm font-medium text-brand">Ver bandeja completa</button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2.5 border-l border-line pl-5"><span className="grid size-8 place-items-center rounded-full bg-brand-soft text-xs font-semibold uppercase text-brand">{user.slice(0, 2)}</span><span className="hidden text-sm font-medium md:block">{user}</span></div>
          </div>
        </header>

        <main key={navKey} className="mx-auto max-w-[1500px] p-6 lg:p-8">
          {page === 'dashboard' && <Dashboard nav={nav} />}
          {page === 'garantias' && <Garantias nav={nav} initial={preset} gestionadas={gest} />}
          {page === 'detalle' && <Detalle id={sel} nav={nav} gestionadas={gest} onGestionar={gestionar} />}
          {page === 'importar' && <Importar nav={nav} toast={toast} />}
          {page === 'historial' && <Historial toast={toast} />}
          {page === 'alertas' && <Alertas initialTab={tab} toast={toast} />}
          {page === 'estadisticas' && <Estadisticas />}
          {page === 'configuracion' && <Configuracion toast={toast} />}
        </main>
      </div>

      {toastMsg && <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-lg bg-ink px-4 py-3 text-sm text-white shadow-xl page-in"><CheckCircle2 className="size-4 text-[#7fd6a4]" />{toastMsg}</div>}
    </div>
  )
}
