import { describe, expect, it, vi } from "vitest";
const findMany = vi.hoisted(() => vi.fn());
vi.mock("../src/db/prisma.js", () => ({ prisma: { garantia: { findMany } } }));
import { findReportGuarantees } from "../src/modules/notificaciones/email-report-repository.js";

describe("lectura de garantías para informes", () => {
  it("conserva nombre y RUT y excluye cumplidas por consulta SQL", async () => {
    findMany.mockResolvedValue([{ id: "g", nombreGarantia: "Tipo", fechaLimite: new Date("2026-11-05"), responsable: "Centro", paciente: { rutNumero: "12345678", dv: "5", nombre: "Paciente de prueba" } }]);
    expect(await findReportGuarantees("2026-11-05")).toEqual([{ id: "g", nombreGarantia: "Tipo", fechaLimite: "2026-11-05", responsable: "Centro", rut: "12345678-5", nombrePaciente: "Paciente de prueba" }]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { estadoGestion: { not: "CUMPLIDA" }, fechaLimite: { lte: new Date("2026-12-05") } } }));
  });
});
