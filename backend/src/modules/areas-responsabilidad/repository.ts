import { prisma } from "../../db/prisma.js";

const areaInclude = {
  establecimiento: { select: { id: true, nombre: true, activo: true } },
  combinacion: {
    select: {
      id: true,
      activa: true,
      problemaSalud: { select: { id: true, nombre: true, activo: true } },
      tipoGarantia: { select: { id: true, nombre: true, activo: true } },
    },
  },
} as const;

export async function listActiveStaff() {
  return prisma.usuario.findMany({
    where: { activo: true },
    select: { id: true, nombre: true, rol: true },
    orderBy: [{ nombre: "asc" }, { id: "asc" }],
  });
}

export async function listCatalogs(includeInactive: boolean) {
  const where = includeInactive ? {} : { activo: true };
  const combinationWhere = includeInactive ? {} : {
    activa: true,
    problemaSalud: { activo: true },
    tipoGarantia: { activo: true },
  };
  const [establecimientos, problemasSalud, tiposGarantia, combinaciones] = await Promise.all([
    prisma.establecimiento.findMany({ where, orderBy: [{ nombre: "asc" }, { id: "asc" }] }),
    prisma.problemaSalud.findMany({ where, orderBy: [{ nombre: "asc" }, { id: "asc" }] }),
    prisma.tipoGarantia.findMany({ where, orderBy: [{ nombre: "asc" }, { id: "asc" }] }),
    prisma.combinacionProblemaGarantia.findMany({
      where: combinationWhere,
      include: { problemaSalud: { select: { id: true, nombre: true, activo: true } }, tipoGarantia: { select: { id: true, nombre: true, activo: true } } },
      orderBy: [{ problemaSalud: { nombre: "asc" } }, { tipoGarantia: { nombre: "asc" } }, { id: "asc" }],
    }),
  ]);
  return { establecimientos, problemasSalud, tiposGarantia, combinaciones };
}

export async function listUserAreas(usuarioId: string) {
  return prisma.areaResponsabilidad.findMany({
    where: { usuarioId },
    include: areaInclude,
    orderBy: [{ activa: "desc" }, { establecimiento: { nombre: "asc" } }, { createdAt: "asc" }],
  });
}

export type AreaSelection = { establecimientoId: string; combinacionId: string };
export type SaveAreasResult =
  | { ok: true; areas: Awaited<ReturnType<typeof listUserAreas>> }
  | { ok: false; reason: "USER_NOT_FOUND" | "INACTIVE_USER" | "INVALID_CATALOG_SELECTION" };

/** Replaces the selected active area set while retaining removed coverages as inactive rows. */
export async function saveUserAreas(usuarioId: string, actorId: string, selections: AreaSelection[]): Promise<SaveAreasResult> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, activo: true } });
    if (!user) return { ok: false, reason: "USER_NOT_FOUND" };
    if (!user.activo && selections.length > 0) return { ok: false, reason: "INACTIVE_USER" };

    const uniqueSelections = new Map(selections.map((selection) => [`${selection.establecimientoId}:${selection.combinacionId}`, selection]));
    const selected = [...uniqueSelections.values()];
    if (selected.length > 0) {
      const establishmentIds = [...new Set(selected.map((item) => item.establecimientoId))];
      const combinationIds = [...new Set(selected.map((item) => item.combinacionId))];
      const [establishments, combinations] = await Promise.all([
        tx.establecimiento.findMany({ where: { id: { in: establishmentIds }, activo: true }, select: { id: true } }),
        tx.combinacionProblemaGarantia.findMany({
          where: { id: { in: combinationIds }, activa: true, problemaSalud: { activo: true }, tipoGarantia: { activo: true } },
          select: { id: true },
        }),
      ]);
      if (establishments.length !== establishmentIds.length || combinations.length !== combinationIds.length) {
        return { ok: false, reason: "INVALID_CATALOG_SELECTION" };
      }
    }

    const desiredKeys = new Set(selected.map((item) => `${item.establecimientoId}:${item.combinacionId}`));
    const activeAreas = await tx.areaResponsabilidad.findMany({
      where: { usuarioId, activa: true },
      select: { id: true, establecimientoId: true, combinacionId: true },
    });
    const removedIds = activeAreas.filter((area) => !desiredKeys.has(`${area.establecimientoId}:${area.combinacionId}`)).map(({ id }) => id);
    if (removedIds.length > 0) {
      await tx.areaResponsabilidad.updateMany({
        where: { id: { in: removedIds } },
        data: { activa: false, actualizadorId: actorId },
      });
    }

    for (const selection of selected) {
      await tx.areaResponsabilidad.upsert({
        where: { usuarioId_establecimientoId_combinacionId: { usuarioId, ...selection } },
        create: { usuarioId, ...selection, activa: true, creadorId: actorId, actualizadorId: actorId },
        update: { activa: true, actualizadorId: actorId },
      });
    }

    const areas = await tx.areaResponsabilidad.findMany({
      where: { usuarioId },
      include: areaInclude,
      orderBy: [{ activa: "desc" }, { establecimiento: { nombre: "asc" } }, { createdAt: "asc" }],
    });
    return { ok: true, areas };
  });
}

export async function createCatalogEntry(kind: "establecimiento" | "problemaSalud" | "tipoGarantia", nombre: string, claveNormalizada: string) {
  const existing = kind === "establecimiento"
    ? await prisma.establecimiento.findMany({ select: { id: true, claveNormalizada: true } })
    : kind === "problemaSalud"
      ? await prisma.problemaSalud.findMany({ select: { id: true, claveNormalizada: true } })
      : await prisma.tipoGarantia.findMany({ select: { id: true, claveNormalizada: true } });
  if (existing.some((item) => item.claveNormalizada === claveNormalizada)) return { duplicate: true as const };
  try {
    const created = kind === "establecimiento"
      ? await prisma.establecimiento.create({ data: { nombre, claveNormalizada } })
      : kind === "problemaSalud"
        ? await prisma.problemaSalud.create({ data: { nombre, claveNormalizada } })
        : await prisma.tipoGarantia.create({ data: { nombre, claveNormalizada } });
    return { duplicate: false as const, created };
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return { duplicate: true as const };
    throw error;
  }
}

export async function createAllowedCombination(problemaSaludId: string, tipoGarantiaId: string) {
  const [problem, guaranteeType] = await Promise.all([
    prisma.problemaSalud.findUnique({ where: { id: problemaSaludId }, select: { id: true, activo: true } }),
    prisma.tipoGarantia.findUnique({ where: { id: tipoGarantiaId }, select: { id: true, activo: true } }),
  ]);
  if (!problem?.activo || !guaranteeType?.activo) return { invalid: true as const };
  try {
    return { invalid: false as const, created: await prisma.combinacionProblemaGarantia.create({ data: { problemaSaludId, tipoGarantiaId } }) };
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return { duplicate: true as const };
    throw error;
  }
}

export type CatalogKind = "establecimiento" | "problemaSalud" | "tipoGarantia" | "combinacion";
export async function setCatalogActive(kind: CatalogKind, id: string, active: boolean) {
  if (kind === "establecimiento") {
    const referenced = await prisma.areaResponsabilidad.count({ where: { establecimientoId: id, activa: true } });
    if (!active && referenced > 0) return { blocked: true as const };
    const result = await prisma.establecimiento.updateMany({ where: { id }, data: { activo: active } });
    return { blocked: false as const, changed: result.count };
  }
  if (kind === "combinacion") {
    const combination = await prisma.combinacionProblemaGarantia.findUnique({ where: { id }, select: { id: true, problemaSalud: { select: { activo: true } }, tipoGarantia: { select: { activo: true } } } });
    if (!combination) return { blocked: false as const, changed: 0 };
    if (active && (!combination.problemaSalud.activo || !combination.tipoGarantia.activo)) return { blocked: true as const };
    const referenced = await prisma.areaResponsabilidad.count({ where: { combinacionId: id, activa: true } });
    if (!active && referenced > 0) return { blocked: true as const };
    const result = await prisma.combinacionProblemaGarantia.updateMany({ where: { id }, data: { activa: active } });
    return { blocked: false as const, changed: result.count };
  }
  if (kind === "problemaSalud" || kind === "tipoGarantia") {
    const referenced = kind === "problemaSalud"
      ? await prisma.areaResponsabilidad.count({ where: { activa: true, combinacion: { problemaSaludId: id } } })
      : await prisma.areaResponsabilidad.count({ where: { activa: true, combinacion: { tipoGarantiaId: id } } });
    if (!active && referenced > 0) return { blocked: true as const };
    const activeCombinations = kind === "problemaSalud"
      ? await prisma.combinacionProblemaGarantia.count({ where: { problemaSaludId: id, activa: true } })
      : await prisma.combinacionProblemaGarantia.count({ where: { tipoGarantiaId: id, activa: true } });
    if (!active && activeCombinations > 0) return { blocked: true as const };
    const result = kind === "problemaSalud"
      ? await prisma.problemaSalud.updateMany({ where: { id }, data: { activo: active } })
      : await prisma.tipoGarantia.updateMany({ where: { id }, data: { activo: active } });
    return { blocked: false as const, changed: result.count };
  }
  return { blocked: true as const };
}
