import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRoles } from "../auth/routes.js";
import { normalizeIdentityText } from "../importaciones/identity-normalization.js";
import {
  createAllowedCombination,
  createCatalogEntry,
  listActiveStaff,
  listCatalogs,
  listUserAreas,
  saveUserAreas,
  setCatalogActive,
  type CatalogKind,
} from "./repository.js";

const authorized = requireRoles("ADMIN", "COORDINADOR_SOME");
const adminOnly = requireRoles("ADMIN");
const idSchema = z.string().uuid();
const areaSchema = z.object({
  establecimientoId: idSchema,
  combinacionId: idSchema,
}).strict();
const saveAreasSchema = z.object({ areas: z.array(areaSchema).max(10_000) }).strict();
const catalogKinds = ["establecimiento", "problemaSalud", "tipoGarantia", "combinacion"] as const;

function uuid(value: string) { return idSchema.safeParse(value).success; }

export async function responsibilityAreaRoutes(app: FastifyInstance) {
  app.get("/usuarios", { preHandler: authorized }, async () => ({ data: await listActiveStaff() }));

  app.get("/catalogos", { preHandler: authorized }, async (request) => ({
    data: await listCatalogs(request.authUser?.rol === "ADMIN"),
    catalogosEditables: request.authUser?.rol === "ADMIN",
  }));

  app.get<{ Params: { usuarioId: string } }>("/usuarios/:usuarioId", { preHandler: authorized }, async (request, reply) => {
    if (!uuid(request.params.usuarioId)) return reply.code(400).send({ error: { code: "INVALID_USER_ID", message: "El identificador del funcionario no es válido." } });
    return { data: await listUserAreas(request.params.usuarioId) };
  });

  app.put<{ Params: { usuarioId: string }; Body: unknown }>("/usuarios/:usuarioId", { preHandler: authorized }, async (request, reply) => {
    if (!uuid(request.params.usuarioId)) return reply.code(400).send({ error: { code: "INVALID_USER_ID", message: "El identificador del funcionario no es válido." } });
    const parsed = saveAreasSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Revisa las coberturas seleccionadas." } });
    const result = await saveUserAreas(request.params.usuarioId, request.authUser!.id, parsed.data.areas);
    if (!result.ok) {
      const errors = {
        USER_NOT_FOUND: [404, "USER_NOT_FOUND", "No se encontró el funcionario."],
        INACTIVE_USER: [409, "INACTIVE_USER", "No se pueden asignar áreas activas a un funcionario inactivo."],
        INVALID_CATALOG_SELECTION: [400, "INVALID_CATALOG_SELECTION", "Una o más coberturas usan catálogos inactivos o inexistentes."],
      } as const;
      const [status, code, message] = errors[result.reason];
      return reply.code(status).send({ error: { code, message } });
    }
    return { data: result.areas };
  });

  app.post<{ Params: { kind: string }; Body: unknown }>("/catalogos/:kind", { preHandler: adminOnly }, async (request, reply) => {
    const kind = request.params.kind;
    if (kind !== "establecimiento" && kind !== "problemaSalud" && kind !== "tipoGarantia") return reply.code(404).send({ error: { code: "CATALOG_NOT_FOUND", message: "El catálogo solicitado no existe." } });
    const parsed = z.object({ nombre: z.string().trim().min(2).max(180) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Ingresa un nombre de catálogo válido." } });
    const nombre = parsed.data.nombre;
    const claveNormalizada = normalizeIdentityText(nombre);
    if (!claveNormalizada) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "El nombre debe incluir letras o números." } });
    const created = await createCatalogEntry(kind, nombre, claveNormalizada);
    if (created.duplicate) return reply.code(409).send({ error: { code: "CATALOG_ENTRY_EXISTS", message: "Ya existe un valor igual o equivalente en este catálogo." } });
    return reply.code(201).send({ data: created.created });
  });

  app.post<{ Body: unknown }>("/catalogos/combinaciones", { preHandler: adminOnly }, async (request, reply) => {
    const parsed = z.object({ problemaSaludId: idSchema, tipoGarantiaId: idSchema }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Selecciona un problema y un tipo de garantía válidos." } });
    const result = await createAllowedCombination(parsed.data.problemaSaludId, parsed.data.tipoGarantiaId);
    if ("invalid" in result && result.invalid) return reply.code(400).send({ error: { code: "INACTIVE_CATALOG_ENTRY", message: "Activa el problema y el tipo antes de crear la combinación." } });
    if ("duplicate" in result && result.duplicate) return reply.code(409).send({ error: { code: "COMBINATION_EXISTS", message: "La combinación ya existe." } });
    return reply.code(201).send({ data: result.created });
  });

  app.patch<{ Params: { kind: string; id: string }; Body: unknown }>("/catalogos/:kind/:id", { preHandler: adminOnly }, async (request, reply) => {
    const parsedKind = z.enum(catalogKinds).safeParse(request.params.kind);
    const parsedBody = z.object({ activo: z.boolean() }).strict().safeParse(request.body);
    if (!parsedKind.success) return reply.code(404).send({ error: { code: "CATALOG_NOT_FOUND", message: "El catálogo solicitado no existe." } });
    if (!uuid(request.params.id) || !parsedBody.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "El identificador o estado del catálogo no es válido." } });
    const result = await setCatalogActive(parsedKind.data as CatalogKind, request.params.id, parsedBody.data.activo);
    if (result.changed === 0) return reply.code(404).send({ error: { code: "CATALOG_ENTRY_NOT_FOUND", message: "No se encontró el valor de catálogo." } });
    if (result.blocked) return reply.code(409).send({ error: { code: "CATALOG_ENTRY_IN_USE", message: "Desactiva primero las áreas y combinaciones que dependen de este valor." } });
    return reply.code(204).send();
  });
}
