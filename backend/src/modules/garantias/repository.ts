import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import type { ListQuery } from "./schema.js";
import { eventSelect, timelineOrder } from "./management-repository.js";
import { guaranteeScopeFor, type GuaranteeViewer } from "./assignment-scope.js";

export async function listGuarantees(query: ListQuery, currentDate: string, user: GuaranteeViewer) {
  const states = query.estado ? (Array.isArray(query.estado) ? query.estado : query.estado.split(",")).map((s) => s.trim().toLowerCase()) : [];
  const allowed = ["vencida", "critica", "proxima", "atencion", "normal"];
  if (states.some((state) => !allowed.includes(state))) throw Object.assign(new Error("Estado inválido"), { statusCode: 400 });
  const ranges: Record<string, Prisma.GarantiaWhereInput> = {
    vencida: { fechaLimite: { lt: new Date(`${currentDate}T00:00:00.000Z`) } },
    critica: { fechaLimite: { gte: new Date(`${currentDate}T00:00:00.000Z`), lte: new Date(new Date(`${currentDate}T00:00:00.000Z`).getTime() + 7 * 86400000) } },
    proxima: { fechaLimite: { gt: new Date(new Date(`${currentDate}T00:00:00.000Z`).getTime() + 7 * 86400000), lte: new Date(new Date(`${currentDate}T00:00:00.000Z`).getTime() + 15 * 86400000) } },
    atencion: { fechaLimite: { gt: new Date(new Date(`${currentDate}T00:00:00.000Z`).getTime() + 15 * 86400000), lte: new Date(new Date(`${currentDate}T00:00:00.000Z`).getTime() + 30 * 86400000) } },
    normal: { fechaLimite: { gt: new Date(new Date(`${currentDate}T00:00:00.000Z`).getTime() + 30 * 86400000) } },
  };
  const patientFilters: Prisma.PacienteWhereInput[] = [];
  if (query.rut) {
    const [rawNumber, rawDv] = query.rut.replace(/\./g, "").split("-");
    const rutNumero = rawNumber.replace(/\D/g, "");
    patientFilters.push(rawDv
      ? { rutNumero: { equals: rutNumero }, dv: { equals: rawDv.trim(), mode: "insensitive" } }
      : { rutNumero: { contains: rutNumero } });
  }
  if (query.nombre) patientFilters.push({ nombre: { contains: query.nombre, mode: "insensitive" } });
  const scope = await guaranteeScopeFor(user);
  const where: Prisma.GarantiaWhereInput = {
    AND: [scope, ...(query.soloPendientes ? [{ estadoGestion: { not: "CUMPLIDA" as const } }] : [])],
    ...(query.estadoGestion ? { estadoGestion: query.estadoGestion } : {}),
    ...(patientFilters.length ? { paciente: { AND: patientFilters } } : {}),
    ...(query.responsable ? { responsable: { equals: query.responsable, mode: "insensitive" } } : {}),
    ...(query.problemaSalud ? { problemaSalud: { equals: query.problemaSalud, mode: "insensitive" } } : {}),
    ...(query.nombreGarantia ? { nombreGarantia: { equals: query.nombreGarantia, mode: "insensitive" } } : {}),
    ...(query.fechaLimiteDesde || query.fechaLimiteHasta ? { fechaLimite: { ...(query.fechaLimiteDesde ? { gte: new Date(`${query.fechaLimiteDesde}T00:00:00.000Z`) } : {}), ...(query.fechaLimiteHasta ? { lte: new Date(`${query.fechaLimiteHasta}T00:00:00.000Z`) } : {}) } } : {}),
    ...(states.length ? { OR: states.map((state) => ranges[state]) } : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.garantia.count({ where }),
    prisma.garantia.findMany({ where, include: { paciente: true, gestionadaPor: { select: { id: true, nombre: true } } }, orderBy: { [query.sort]: query.order }, skip: (query.page - 1) * query.limit, take: query.limit }),
  ]);
  return { total, rows };
}

export async function findGuarantee(id: string, user: GuaranteeViewer) {
  const scope = await guaranteeScopeFor(user);
  return prisma.garantia.findFirst({ where: { id, AND: [scope] }, include: { paciente: true, gestionadaPor: { select: { id: true, nombre: true } }, eventos: { select: eventSelect, orderBy: timelineOrder } } });
}

export async function listGuaranteeFilterOptions(user: GuaranteeViewer) {
  const where = await guaranteeScopeFor(user);
  const [responsables, problemasSalud, nombresGarantia] = await Promise.all([
    prisma.garantia.findMany({ where, distinct: ["responsable"], select: { responsable: true }, orderBy: { responsable: "asc" } }),
    prisma.garantia.findMany({ where, distinct: ["problemaSalud"], select: { problemaSalud: true }, orderBy: { problemaSalud: "asc" } }),
    prisma.garantia.findMany({ where, distinct: ["nombreGarantia"], select: { nombreGarantia: true }, orderBy: { nombreGarantia: "asc" } }),
  ]);
  const uniqueCaseInsensitive = (values: string[]) => {
    const unique = new Map<string, string>();
    for (const value of values.filter(Boolean)) {
      const key = value.normalize("NFC").toLocaleLowerCase("es-CL");
      if (!unique.has(key)) unique.set(key, value);
    }
    return [...unique.values()].sort((a, b) => a.localeCompare(b, "es-CL", { sensitivity: "base" }));
  };
  return {
    responsables: uniqueCaseInsensitive(responsables.map(({ responsable }) => responsable)),
    problemasSalud: uniqueCaseInsensitive(problemasSalud.map(({ problemaSalud }) => problemaSalud)),
    nombresGarantia: uniqueCaseInsensitive(nombresGarantia.map(({ nombreGarantia }) => nombreGarantia)),
  };
}
