import { useRef, useState, type FormEvent } from 'react';
import { History, Loader2, RotateCcw } from 'lucide-react';
import { ACTIONS, MANAGEMENT } from '../management';
import type { EstadoGestion, GarantiaSeguimiento, TipoActuacion } from '../types';
import { cambiarEstadoGestion, reabrirGarantia, type ActuacionInput, type GestionGarantiaResult } from '../services/garantias';
import { Btn, Card, CardHeader, cx, inputCls } from '../ui';

const EVENT_LABEL = { ACTUACION: 'Actuación registrada', CAMBIO_ESTADO: 'Cambio de estado', CUMPLIMIENTO: 'Cumplimiento acreditado', REAPERTURA: 'Seguimiento reabierto', ANTECEDENTE_LEGADO: 'Última gestión anterior al historial' };
const formatTime = (value: string) => new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Santiago' }).format(new Date(value));

export default function SeguimientoGarantia({ guarantee, canManage, isAdmin, onGestionar, onSaved, onRefresh }: {
  guarantee: GarantiaSeguimiento; canManage: boolean; isAdmin: boolean;
  onGestionar: (id: string | number, input: ActuacionInput) => Promise<GestionGarantiaResult>;
  onSaved: (result: GestionGarantiaResult) => void; onRefresh: () => void;
}) {
  const [tipoActuacion, setTipo] = useState<TipoActuacion>('CONTACTO_PACIENTE');
  const [comentario, setComentario] = useState('');
  const [target, setTarget] = useState<Exclude<EstadoGestion, 'SIN_GESTION'>>('PENDIENTE_RESOLUCION');
  const [stateComment, setStateComment] = useState('');
  const [respaldo, setRespaldo] = useState('');
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  const completed = guarantee.estadoGestion === 'CUMPLIDA';
  const events = guarantee.eventos ?? [];
  const currentEvidence = completed ? events.find((event) => event.tipo === 'CUMPLIMIENTO') : undefined;
  const save = async (event: FormEvent, request: () => Promise<GestionGarantiaResult>) => {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      const result = await request();
      onSaved(result);
      setComentario(''); setStateComment(''); setRespaldo(''); setMotivo('');
      setNotice('Seguimiento guardado correctamente.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No fue posible guardar el seguimiento.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <section aria-label="Seguimiento de la garantía" className="space-y-4">
    <div className="flex flex-wrap items-center gap-3"><h3 className="text-lg font-semibold">Seguimiento de gestión</h3><span className={cx('rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset', MANAGEMENT[guarantee.estadoGestion].badge)}>{MANAGEMENT[guarantee.estadoGestion].label}</span></div>
    <p className="text-sm text-muted">{MANAGEMENT[guarantee.estadoGestion].desc}</p>
    {notice && <p role="status" className="rounded-lg bg-[#e6f4ec] p-3 text-sm text-[#256b45]">{notice}</p>}
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[#fbe7e5] p-3 text-sm text-[#a12a22]"><span>{error}</span><Btn onClick={onRefresh} disabled={busy}>Recargar detalle</Btn></div>}
    {currentEvidence && <Card className="border-[#bfe1cd] p-5"><h4 className="font-semibold text-[#256b45]">Respaldo del cumplimiento vigente</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm">{currentEvidence.respaldo}</p><p className="mt-2 text-xs text-muted">{currentEvidence.autorNombre ?? 'Funcionario no disponible'} · {formatTime(currentEvidence.createdAt)}</p></Card>}
    <div className="grid items-start gap-5 xl:grid-cols-2">
      <div className="space-y-5">
        {canManage && !completed && <Card><CardHeader title="Registrar gestión" sub="El comentario es opcional" />
          <form onSubmit={(event) => void save(event, () => onGestionar(guarantee.id, { tipoActuacion, comentario, revisionGestion: guarantee.revisionGestion }))} className="space-y-3 p-5">
            <fieldset disabled={busy} className="space-y-3">
              <label className="block text-sm font-medium">Tipo de actuación<select className={`${inputCls} mt-1`} value={tipoActuacion} onChange={(event) => setTipo(event.target.value as TipoActuacion)}>{Object.entries(ACTIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label className="block text-sm font-medium">Comentario (opcional)<textarea maxLength={4000} rows={3} className={`${inputCls} mt-1 resize-y`} value={comentario} onChange={(event) => setComentario(event.target.value)} /></label>
              <p className="text-xs text-muted">Registrar una actuación no acredita el cumplimiento ni modifica la fecha límite.</p>
              <div className="flex justify-end"><Btn type="submit" variant="primary" disabled={busy}>{busy ? <><Loader2 className="size-4 animate-spin" />Guardando…</> : 'Registrar gestión'}</Btn></div>
            </fieldset>
          </form>
        </Card>}
        {isAdmin && <Card><CardHeader title={completed ? 'Reabrir seguimiento' : 'Cambiar estado de gestión'} sub="Acción de administración" />
          {completed ? <form onSubmit={(event) => void save(event, () => reabrirGarantia(guarantee.id, motivo, guarantee.revisionGestion))} className="space-y-3 p-5">
            <p className="text-sm text-muted">La garantía volverá a Pendiente de resolución. El respaldo anterior se conserva en el historial.</p>
            <label className="block text-sm font-medium">Motivo de reapertura<textarea required maxLength={4000} rows={3} disabled={busy} className={`${inputCls} mt-1`} value={motivo} onChange={(event) => setMotivo(event.target.value)} /></label>
            <Btn type="submit" disabled={busy || !motivo.trim()}><RotateCcw className="size-4" />Reabrir seguimiento</Btn>
          </form> : <form onSubmit={(event) => void save(event, () => cambiarEstadoGestion(guarantee.id, { estadoGestion: target, comentario: stateComment, ...(target === 'CUMPLIDA' ? { respaldo } : {}), revisionGestion: guarantee.revisionGestion }))} className="space-y-3 p-5">
            <label className="block text-sm font-medium">Nuevo estado<select disabled={busy} className={`${inputCls} mt-1`} value={target} onChange={(event) => setTarget(event.target.value as typeof target)}>{(['EN_GESTION', 'PENDIENTE_RESOLUCION', 'CUMPLIDA'] as const).map((state) => <option key={state} value={state}>{MANAGEMENT[state].label}{state === guarantee.estadoGestion ? ' (actual)' : ''}</option>)}</select></label>
            <label className="block text-sm font-medium">Comentario (opcional)<textarea disabled={busy} maxLength={4000} rows={2} className={`${inputCls} mt-1`} value={stateComment} onChange={(event) => setStateComment(event.target.value)} /></label>
            {target === 'CUMPLIDA' && <label className="block text-sm font-medium">Respaldo o justificación de cumplimiento (obligatorio)<textarea required disabled={busy} maxLength={4000} rows={3} className={`${inputCls} mt-1`} value={respaldo} onChange={(event) => setRespaldo(event.target.value)} /></label>}
            <Btn type="submit" variant="primary" disabled={busy || target === guarantee.estadoGestion || (target === 'CUMPLIDA' && !respaldo.trim())}>Confirmar cambio de estado</Btn>
          </form>}
        </Card>}
        {completed && !isAdmin && <p className="rounded-lg bg-canvas p-4 text-sm text-muted">Un administrador debe reabrir la garantía antes de registrar nuevas actuaciones.</p>}
        {!canManage && <p className="text-sm text-muted">Tu perfil permite consultar el seguimiento.</p>}
      </div>
      <Card><CardHeader title="Historial de gestiones y cambios" sub={`${events.length} registros · hora de Santiago`} right={<History className="size-4 text-muted" />} />
        {events.length === 0 ? <p className="p-5 text-sm text-muted">Sin actuaciones ni cambios registrados.</p> : <ol className="max-h-[680px] space-y-5 overflow-y-auto p-5">
          {events.map((event) => <li key={event.id} className="border-l-2 border-line pl-4">
            <p className="text-sm font-semibold">{EVENT_LABEL[event.tipo]}{event.tipoActuacion ? ` · ${ACTIONS[event.tipoActuacion]}` : ''}</p>
            {event.estadoAnterior && event.estadoNuevo && event.estadoAnterior !== event.estadoNuevo && <p className="mt-1 text-xs text-muted">{MANAGEMENT[event.estadoAnterior].label} → {MANAGEMENT[event.estadoNuevo].label}</p>}
            {event.comentario && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{event.tipo === 'REAPERTURA' ? 'Motivo: ' : ''}{event.comentario}</p>}
            {event.respaldo && <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-canvas p-3 text-sm">Respaldo registrado en este evento: {event.respaldo}</p>}
            {event.tipo === 'ANTECEDENTE_LEGADO' && <p className="mt-1 text-xs text-muted">Antecedente conservado con su fecha y autor originales. No se conoce el tipo ni el comentario.</p>}
            <p className="mt-2 text-xs text-muted">{event.autorNombre ?? 'Funcionario no disponible'} · {formatTime(event.createdAt)}</p>
          </li>)}
        </ol>}
      </Card>
    </div>
  </section>;
}
