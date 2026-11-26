import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  $transaction: vi.fn(), $executeRawUnsafe: vi.fn(), $queryRaw: vi.fn(),
  usuario: { findMany: vi.fn(), findUnique: vi.fn() },
  garantia: { count: vi.fn(), findMany: vi.fn() },
  envioInformeIndividual: { findUnique: vi.fn(), update: vi.fn() },
  intentoInformeIndividual: { update: vi.fn() },
}));
vi.mock("../src/db/prisma.js", () => ({ prisma: db }));
import { createIndividualReportStore, previewIndividualReports } from "../src/modules/notificaciones/individual-report-repository.js";

const date = "2026-11-23";
const account = (rol: string) => ({ id: "user", rol, email: "staff@example.test", activo: true, recibirInformeAutomatico: false, reglasAsignacion: [], tiposGarantia: [] });
const claim = { id: "report", usuarioId: "user", fechaInforme: date, destinatario: "staff@example.test", huellaConfiguracion: "scope", tokenReserva: "token", numero: 1 };
beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (work) => work(db));
  db.garantia.count.mockResolvedValue(1);
  db.garantia.findMany.mockResolvedValue([]);
  db.envioInformeIndividual.findUnique.mockResolvedValue({ tokenReserva: "token", estado: "EN_PROCESO", intentos: 1 });
});
describe("alcance SQL de informes por perfil", () => {
  it("incluye coordinadores activos en candidatos aunque no tengan recepción opcional", async () => {
    db.usuario.findMany.mockResolvedValue([]);
    await createIndividualReportStore().candidates(date);
    expect(db.usuario.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: expect.arrayContaining([
      { activo: true, OR: [{ recibirInformeAutomatico: true }, { rol: "COORDINADOR_SOME" }] },
    ]) } }));
  });
  it("la vista previa de Coordinador excluye cumplidas y plazo normal sin aplicar reglas", async () => {
    db.usuario.findMany.mockResolvedValue([account("COORDINADOR_SOME")]);
    expect(await previewIndividualReports(date)).toMatchObject({ correosPrevistos: 1, garantiasEnInformes: 1 });
    expect(db.garantia.count).toHaveBeenCalledWith({ where: { estadoGestion: { not: "CUMPLIDA" }, fechaLimite: { lte: new Date("2026-12-23") } } });
    expect(db.garantia.findMany).not.toHaveBeenCalled();
    expect(db.$executeRawUnsafe).toHaveBeenCalledWith("SET TRANSACTION READ ONLY");
  });
  it.each(["ADMIN", "PROFESIONAL", "LECTOR"])("%s sin reglas no obtiene un informe completo", async (rol) => {
    db.usuario.findMany.mockResolvedValue([{ ...account(rol), recibirInformeAutomatico: true }]);
    expect(await previewIndividualReports(date)).toMatchObject({ correosPrevistos: 0, usuarios: [{ motivo: "SIN_REGLAS_VALIDAS" }] });
    expect(db.garantia.count).not.toHaveBeenCalled();
  });
  it.each(["COORDINADOR_SOME", "PROFESIONAL"])("el envío %s usa el rol revalidado bajo bloqueo para consultar garantías", async (rol) => {
    db.usuario.findUnique.mockResolvedValue({ ...account(rol), recibirInformeAutomatico: true });
    await createIndividualReportStore().withLockedRecipient(claim, async (user, loadRows) => {
      expect(user?.rol).toBe(rol);
      await loadRows([]);
      return { estado: "OMITIDO", cantidadGarantias: 0 };
    });
    const where = db.garantia.findMany.mock.calls[0][0].where;
    expect(where.estadoGestion).toEqual({ not: "CUMPLIDA" });
    if (rol === "COORDINADOR_SOME") expect(where).toEqual({ estadoGestion: { not: "CUMPLIDA" }, fechaLimite: { lte: new Date("2026-12-23") } });
    else expect(where).toEqual({ AND: [{ id: { in: [] } }], estadoGestion: { not: "CUMPLIDA" }, fechaLimite: { lte: new Date("2026-12-23") } });
  });
});
