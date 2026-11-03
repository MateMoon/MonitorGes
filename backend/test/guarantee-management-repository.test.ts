import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const db = vi.hoisted(() => ({ row: null as any, events: [] as any[], failEvent: false, failUpdate: false, tx: null as any }));
vi.mock("../src/db/prisma.js", () => {
  const tx = {
    $queryRaw: vi.fn(async () => db.row ? [{ id: db.row.id }] : []),
    garantia: { findUnique: vi.fn(async () => db.row) },
    eventoGarantia: { create: vi.fn(async ({ data }: any) => {
      if (db.failEvent) throw new Error("event unavailable");
      const event = { id: `event-${db.events.length + 1}`, secuencia: db.events.length + 1, ...data };
      db.events.push(event); return event;
    }) },
    $executeRaw: vi.fn(async (_sql: any, estado: string, at: Date, userId: string) => {
      if (db.failUpdate) throw new Error("update unavailable");
      Object.assign(db.row, { estadoGestion: estado, revisionGestion: db.row.revisionGestion + 1, gestionadaAt: at, gestionadaPorUsuarioId: userId });
      return 1;
    }),
  };
  db.tx = tx;
  return { prisma: { $transaction: async (work: any) => {
    const snapshot = structuredClone({ row: db.row, events: db.events });
    try { return await work(tx); }
    catch (error) { db.row = snapshot.row; db.events = snapshot.events; throw error; }
  } } };
});
import { writeManagement, timelineOrder } from "../src/modules/garantias/management-repository.js";
import { actionSchema, stateChangeSchema, reopenSchema } from "../src/modules/garantias/management.js";

const admin = { id: "admin-id", nombre: "Administrador de prueba", rol: "ADMIN" };
const professional = { id: "professional-id", nombre: "Profesional de prueba", rol: "PROFESIONAL" };
const action = (revisionGestion = db.row.revisionGestion) => ({ operacion: "actuacion" as const, tipoActuacion: "CONTACTO_PACIENTE" as const, revisionGestion, comentario: "Seguimiento de prueba" });
const complete = (respaldo = "Constancia verificada") => ({ operacion: "estado" as const, estadoGestion: "CUMPLIDA" as const, respaldo, revisionGestion: db.row.revisionGestion });
beforeEach(() => {
  db.row = { id: "guarantee-id", estadoGestion: "SIN_GESTION", revisionGestion: 0, fechaLimite: new Date("2026-12-01"), fechaInicio: new Date("2026-10-01"), responsable: "Centro de prueba", version: 1, updatedAt: new Date("2026-10-02"), gestionadaAt: null };
  db.events = []; db.failEvent = false; db.failUpdate = false; vi.clearAllMocks();
});
describe("seguimiento transaccional (repositorio simulado, sin PostgreSQL)", () => {
  it("declara SIN_GESTION inicial y migra solo antecedentes conocidos sin inventar actuaciones", () => {
    const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
    const migration = readFileSync(new URL("../prisma/migrations/20261103120000_guarantee_management_timeline/migration.sql", import.meta.url), "utf8");
    expect(schema).toMatch(/estadoGestion\s+EstadoGestion\s+@default\(SIN_GESTION\)/);
    expect(migration).toContain("NOT NULL DEFAULT 'SIN_GESTION'");
    expect(migration).toContain('WHERE g."gestionadaAt" IS NOT NULL');
    expect(migration).toContain('ON CONFLICT ("claveLegado") DO NOTHING');
    expect(migration).toContain("'ANTECEDENTE_LEGADO', g.\"gestionadaAt\"");
    expect(migration).not.toMatch(/DROP |DELETE FROM|TRUNCATE /);
  });
  it("la primera actuación pasa a EN_GESTION y la segunda conserva ambas entradas", async () => {
    await writeManagement("guarantee-id", professional, action());
    expect(db.row.estadoGestion).toBe("EN_GESTION");
    await writeManagement("guarantee-id", professional, action());
    expect(db.events).toHaveLength(2);
    expect(db.events[0]).toMatchObject({ tipo: "ACTUACION", estadoAnterior: "SIN_GESTION", estadoNuevo: "EN_GESTION", usuarioId: professional.id });
    expect(db.row.revisionGestion).toBe(2);
  });
  it("conserva PENDIENTE_RESOLUCION al registrar una actuación", async () => {
    db.row.estadoGestion = "PENDIENTE_RESOLUCION";
    await writeManagement("guarantee-id", professional, action());
    expect(db.row.estadoGestion).toBe("PENDIENTE_RESOLUCION");
  });
  it("Atención realizada no acredita cumplimiento ni altera datos fuente", async () => {
    const before = { ...db.row };
    await writeManagement("guarantee-id", professional, { ...action(), tipoActuacion: "ATENCION_REALIZADA" });
    expect(db.row.estadoGestion).toBe("EN_GESTION");
    for (const key of ["fechaLimite", "fechaInicio", "responsable", "version", "updatedAt"]) expect(db.row[key]).toEqual(before[key]);
    expect(db.row.gestionadaAt).toBeInstanceOf(Date);
  });
  it("valida tipo, respaldo de cumplimiento y motivo de reapertura", async () => {
    expect(actionSchema.safeParse({ tipoActuacion: "inventado", revisionGestion: 0 }).success).toBe(false);
    expect(stateChangeSchema.safeParse({ estadoGestion: "CUMPLIDA", respaldo: "  ", revisionGestion: 0 }).success).toBe(false);
    expect(reopenSchema.safeParse({ motivo: "  ", revisionGestion: 0 }).success).toBe(false);
    await expect(writeManagement("guarantee-id", admin, complete(" "))).rejects.toMatchObject({ code: "EVIDENCE_REQUIRED" });
    expect(db.events).toHaveLength(0);
  });
  it("cumple y reabre conservando actuaciones, respaldo histórico y antecedente legado", async () => {
    db.row.estadoGestion = "EN_GESTION";
    db.events.push({ id: "legacy", tipo: "ANTECEDENTE_LEGADO", createdAt: new Date("2026-09-01"), comentario: null, tipoActuacion: null });
    await writeManagement("guarantee-id", professional, action());
    await writeManagement("guarantee-id", admin, complete());
    expect(db.row.estadoGestion).toBe("CUMPLIDA");
    await expect(writeManagement("guarantee-id", professional, action())).rejects.toMatchObject({ code: "REOPEN_REQUIRED" });
    await expect(writeManagement("guarantee-id", admin, { operacion: "reabrir", motivo: " ", revisionGestion: db.row.revisionGestion })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await writeManagement("guarantee-id", admin, { operacion: "reabrir", motivo: "Se requiere nueva revisión", revisionGestion: db.row.revisionGestion });
    expect(db.row.estadoGestion).toBe("PENDIENTE_RESOLUCION");
    expect(db.events.map((event) => event.tipo)).toEqual(["ANTECEDENTE_LEGADO", "ACTUACION", "CUMPLIMIENTO", "REAPERTURA"]);
    expect(db.events[2].respaldo).toBe("Constancia verificada");
    expect(db.events[3]).toMatchObject({ estadoAnterior: "CUMPLIDA", estadoNuevo: "PENDIENTE_RESOLUCION", comentario: "Se requiere nueva revisión" });
    expect(db.events.filter((event) => event.tipo === "ANTECEDENTE_LEGADO")).toHaveLength(1);
  });
  it("registra cambios explícitos e impide transiciones contradictorias", async () => {
    await writeManagement("guarantee-id", admin, { operacion: "estado", estadoGestion: "PENDIENTE_RESOLUCION", revisionGestion: 0 });
    await writeManagement("guarantee-id", admin, { operacion: "estado", estadoGestion: "EN_GESTION", revisionGestion: 1 });
    expect(db.events.map((event) => event.tipo)).toEqual(["CAMBIO_ESTADO", "CAMBIO_ESTADO"]);
    await expect(writeManagement("guarantee-id", admin, { operacion: "estado", estadoGestion: "EN_GESTION", revisionGestion: 2 })).rejects.toMatchObject({ code: "UNCHANGED_STATE" });
    await expect(writeManagement("guarantee-id", admin, { operacion: "reabrir", motivo: "Revisión", revisionGestion: 2 })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
  it.each(["failEvent", "failUpdate"] as const)("revierte estado y evento cuando falla %s", async (failure) => {
    db[failure] = true;
    await expect(writeManagement("guarantee-id", admin, complete())).rejects.toThrow();
    expect(db.row).toMatchObject({ estadoGestion: "SIN_GESTION", revisionGestion: 0, gestionadaAt: null });
    expect(db.events).toHaveLength(0);
  });
  it("rechaza revisiones obsoletas y define orden estable para eventos simultáneos", async () => {
    await writeManagement("guarantee-id", professional, action(0));
    await expect(writeManagement("guarantee-id", professional, action(0))).rejects.toMatchObject({ code: "STALE_MANAGEMENT" });
    expect(db.events).toHaveLength(1);
    expect(timelineOrder).toEqual([{ createdAt: "desc" }, { secuencia: "desc" }]);
    expect(db.tx.$queryRaw.mock.calls[0][0].join("?")).toContain("FOR UPDATE");
  });
  it("no amplía permisos internos a perfiles no autorizados", async () => {
    await expect(writeManagement("guarantee-id", professional, complete())).rejects.toMatchObject({ statusCode: 403 });
    for (const rol of ["LECTOR", "COORDINADOR_SOME"]) await expect(writeManagement("guarantee-id", { ...professional, rol }, action())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("no crea eventos si la garantía no existe", async () => {
    db.row = null;
    expect(await writeManagement("missing", professional, action(0))).toBeNull();
    expect(db.events).toHaveLength(0);
  });
});
