import { afterEach, expect, it, vi } from 'vitest';
const modulePath = '../../src/services/calidad-datos.ts';
const client = await import(modulePath);
afterEach(() => vi.unstubAllGlobals());
it('consulta el historial paginado con la sesión y cancelación existentes', async () => {
  const result = { data: [], pagination: { page: 2, limit: 10, total: 11, totalPages: 2 } };
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => result });
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  expect(await client.getQualityDecisions(2, controller.signal)).toEqual(result);
  expect(fetch.mock.calls[0][0]).toMatch(/\/api\/calidad-datos\/decisiones\?page=2&limit=10$/);
  expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'include', signal: controller.signal });
});
it('consulta los pendientes y el detalle con sesión y señal de cancelación', async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [], pendientesTotales: 0 }) }).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { id: 'synthetic-row' } }) });
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  expect(await client.getPendingQualityRows(2, controller.signal)).toMatchObject({ pendientesTotales: 0 });
  expect(fetch.mock.calls[0][0]).toMatch(/\/api\/calidad-datos\/pendientes\?page=2&limit=20$/);
  expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'include', signal: controller.signal });
  expect(await client.getQualityReview('synthetic-row', controller.signal)).toEqual({ id: 'synthetic-row' });
  expect(fetch.mock.calls[1][0]).toMatch(/\/api\/calidad-datos\/pendientes\/synthetic-row$/);
});
it('confirma contra el endpoint existente con el contrato operativo y sin un ID resultante del cliente', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { resolucion: { decision: 'DISTINTA' }, repetida: false } }) });
  vi.stubGlobal('fetch', fetch);
  const input = { decision: 'DISTINTA', confirmaDistintaDeTodas: true, version: 1, solicitudId: 'synthetic-request', huellaRevision: 'a'.repeat(64), justificacion: 'Antecedentes sintéticos revisados' };
  expect(await client.resolveQualityReview('synthetic-row', input)).toMatchObject({ resolucion: { decision: 'DISTINTA' } });
  expect(fetch.mock.calls[0][0]).toMatch(/\/api\/calidad-datos\/pendientes\/synthetic-row\/resolver$/);
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(input);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty('garantiaResultadoId');
});
