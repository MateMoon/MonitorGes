import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn(), transaction: vi.fn() }));
vi.mock("../src/db/prisma.js", () => ({ prisma: { garantia: { findMany: db.findMany, count: db.count }, $transaction: db.transaction } }));

import { listGuaranteeFilterOptions, listGuarantees } from "../src/modules/garantias/repository.js";

describe("opciones de filtros de garantias", () => {
  it("elimina duplicados que solo cambian mayusculas y conserva coincidencias exactas insensibles", async () => {
    db.findMany.mockResolvedValueOnce([{ responsable: "Centro Norte" }, { responsable: "CENTRO NORTE" }, { responsable: "Centro Sur" }])
      .mockResolvedValueOnce([{ problemaSalud: "Problema A" }, { problemaSalud: "PROBLEMA A" }])
      .mockResolvedValueOnce([{ nombreGarantia: "Garantia X" }, { nombreGarantia: "GARANTIA X" }]);
    const result = await listGuaranteeFilterOptions();
    expect(result).toEqual({ responsables: ["Centro Norte", "Centro Sur"], problemasSalud: ["Problema A"], nombresGarantia: ["Garantia X"] });
    expect(db.findMany).toHaveBeenCalledTimes(3);
  });

  it("combina los comboboxes con igualdad exacta e insensible a mayusculas sin alterar pagina u orden", async () => {
    db.count.mockResolvedValue(0);
    db.findMany.mockResolvedValue([]);
    db.transaction.mockImplementation((queries: Promise<unknown>[]) => Promise.all(queries));
    await listGuarantees({ page: 2, limit: 12, sort: "fechaLimite", order: "desc", responsable: "Centro Norte", problemaSalud: "Problema A", nombreGarantia: "Garantia X" } as never, "2026-10-14");
    const query = db.findMany.mock.calls.at(-1)?.[0];
    expect(query.where).toMatchObject({
      responsable: { equals: "Centro Norte", mode: "insensitive" },
      problemaSalud: { equals: "Problema A", mode: "insensitive" },
      nombreGarantia: { equals: "Garantia X", mode: "insensitive" },
    });
    expect(query).toMatchObject({ skip: 12, take: 12, orderBy: { fechaLimite: "desc" } });
  });
});
