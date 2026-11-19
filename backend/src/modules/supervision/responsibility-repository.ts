import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { readAssignmentRules, legacyAssignmentRules, type AssignmentRule } from "../garantias/assignment-rules.js";
import { listAssignmentOptions, saveAssignmentRules, userTransaction, UserManagementError } from "../usuarios/repository.js";

const staffSelect = { id: true, nombre: true, rol: true, activo: true, reglasAsignacion: true, tiposGarantia: { select: { claveNormalizada: true } } } as const;
type StaffRecord = Prisma.UsuarioGetPayload<{ select: typeof staffSelect }>;
type Actor = { id: string; rol: string; activo: boolean };

function staffData(row: StaffRecord) {
  const rules = readAssignmentRules(row.reglasAsignacion);
  if (row.reglasAsignacion != null && (!Array.isArray(row.reglasAsignacion) || rules?.length !== row.reglasAsignacion.length)) {
    throw new UserManagementError("INVALID_STORED_ASSIGNMENT_RULES", "Las reglas guardadas requieren revisión por un administrador.", 409);
  }
  const types = row.tiposGarantia.map((type) => type.claveNormalizada).sort();
  const revision = createHash("sha256").update(JSON.stringify({ reglas: row.reglasAsignacion, tipos: row.reglasAsignacion == null ? types : [], rol: row.rol, activo: row.activo })).digest("hex");
  return { id: row.id, nombre: row.nombre, rol: row.rol, activo: row.activo, reglasAsignacion: rules ?? legacyAssignmentRules(types), revision };
}

async function currentActor(tx: Prisma.TransactionClient, id: string): Promise<Actor> {
  const actor = await tx.usuario.findUnique({ where: { id }, select: { id: true, rol: true, activo: true } });
  if (!actor?.activo || !["ADMIN", "COORDINADOR_SOME"].includes(actor.rol)) throw new UserManagementError("FORBIDDEN", "No tienes permiso para administrar responsabilidades.", 403);
  return actor;
}
function staffScope(actor: Actor): Prisma.UsuarioWhereInput {
  return actor.rol === "ADMIN" ? { rol: { not: "ADMIN" } } : { activo: true, rol: { in: ["PROFESIONAL", "LECTOR"] }, id: { not: actor.id } };
}
function canEdit(actor: Actor, target: StaffRecord) {
  if (target.rol === "ADMIN") return false;
  return actor.rol === "ADMIN" || (target.id !== actor.id && target.activo && ["PROFESIONAL", "LECTOR"].includes(target.rol));
}

export async function readResponsibilities(actorId: string) {
  return userTransaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const actor = await currentActor(tx, actorId);
    const [staff, opciones] = await Promise.all([
      tx.usuario.findMany({ where: staffScope(actor), select: staffSelect, orderBy: [{ activo: "desc" }, { nombre: "asc" }, { id: "asc" }] }),
      listAssignmentOptions(tx),
    ]);
    return { funcionarios: staff.map(staffData), opciones };
  });
}

export async function writeResponsibilities(actorId: string, targetId: string, revision: string, rules: AssignmentRule[]) {
  return userTransaction(async (tx) => {
    const actor = await currentActor(tx, actorId);
    const target = await tx.usuario.findUnique({ where: { id: targetId }, select: staffSelect });
    // Excluded accounts cannot be edited here, even by guessing IDs as ADMIN.
    if (!target || !canEdit(actor, target)) throw new UserManagementError("FORBIDDEN", "No tienes permiso para modificar las reglas de este funcionario.", 403);
    const before = staffData(target);
    if (before.revision !== revision) throw new UserManagementError("STALE_ASSIGNMENT_RULES", "Las reglas cambiaron desde que abriste el editor. Actualiza la lista antes de guardar.", 409);
    await saveAssignmentRules(tx, target.id, rules);
    const data = staffData(await tx.usuario.findUniqueOrThrow({ where: { id: target.id }, select: staffSelect }));
    return { data, audit: { actorId: actor.id, actorRole: actor.rol, targetId: target.id, beforeRevision: before.revision, afterRevision: data.revision, beforeCount: before.reglasAsignacion.length, afterCount: data.reglasAsignacion.length } };
  });
}
