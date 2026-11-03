import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    usuario: { findUnique: vi.fn() },
    establecimiento: { findMany: vi.fn() },
    combinacionProblemaGarantia: { findMany: vi.fn() },
    areaResponsabilidad: { findMany: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
  };
  return { tx, transaction: vi.fn() };
});
vi.mock("../src/db/prisma.js", () => ({ prisma: { $transaction: mocks.transaction } }));
import { saveUserAreas } from "../src/modules/areas-responsabilidad/repository.js";

const userId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const selection = { establecimientoId: "00000000-0000-4000-8000-000000000003", combinacionId: "00000000-0000-4000-8000-000000000004" };

describe("persistencia de áreas de responsabilidad", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx));
    mocks.tx.usuario.findUnique.mockResolvedValue({ id: userId, activo: true });
    mocks.tx.establecimiento.findMany.mockResolvedValue([{ id: selection.establecimientoId }]);
    mocks.tx.combinacionProblemaGarantia.findMany.mockResolvedValue([{ id: selection.combinacionId }]);
    mocks.tx.areaResponsabilidad.findMany.mockResolvedValue([]);
    mocks.tx.areaResponsabilidad.updateMany.mockResolvedValue({ count: 0 });
    mocks.tx.areaResponsabilidad.upsert.mockResolvedValue({ id: "area-ficticia", ...selection, usuarioId: userId, activa: true });
  });

  it("acepta varias coberturas, quita duplicados del cuerpo y realiza un upsert idempotente", async () => {
    const second = { establecimientoId: "00000000-0000-4000-8000-000000000005", combinacionId: selection.combinacionId };
    mocks.tx.establecimiento.findMany.mockResolvedValue([{ id: selection.establecimientoId }, { id: second.establecimientoId }]);
    mocks.tx.areaResponsabilidad.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const result = await saveUserAreas(userId, actorId, [selection, selection, second]);
    expect(result.ok).toBe(true);
    expect(mocks.tx.areaResponsabilidad.upsert).toHaveBeenCalledTimes(2);
    expect(mocks.tx.areaResponsabilidad.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { usuarioId_establecimientoId_combinacionId: { usuarioId: userId, ...selection } },
      update: { activa: true, actualizadorId: actorId },
    }));
  });

  it("reactiva una cobertura inactiva mediante la clave única, sin crear una fila paralela", async () => {
    mocks.tx.areaResponsabilidad.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "area-reactivada", ...selection, usuarioId: userId, activa: true }]);
    const result = await saveUserAreas(userId, actorId, [selection]);
    expect(result.ok).toBe(true);
    expect(mocks.tx.areaResponsabilidad.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.tx.areaResponsabilidad.upsert.mock.calls[0][0]).toMatchObject({
      where: { usuarioId_establecimientoId_combinacionId: { usuarioId: userId, ...selection } },
      update: { activa: true, actualizadorId: actorId },
    });
  });

  it("desactiva las coberturas quitadas y conserva sus filas", async () => {
    mocks.tx.areaResponsabilidad.findMany.mockResolvedValueOnce([{ id: "area-se-conserva", establecimientoId: selection.establecimientoId, combinacionId: selection.combinacionId }]).mockResolvedValueOnce([]);
    const result = await saveUserAreas(userId, actorId, []);
    expect(result.ok).toBe(true);
    expect(mocks.tx.areaResponsabilidad.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["area-se-conserva"] } }, data: { activa: false, actualizadorId: actorId } });
    expect(mocks.tx.areaResponsabilidad.upsert).not.toHaveBeenCalled();
  });

  it("rechaza asignar coberturas activas a un usuario inactivo antes de escribir", async () => {
    mocks.tx.usuario.findUnique.mockResolvedValue({ id: userId, activo: false });
    const result = await saveUserAreas(userId, actorId, [selection]);
    expect(result).toEqual({ ok: false, reason: "INACTIVE_USER" });
    expect(mocks.tx.areaResponsabilidad.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.areaResponsabilidad.upsert).not.toHaveBeenCalled();
  });

  it("rechaza establecimientos o combinaciones inactivos o inexistentes", async () => {
    mocks.tx.establecimiento.findMany.mockResolvedValue([]);
    const result = await saveUserAreas(userId, actorId, [selection]);
    expect(result).toEqual({ ok: false, reason: "INVALID_CATALOG_SELECTION" });
    expect(mocks.tx.areaResponsabilidad.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.areaResponsabilidad.upsert).not.toHaveBeenCalled();
  });
});
