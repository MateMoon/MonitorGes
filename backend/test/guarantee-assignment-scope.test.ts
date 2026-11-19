import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const memory = vi.hoisted(() => ({
  rows: [] as any[],
  assignments: new Map<string, string[]>(),
  users: new Map<string, any>(),
  events: [] as any[],
}));

// Se ejercitan rutas, servicios y repositorios reales con un doble de Prisma.
// No se conecta a PostgreSQL ni se envían correos.
vi.mock("../src/db/prisma.js", () => {
  const matches = (row: any, where: any = {}): boolean => Object.entries(where).every(([key, filter]: [string, any]) => {
    if (key === "AND") return filter.every((part: any) => matches(row, part));
    if (key === "OR") return filter.some((part: any) => matches(row, part));
    const value = row[key];
    if (filter === null || typeof filter !== "object") return value === filter;
    if (key === "paciente") return matches(value, filter);
    return Object.entries(filter).every(([operator, target]: [string, any]) => {
      switch (operator) {
        case "mode": return true;
        case "in": return target.includes(value);
        case "not": return value !== target;
        case "equals": return filter.mode === "insensitive" ? value.toLowerCase() === target.toLowerCase() : value === target;
        case "contains": return value.toLowerCase().includes(target.toLowerCase());
        case "lt": return value < target;
        case "lte": return value <= target;
        case "gt": return value > target;
        case "gte": return value >= target;
        default: throw new Error(`Operador no soportado por el doble: ${operator}`);
      }
    });
  });
  const findMany = ({ where, distinct, select, orderBy, skip = 0, take }: any) => {
    let rows = memory.rows.filter((row) => matches(row, where));
    if (distinct) rows = [...new Map(rows.map((row) => [JSON.stringify(distinct.map((key: string) => row[key])), row])).values()];
    const ordering = orderBy ? Array.isArray(orderBy) ? orderBy : [orderBy] : [];
    rows.sort((a, b) => {
      for (const order of ordering) {
        const [key, direction] = Object.entries(order)[0] as [string, string];
        const comparison = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
        if (comparison) return direction === "desc" ? -comparison : comparison;
      }
      return 0;
    });
    return rows.slice(skip, take === undefined ? undefined : skip + take).map((row) => select
      ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]))
      : row);
  };
  const prisma: any = {
    usuario: { findUnique: vi.fn(async ({ where }: any) => memory.users.get(where.id) ?? null) },
    usuarioTipoGarantia: {
      findMany: vi.fn(async ({ where }: any) => (memory.assignments.get(where.usuarioId) ?? []).map((claveNormalizada) => ({ claveNormalizada }))),
      findUnique: vi.fn(async ({ where: { usuarioId_claveNormalizada: key } }: any) =>
        memory.assignments.get(key.usuarioId)?.includes(key.claveNormalizada) ? { usuarioId: key.usuarioId } : null),
    },
    garantia: {
      count: vi.fn(async ({ where }: any) => memory.rows.filter((row) => matches(row, where)).length),
      findMany: vi.fn(async (query: any) => findMany(query)),
      findFirst: vi.fn(async ({ where }: any) => memory.rows.find((row) => matches(row, where)) ?? null),
      findUnique: vi.fn(async ({ where }: any) => memory.rows.find((row) => row.id === where.id) ?? null),
    },
    importacion: { findFirst: vi.fn(async () => null) },
    eventoGarantia: { create: vi.fn(async ({ data }: any) => {
      const event = { id: `event-${memory.events.length + 1}`, secuencia: memory.events.length + 1, ...data };
      memory.events.push(event);
      return event;
    }) },
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(async (_sql: any, state: string, at: Date, userId: string, id: string) => {
      const row = memory.rows.find((item) => item.id === id)!;
      Object.assign(row, { estadoGestion: state, revisionGestion: row.revisionGestion + 1, gestionadaAt: at, gestionadaPorUsuarioId: userId });
      return 1;
    }),
    $transaction: async (work: any) => Array.isArray(work) ? Promise.all(work) : work(prisma),
  };
  return { prisma };
});
vi.mock("../src/modules/auth/auth-service.js", () => ({
  getSessionUser: vi.fn(async (token: string) => memory.users.get(token) ?? null),
}));

import { buildApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { todayInTimeZone } from "../src/utils/dates.js";
import { guaranteeScopeFor } from "../src/modules/garantias/assignment-scope.js";
import { matchingGuaranteeNames, individualGuaranteeWhere } from "../src/modules/notificaciones/individual-report-repository.js";

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const today = todayInTimeZone();
const date = (offset: number) => new Date(new Date(`${today}T00:00:00Z`).getTime() + offset * 86_400_000);

beforeEach(() => {
  vi.clearAllMocks();
  memory.assignments = new Map([
    ["reader", ["consulta de especialidad"]],
    ["professional", ["consulta de especialidad"]],
    ["coordinator", ["consulta de especialidad"]],
    ["admin", ["consulta de especialidad"]],
  ]);
  memory.users = new Map(["reader", "professional", "coordinator", "admin"].map((key) => [key, {
    id: key, username: key, nombre: `Usuario ${key}`, email: `${key}@example.test`,
    rol: { reader: "LECTOR", professional: "PROFESIONAL", coordinator: "COORDINADOR_SOME", admin: "ADMIN" }[key],
    puedeCargarNominas: false, recibirInformeAutomatico: false,
  }] as [string, any]));
  const row = (number: number, name: string, offset: number, state: string, category = "consulta") => ({
    id: id(number), nombreGarantia: name, fechaInicio: date(-30), fechaLimite: date(offset),
    estadoGestion: state, revisionGestion: 0, version: 1, gestionadaAt: null,
    responsable: `Centro ${category}`, problemaSalud: `Problema ${category}`,
    paciente: { id: id(100 + number), rutNumero: String(12_345_670 + number), dv: "5", nombre: `Paciente ${number}` },
    eventos: [],
  });
  memory.rows = [
    row(1, "CONSÚLTA  de   Especialidad!!!", 2, "SIN_GESTION"),
    row(2, "Consulta de especialidad", 80, "EN_GESTION"),
    row(3, "Consulta de especialidad", -2, "CUMPLIDA"),
    row(4, "Tratamiento", 3, "PENDIENTE_RESOLUCION", "tratamiento"),
    row(5, "Otro tipo", -1, "SIN_GESTION", "otro"),
    row(6, "CONSULTA DE ESPECIALIDAD", -1, "EN_GESTION"),
  ];
  memory.events = [];
});

describe("Dashboard y Garantías según asignaciones de usuario", () => {
  const app = buildApp();
  app.log.level = "silent";
  const get = (url: string, user = "reader") => app.inject({ method: "GET", url, headers: { cookie: `ges_session=${user}` } });
  const manage = (number: number, user = "professional") => app.inject({
    method: "POST", url: `/api/garantias/${id(number)}/gestion`,
    headers: { cookie: `ges_session=${user}`, origin: "http://localhost:8443" },
    payload: { tipoActuacion: "CONTACTO_PACIENTE", revisionGestion: 0 },
  });
  afterAll(async () => { await app.close(); });

  it.each(["reader", "professional"])("%s solo ve sus tipos, aunque no reciba correo ni pueda importar", async (user) => {
    const list = await get("/api/garantias", user);
    const dashboard = await get("/api/dashboard", user);
    expect(list.statusCode).toBe(200);
    expect(list.json().pagination.total).toBe(4);
    expect(list.json().data.map((row: any) => row.id).sort()).toEqual([id(1), id(2), id(3), id(6)]);
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().data).toMatchObject({
      total: 4, totalPendientes: 3,
      conteosPorEstado: { vencida: 1, critica: 1, proxima: 0, atencion: 0, normal: 1 },
      conteosPorGestion: { SIN_GESTION: 1, EN_GESTION: 2, PENDIENTE_RESOLUCION: 0, CUMPLIDA: 1 },
    });
    expect(dashboard.json().data.garantiasUrgentes.map((row: any) => row.id)).toEqual([id(6), id(1)]);
    expect((await get(`/api/garantias/${id(1)}`, user)).statusCode).toBe(200);
  });

  it.each(["admin", "coordinator"])("%s ve todo, incluso sin tipos asignados", async (role) => {
    memory.assignments.set(role, []);
    memory.users.get(role).reglasAsignacion = [];
    expect((await get("/api/garantias", role)).json().pagination.total).toBe(6);
    expect((await get("/api/dashboard", role)).json().data.total).toBe(6);
    expect((await get(`/api/garantias/${id(5)}`, role)).statusCode).toBe(200);
    expect((await get("/api/garantias/opciones-filtros", role)).json().data.responsables).toHaveLength(3);
    expect(prisma.usuarioTipoGarantia.findMany).not.toHaveBeenCalled();
  });
  it("el coordinador puede gestionar una garantía fuera de sus reglas de correo", async () => {
    memory.users.get("coordinator").reglasAsignacion = [];
    expect((await manage(4, "coordinator")).statusCode).toBe(200);
    expect(memory.events).toHaveLength(1);
  });

  it("los filtros y la paginación reducen el alcance y los enlaces coinciden con los conteos", async () => {
    for (const query of ["nombreGarantia=Tratamiento", "responsable=Centro%20otro", "nombre=Paciente%205", "rut=12345675-5"]) {
      expect((await get(`/api/garantias?${query}`)).json().pagination.total).toBe(0);
    }
    const query = "/api/garantias?estado=vencida,critica&soloPendientes=true&limit=1&sort=fechaLimite&order=asc";
    const first = (await get(`${query}&page=1`)).json();
    const second = (await get(`${query}&page=2`)).json();
    expect(first.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
    expect(first.data.map((row: any) => row.id)).toEqual([id(6)]);
    expect(second.data.map((row: any) => row.id)).toEqual([id(1)]);
    const dashboard = (await get("/api/dashboard")).json().data;
    for (const [state, count] of Object.entries(dashboard.conteosPorGestion)) {
      expect((await get(`/api/garantias?estadoGestion=${state}`)).json().pagination.total).toBe(count);
    }
  });

  it("las opciones de filtros no revelan responsables, problemas ni tipos ajenos", async () => {
    const response = await get("/api/garantias/opciones-filtros");
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ responsables: ["Centro consulta"], problemasSalud: ["Problema consulta"] });
    expect(response.json().data.nombresGarantia).not.toContain("Tratamiento");
    expect(response.json().data.nombresGarantia).not.toContain("Otro tipo");
  });

  it("sin asignaciones, o con un tipo sin garantías, nunca se concede acceso global", async () => {
    for (const types of [[], ["tipo sin registros"]]) {
      memory.assignments.set("reader", types);
      const list = (await get("/api/garantias")).json();
      const dashboard = (await get("/api/dashboard")).json().data;
      expect(list.data).toEqual([]);
      expect(list.pagination.total).toBe(0);
      expect(dashboard).toMatchObject({ total: 0, totalPendientes: 0, garantiasUrgentes: [] });
      expect(Object.values(dashboard.conteosPorGestion)).toEqual([0, 0, 0, 0]);
      expect((await get("/api/garantias/opciones-filtros")).json().data).toEqual({ responsables: [], problemasSalud: [], nombresGarantia: [] });
      expect((await get(`/api/garantias/${id(1)}`)).statusCode).toBe(404);
    }
  });

  it("lee los cambios de asignación en la siguiente petición de la misma sesión", async () => {
    expect((await get("/api/dashboard")).json().data.total).toBe(4);
    memory.assignments.set("reader", ["tratamiento"]);
    expect((await get("/api/dashboard")).json().data.total).toBe(1);
    expect((await get("/api/garantias")).json().data.map((row: any) => row.id)).toEqual([id(4)]);
    expect((await get(`/api/garantias/${id(1)}`)).statusCode).toBe(404);
    expect((await get(`/api/garantias/${id(4)}`)).statusCode).toBe(200);
    memory.assignments.set("reader", []);
    expect((await get("/api/dashboard")).json().data.total).toBe(0);
  });

  it("admite varios tipos y nombres equivalentes sin confundir tipos distintos", async () => {
    memory.assignments.set("reader", ["consulta de especialidad", "tratamiento"]);
    expect((await get("/api/garantias")).json().pagination.total).toBe(5);
    expect((await get("/api/dashboard")).json().data.total).toBe(5);
    const scope = await guaranteeScopeFor(memory.users.get("reader"));
    const names = await matchingGuaranteeNames(prisma, memory.assignments.get("reader")!);
    const scoped = await prisma.garantia.findMany({ where: scope });
    expect(scoped).toHaveLength(5);
    expect(scoped.every((row: any) => names.includes(row.nombreGarantia))).toBe(true);
    expect(names).toContain("CONSÚLTA  de   Especialidad!!!");
    expect(names).not.toContain("Otro tipo");
  });

  it("impide consultar y gestionar por ID una garantía ajena sin escribir eventos", async () => {
    expect((await get(`/api/garantias/${id(4)}`, "professional")).statusCode).toBe(404);
    expect((await manage(4)).statusCode).toBe(404);
    expect(memory.events).toEqual([]);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(memory.rows.find((row) => row.id === id(4)).revisionGestion).toBe(0);
    expect((await manage(1)).statusCode).toBe(200);
    expect(memory.events).toHaveLength(1);
    memory.assignments.set("professional", []);
    expect((await manage(6)).statusCode).toBe(404);
    expect(memory.events).toHaveLength(1);
    expect((await manage(4, "admin")).statusCode).toBe(200);
  });

  it("combina los tres criterios en cada regla y suma reglas sin cruzar sus dimensiones", async () => {
    const rules = [
      { problemaSalud: "problema consulta", establecimiento: "centro consulta", tipoGarantia: "consulta de especialidad" },
      { problemaSalud: "problema tratamiento", establecimiento: "centro tratamiento", tipoGarantia: "tratamiento" },
    ];
    memory.users.get("reader").reglasAsignacion = rules;
    memory.users.get("professional").reglasAsignacion = rules;
    memory.rows.push(
      { ...memory.rows[0], id: id(7), responsable: "Centro tratamiento" },
      { ...memory.rows[0], id: id(8), problemaSalud: "Problema tratamiento" },
      { ...memory.rows[3], id: id(9), responsable: "Centro consulta" },
    );
    const list = (await get("/api/garantias")).json();
    expect(list.pagination.total).toBe(5);
    expect(list.data.map((row: any) => row.id).sort()).toEqual([id(1), id(2), id(3), id(4), id(6)]);
    expect((await get("/api/dashboard")).json().data).toMatchObject({ total: 5, totalPendientes: 4 });
    expect((await get(`/api/garantias/${id(7)}`)).statusCode).toBe(404);
    expect((await manage(7)).statusCode).toBe(404);
    expect((await manage(8)).statusCode).toBe(404);
    expect(memory.events).toHaveLength(0);
    expect((await manage(4)).statusCode).toBe(200);
  });

  it("una regla puede cubrir cualquier tipo; quitar todas las reglas revoca el acceso aunque queden tipos antiguos", async () => {
    memory.users.get("reader").reglasAsignacion = [{ problemaSalud: "problema consulta", establecimiento: "", tipoGarantia: "" }];
    expect((await get("/api/garantias")).json().pagination.total).toBe(4);
    memory.users.get("reader").reglasAsignacion = [];
    expect((await get("/api/garantias")).json().pagination.total).toBe(0);
    expect((await get(`/api/garantias/${id(1)}`)).statusCode).toBe(404);
    expect((await get("/api/dashboard")).json().data.total).toBe(0);
  });

  it("ignora tildes, puntuación y mayúsculas en problema y establecimiento y deniega reglas corruptas", async () => {
    memory.rows[0].problemaSalud = "PRÓBLEMA  Consulta!!!";
    memory.rows[0].responsable = "CÉNTRO  CONSULTA!!!";
    memory.users.get("reader").reglasAsignacion = [{ problemaSalud: "problema consulta", establecimiento: "centro consulta", tipoGarantia: "consulta de especialidad" }];
    expect((await get(`/api/garantias/${id(1)}`)).statusCode).toBe(200);
    memory.users.get("reader").reglasAsignacion = [{ problemaSalud: "", establecimiento: "", tipoGarantia: "" }];
    expect((await get("/api/garantias")).json().pagination.total).toBe(0);
  });
});
