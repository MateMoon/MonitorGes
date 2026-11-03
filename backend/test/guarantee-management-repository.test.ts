import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ executeRaw: vi.fn() }));
vi.mock("../src/db/prisma.js", () => ({ prisma: { $executeRaw: database.executeRaw } }));
import { recordGuaranteeManagement } from "../src/modules/garantias/repository.js";

describe("registro de última gestión en el repositorio", () => {
  beforeEach(() => database.executeRaw.mockReset());
  afterEach(() => vi.useRealTimers());

  it("usa hora del servidor y escribe solo los dos campos de gestión", async () => {
    const serverTime = new Date("2026-10-28T15:30:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(serverTime);
    database.executeRaw.mockResolvedValueOnce(1);

    await expect(recordGuaranteeManagement("00000000-0000-4000-8000-000000000001", "user-fake")).resolves.toEqual(serverTime);

    const [sql, timestamp, userId, guaranteeId] = database.executeRaw.mock.calls[0];
    const statement = sql.join("?").replace(/\s+/g, " ").trim();
    expect(statement).toContain('UPDATE "Garantia" SET "gestionadaAt" = ?, "gestionadaPorUsuarioId" = ? WHERE "id" = ?::uuid');
    expect(timestamp).toEqual(serverTime);
    expect(userId).toBe("user-fake");
    expect(guaranteeId).toBe("00000000-0000-4000-8000-000000000001");
    expect(statement).not.toContain("updatedAt");
    expect(statement).not.toContain("responsable");
    expect(statement).not.toContain("fechaLimite");
  });

  it("traduce un registro inexistente a resultado vacío sin cambiar otros campos", async () => {
    database.executeRaw.mockResolvedValueOnce(0);
    await expect(recordGuaranteeManagement("00000000-0000-4000-8000-000000000099", "user-fake")).resolves.toBeNull();
    expect(database.executeRaw).toHaveBeenCalledOnce();
  });
});
