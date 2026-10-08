import { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Eye, Loader2, Search, X } from 'lucide-react';
import { STATUS, type Status, fmt, rutFull } from '../data';
import { getGarantias, getGarantiaById } from '../services/garantias';
import type { Garantia } from '../types';
import { Btn, Card, CardHeader, Days, Empty, StatusBadge, Th, cx, inputCls, tdCls } from '../ui';
import type { Nav } from './pages1';

const PAGE_SIZE = 12;
const CHIP_ORDER: Status[] = ['normal', 'atencion', 'proxima', 'critica', 'vencida'];
const DEFAULT_STATES: Status[] = ['normal', 'atencion', 'proxima', 'critica'];

export function Garantias({ nav, initial, gestionadas }: { nav: Nav; initial?: Status[]; gestionadas: Set<string | number> }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Garantia[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, totalPages: 0 });
  const [q, setQ] = useState('');
  const [estados, setEstados] = useState<Set<Status>>(new Set(initial ?? DEFAULT_STATES));
  const [resp, setResp] = useState('');
  const [prob, setProb] = useState('');
  const [nombreGarantia, setNombreGarantia] = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [page, setPage] = useState(1);
  const [asc, setAsc] = useState(true);
  const [reload, setReload] = useState(0);
  const estadosKey = [...estados].sort().join(',');

  useEffect(() => setPage(1), [q, estadosKey, resp, prob, nombreGarantia, fechaDesde, fechaHasta]);

  useEffect(() => {
    const controller = new AbortController();
    const queryText = q.trim();
    const isRut = /^\s*\d/.test(queryText);
    setLoading(true);
    setError(null);
    getGarantias({
      ...(queryText ? (isRut ? { rut: queryText } : { nombre: queryText }) : {}),
      estado: estadosKey ? estadosKey.split(',') as Status[] : [],
      responsable: resp.trim() || undefined,
      problemaSalud: prob.trim() || undefined,
      nombreGarantia: nombreGarantia.trim() || undefined,
      fechaLimiteDesde: fechaDesde || undefined,
      fechaLimiteHasta: fechaHasta || undefined,
      page,
      limit: PAGE_SIZE,
      sort: 'fechaLimite',
      order: asc ? 'asc' : 'desc',
    }, controller.signal)
      .then((result) => {
        setRows(result.data);
        setPagination(result.pagination);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : 'No fue posible cargar las garantías.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [q, estadosKey, resp, prob, nombreGarantia, fechaDesde, fechaHasta, page, asc, reload]);

  const clean = () => {
    setQ(''); setResp(''); setProb(''); setNombreGarantia(''); setFechaDesde(''); setFechaHasta('');
    setEstados(new Set(DEFAULT_STATES));
  };
  const toggle = (status: Status) => setEstados((previous) => {
    const next = new Set(previous);
    if (next.has(status)) next.delete(status); else next.add(status);
    return next;
  });
  const estadoSel = estados.size === 1 ? [...estados][0] : estados.size === CHIP_ORDER.length ? 'todos' : 'varios';
  const dirty = Boolean(q || resp || prob || nombreGarantia || fechaDesde || fechaHasta) || estadosKey !== [...DEFAULT_STATES].sort().join(',');

  return (
    <div className="page-in space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Garantías</h2>
        <p className="mt-1 text-sm text-muted">Listado actualizado desde el sistema.</p>
      </div>
      <Card className="p-4">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr_auto]">
          <div className="relative col-span-2 xl:col-span-1">
            <Search className="absolute left-3 top-2.5 size-4 text-muted" />
            <input className={cx(inputCls, 'pl-9')} placeholder="Buscar por RUT o nombre…" value={q} onChange={(event) => setQ(event.target.value)} />
            {q && <button onClick={() => setQ('')} className="absolute right-2.5 top-2.5 text-muted hover:text-ink" aria-label="Limpiar búsqueda"><X className="size-4" /></button>}
          </div>
          <select className={inputCls} value={estadoSel} onChange={(event) => setEstados(new Set(event.target.value === 'todos' ? CHIP_ORDER : event.target.value === 'varios' ? estados : [event.target.value as Status]))}>
            <option value="todos">Estado: todos</option>
            {estadoSel === 'varios' && <option value="varios">Estado: selección</option>}
            {CHIP_ORDER.map((status) => <option key={status} value={status}>{STATUS[status].label}</option>)}
          </select>
          <input className={inputCls} placeholder="Responsable" aria-label="Filtrar por responsable" value={resp} onChange={(event) => setResp(event.target.value)} />
          <input className={inputCls} placeholder="Problema de salud" aria-label="Filtrar por problema de salud" value={prob} onChange={(event) => setProb(event.target.value)} />
          <input className={inputCls} placeholder="Nombre de garantía" aria-label="Filtrar por nombre de garantía" value={nombreGarantia} onChange={(event) => setNombreGarantia(event.target.value)} />
          <div className="flex gap-2">
            <input className={cx(inputCls, 'min-w-0')} type="date" aria-label="Fecha límite desde" title="Fecha límite desde" value={fechaDesde} onChange={(event) => setFechaDesde(event.target.value)} />
            <input className={cx(inputCls, 'min-w-0')} type="date" aria-label="Fecha límite hasta" title="Fecha límite hasta" value={fechaHasta} onChange={(event) => setFechaHasta(event.target.value)} />
          </div>
          <Btn onClick={clean} disabled={!dirty}><X className="size-4" />Limpiar</Btn>
        </div>
        <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-line pt-3.5">
          <span className="mr-1 text-xs font-medium uppercase tracking-wider text-muted">Mostrar</span>
          {CHIP_ORDER.map((status) => (
            <button key={status} onClick={() => toggle(status)} aria-pressed={estados.has(status)} className={cx('inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition', estados.has(status) ? 'border-brand/40 bg-brand-soft font-medium text-brand-dark' : 'border-line bg-white text-muted hover:bg-canvas')}>
              <span className={cx('size-2 rounded-full', estados.has(status) ? STATUS[status].dot : 'bg-[#cdd3dd]')} />{STATUS[status].short}
            </button>
          ))}
          <span className="ml-auto text-sm text-muted"><span className="tnum font-semibold text-ink">{pagination.total}</span> resultados</span>
        </div>
      </Card>
      {error && <Card className="flex items-center justify-between gap-4 border-[#f1b9b4] p-4 text-sm text-[#a12a22]"><span className="flex items-center gap-2"><AlertCircle className="size-4 shrink-0" />{error}</span><Btn onClick={() => setReload((current) => current + 1)}>Reintentar</Btn></Card>}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr>
              <th className="w-1 bg-[#f8f9fb] p-0" /><Th>Estado</Th><Th>RUT</Th><Th>Nombre</Th><Th>Problema de salud</Th><Th>Garantía</Th><Th>Inicio</Th><Th>Fecha límite</Th>
              <Th><button onClick={() => setAsc((value) => !value)} className="inline-flex items-center gap-1 uppercase hover:text-ink">Días restantes <span>{asc ? '↑' : '↓'}</span></button></Th><Th>Responsable</Th><Th className="text-right">Acciones</Th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {loading && Array.from({ length: 8 }).map((_, index) => <tr key={index}><td colSpan={11} className="px-4 py-3"><div className="h-5 animate-pulse rounded bg-[#eef1f5]" /></td></tr>)}
              {!loading && !error && rows.map((guarantee) => (
                <tr key={guarantee.id} onClick={() => nav('detalle', { id: guarantee.id })} className={cx('group cursor-pointer transition-colors', guarantee.estado === 'critica' ? 'bg-[#fff7f6] hover:bg-[#fdeeec]' : 'hover:bg-canvas', guarantee.estado === 'vencida' && 'text-[#4a5463]')}>
                  <td className="w-1 p-0"><div className={cx('h-full min-h-[48px] w-1', STATUS[guarantee.estado].dot)} /></td>
                  <td className={tdCls}><StatusBadge s={guarantee.estado} short /></td><td className={cx(tdCls, 'font-mono text-[13px]')}>{rutFull(guarantee)}</td>
                  <td className={cx(tdCls, 'font-medium')}>{guarantee.nombre}{gestionadas.has(guarantee.id) && <span className="ml-2 rounded bg-[#e6f4ec] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#256b45]">Gestionada</span>}</td>
                  <td className={tdCls}>{guarantee.problema}</td><td className={tdCls}>{guarantee.garantia}</td><td className={cx(tdCls, 'tnum text-muted')}>{fmt(guarantee.inicio)}</td><td className={cx(tdCls, 'tnum')}>{fmt(guarantee.limite)}</td><td className={tdCls}><Days d={guarantee.dias} /></td><td className={tdCls}>{guarantee.responsable}</td>
                  <td className={cx(tdCls, 'text-right')}><button onClick={(event) => { event.stopPropagation(); nav('detalle', { id: guarantee.id }); }} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-brand hover:bg-brand-soft"><Eye className="size-4" />Ver</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !error && rows.length === 0 && <Empty title="Sin resultados" text="No hay garantías que coincidan con los filtros aplicados. Pruebe con otro RUT, nombre o amplíe los estados visibles." action={<Btn onClick={clean}>Limpiar filtros</Btn>} />}
        {!loading && !error && pagination.total > 0 && <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-muted">
          <span>Mostrando {(pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.total, pagination.page * pagination.limit)} de {pagination.total}</span>
          <div className="flex items-center gap-2"><Btn onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={pagination.page <= 1} className="!px-2 !py-1.5"><ChevronLeft className="size-4" /></Btn><span className="tnum">Página {pagination.page} de {pagination.totalPages}</span><Btn onClick={() => setPage((value) => Math.min(pagination.totalPages, value + 1))} disabled={pagination.page >= pagination.totalPages} className="!px-2 !py-1.5"><ChevronRight className="size-4" /></Btn></div>
        </div>}
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-xs font-medium uppercase tracking-wider text-muted">{label}</dt><dd className="mt-1 text-[15px] font-medium">{children}</dd></div>;
}

export function Detalle({ id, nav, gestionadas, onGestionar }: { id: string | number; nav: Nav; gestionadas: Set<string | number>; onGestionar: (id: string | number) => void }) {
  const [guarantee, setGuarantee] = useState<Garantia | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setGuarantee(null);
    getGarantiaById(id, controller.signal)
      .then(setGuarantee)
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No fue posible cargar el detalle.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id]);

  if (loading) return <Card className="flex items-center gap-3 p-6 text-sm text-muted"><Loader2 className="size-4 animate-spin" />Cargando detalle de garantía…</Card>;
  if (error || !guarantee) return <Card><Empty title="No se pudo cargar la garantía" text={error ?? 'El registro solicitado no existe.'} action={<Btn onClick={() => nav('garantias')}>Volver al listado</Btn>} /></Card>;

  const done = guarantee.gestionadaAt != null || gestionadas.has(guarantee.id);
  const hero = { normal: 'bg-[#f1f9f4] border-[#bfe1cd]', atencion: 'bg-[#fffbec] border-[#efdc9a]', proxima: 'bg-[#fff5ec] border-[#f3c9a4]', critica: 'bg-[#fff3f2] border-[#f1b9b4]', vencida: 'bg-[#eef0f3] border-[#c5cad3]' }[guarantee.estado];
  return (
    <div className="page-in space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3"><button onClick={() => nav('garantias')} className="grid size-9 place-items-center rounded-lg border border-line bg-white hover:bg-canvas" aria-label="Volver"><ArrowLeft className="size-4" /></button><div><h2 className="text-2xl font-semibold">Detalle de garantía</h2><p className="text-sm text-muted">Garantías / {guarantee.nombre}</p></div></div>
        <div className="flex gap-2"><Btn onClick={() => nav('garantias')}>Volver</Btn><Btn variant="primary" onClick={() => onGestionar(guarantee.id)}>{done ? <><CheckCircle2 className="size-4" />Gestionada</> : 'Marcar como gestionada'}</Btn></div>
      </div>
      <div className={cx('flex items-center justify-between rounded-xl border-2 px-7 py-5', hero)}>
        <div><p className="text-xs font-semibold uppercase tracking-wider text-muted">Fecha límite</p><p className="tnum text-3xl font-semibold">{fmt(guarantee.limite)}</p></div>
        <div className="text-center"><p className="text-xs font-semibold uppercase tracking-wider text-muted">{guarantee.dias < 0 ? 'Vencida' : 'Plazo restante'}</p><p className="text-3xl font-semibold">{guarantee.dias < 0 ? `Hace ${-guarantee.dias} días` : guarantee.dias === 0 ? 'Vence hoy' : `Faltan ${guarantee.dias} ${guarantee.dias === 1 ? 'día' : 'días'}`}</p></div>
        <div className="text-right"><p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Estado</p><span className={cx('inline-block rounded-lg px-4 py-1.5 text-lg font-semibold uppercase tracking-wide ring-1 ring-inset', STATUS[guarantee.estado].badge)}>{STATUS[guarantee.estado].label}</span></div>
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_1fr]">
        <div className="space-y-5"><Card><CardHeader title="Información del paciente" /><dl className="grid grid-cols-3 gap-5 p-5"><Field label="Nombre">{guarantee.nombre}</Field><Field label="RUT"><span className="font-mono">{guarantee.rut}</span></Field><Field label="DV">{guarantee.dv}</Field></dl></Card>
          <Card><CardHeader title="Información de la garantía" /><dl className="grid grid-cols-2 gap-5 p-5"><Field label="Problema de salud">{guarantee.problema}</Field><Field label="Nombre de la garantía">{guarantee.garantia}</Field><Field label="Fecha de inicio"><span className="tnum">{fmt(guarantee.inicio)}</span></Field><Field label="Fecha límite"><span className="tnum">{fmt(guarantee.limite)}</span></Field><Field label="Días restantes"><Days d={guarantee.dias} /></Field><Field label="Estado"><StatusBadge s={guarantee.estado} /></Field><Field label="Responsable">{guarantee.responsable}</Field><Field label="Gestión">{done ? <span className="text-[#256b45]">Marcada como gestionada</span> : <span className="text-muted">Sin gestionar</span>}</Field></dl></Card>
        </div>
        <Card><CardHeader title="Historial de notificaciones" sub="El historial real estará disponible en una etapa posterior." /><p className="p-5 text-sm text-muted">Esta garantía aún no tiene eventos de notificación disponibles desde la API.</p></Card>
      </div>
    </div>
  );
}




