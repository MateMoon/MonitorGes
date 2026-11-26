// @vitest-environment jsdom
import { createElement, type ComponentType } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
const servicePath = '../../src/services/supervision.ts', panelPath = '../../src/pages/SupervisionActivity.tsx';
const { getSupervisionActivity } = await import(servicePath);
const { default: Panel } = await import(panelPath) as { default: ComponentType<any> };
const fetchMock = vi.fn(), nav = vi.fn();
const guarantee = { id: 'existing-guarantee', paciente: { nombre: 'Paciente sintético' }, problemaSalud: 'Problema sintético', nombreGarantia: 'Garantía sintética', establecimiento: 'Centro sintético', estadoGestion: 'EN_GESTION' };
const normal = { id: 'normal-event', secuencia: 2, tipo: 'ACTUACION', tipoActuacion: 'CITACION', comentario: 'Comentario de gestión previo', estadoAnterior: 'SIN_GESTION', estadoNuevo: 'EN_GESTION', respaldo: null, createdAt: '2026-11-18T12:00:00Z', autorNombre: 'Gestor histórico', usuarioId: 'professional-id', garantia: guarantee };
const review = (decision: 'MISMA' | 'DISTINTA', extra = {}) => {
  const id = decision.toLowerCase(), resultId = decision === 'MISMA' ? 'preserved-guarantee' : 'created-guarantee';
  return { id: `revision-importacion:${id}`, secuencia: null, tipo: 'REVISION_IMPORTACION', tipoActuacion: null, comentario: null, estadoAnterior: null, estadoNuevo: null, respaldo: null,
    createdAt: decision === 'MISMA' ? '2026-11-18T12:30:00Z' : '2026-11-18T12:40:00Z', autorNombre: 'Supervisora histórica', usuarioId: 'supervisor-id', garantia: { ...guarantee, id: resultId },
    revisionImportacion: { id, decision, descripcion: decision === 'MISMA' ? 'Se confirmó que los datos recibidos corresponden a una garantía existente' : 'Se confirmó una garantía distinta y se incorporó un nuevo registro', justificacion: `Justificación sintética ${decision}`, garantiaResultadoId: resultId, origen: { importacionId: 'import-id', archivo: 'nomina-sintetica.xlsx', hoja: 'Hoja de origen', numeroFila: decision === 'MISMA' ? 8 : 9 } }, ...extra,
  };
};
const data = () => ({ generadoAt: '2026-11-18T13:00:00Z', zonaHoraria: 'America/Santiago', alcance: 'GLOBAL', limite: 30, eventos: [review('DISTINTA'), review('MISMA'), normal] });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: data() }) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('identifica una actualización de datos como revisión y conserva el enlace a la garantía existente', async () => {
  const event = review('MISMA');
  const updated = { ...event, revisionImportacion: { ...event.revisionImportacion, actualizarDatos: true, descripcion: 'Se actualizaron los datos conservando la gestión' } };
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { ...data(), eventos: [updated] } }) });
  render(createElement(Panel, { isAdmin: true, nav, onSessionExpired: vi.fn() }));
  await screen.findByText('Datos actualizados · Gestión conservada');
  expect(screen.getByText('Revisión de importación')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Abrir garantía de Paciente sintético' }));
  expect(nav).toHaveBeenCalledWith('detalle', { id: 'preserved-guarantee' });
});
it('rechaza una marca de actualización incompatible o no booleana en la respuesta del historial', async () => {
  for (const [decision, flag] of [['DISTINTA', true], ['MISMA', 'true'], ['MISMA', false]] as const) {
    const event = review(decision);
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { ...data(), eventos: [{ ...event, revisionImportacion: { ...event.revisionImportacion, actualizarDatos: flag } }] } }) });
    await expect(getSupervisionActivity()).rejects.toMatchObject({ code: 'INVALID_SUPERVISION_ACTIVITY_RESPONSE' });
  }
});
it('admite ambas resoluciones y actuaciones en el mismo contrato sin transformar su orden', async () => {
  const result = await getSupervisionActivity(); expect(result).toEqual(data());
  expect(result.eventos.map((value: any) => value.tipo)).toEqual(['REVISION_IMPORTACION', 'REVISION_IMPORTACION', 'ACTUACION']);
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store', credentials: 'include' });
});
it('muestra tipo, decisión, autor, justificación y procedencia sin presentarlas como actuaciones', async () => {
  render(createElement(Panel, { isAdmin: true, nav, onSessionExpired: vi.fn() }));
  const list = await screen.findByRole('list', { name: 'Eventos de gestión' }), items = within(list).getAllByRole('listitem');
  expect(items).toHaveLength(3); expect(screen.getAllByText('Revisión de importación')).toHaveLength(2);
  expect(items[0].textContent).toContain('DISTINTA · Nueva garantía'); expect(items[1].textContent).toContain('MISMA · Garantía conservada');
  expect(items[0].textContent).toContain('Justificación sintética DISTINTA'); expect(items[1].textContent).toContain('Justificación sintética MISMA');
  expect(items[0].textContent).toContain('nomina-sintetica.xlsx · Hoja de origen · Fila 9'); expect(items[1].textContent).toContain('Fila 8');
  expect(items[0].textContent).toContain('Supervisora histórica'); expect(items[2].textContent).toContain('Actuación registrada');
  expect(items[2].textContent).toContain('Citación / hora agendada'); expect(items[2].textContent).toContain('Comentario de gestión previo');
  for (const item of items.slice(0, 2)) { expect(item.textContent).not.toContain('Citación'); expect(within(item).queryByLabelText('Cambio de estado de gestión')).toBeNull(); }
  expect(within(list).getAllByRole('listitem').map(item => item.querySelector('time')?.dateTime)).toEqual(data().eventos.map(value => value.createdAt));
  const expected = new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Santiago' }).format(new Date(data().eventos[0].createdAt));
  expect(items[0].textContent).toContain(expected);
});
it('abre el ID conservado o creado correspondiente a cada revisión', async () => {
  render(createElement(Panel, { isAdmin: true, nav, onSessionExpired: vi.fn() }));
  const items = within(await screen.findByRole('list', { name: 'Eventos de gestión' })).getAllByRole('listitem');
  await userEvent.click(within(items[0]).getByRole('button', { name: 'Abrir garantía de Paciente sintético' })); expect(nav).toHaveBeenLastCalledWith('detalle', { id: 'created-guarantee' });
  await userEvent.click(within(items[1]).getByRole('button', { name: 'Abrir garantía de Paciente sintético' })); expect(nav).toHaveBeenLastCalledWith('detalle', { id: 'preserved-guarantee' });
});
it('conserva las justificaciones extensas desplegables y el origen no disponible', async () => {
  const value = review('MISMA'); value.revisionImportacion.justificacion = 'Justificación sintética extensa. '.repeat(30);
  (value.revisionImportacion.origen as any) = { importacionId: 'import-id', archivo: null, hoja: null, numeroFila: null };
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { ...data(), eventos: [value] } }) });
  render(createElement(Panel, { isAdmin: true, nav, onSessionExpired: vi.fn() }));
  expect(await screen.findByText('Ver justificación')).toBeTruthy(); expect(screen.getByText('Origen no disponible')).toBeTruthy();
  expect(screen.getByText(value.revisionImportacion.justificacion.trim())).toBeTruthy();
});
it.each(['missing-review', 'invalid-decision', 'incorrect-link', 'fake-action', 'fake-sequence', 'missing-source', 'incorrect-id', 'missing-author'])('rechaza la revisión incompleta o contradictoria: %s', async scenario => {
  const value: any = review('MISMA');
  if (scenario === 'missing-review') delete value.revisionImportacion;
  if (scenario === 'invalid-decision') value.revisionImportacion.decision = 'FUSION';
  if (scenario === 'incorrect-link') value.revisionImportacion.garantiaResultadoId = 'different-guarantee';
  if (scenario === 'fake-action') value.tipoActuacion = 'CITACION';
  if (scenario === 'fake-sequence') value.secuencia = 42;
  if (scenario === 'missing-source') delete value.revisionImportacion.origen;
  if (scenario === 'incorrect-id') value.id = 'some-fabricated-id';
  if (scenario === 'missing-author') value.autorNombre = null;
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { ...data(), eventos: [value] } }) });
  await expect(getSupervisionActivity()).rejects.toMatchObject({ code: 'INVALID_SUPERVISION_ACTIVITY_RESPONSE' });
});
