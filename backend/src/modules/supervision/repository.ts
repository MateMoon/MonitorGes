import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { dateToCivil } from "../../utils/dates.js";
import { assignmentScopeForRules, userAssignmentRules } from "../garantias/assignment-scope.js";
import { matchesAssignmentRules, readAssignmentRules, type AssignedGuarantee, type AssignmentRule } from "../garantias/assignment-rules.js";
import { getDaysRemaining, getGuaranteeStatus } from "../garantias/status.js";
import type { PriorityCase, PriorityReason, SupervisionSummary } from "./types.js";

const PRIORITY_LIMIT = 10;
const categoryKey = (row: AssignedGuarantee) => JSON.stringify([row.problemaSalud, row.responsable, row.nombreGarantia]);

/** No writes, new assignment semantics, patient-wide loads, or persistent coverage cache. */
export async function readSupervisionSummary(today: string): Promise<SupervisionSummary> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const accounts = await tx.usuario.findMany({
      where: { activo: true, rol: "PROFESIONAL" },
      select: { id: true, nombre: true, reglasAsignacion: true },
      orderBy: { id: "asc" },
    });
    const professionals: { id: string; nombre: string; rules: AssignmentRule[]; cantidad: number }[] = [];
    for (const account of accounts) {
      // Access helpers deliberately fail closed on corruption. For reporting, distinguish
      // corrupt JSON from a valid empty set rather than publishing misleading counts.
      if (account.reglasAsignacion != null) {
        const parsed = readAssignmentRules(account.reglasAsignacion);
        if (!Array.isArray(account.reglasAsignacion) || parsed?.length !== account.reglasAsignacion.length) {
          throw new Error("SUPERVISION_INVALID_ASSIGNMENT_RULES");
        }
      }
      const rules = await userAssignmentRules(account.id, tx);
      if (readAssignmentRules(rules)?.length !== rules.length) throw new Error("SUPERVISION_INVALID_ASSIGNMENT_RULES");
      if (rules.length) professionals.push({ id: account.id, nombre: account.nombre, rules, cantidad: 0 });
    }

    const union = [...new Map(professionals.flatMap((professional) => professional.rules).map((rule) => [JSON.stringify(rule), rule])).values()];
    // This is the same SQL access predicate used by guarantees and individual reports.
    const coveredScope = await assignmentScopeForRules(union, tx);
    const uncoveredScope: Prisma.GarantiaWhereInput = { NOT: coveredScope };
    const nonCompleted = { estadoGestion: { not: "CUMPLIDA" as const } };
    const groups = await tx.garantia.groupBy({
      by: ["problemaSalud", "responsable", "nombreGarantia", "estadoGestion", "fechaLimite"],
      _count: { _all: true },
    });
    const indicadores: SupervisionSummary["indicadores"] = {
      totalGarantias: 0, pendientesResolucion: 0, enGestion: 0, cumplidas: 0,
      vencidasNoCumplidas: 0, proximas15DiasNoCumplidas: 0,
    };
    const cobertura: SupervisionSummary["cobertura"] = {
      sinProfesional: 0, unProfesional: 0, variosProfesionales: 0, sinProfesionalNoCumplidas: 0,
    };
    const problems = new Map<string, number>();
    const establishments = new Map<string, number>();
    const matching = new Map<string, typeof professionals>();
    const matchingProfessionals = (row: AssignedGuarantee) => {
      const key = categoryKey(row);
      if (!matching.has(key)) matching.set(key, professionals.filter((professional) => matchesAssignmentRules(row, professional.rules)));
      return matching.get(key)!;
    };
    for (const group of groups) {
      const count = group._count._all;
      const matched = matchingProfessionals(group);
      indicadores.totalGarantias += count;
      if (group.estadoGestion === "PENDIENTE_RESOLUCION") indicadores.pendientesResolucion += count;
      if (group.estadoGestion === "EN_GESTION") indicadores.enGestion += count;
      if (group.estadoGestion === "CUMPLIDA") indicadores.cumplidas += count;
      if (matched.length === 0) cobertura.sinProfesional += count;
      else if (matched.length === 1) cobertura.unProfesional += count;
      else cobertura.variosProfesionales += count;
      if (group.estadoGestion === "CUMPLIDA") continue;

      const status = getGuaranteeStatus(dateToCivil(group.fechaLimite), today);
      if (status === "vencida") indicadores.vencidasNoCumplidas += count;
      if (status === "critica" || status === "proxima") indicadores.proximas15DiasNoCumplidas += count;
      if (matched.length === 0) cobertura.sinProfesionalNoCumplidas += count;
      problems.set(group.problemaSalud, (problems.get(group.problemaSalud) ?? 0) + count);
      establishments.set(group.responsable, (establishments.get(group.responsable) ?? 0) + count);
      for (const professional of matched) professional.cantidad += count;
    }

    // Verify the shared in-memory matcher against the shared SQL predicate in this
    // snapshot. Any divergence is an error, never a fabricated zero or partial summary.
    const uncoveredTotal = await tx.garantia.count({ where: uncoveredScope });
    const uncoveredOperational = await tx.garantia.count({ where: { AND: [nonCompleted, uncoveredScope] } });
    if (uncoveredTotal !== cobertura.sinProfesional || uncoveredOperational !== cobertura.sinProfesionalNoCumplidas) {
      throw new Error("SUPERVISION_COVERAGE_INCONSISTENT");
    }

    const day = new Date(`${today}T00:00:00.000Z`);
    const seventhDay = new Date(day.getTime() + 7 * 86_400_000);
    // Disjoint buckets implement the required rank without duplicating access logic
    // in raw SQL or loading every patient's details to sort in JavaScript.
    const buckets: Prisma.GarantiaWhereInput[] = [
      { fechaLimite: { lt: day } },
      { fechaLimite: { gte: day, lte: seventhDay } },
      { AND: [uncoveredScope], fechaLimite: { gt: seventhDay } },
    ];
    const prioritarios: PriorityCase[] = [];
    for (const [index, bucket] of buckets.entries()) {
      if (prioritarios.length === PRIORITY_LIMIT) break;
      const rows = await tx.garantia.findMany({
        where: { AND: [nonCompleted, bucket] },
        select: { id: true, problemaSalud: true, nombreGarantia: true, responsable: true, fechaLimite: true, estadoGestion: true, paciente: { select: { nombre: true } } },
        orderBy: [{ fechaLimite: "asc" }, { id: "asc" }],
        take: PRIORITY_LIMIT - prioritarios.length,
      });
      for (const row of rows) {
        const fechaLimite = dateToCivil(row.fechaLimite);
        const estado = getGuaranteeStatus(fechaLimite, today);
        const matched = matchingProfessionals(row);
        const motivos: PriorityReason[] = [];
        if (estado === "vencida") motivos.push("VENCIDA");
        if (estado === "critica") motivos.push("CRITICA");
        if (matched.length === 0) motivos.push("SIN_PROFESIONAL_ACTIVO");
        if (!motivos.length || row.estadoGestion === "CUMPLIDA") throw new Error("SUPERVISION_PRIORITY_INCONSISTENT");
        prioritarios.push({
          id: row.id, paciente: row.paciente, problemaSalud: row.problemaSalud,
          nombreGarantia: row.nombreGarantia, establecimiento: row.responsable, fechaLimite,
          estadoGestion: row.estadoGestion, estadoVencimiento: estado,
          diasRestantes: getDaysRemaining(fechaLimite, today),
          cantidadProfesionalesCoincidentes: matched.length, motivosPrioridad: motivos,
          prioridad: (index + 1) as 1 | 2 | 3,
        });
      }
    }
    const byCountAndLabel = (a: [string, number], b: [string, number]) => b[1] - a[1] || a[0].localeCompare(b[0], "es");
    return {
      indicadores, cobertura,
      criteriosCobertura: { rol: "PROFESIONAL", soloActivos: true, profesionalesActivos: accounts.length, profesionalesConReglasEfectivas: professionals.length },
      distribuciones: {
        soloNoCumplidas: true, permiteSuperposicionEntreProfesionales: true,
        porProblemaSalud: [...problems.entries()].sort(byCountAndLabel).map(([problemaSalud, cantidad]) => ({ problemaSalud, cantidad })),
        porEstablecimiento: [...establishments.entries()].sort(byCountAndLabel).map(([establecimiento, cantidad]) => ({ establecimiento, cantidad })),
        porProfesional: professionals.map(({ id, nombre, cantidad }) => ({ usuarioId: id, nombre, cantidad })).sort((a, b) => b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre, "es") || a.usuarioId.localeCompare(b.usuarioId)),
      },
      prioritarios,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
}
