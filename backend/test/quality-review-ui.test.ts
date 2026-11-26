// @vitest-environment jsdom
import { createElement, type ComponentType } from 'react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
const api = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), resolve: vi.fn(), current: vi.fn(), decisions: vi.fn() }));
vi.mock('../../src/services/calidad-datos', () => ({ getPendingQualityRows: api.list, getQualityReview: api.detail, resolveQualityReview: api.resolve, getQualityDecisions: api.decisions }));
vi.mock('../../src/services/auth', () => ({ getCurrentUser: api.current, logout: vi.fn(), login: vi.fn() }));
vi.mock('../../src/pages/pages1', async original => ({ ...await original<object>(), Dashboard: () => createElement('p', null, 'Dashboard de prueba') }));
const modalPath = '../../src/components/calidad/ReviewGuaranteeModal.tsx', pagePath = '../../src/pages/CalidadDatos.tsx', appPath = '../../src/App.tsx', errorPath = '../../src/services/api.ts';
const { default: Modal } = await import(modalPath) as { default: ComponentType<any> };
const { default: Page } = await import(pagePath) as { default: ComponentType<any> };
const { default: App } = await import(appPath) as { default: ComponentType };
const { ApiError } = await import(errorPath);
const candidate = { id: 'candidate-1', datos: { fechaInicio: '2026-11-10', fechaLimite: '2026-11-30', responsable: 'Centro sintético', estadoGestion: 'EN_GESTION' }, estadoGestion: 'EN_GESTION', actuacionesDisponibles: 2, diferencias: ['fechaInicio', 'fechaLimite'], comparacion: [] };
const detail = { id: 'row-1', importacionId: 'import-1', hoja: 'Nómina', numeroFila: 2, estado: 'PENDIENTE', version: 1, datosNomina: { nombre: 'Paciente sintético', fechaInicio: '2026-11-12', fechaLimite: '2026-12-02', responsable: 'Centro sintético', nombreGarantia: 'Garantía sintética' }, motivos: ['FECHA_INICIO_DISTINTA'], candidatas: [candidate], huellaRevision: 'a'.repeat(64), puedeResolver: true, antecedentesCambiaron: false, resolucion: null };
const resolution = { id: 'decision-1', filaId: detail.id, decision: 'MISMA', justificacion: 'Antecedentes revisados', garantiaResultadoId: candidate.id, usuario: { id: 'admin', nombre: 'Cuenta sintética' }, createdAt: '2026-11-25T12:00:00Z' };
const rows = { data: [{ id: detail.id, importacionId: 'import-1', hoja: 'Nómina', numeroFila: 2, nombre: 'Paciente sintético', problemaSalud: 'Problema sintético', nombreGarantia: 'Garantía sintética', motivos: ['FECHA_INICIO_DISTINTA'], candidatas: 1 }], pendientesTotales: 1, pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } };
const close = vi.fn(), resolved = vi.fn(), expired = vi.fn();
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockReset().mockResolvedValue(structuredClone(rows)); api.detail.mockReset().mockResolvedValue(structuredClone(detail)); api.resolve.mockReset().mockResolvedValue({ resolucion: resolution, repetida: false });
  api.current.mockReset().mockResolvedValue({ id: 'admin', nombre: 'Cuenta sintética', rol: 'ADMIN' });
  api.decisions.mockReset().mockResolvedValue({ data: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } });
});
afterEach(cleanup);
it('carga el historial real al abrirlo y muestra decisión, autor, origen y justificación', async () => {
  api.decisions.mockResolvedValue({ data: [{ ...resolution, origen: { importacionId: 'import-1', hoja: 'Hoja histórica', numeroFila: 7 } }], pagination: { page: 1, limit: 10, total: 1, totalPages: 1 } });
  render(createElement(Page, { role: 'ADMIN', onSessionExpired: expired }));
  await screen.findByText('1 pendiente'); expect(api.decisions).not.toHaveBeenCalled();
  await userEvent.click(screen.getByText('Historial de decisiones'));
  await screen.findByText('MISMA · Garantía conservada');
  expect(screen.getByText('Cuenta sintética · Hoja histórica · Fila 7')).toBeTruthy();
  expect(screen.getByText('Antecedentes revisados')).toBeTruthy();
  const expectedTime = new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Santiago' }).format(new Date(resolution.createdAt));
  expect(screen.getByText(expectedTime)).toBeTruthy();
});
it('un historial vacío no inventa decisiones y permite reintentar un error', async () => {
  api.decisions.mockRejectedValueOnce(new Error('Consulta temporalmente no disponible'));
  render(createElement(Page, { role: 'COORDINADOR_SOME', onSessionExpired: expired }));
  await userEvent.click(screen.getByText('Historial de decisiones'));
  await screen.findByText('Consulta temporalmente no disponible');
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar historial' }));
  await screen.findByText('Todavía no hay decisiones registradas.');
});
const open = async () => {
  render(createElement(Modal, { rowId: detail.id, onClose: close, onResolved: resolved, onSessionExpired: expired }));
  await screen.findByRole('radio', { name: 'Es la misma garantía' });
};
const fill = async (decision = 'Es la misma garantía') => {
  await userEvent.click(screen.getByRole('radio', { name: decision }));
  await userEvent.type(screen.getByLabelText('Justificación'), 'Antecedentes revisados');
};
it('conserva la composición aprobada sin decisión inicial ni textos de demostración', async () => {
  await open();
  const dialog = screen.getByRole('dialog', { name: 'Revisar garantía' });
  const sections = within(dialog).getAllByRole('region');
  expect(sections.map(section => section.getAttribute('aria-label'))).toEqual(['Garantía existente', 'Nueva nómina']);
  expect(screen.getByText('Prioritaria')).toBeTruthy(); expect(screen.getByText('Por revisar')).toBeTruthy();
  expect(screen.getByText('No informado')).toBeTruthy(); expect(screen.getByText('10/11/2026')).toBeTruthy();
  expect(screen.getByText('12/11/2026')).toBeTruthy();
  for (const radio of screen.getAllByRole('radio')) expect((radio as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole('button', { name: 'Confirmar decisión' }) as HTMLButtonElement).disabled).toBe(true);
  expect(dialog.textContent).not.toMatch(/demostración|demo|ejemplo visual|no conectado/i);
  expect(sections[0].parentElement!.className).toContain('grid-cols-1'); expect(sections[0].parentElement!.className).toContain('sm:grid-cols-2');
  expect(within(sections[0]).getAllByText(/Valor diferente/).length).toBe(2);
});
it('MISMA envía candidata, versión, token y justificación al endpoint real del cliente', async () => {
  await open(); await fill();
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar decisión' }));
  await screen.findByText(/Decisión registrada. Se conservó la garantía existente/);
  expect(api.resolve).toHaveBeenCalledWith(detail.id, expect.objectContaining({ decision: 'MISMA', garantiaExistenteId: candidate.id, version: 1, huellaRevision: detail.huellaRevision, justificacion: 'Antecedentes revisados', solicitudId: expect.any(String) }));
  expect(api.resolve.mock.calls[0][1]).not.toHaveProperty('confirmaDistintaDeTodas'); expect(resolved).toHaveBeenCalledWith(resolution);
});
it('DISTINTA confirma que es distinta de todas y muestra el resultado de creación', async () => {
  api.resolve.mockResolvedValue({ resolucion: { ...resolution, decision: 'DISTINTA', garantiaResultadoId: 'new-1' }, repetida: false });
  await open(); await fill('Es una garantía distinta');
  expect(screen.getByText(/distinta de todas las candidatas/)).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar decisión' }));
  await screen.findByText(/Se creó una nueva garantía sin modificar las anteriores/);
  expect(api.resolve.mock.calls[0][1]).toMatchObject({ decision: 'DISTINTA', confirmaDistintaDeTodas: true }); expect(api.resolve.mock.calls[0][1]).not.toHaveProperty('garantiaExistenteId');
});
it('actualizar conserva gestión, exige justificación y envía únicamente el indicador explícito y la candidata', async () => {
  api.detail.mockResolvedValue({ ...detail, puedeActualizarDatos: true });
  api.resolve.mockResolvedValue({ resolucion: { ...resolution, actualizarDatos: true }, repetida: false });
  await open();
  expect((screen.getByRole('radio', { name: 'Actualizar datos y conservar gestión' }) as HTMLInputElement).checked).toBe(false);
  await userEvent.click(screen.getByRole('radio', { name: 'Actualizar datos y conservar gestión' }));
  expect(screen.getByText(/Se conservan su identificador, los datos del paciente, el estado, las gestiones y el historial/)).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Confirmar decisión' }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.type(screen.getByLabelText('Justificación'), 'Actualizar según nómina ficticia revisada');
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar decisión' }));
  await screen.findByText(/Decisión registrada. Se actualizaron los datos/);
  expect(api.resolve.mock.calls[0][1]).toMatchObject({ decision: 'MISMA', actualizarDatos: true, garantiaExistenteId: candidate.id, version: 1, huellaRevision: detail.huellaRevision });
  expect(api.resolve.mock.calls[0][1]).not.toHaveProperty('estadoGestion');
  expect((screen.getByRole('radio', { name: 'Actualizar datos y conservar gestión' }) as HTMLInputElement).checked).toBe(true);
});
it('actualizar con varias candidatas exige selección explícita y conserva la separación de MISMA', async () => {
  api.detail.mockResolvedValue({ ...detail, puedeActualizarDatos: true, candidatas: [candidate, { ...candidate, id: 'candidate-2' }] });
  await open(); await fill('Actualizar datos y conservar gestión');
  expect((screen.getByRole('button', { name: 'Confirmar decisión' }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Garantía candidata' }), 'candidate-2');
  expect((screen.getByRole('button', { name: 'Confirmar decisión' }) as HTMLButtonElement).disabled).toBe(false);
  await userEvent.click(screen.getByRole('radio', { name: 'Es la misma garantía' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar decisión' }));
  await screen.findByText(/Decisión registrada. Se conservó la garantía existente/);
  expect(api.resolve.mock.calls[0][1]).not.toHaveProperty('actualizarDatos');
});
it('no ofrece actualizar antes de que el backend lo soporte ni confirma datos que ya son iguales', async () => {
  await open(); expect(screen.queryByRole('radio', { name: 'Actualizar datos y conservar gestión' })).toBeNull();
  cleanup(); api.detail.mockResolvedValue({ ...detail, puedeActualizarDatos: true, candidatas: [{ ...candidate, datos: { ...detail.datosNomina, estadoGestion: 'EN_GESTION' } }] });
  await open(); await fill('Actualizar datos y conservar gestión');
  expect(screen.getByText(/La garantía ya tiene esos datos/)).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Confirmar decisión' }) as HTMLButtonElement).disabled).toBe(true);
});
it('el historial identifica las actualizaciones conservando las decisiones anteriores', async () => {
  api.decisions.mockResolvedValue({ data: [{ ...resolution, actualizarDatos: true, origen: { importacionId: 'import-1', hoja: 'Nómina ficticia', numeroFila: 2 } }], pagination: { page: 1, limit: 10, total: 1, totalPages: 1 } });
  render(createElement(Page, { role: 'ADMIN', onSessionExpired: expired }));
  await userEvent.click(screen.getByText('Historial de decisiones'));
  await screen.findByText('Datos actualizados · Gestión conservada');
});
it('exige justificación válida y selección explícita con varias candidatas', async () => {
  api.detail.mockResolvedValue({ ...detail, candidatas: [candidate, { ...candidate, id: 'candidate-2' }] });
  await open(); await fill();
  const button = screen.getByRole('button', { name: 'Confirmar decisión' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Garantía candidata' }), 'candidate-2');
  expect(button.disabled).toBe(false);
  fireEvent.change(screen.getByLabelText('Justificación'), { target: { value: '   ' } }); expect(button.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Justificación'), { target: { value: 'Antecedentes revisados' } });
  await userEvent.click(button); expect(api.resolve.mock.calls[0][1].garantiaExistenteId).toBe('candidate-2');
});
it('permite cerrar y cancelar con Escape sin enviar decisiones', async () => {
  await open(); await userEvent.click(screen.getByRole('button', { name: 'Cerrar revisión' })); expect(close).toHaveBeenCalledOnce();
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true })); expect(close).toHaveBeenCalledTimes(2); expect(api.resolve).not.toHaveBeenCalled();
});
it('evita el doble envío mientras guarda y no permite cerrar una operación enviada', async () => {
  let finish!: (value: unknown) => void; api.resolve.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await open(); await fill();
  const button = screen.getByRole('button', { name: 'Confirmar decisión' }); fireEvent.click(button); fireEvent.click(button);
  expect(api.resolve).toHaveBeenCalledOnce(); expect((screen.getByRole('button', { name: 'Cerrar revisión' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true })); expect(close).not.toHaveBeenCalled();
  finish({ resolucion: resolution, repetida: false }); await screen.findByText(/Decisión registrada. Se conservó/);
});
it('un reintento de red reutiliza exactamente la solicitud persistente', async () => {
  api.resolve.mockRejectedValueOnce(new TypeError('Respuesta interrumpida')).mockResolvedValueOnce({ resolucion: resolution, repetida: true });
  await open(); await fill(); await userEvent.click(screen.getByRole('button', { name: 'Confirmar decisión' })); await screen.findByRole('alert');
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar decisión' })); await screen.findByText(/Decisión registrada. Se conservó/);
  expect(api.resolve.mock.calls[0][1]).toEqual(api.resolve.mock.calls[1][1]);
});
it('un conflicto exige recargar y volver a elegir antes de confirmar', async () => {
  api.resolve.mockRejectedValueOnce(new ApiError('Las candidatas cambiaron.', [], 'STALE_CANDIDATES'));
  await open(); await fill(); await userEvent.click(screen.getByRole('button', { name: 'Confirmar decisión' }));
  await screen.findByText('Las candidatas cambiaron.'); expect((screen.getByRole('button', { name: 'Confirmar decisión' }) as HTMLButtonElement).disabled).toBe(true);
  api.detail.mockResolvedValue({ ...detail, huellaRevision: 'b'.repeat(64) });
  await userEvent.click(screen.getByRole('button', { name: 'Actualizar datos' })); await screen.findByRole('radio', { name: 'Es la misma garantía' });
  expect((screen.getByRole('radio', { name: 'Es la misma garantía' }) as HTMLInputElement).checked).toBe(false);
  await userEvent.click(screen.getByRole('radio', { name: 'Es la misma garantía' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar decisión' })); await waitFor(() => expect(api.resolve).toHaveBeenCalledTimes(2));
  expect(api.resolve.mock.calls[1][1].huellaRevision).toBe('b'.repeat(64)); expect(api.resolve.mock.calls[1][1].solicitudId).not.toBe(api.resolve.mock.calls[0][1].solicitudId);
});
it('sin candidatas informa la ausencia y solo permite decidir DISTINTA', async () => {
  api.detail.mockResolvedValue({ ...detail, candidatas: [] }); await open();
  expect(screen.getByText('No hay garantías existentes para comparar.')).toBeTruthy(); expect((screen.getByRole('radio', { name: 'Es la misma garantía' }) as HTMLInputElement).disabled).toBe(true);
  await fill('Es una garantía distinta'); expect((screen.getByRole('button', { name: 'Confirmar decisión' }) as HTMLButtonElement).disabled).toBe(false);
});
it('una fila ya resuelta muestra la decisión existente sin volver a guardar', async () => {
  api.detail.mockResolvedValue({ ...detail, estado: 'RESUELTA', puedeResolver: false, resolucion: resolution });
  await open(); expect(screen.getByText(/Decisión registrada. Se conservó/)).toBeTruthy(); expect(api.resolve).not.toHaveBeenCalled();
});
it('la pantalla actualiza el contador después de resolver sin cerrar el resultado', async () => {
  render(createElement(Page, { role: 'ADMIN', onSessionExpired: expired }));
  await screen.findByText('1 pendiente'); await userEvent.click(screen.getByRole('button', { name: /Revisar fila/ })); await screen.findByRole('radio', { name: 'Es la misma garantía' });
  api.list.mockResolvedValue({ ...rows, data: [], pendientesTotales: 0, pagination: { ...rows.pagination, total: 0, totalPages: 0 } });
  await fill(); await userEvent.click(screen.getByRole('button', { name: 'Confirmar decisión' }));
  await screen.findByText('0 pendientes'); expect(screen.getByRole('dialog')).toBeTruthy(); expect(screen.getByText('No hay filas pendientes')).toBeTruthy();
});
it.each(['PROFESIONAL', 'LECTOR'])('%s no puede cargar la pantalla ni sus datos', async role => {
  render(createElement(Page, { role, onSessionExpired: expired })); expect(screen.getByRole('alert')).toBeTruthy(); expect(api.list).not.toHaveBeenCalled();
});
it.each(['ADMIN', 'COORDINADOR_SOME', 'PROFESIONAL', 'LECTOR'])('la navegación independiente respeta el perfil %s', async rol => {
  api.current.mockResolvedValue({ id: 'account-1', nombre: 'Cuenta sintética', rol });
  render(createElement(App)); await screen.findByText('Dashboard de prueba');
  const menu = screen.queryByRole('button', { name: 'Calidad de datos' });
  if (rol === 'ADMIN' || rol === 'COORDINADOR_SOME') { expect(menu).toBeTruthy(); await userEvent.click(menu!); await screen.findByText('1 pendiente'); }
  else { expect(menu).toBeNull(); expect(api.list).not.toHaveBeenCalled(); }
});
it('no presenta registros ficticios cuando la API está desactivada', async () => {
  api.list.mockRejectedValue(new ApiError('Calidad de datos todavía no está habilitada.', [], 'DATA_QUALITY_DISABLED'));
  render(createElement(Page, { role: 'ADMIN', onSessionExpired: expired })); await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: /Revisar fila/ })).toBeNull(); expect(screen.queryByText('Paciente sintético')).toBeNull();
});
