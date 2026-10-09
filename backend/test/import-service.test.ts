import ExcelJS from "exceljs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const memory = vi.hoisted(() => ({
  patients: [] as any[], guarantees: [] as any[], imports: [] as any[], errors: [] as any[], nextId: 1, failGuaranteeCreate: false,
}));

vi.mock("../src/db/prisma.js", () => {
  const id = () => `fake-${memory.nextId++}`;
  const tx: any = {
    $queryRawUnsafe: vi.fn(async () => []),
    paciente: {
      findUnique: vi.fn(async ({ where }: any) => memory.patients.find((p) => p.rutNumero === where.rutNumero_dv.rutNumero && p.dv === where.rutNumero_dv.dv) ?? null),
      create: vi.fn(async ({ data }: any) => { const patient = { id: id(), ...data }; memory.patients.push(patient); return patient; }),
      update: vi.fn(async ({ where, data }: any) => { const patient = memory.patients.find((p) => p.id === where.id)!; Object.assign(patient, data); return patient; }),
    },
    garantia: {
      findMany: vi.fn(async ({ where }: any) => memory.guarantees.filter((g) => g.pacienteId === where.pacienteId && g.fechaInicio.getTime() === where.fechaInicio.getTime())),
      create: vi.fn(async ({ data }: any) => { if (memory.failGuaranteeCreate) throw new Error("db unavailable"); const guarantee = { id: id(), version: 1, ...data }; memory.guarantees.push(guarantee); return guarantee; }),
      update: vi.fn(async ({ where, data }: any) => { const guarantee = memory.guarantees.find((g) => g.id === where.id)!; const version = data.version?.increment ?? 0; const { version: _version, ...changes } = data; Object.assign(guarantee, changes); guarantee.version += version; return guarantee; }),
    },
    importacion: {
      create: vi.fn(async ({ data }: any) => { const row = { id: id(), fechaImportacion: new Date(), registrosNuevos: 0, registrosActualizados: 0, registrosSinCambios: 0, registrosConError: 0, ...data }; memory.imports.push(row); return row; }),
      update: vi.fn(async ({ where, data }: any) => { const row = memory.imports.find((i) => i.id === where.id)!; for (const [key, value] of Object.entries(data)) { if (value && typeof value === "object" && "increment" in value) row[key] += (value as any).increment; else row[key] = value; } return row; }),
      count: vi.fn(async () => memory.imports.length),
      findMany: vi.fn(async ({ skip = 0, take = 25 }: any) => [...memory.imports].sort((a, b) => b.fechaImportacion.getTime() - a.fechaImportacion.getTime()).slice(skip, skip + take)),
      findFirst: vi.fn(async () => [...memory.imports].sort((a, b) => b.fechaImportacion.getTime() - a.fechaImportacion.getTime())[0] ?? null),
    },
    errorImportacion: {
      createMany: vi.fn(async ({ data }: any) => { memory.errors.push(...data.map((row: any) => ({ id: id(), ...row }))); return { count: data.length }; }),
      create: vi.fn(async ({ data }: any) => { const row = { id: id(), ...data }; memory.errors.push(row); return row; }),
    },
  };
  const prisma: any = {
    ...tx,
    $transaction: vi.fn(async (operation: any) => {
      if (Array.isArray(operation)) return Promise.all(operation);
      const snapshot = structuredClone({ patients: memory.patients, guarantees: memory.guarantees, imports: memory.imports, errors: memory.errors });
      try { return await operation(tx); }
      catch (error) {
        memory.patients.splice(0, memory.patients.length, ...snapshot.patients);
        memory.guarantees.splice(0, memory.guarantees.length, ...snapshot.guarantees);
        memory.imports.splice(0, memory.imports.length, ...snapshot.imports);
        memory.errors.splice(0, memory.errors.length, ...snapshot.errors);
        throw error;
      }
    }),
  };
  return { prisma };
});

vi.mock("../src/modules/garantias/repository.js", () => ({
  listGuarantees: vi.fn(async () => ({ total: memory.guarantees.length, rows: memory.guarantees.map((row) => ({ ...row, paciente: memory.patients.find((patient) => patient.id === row.pacienteId), gestionadaPor: null })) })),
  findGuarantee: vi.fn(async () => null),
}));
vi.mock("../src/modules/dashboard/repository.js", () => ({
  dashboardData: vi.fn(async () => ({ total: memory.guarantees.length, conteosPorEstado: { vencida: 0, critica: 0, proxima: 0, atencion: 0, normal: memory.guarantees.length }, urgentes: [] })),
  latestImport: vi.fn(async () => [...memory.imports].sort((a, b) => b.fechaImportacion.getTime() - a.fechaImportacion.getTime())[0] ?? null),
}));
import { importWorkbook } from "../src/modules/importaciones/import-service.js";
import { buildApp } from "../src/app.js";

const headers = ["Problema de salud", "RUT", "DV", "Nombre", "Fecha de Inicio", "Fecha Limite", "Días que faltan para el Vencimiento de la Garantía", "Nombre de la Garantía", "Responsable de la Garantía"];
const baseRow = ["Problema A", "12345678", "5", "Paciente Ficticio", "01/10/2026", "31/12/2026", "0", "Garantía A", "Centro A"];

async function makeXlsx(rows: string[][]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Reporte");
  sheet.addRow(headers);
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}


function multipart(file: Buffer) {
  const boundary = "----persistent-import-boundary";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="archivo"; filename="nomina.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
function seededPatient() {
  memory.patients.push({ id: "patient-1", rutNumero: "12345678", dv: "5", nombre: "Paciente Ficticio" });
  return "patient-1";
}
function seededGuarantee(patientId: string, changes: Record<string, unknown> = {}) {
  memory.guarantees.push({ id: `warranty-${memory.guarantees.length + 1}`, pacienteId: patientId, problemaSalud: "Problema A", nombreGarantia: "Garantía A", fechaInicio: new Date("2026-10-01T00:00:00.000Z"), fechaLimite: new Date("2026-12-31T00:00:00.000Z"), responsable: "Centro A", version: 1, ...changes });
}

beforeEach(() => {
  memory.patients.splice(0); memory.guarantees.splice(0); memory.imports.splice(0); memory.errors.splice(0);
  memory.nextId = 1; memory.failGuaranteeCreate = false;
});

describe("importación persistente", () => {
  const app = buildApp();
  beforeAll(async () => { await app.ready(); });
  afterAll(async () => { await app.close(); });
  it("publica los cambios importados en Garantías, Dashboard e Historial mediante sus APIs", async () => {
    const form = multipart(await makeXlsx([baseRow]));
    const imported = await app.inject({ method: "POST", url: "/api/importaciones", headers: { "content-type": form.contentType }, payload: form.body });
    expect(imported.statusCode).toBe(201);
    const importData = imported.json().data;
    expect(importData).toMatchObject({ estado: "COMPLETADA", registrosNuevos: 1, registrosConError: 0 });

    const guarantees = await app.inject({ method: "GET", url: "/api/garantias" });
    expect(guarantees.statusCode).toBe(200);
    expect(guarantees.json()).toMatchObject({ pagination: { total: 1 }, data: [expect.objectContaining({ paciente: expect.objectContaining({ rut: "12345678-5", nombre: "Paciente Ficticio" }), nombreGarantia: "Garantía A" })] });

    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().data).toMatchObject({ total: 1, ultimaImportacion: { id: importData.id, nombreArchivo: "nomina.xlsx" } });

    const history = await app.inject({ method: "GET", url: "/api/importaciones?page=1&limit=25" });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toMatchObject({ data: [expect.objectContaining({ id: importData.id, nombreArchivo: "nomina.xlsx", registrosNuevos: 1 })], pagination: { total: 1, page: 1, limit: 25 } });
  });
  it("crea paciente, garantía e historial para un Excel válido", async () => {
    const result = await importWorkbook(await makeXlsx([baseRow]), "nomina.xlsx");
    expect(memory.patients).toHaveLength(1);
    expect(memory.guarantees).toHaveLength(1);
    expect(result).toMatchObject({ estado: "COMPLETADA", filasLeidas: 1, registrosNuevos: 1, registrosActualizados: 0, registrosSinCambios: 0, registrosConError: 0 });
    expect(memory.imports[0].id).toBe(result.id);
  });

  it("reutiliza pacientes y permite varias garantías para el mismo RUT", async () => {
    seededPatient();
    const second = [...baseRow]; second[5] = "15/01/2027"; second[7] = "Garantía B";
    const result = await importWorkbook(await makeXlsx([baseRow, second]), "dos-garantias.xlsx");
    expect(memory.patients).toHaveLength(1);
    expect(memory.guarantees).toHaveLength(2);
    expect(result.registrosNuevos).toBe(2);
  });

  it("reimportar la misma planilla no duplica una coincidencia inequívoca", async () => {
    const file = await makeXlsx([baseRow]);
    await importWorkbook(file, "repetida.xlsx");
    const result = await importWorkbook(file, "repetida.xlsx");
    expect(memory.guarantees).toHaveLength(1);
    expect(result).toMatchObject({ registrosNuevos: 0, registrosSinCambios: 1, registrosConError: 0 });
  });

  it("actualiza solo fecha límite y responsable en una coincidencia única", async () => {
    const patientId = seededPatient();
    seededGuarantee(patientId);
    const updated = [...baseRow]; updated[5] = "15/01/2027"; updated[8] = "Centro B";
    const result = await importWorkbook(await makeXlsx([updated]), "actualizacion.xlsx");
    expect(result.registrosActualizados).toBe(1);
    expect(memory.guarantees[0].fechaLimite.toISOString().slice(0, 10)).toBe("2027-01-15");
    expect(memory.guarantees[0].responsable).toBe("Centro B");
    expect(memory.guarantees[0].problemaSalud).toBe("Problema A");
  });

  it("marca como ambigua una identidad con varias coincidencias sin actualizarlas", async () => {
    const patientId = seededPatient();
    seededGuarantee(patientId); seededGuarantee(patientId, { id: "warranty-2", responsable: "Centro alternativo" });
    const changed = [...baseRow]; changed[5] = "15/01/2027"; changed[8] = "No aplicar";
    const result = await importWorkbook(await makeXlsx([changed]), "ambigua.xlsx");
    expect(result).toMatchObject({ estado: "FALLIDA", registrosConError: 1 });
    expect(memory.guarantees.map((g) => g.responsable)).toEqual(["Centro A", "Centro alternativo"]);
    expect(memory.errors[0].codigo).toBe("AMBIGUOUS_MATCH");
  });

  it("registra las filas con RUT inválido sin crear pacientes ni garantías", async () => {
    const invalid = [...baseRow]; invalid[2] = "9";
    const result = await importWorkbook(await makeXlsx([invalid]), "rut-invalido.xlsx");
    expect(result).toMatchObject({ estado: "FALLIDA", filasLeidas: 1, registrosConError: 1 });
    expect(memory.patients).toHaveLength(0);
    expect(memory.guarantees).toHaveLength(0);
    expect(memory.errors[0].codigo).toBe("INVALID_RUT_DV");
  });

  it("revierte una fila fallida de base de datos y registra el error", async () => {
    memory.failGuaranteeCreate = true;
    const result = await importWorkbook(await makeXlsx([baseRow]), "error-db.xlsx");
    expect(result).toMatchObject({ estado: "FALLIDA", registrosNuevos: 0, registrosConError: 1 });
    expect(memory.patients).toHaveLength(0);
    expect(memory.guarantees).toHaveLength(0);
    expect(memory.errors[0].codigo).toBe("DATABASE_ERROR");
  });
});
