import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("../src/db/prisma.js", () => ({
  prisma: {
    $transaction: db.read,
    garantia: { count: db.read, findMany: db.read, findUnique: db.read, create: db.write, update: db.write, delete: db.write, upsert: db.write },
    paciente: { findUnique: db.read, create: db.write, update: db.write, delete: db.write, upsert: db.write },
    importacion: { findFirst: db.read, create: db.write, update: db.write, delete: db.write },
  },
}));
import { buildApp } from "../src/app.js";

async function sampleXlsx() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Nómina");
  sheet.addRow(["Problema de salud", "RUT", "DV", "Nombre", "Fecha de Inicio", "Fecha Límite", "Días que faltan para el Vencimiento de la Garantía", "Nombre de la garantía", "Responsable de la garantía"]);
  sheet.addRow(["Problema ficticio", "12345678", "5", "Paciente Prueba", "2026-10-01", "2026-12-31", 0, "Garantía ficticia", "Centro ficticio"]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function multipart(file: Buffer) {
  const boundary = "----import-validation-boundary";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="archivo"; filename="prueba.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

describe("POST /api/importaciones/validar", () => {
  const app = buildApp();
  beforeAll(async () => { await app.ready(); });
  afterAll(async () => { await app.close(); });

  it("devuelve el resumen y la vista previa, sin modificar PostgreSQL", async () => {
    const form = multipart(await sampleXlsx());
    const response = await app.inject({ method: "POST", url: "/api/importaciones/validar", headers: { "content-type": form.contentType }, payload: form.body });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ filasLeidas: 1, filasValidas: 1, filasConErrores: 0, vistaPrevia: [expect.objectContaining({ nombre: "Paciente Prueba" })] });
    expect(db.read).not.toHaveBeenCalled();
    expect(db.write).not.toHaveBeenCalled();
  });

  it("devuelve error legible si falta el campo archivo", async () => {
    const response = await app.inject({ method: "POST", url: "/api/importaciones/validar", headers: { "content-type": "multipart/form-data; boundary=empty" }, payload: "--empty--\r\n" });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("FILE_REQUIRED");
  });
});
