import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import type { ListQuery } from "./schema.js";

export async function listGuarantees(query: ListQuery, currentDate: string) {
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
  const where: Prisma.GarantiaWhereInput = {
    ...(patientFilters.length ? { paciente: { AND: patientFilters } } : {}),
    ...(query.responsable ? { responsable: { contains: query.responsable, mode: "insensitive" } } : {}),
    ...(query.problemaSalud ? { problemaSalud: { contains: query.problemaSalud, mode: "insensitive" } } : {}),
    ...(query.nombreGarantia ? { nombreGarantia: { contains: query.nombreGarantia, mode: "insensitive" } } : {}),
    ...(query.fechaLimiteDesde || query.fechaLimiteHasta ? { fechaLimite: { ...(query.fechaLimiteDesde ? { gte: new Date(`${query.fechaLimiteDesde}T00:00:00.000Z`) } : {}), ...(query.fechaLimiteHasta ? { lte: new Date(`${query.fechaLimiteHasta}T00:00:00.000Z`) } : {}) } } : {}),
    ...(states.length ? { OR: states.map((state) => ranges[state]) } : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.garantia.count({ where }),
    prisma.garantia.findMany({ where, include: { paciente: true, gestionadaPor: { select: { id: true, nombre: true } } }, orderBy: { [query.sort]: query.order }, skip: (query.page - 1) * query.limit, take: query.limit }),
  ]);
  return { total, rows };
}

export const findGuarantee = (id: string) => prisma.garantia.findUnique({ where: { id }, include: { paciente: true, gestionadaPor: { select: { id: true, nombre: true } } } });
