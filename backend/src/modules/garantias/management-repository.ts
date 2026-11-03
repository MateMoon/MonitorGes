import { prisma } from "../../db/prisma.js";
import { decideManagement, ManagementError, type ManagementCommand } from "./management.js";

export const timelineOrder = [{ createdAt: "desc" as const }, { secuencia: "desc" as const }];
export const eventSelect = { id: true, secuencia: true, tipo: true, tipoActuacion: true, comentario: true, estadoAnterior: true, estadoNuevo: true, respaldo: true, createdAt: true, autorNombre: true, usuarioId: true } as const;

export async function writeManagement(id: string, user: { id: string; nombre: string; rol: string }, command: ManagementCommand) {
  // Defensa adicional para llamadas internas, además de los guards de Fastify.
  const authorized = command.operacion === "actuacion" ? ["ADMIN", "PROFESIONAL"].includes(user.rol) : user.rol === "ADMIN";
  if (!authorized) throw new ManagementError("FORBIDDEN", "No tienes permisos para realizar esta acción.", 403);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Garantia" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const current = await tx.garantia.findUnique({ where: { id } });
    if (!current) return null;
    if (current.revisionGestion !== command.revisionGestion) throw new ManagementError("STALE_MANAGEMENT", "El seguimiento cambió. Recarga el detalle antes de continuar.");
    const decision = decideManagement(current.estadoGestion, command);
    const instant = new Date();
    const evento = await tx.eventoGarantia.create({ data: {
      garantiaId: id, usuarioId: user.id, autorNombre: user.nombre, tipo: decision.tipo,
      tipoActuacion: decision.tipoActuacion, comentario: decision.comentario, respaldo: decision.respaldo,
      estadoAnterior: current.estadoGestion, estadoNuevo: decision.estado, createdAt: instant,
    }, select: eventSelect });
    // Conserva la compatibilidad de última gestión sin tocar plazos ni versión de importación.
    // SQL explícito conserva también updatedAt (utilizado para cambios de datos fuente).
    await tx.$executeRaw`UPDATE "Garantia" SET "estadoGestion" = ${decision.estado}::"EstadoGestion",
      "revisionGestion" = "revisionGestion" + 1, "gestionadaAt" = (CAST(${instant} AS timestamptz) AT TIME ZONE 'UTC'), "gestionadaPorUsuarioId" = ${user.id}::uuid
      WHERE "id" = ${id}::uuid`;
    return { estadoGestion: decision.estado, revisionGestion: current.revisionGestion + 1, gestionadaAt: instant, gestionadaPor: { id: user.id, nombre: user.nombre }, evento };
  });
}
