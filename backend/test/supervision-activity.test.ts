import Fastify from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const memory = vi.hoisted(() => ({ rows: [] as any[], session: null as any, fail: false, logs: [] as string[] }));
vi.mock("../src/db/prisma.js", () => {
  const project = (row: any, select: any): any => Object.fromEntries(Object.entries(select).map(([key, selection]: [string, any]) => [key, selection === true ? row[key] : project(row[key], selection.select)]));
  const write = vi.fn(() => { throw new Error("No writes allowed"); });
  const prisma: any = {
    eventoGarantia: {
      findMany: vi.fn(async ({ select, take, orderBy }: any) => {
        if (memory.fail) throw new Error("PRIVATE_SQL_PATIENT_AND_PARAMETERS");
        const rows = [...memory.rows].sort((a, b) => {
          for (const field of orderBy) {
            const [key, direction] = Object.entries(field)[0];
            const difference = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
            if (difference) return direction === "desc" ? -difference : difference;
          }
          return 0;
        });
        return rows.slice(0, take).map((row) => project(row, select));
      }),
      create: write, update: write, delete: write,
    },
    garantia: { update: write }, usuario: { update: write },
    $executeRaw: vi.fn(async () => 0),
    $transaction: vi.fn(async (work: any) => work(prisma)),
    _write: write,
  };
  return { prisma };
});
vi.mock("../src/modules/auth/auth-service.js", () => ({ getSessionUser: vi.fn(async () => memory.session) }));
import { prisma } from "../src/db/prisma.js";
import { supervisionRoutes } from "../src/modules/supervision/routes.js";
import { buildApp } from "../src/app.js";

const event = (sequence: number, extra: any = {}) => ({
  id: `event-${sequence}`, secuencia: sequence, tipo: "ACTUACION", tipoActuacion: "CONTACTO_PACIENTE",
  comentario: "Comentario sintético", estadoAnterior: "SIN_GESTION", estadoNuevo: "EN_GESTION", respaldo: null,
  createdAt: new Date("2026-11-18T12:00:00.000Z"), autorNombre: "Autor histórico", usuarioId: "original-user",
  metadatos: "PRIVATE_METADATA", usuario: { nombre: "Nombre actual diferente", email: "PRIVATE_EMAIL" },
  garantia: { id: "guarantee-1", problemaSalud: "Diabetes", nombreGarantia: "Tratamiento", responsable: "Centro Norte", estadoGestion: "EN_GESTION", paciente: { nombre: "Caso sintético", rutNumero: "PRIVATE_RUT" } },
  ...extra,
});
const app = Fastify({ logger: { stream: { write: (line: string) => memory.logs.push(line) } } });
app.decorateRequest("authUser", null);
app.register(supervisionRoutes, { prefix: "/api/supervision" });
const request = (headers: Record<string, string> = { cookie: "ges_session=synthetic-token" }) => app.inject({ method: "GET", url: "/api/supervision/eventos", headers });
beforeEach(() => {
  vi.clearAllMocks(); memory.rows = []; memory.fail = false; memory.logs = [];
  memory.session = { id: "admin", nombre: "Cuenta de prueba", rol: "ADMIN", puedeCargarNominas: false };
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-18T14:00:00Z"));
});
afterEach(() => vi.useRealTimers());
afterAll(() => app.close());

describe("Gestiones y cambios: autorización y lectura persistida", () => {
  it("rechaza peticiones sin cookie antes de consultar el historial", async () => {
    expect((await request({})).statusCode).toBe(401);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it("rechaza una sesión vencida sin consultar eventos", async () => {
    memory.session = null;
    expect((await request()).statusCode).toBe(401);
    expect(prisma.eventoGarantia.findMany).not.toHaveBeenCalled();
  });
  it.each(["COORDINADOR_SOME", "PROFESIONAL", "LECTOR"])("%s no recibe actividad global aunque tenga permiso de importación", async (rol) => {
    memory.session = { ...memory.session, rol, puedeCargarNominas: true };
    const response = await request();
    expect(response.statusCode).toBe(403);
    expect(response.json()).not.toHaveProperty("data");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it("ADMIN obtiene un vacío real, sin caché, en una transacción de solo lectura", async () => {
    const response = await request();
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({ data: { generadoAt: "2026-11-18T14:00:00.000Z", zonaHoraria: "America/Santiago", alcance: "GLOBAL", limite: 30, eventos: [] } });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", timeout: 30_000 });
    expect(Array.from(vi.mocked(prisma.$executeRaw).mock.calls[0][0] as any)).toEqual(["SET TRANSACTION READ ONLY"]);
    expect((prisma as any)._write).not.toHaveBeenCalled();
  });
  it("ordena por fecha real y secuencia, limita treinta y no elimina eventos del mismo caso", async () => {
    memory.rows = Array.from({ length: 36 }, (_, index) => event(index + 1));
    memory.rows.push(event(100, { createdAt: new Date("2026-11-17T12:00:00Z") }));
    memory.rows.push(event(0, { createdAt: new Date("2026-11-18T13:00:00Z") }));
    const data = (await request()).json().data;
    expect(data.eventos.map((row: any) => row.secuencia)).toEqual([0, ...Array.from({ length: 29 }, (_, index) => 36 - index)]);
    expect(data.eventos.every((row: any) => row.garantia.id === "guarantee-1")).toBe(true);
  });
  it("conserva los cinco tipos, autor histórico y campos nulos de antecedentes sin inventar importaciones", async () => {
    memory.rows = [
      event(1), event(2, { tipo: "CAMBIO_ESTADO", tipoActuacion: null, estadoNuevo: "PENDIENTE_RESOLUCION" }),
      event(3, { tipo: "CUMPLIMIENTO", tipoActuacion: null, estadoNuevo: "CUMPLIDA", respaldo: "Documento sintético" }),
      event(4, { tipo: "REAPERTURA", tipoActuacion: null, estadoAnterior: "CUMPLIDA", estadoNuevo: "EN_GESTION", comentario: "Motivo sintético" }),
      event(5, { tipo: "ANTECEDENTE_LEGADO", tipoActuacion: null, estadoAnterior: null, estadoNuevo: null, autorNombre: null, usuarioId: null }),
    ];
    const rows = (await request()).json().data.eventos;
    expect(rows.map((row: any) => row.tipo)).toEqual(["ANTECEDENTE_LEGADO", "REAPERTURA", "CUMPLIMIENTO", "CAMBIO_ESTADO", "ACTUACION"]);
    expect(rows[0]).toMatchObject({ autorNombre: null, usuarioId: null, estadoAnterior: null, estadoNuevo: null });
    expect(rows[1].comentario).toBe("Motivo sintético");
    expect(rows[2].respaldo).toBe("Documento sintético");
    expect(rows[4].autorNombre).toBe("Autor histórico");
  });
  it("devuelve solo el contexto necesario del caso, sin RUT, emails ni metadatos", async () => {
    memory.rows = [event(1)];
    const response = await request();
    expect(response.json().data.eventos[0].garantia).toEqual({ id: "guarantee-1", problemaSalud: "Diabetes", nombreGarantia: "Tratamiento", establecimiento: "Centro Norte", estadoGestion: "EN_GESTION", paciente: { nombre: "Caso sintético" } });
    expect(response.body).not.toContain("PRIVATE_");
    expect(response.body).not.toContain("Nombre actual diferente");
    expect(memory.logs.join("")).not.toContain("Caso sintético");
  });
  it("un fallo no publica un vacío ni datos parciales y no registra la excepción sensible", async () => {
    memory.rows = [event(1)]; memory.fail = true;
    const response = await request();
    expect(response.statusCode).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).not.toHaveProperty("data");
    expect(response.json().error.code).toBe("SUPERVISION_ACTIVITY_UNAVAILABLE");
    expect(response.body).not.toContain("PRIVATE_");
    expect(memory.logs.join("")).not.toContain("PRIVATE_");
    expect((prisma as any)._write).not.toHaveBeenCalled();
  });
  it("está registrado en la aplicación real y relee cambios entre consultas", async () => {
    const fullApp = buildApp(); fullApp.log.level = "silent";
    try {
      const call = () => fullApp.inject({ method: "GET", url: "/api/supervision/eventos", headers: { cookie: "ges_session=synthetic-token" } });
      expect((await call()).json().data.eventos).toEqual([]);
      memory.rows = [event(1)];
      expect((await call()).json().data.eventos).toHaveLength(1);
    } finally { await fullApp.close(); }
  });
});
