import { prisma } from "../../db/prisma.js";

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
      },
    }),
  ]);
  return { data: rows, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
}
