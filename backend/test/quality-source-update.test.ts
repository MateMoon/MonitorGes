import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { SourceGuarantee } from "../src/modules/calidad-datos/candidate-evidence.js";
import { changedSourceFields, isSourceDataUpdate, sourceUpdateValues, validSourceUpdate } from "../src/modules/calidad-datos/source-update.js";

const source = (): SourceGuarantee => ({
  id: randomUUID(), pacienteId: randomUUID(), problemaSalud: "Problema ficticio", nombreGarantia: "Tratamiento ficticio",
  fechaInicio: new Date("2026-10-01"), fechaLimite: new Date("2026-12-01"), responsable: "Centro ficticio",
  estadoGestion: "CUMPLIDA", version: 4, revisionGestion: 3, gestionadaAt: new Date("2026-10-15"), gestionadaPorUsuarioId: randomUUID(),
  createdAt: new Date("2026-10-01"), updatedAt: new Date("2026-11-01"), _count: { eventos: 3 },
  paciente: { id: randomUUID(), rutNumero: "12345678", dv: "5", nombre: "Paciente ficticio", updatedAt: new Date("2026-10-01") },
});
const row = { numeroFila: 2, problemaSalud: "Problema ficticio", nombreGarantia: "Tratamiento ficticio", rut: "12345678", dv: "5", nombre: "Nombre recibido ficticio", fechaInicio: "2026-10-02", fechaLimite: "2027-01-01", responsable: "Centro recibido ficticio" };
it("la lista de actualización solo contiene los cinco campos fuente de la garantía", () => {
  expect(Object.keys(sourceUpdateValues(row))).toEqual(["problemaSalud", "nombreGarantia", "fechaInicio", "fechaLimite", "responsable"]);
  expect(changedSourceFields(source(), row)).toEqual(["fechaInicio", "fechaLimite", "responsable"]);
});
it("el resultado debe conservar identidad, paciente, estado, gestión e historial y aumentar solo la versión de datos", () => {
  const before = source(), after = { ...before, ...sourceUpdateValues(row), version: before.version + 1, updatedAt: new Date("2026-11-02") };
  expect(validSourceUpdate(before, after, row)).toBe(true);
  for (const patch of [{ id: randomUUID() }, { pacienteId: randomUUID() }, { estadoGestion: "SIN_GESTION" as const }, { revisionGestion: 0 }, { gestionadaAt: null }, { gestionadaPorUsuarioId: null }, { version: before.version }, { createdAt: new Date("2026-11-02") }, { _count: { eventos: 0 } }, { paciente: { ...before.paciente, nombre: row.nombre } }, { responsable: "Otro valor ficticio" }]) expect(validSourceUpdate(before, { ...after, ...patch }, row)).toBe(false);
});
it("una diferencia solo en el nombre del paciente no habilita una actualización de la garantía", () => {
  const before = source();
  expect(changedSourceFields(before, { ...row, fechaInicio: "2026-10-01", fechaLimite: "2026-12-01", responsable: before.responsable })).toEqual([]);
});
it("la auditoría distingue actualización de MISMA histórica y DISTINTA sin reinterpretarlas", () => {
  expect(isSourceDataUpdate({ decision: "MISMA", antecedentesRevisados: { accion: "ACTUALIZAR_DATOS" } })).toBe(true);
  for (const antecedentesRevisados of [null, {}, [], { version: 1 }]) expect(isSourceDataUpdate({ decision: "MISMA", antecedentesRevisados })).toBe(false);
  expect(isSourceDataUpdate({ decision: "DISTINTA", antecedentesRevisados: { accion: "ACTUALIZAR_DATOS" } })).toBe(false);
});
