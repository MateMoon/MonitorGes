import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { normalizeIdentityText } from "../importaciones/identity-normalization.js";
import { legacyAssignmentRules, readAssignmentRules, matchesAssignmentRules, type AssignedGuarantee, type AssignmentRule } from "./assignment-rules.js";

export type GuaranteeViewer = { id: string; rol: string };
type AssignmentDatabase = Pick<Prisma.TransactionClient, "usuario" | "usuarioTipoGarantia" | "garantia">;

/** Mismo criterio para las consultas de la aplicación y los informes por correo. */
export async function matchingGuaranteeNames(db: Pick<Prisma.TransactionClient, "garantia">, keys: string[]) {
  if (!keys.length) return [];
  const allowed = new Set(keys);
  const names = await db.garantia.findMany({ distinct: ["nombreGarantia"], select: { nombreGarantia: true } });
  return names.map((row) => row.nombreGarantia).filter((name) => allowed.has(normalizeIdentityText(name)));
}

export async function userAssignmentRules(id: string, db: Pick<AssignmentDatabase, "usuario" | "usuarioTipoGarantia"> = prisma): Promise<AssignmentRule[]> {
  const account = await db.usuario.findUnique({ where: { id }, select: { reglasAsignacion: true } });
  if (!account) return [];
  const rules = readAssignmentRules(account.reglasAsignacion);
  if (rules !== null) return rules;
  const types = await db.usuarioTipoGarantia.findMany({ where: { usuarioId: id }, select: { claveNormalizada: true } });
  return legacyAssignmentRules(types.map((type) => type.claveNormalizada));
}

/** Each rule is an intersection; multiple rules form a union, preserving exact combinations. */
export async function assignmentScopeForRules(rules: AssignmentRule[], db: Pick<AssignmentDatabase, "garantia"> = prisma): Promise<Prisma.GarantiaWhereInput> {
  if (!rules.length) return { id: { in: [] } };
  const values = await db.garantia.findMany({ distinct: ["problemaSalud", "responsable", "nombreGarantia"], select: { problemaSalud: true, responsable: true, nombreGarantia: true } });
  const fields = ["problemaSalud", "responsable", "nombreGarantia"] as const;
  const indexes = { problemaSalud: new Map<string, Set<string>>(), responsable: new Map<string, Set<string>>(), nombreGarantia: new Map<string, Set<string>>() };
  for (const row of values) {
    for (const field of fields) {
      const key = normalizeIdentityText(row[field]);
      if (!indexes[field].has(key)) indexes[field].set(key, new Set());
      indexes[field].get(key)!.add(row[field]);
    }
  }
  const matches = (key: string, field: typeof fields[number]) => [...(indexes[field].get(key) ?? [])];
  return { OR: rules.filter((rule) => rule.problemaSalud || rule.establecimiento || rule.tipoGarantia).map((rule) => ({
    ...(rule.problemaSalud ? { problemaSalud: { in: matches(rule.problemaSalud, "problemaSalud") } } : {}),
    ...(rule.establecimiento ? { responsable: { in: matches(rule.establecimiento, "responsable") } } : {}),
    ...(rule.tipoGarantia ? { nombreGarantia: { in: matches(rule.tipoGarantia, "nombreGarantia") } } : {}),
  })) };
}

export async function guaranteeScopeFor(user: GuaranteeViewer, db: AssignmentDatabase = prisma): Promise<Prisma.GarantiaWhereInput> {
  if (!user) throw Object.assign(new Error("Inicia sesión para continuar."), { statusCode: 401 });
  if (user.rol === "ADMIN") return {};
  return assignmentScopeForRules(await userAssignmentRules(user.id, db), db);
}

export async function canAccessGuarantee(user: GuaranteeViewer, row: AssignedGuarantee, db: Pick<AssignmentDatabase, "usuario" | "usuarioTipoGarantia"> = prisma) {
  if (!user) return false;
  if (user.rol === "ADMIN") return true;
  return matchesAssignmentRules(row, await userAssignmentRules(user.id, db));
}
