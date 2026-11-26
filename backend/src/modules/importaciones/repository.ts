import { prisma } from "../../db/prisma.js";

import { readImportRetentionConfig } from "./retention-config.js";

export interface ImportHistoryQuery { page: number; limit: number }

export async function listImports(query: ImportHistoryQuery) {
  const [total, rows] = await prisma.$transaction([
    prisma.importacion.count(),
    prisma.importacion.findMany({
      orderBy: { fechaImportacion: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
        nombreArchivo: true,
        fechaImportacion: true,
        estado: true,
        registrosLeidos: true,
        registrosNuevos: true,
        registrosActualizados: true,
        registrosSinCambios: true,
        registrosConError: true,
        usuario: { select: { nombre: true, username: true } },
      },
    }),
  ]);
  // Do not query tables absent from QA while retention is disabled.
  if (!readImportRetentionConfig()) return { data: rows, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  const controls = await prisma.controlRetencionImportacion.findMany({ where: { importacionId: { in: rows.map(row => row.id) } }, select: { importacionId: true, registrosPendientesRevision: true, registrosRepetidosOmitidos: true, registrosInvalidos: true } });
  const byImport = new Map(controls.map(control => [control.importacionId, control]));
  return { data: rows.map(row => {
    const control = byImport.get(row.id);
    return { ...row, registrosPendientesRevision: control?.registrosPendientesRevision ?? 0, registrosRepetidosOmitidos: control?.registrosRepetidosOmitidos ?? 0, ...(control ? { registrosInvalidos: control.registrosInvalidos } : {}) };
  }), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
}
