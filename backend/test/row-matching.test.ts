import { describe, expect, it } from "vitest";
import { classifyImportRows, type MatchCandidate, type MatchRow } from "../src/modules/importaciones/row-matching.js";

const row = (patch: Partial<MatchRow> = {}): MatchRow => ({
  numeroFila: 2,
  rut: "12.345.678",
  dv: "5",
  problemaSalud: "Cáncer cervicouterino",
  nombreGarantia: "Tratamiento",
  fechaInicio: "2026-10-05",
  fechaLimite: "2026-11-30",
  responsable: "Equipo ficticio A",
  ...patch,
});

const candidate = (patch: Partial<MatchCandidate> = {}): MatchCandidate => ({
  id: "garantia-ficticia-1",
  rut: "12345678-5",
  dv: "",
  problemaSalud: "CANCER CERVICOUTERINO",
  nombreGarantia: "Tratamiento",
  fechaInicio: "2026-10-05",
  ...patch,
});

describe("clasificación pura de filas de importación", () => {
  it("clasifica una coincidencia exacta con un único candidato", () => {
    expect(classifyImportRows([row()], [candidate()])[0]).toMatchObject({
      clasificacion: "COINCIDENCIA_EXACTA_UNICA",
      candidatoIds: ["garantia-ficticia-1"],
    });
  });

  it("propone una fila nueva cuando no hay candidato de identidad relacionado", () => {
    expect(classifyImportRows([row()], [candidate({ problemaSalud: "Diabetes tipo 2" })])[0]).toMatchObject({
      clasificacion: "NUEVA_PROPUESTA",
      candidatoIds: [],
    });
  });

  it("marca fecha de inicio distinta como dudosa, aunque paciente, problema y tipo coincidan", () => {
    expect(classifyImportRows([row()], [candidate({ fechaInicio: "2026-10-06" })])[0]).toMatchObject({
      clasificacion: "DUDOSA_FECHA_DISTINTA",
      candidatoIds: ["garantia-ficticia-1"],
    });
  });

  it("no elige entre varios candidatos exactos", () => {
    expect(classifyImportRows([row()], [candidate(), candidate({ id: "garantia-ficticia-2" })])[0]).toMatchObject({
      clasificacion: "DUDOSA_VARIOS_CANDIDATOS",
      candidatoIds: ["garantia-ficticia-1", "garantia-ficticia-2"],
    });
  });

  it("marca todas las filas repetidas de la planilla para revisión", () => {
    const result = classifyImportRows([row({ numeroFila: 2 }), row({ numeroFila: 3, fechaInicio: "2026-10-06", fechaLimite: "2026-12-15", responsable: "Equipo ficticio B" })], [candidate()]);
    expect(result.map(({ clasificacion }) => clasificacion)).toEqual(["DUDOSA_REPETIDA_EN_ARCHIVO", "DUDOSA_REPETIDA_EN_ARCHIVO"]);
  });

  it("normaliza RUT/DV y diferencias de mayúsculas, tildes, espacios y puntuación", () => {
    const varied = row({ rut: " 12.345.678-5 ", dv: "", problemaSalud: "  CANCER   CERVICOUTERINO!!! ", nombreGarantia: " TRATAMIENTO... " });
    expect(classifyImportRows([varied], [candidate()])[0].clasificacion).toBe("COINCIDENCIA_EXACTA_UNICA");
  });

  it("ignora fecha límite y responsable al determinar identidad", () => {
    const changedNonIdentity = row({ fechaLimite: "2027-01-31", responsable: "Equipo ficticio distinto" });
    const changedCandidate = candidate({ fechaInicio: "2026-10-05" });
    expect(classifyImportRows([changedNonIdentity], [changedCandidate])[0].clasificacion).toBe("COINCIDENCIA_EXACTA_UNICA");
  });

  it("no puede distinguir dos episodios idénticos si solo hay un candidato registrado", () => {
    // Un segundo episodio con los mismos cuatro campos produciría la misma observación.
    // Sin ID de origen, la salida exacta única es una regla operativa, no certeza clínica.
    expect(classifyImportRows([row()], [candidate()])[0].clasificacion).toBe("COINCIDENCIA_EXACTA_UNICA");
  });

  it("rechaza fechas de inicio que no estén en formato civil ISO válido", () => {
    expect(() => classifyImportRows([row({ fechaInicio: "05/10/2026" })], [])).toThrow("YYYY-MM-DD");
    expect(() => classifyImportRows([row({ fechaInicio: "2026-02-30" })], [])).toThrow("fecha civil válida");
  });
});
