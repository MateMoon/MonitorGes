import { beforeEach, describe, expect, it, vi } from "vitest";
const database = vi.hoisted(() => ({ rows: [] as any[] }));

// Evalúa los where que reciben los repositorios sobre un conjunto fijo de prueba.
// Es un doble de Prisma, no una integración PostgreSQL.
vi.mock("../src/db/prisma.js", () => {
  const matches = (row: any, where: any): boolean => Object.entries(where ?? {}).every(([key, filter]: [string, any]) => {
    if (key === "AND") return filter.every((item: any) => matches(row, item));
    if (key === "OR") return filter.some((item: any) => matches(row, item));
    const value = row[key];
    if (typeof filter !== "object" || filter === null) return value === filter;
    if (key === "paciente") return matches(value, filter);
    if ("equals" in filter) return filter.mode === "insensitive" ? value.toLowerCase() === filter.equals.toLowerCase() : value === filter.equals;
    if ("contains" in filter) return value.toLowerCase().includes(filter.contains.toLowerCase());
    return Object.entries(filter).every(([operator, target]: [string, any]) => operator === "not" ? value !== target : operator === "lt" ? value < target : operator === "lte" ? value <= target : operator === "gte" ? value >= target : operator === "gt" ? value > target : false);
  });
  return { prisma: {
    garantia: {
      count: vi.fn(async ({ where }: any = {}) => database.rows.filter((row) => matches(row, where)).length),
      findMany: vi.fn(async ({ where, skip = 0, take }: any) => database.rows.filter((row) => matches(row, where)).slice(skip, take === undefined ? undefined : skip + take)),
    },
    $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
  } };
});
import { dashboardData } from "../src/modules/dashboard/repository.js";
import { listGuarantees } from "../src/modules/garantias/repository.js";
import { listQuerySchema } from "../src/modules/garantias/schema.js";
import { findReportGuarantees } from "../src/modules/notificaciones/email-report-repository.js";
const { managementPreset } = await import(new URL("../../src/management.ts", import.meta.url).href);

beforeEach(() => {
  const examples = [
    ["a", "SIN_GESTION", "2026-11-01"], ["b", "EN_GESTION", "2026-11-06"],
    ["c", "PENDIENTE_RESOLUCION", "2026-11-07"], ["d", "CUMPLIDA", "2026-11-06"],
    ["e", "SIN_GESTION", "2027-01-01"], ["f", "EN_GESTION", "2026-11-01"],
    ["g", "CUMPLIDA", "2026-11-01"], ["h", "PENDIENTE_RESOLUCION", "2026-11-25"],
  ];
  database.rows = examples.map(([id, estadoGestion, fecha]) => ({ id, estadoGestion, fechaLimite: new Date(`${fecha}T00:00:00Z`), responsable: "Centro de prueba", problemaSalud: "Problema de prueba", nombreGarantia: "Tipo de prueba", paciente: { rutNumero: "12345678", dv: "5", nombre: "Paciente de prueba" } }));
});
describe("conteos y selecciones de seguimiento", () => {
  it("calcula las cuatro tarjetas sobre todo el conjunto y excluye cumplidas solo de plazos y urgencias", async () => {
    const dashboard = await dashboardData("2026-11-03");
    expect(dashboard.total).toBe(8);
    expect(dashboard.totalPendientes).toBe(6);
    expect(dashboard.conteosPorGestion).toEqual({ SIN_GESTION: 2, EN_GESTION: 2, PENDIENTE_RESOLUCION: 2, CUMPLIDA: 2 });
    expect(dashboard.conteosPorEstado).toEqual({ vencida: 2, critica: 2, proxima: 0, atencion: 1, normal: 1 });
    expect(dashboard.urgentes.map((row) => row.id)).toEqual(["a", "b", "c", "f"]);
  });
  it("los enlaces de tarjetas incluyen vencidas y coinciden con los totales del backend", async () => {
    const dashboard = await dashboardData("2026-11-03");
    for (const state of Object.keys(dashboard.conteosPorGestion)) {
      const preset = managementPreset(state);
      expect(preset.estados).toContain("vencida");
      const query = listQuerySchema.parse({ estadoGestion: preset.estadoGestion, estado: preset.estados.join(","), soloPendientes: String(preset.soloPendientes) });
      const result = await listGuarantees(query, "2026-11-03");
      expect(result.total).toBe(dashboard.conteosPorGestion[state as keyof typeof dashboard.conteosPorGestion]);
    }
  });
  it("combina plazo y gestión con búsqueda, igualdad y paginación", async () => {
    const result = await listGuarantees(listQuerySchema.parse({ estado: "vencida", estadoGestion: "EN_GESTION", nombre: "paciente", responsable: "centro de prueba", page: 1, limit: 1 }), "2026-11-03");
    expect(result.total).toBe(1);
    expect(result.rows.map((row) => row.id)).toEqual(["f"]);
    const second = await listGuarantees(listQuerySchema.parse({ estadoGestion: "CUMPLIDA", page: 2, limit: 1 }), "2026-11-03");
    expect(second.total).toBe(2); expect(second.rows.map((row) => row.id)).toEqual(["g"]);
  });
  it("el filtro operativo de plazo coincide con su tarjeta y permite consulta histórica de cumplidas", async () => {
    const dashboard = await dashboardData("2026-11-03");
    const pending = await listGuarantees(listQuerySchema.parse({ estado: "critica", soloPendientes: "true" }), "2026-11-03");
    expect(pending.total).toBe(dashboard.conteosPorEstado.critica);
    expect((await listGuarantees(listQuerySchema.parse({ estado: "critica", estadoGestion: "CUMPLIDA" }), "2026-11-03")).total).toBe(1);
    expect(listQuerySchema.safeParse({ estadoGestion: "INVENTADO" }).success).toBe(false);
    expect(listQuerySchema.safeParse({ soloPendientes: "yes" }).success).toBe(false);
  });
  it("el informe excluye CUMPLIDA e incluye EN_GESTION y pendientes según plazo", async () => {
    const rows = await findReportGuarantees("2026-11-03");
    expect(rows.map((row) => row.id)).toEqual(["a", "b", "c", "f", "h"]);
    // Reabrir restaura elegibilidad; una actuación ordinaria no la quita.
    database.rows.find((row) => row.id === "d").estadoGestion = "PENDIENTE_RESOLUCION";
    expect((await findReportGuarantees("2026-11-03")).some((row) => row.id === "d")).toBe(true);
  });
});
