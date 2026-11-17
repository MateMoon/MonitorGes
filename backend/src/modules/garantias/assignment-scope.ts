import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { normalizeIdentityText } from "../importaciones/identity-normalization.js";

export type GuaranteeViewer = { id: string; rol: string };
type AssignmentDatabase = Pick<Prisma.TransactionClient, "usuarioTipoGarantia" | "garantia">;

/** Mismo criterio para las consultas de la aplicación y los informes por correo. */
export async function matchingGuaranteeNames(db: Pick<Prisma.TransactionClient, "garantia">, keys: string[]) {
  if (!keys.length) return [];
  const allowed = new Set(keys);
  const names = await db.garantia.findMany({ distinct: ["nombreGarantia"], select: { nombreGarantia: true } });
  return names.map((row) => row.nombreGarantia).filter((name) => allowed.has(normalizeIdentityText(name)));
}

export async function guaranteeScopeFor(user: GuaranteeViewer, db: AssignmentDatabase = prisma): Promise<Prisma.GarantiaWhereInput> {
  if (!user) throw Object.assign(new Error("Inicia sesión para continuar."), { statusCode: 401 });
  if (user.rol === "ADMIN") return {};
  // Se consultan las asignaciones vigentes en cada petición, sin depender del
  // permiso de importar, la recepción de correo ni los datos del navegador.
  const assignments = await db.usuarioTipoGarantia.findMany({
    where: { usuarioId: user.id }, select: { claveNormalizada: true },
  });
  const names = await matchingGuaranteeNames(db, assignments.map((assignment) => assignment.claveNormalizada));
  // Una lista vacía significa ningún acceso, nunca acceso global.
  return { nombreGarantia: { in: names } };
}

export async function canAccessGuarantee(user: GuaranteeViewer, name: string, db: Pick<Prisma.TransactionClient, "usuarioTipoGarantia"> = prisma) {
  if (!user) return false;
  if (user.rol === "ADMIN") return true;
  const assignment = await db.usuarioTipoGarantia.findUnique({
    where: { usuarioId_claveNormalizada: { usuarioId: user.id, claveNormalizada: normalizeIdentityText(name) } },
    select: { usuarioId: true },
  });
  return Boolean(assignment);
}
