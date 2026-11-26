import type { FutureResolutionEffects } from "./contracts.js";
import { normalizeIdentityRut } from "../importaciones/identity-normalization.js";
import { sourceUpdateValues } from "./source-update.js";

/** Fixed internal executor. The persistence service already holds the shared
 * patient lock and has checked the review token. No generic importer,
 * copied management, callbacks from HTTP or IDs supplied by a client. */
export const operationalResolutionEffects: FutureResolutionEffects = {
  async actualizarGarantiaExistente(tx, { garantiaExistenteId, datosValidados }) {
    await tx.garantia.update({ where: { id: garantiaExistenteId }, data: {
      ...sourceUpdateValues(datosValidados), version: { increment: 1 },
    } });
  },
  async crearGarantiaDistinta(tx, { nuevaGarantiaId, datosValidados: data }) {
    const identity = normalizeIdentityRut(data.rut, data.dv);
    const existing = await tx.paciente.findUnique({ where: { rutNumero_dv: identity }, select: { id: true } });
    const patient = existing ?? await tx.paciente.create({ data: { ...identity, nombre: data.nombre } });
    await tx.garantia.create({ data: {
      id: nuevaGarantiaId, pacienteId: patient.id, problemaSalud: data.problemaSalud,
      nombreGarantia: data.nombreGarantia, fechaInicio: new Date(`${data.fechaInicio}T00:00:00.000Z`),
      fechaLimite: new Date(`${data.fechaLimite}T00:00:00.000Z`), responsable: data.responsable,
      // All management/version defaults come from the normal Prisma model.
    } });
  },
};
