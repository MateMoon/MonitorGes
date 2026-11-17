import type { FastifyInstance, FastifyReply } from "fastify"
import { hashPassword } from "../auth/auth-service.js"
import { requireRoles } from "../auth/routes.js"
import { createSchema, updateSchema, passwordSchema } from "./schema.js"
import {
  changePassword,
  createManagedUser,
  getUser,
  listGuaranteeTypes,
  listAssignmentOptions,
  listUsers,
  updateManagedUser,
  UserManagementError,
} from "./repository.js"

function handleError(error: unknown, reply: FastifyReply) {
  if (error instanceof UserManagementError)
    return reply
      .code(error.statusCode)
      .send({
        error: { code: error.code, message: error.message, details: [] },
      })
  if ((error as { code?: string }).code === "P2002")
    return reply
      .code(409)
      .send({
        error: {
          code: "USER_ALREADY_EXISTS",
          message: "El nombre de usuario o correo ya está registrado.",
          details: [],
        },
      })
  throw error
}

export async function userRoutes(app: FastifyInstance) {
  const adminOnly = requireRoles("ADMIN")
  app.get("/", { preHandler: adminOnly }, async () => listUsers())
  app.get("/opciones-asignacion", { preHandler: adminOnly }, async () => ({ data: await listAssignmentOptions() }))
  app.get("/tipos-garantia", { preHandler: adminOnly }, async () => ({
    data: await listGuaranteeTypes(),
  }))
  app.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: adminOnly },
    async (request, reply) => {
      try {
        return { data: await getUser(request.params.id) }
      } catch (error) {
        return handleError(error, reply)
      }
    },
  )

  app.post<{ Body: unknown }>(
    "/",
    { preHandler: adminOnly },
    async (request, reply) => {
      const parsed = createSchema.safeParse(request.body)
      if (!parsed.success)
        return reply
          .code(400)
          .send({
            error: {
              code: "VALIDATION_ERROR",
              message:
                "Revisa los datos del usuario. La contraseña debe tener entre 8 y 128 caracteres.",
              details: parsed.error.issues,
            },
          })
      try {
        return reply
          .code(201)
          .send({
            data: await createManagedUser(
              parsed.data,
              await hashPassword(parsed.data.password),
            ),
          })
      } catch (error) {
        return handleError(error, reply)
      }
    },
  )

  app.put<{ Params: { id: string }, Body: unknown }>(
    "/:id",
    { preHandler: adminOnly },
    async (request, reply) => {
      const parsed = updateSchema.safeParse(request.body)
      if (!parsed.success)
        return reply
          .code(400)
          .send({
            error: {
              code: "VALIDATION_ERROR",
              message: "Revisa los datos del usuario.",
              details: parsed.error.issues,
            },
          })
      try {
        return { data: await updateManagedUser(request.params.id, parsed.data) }
      } catch (error) {
        return handleError(error, reply)
      }
    },
  )

  app.put<{ Params: { id: string }, Body: unknown }>(
    "/:id/contrasena",
    { preHandler: adminOnly },
    async (request, reply) => {
      const parsed = passwordSchema.safeParse(request.body)
      if (!parsed.success)
        return reply
          .code(400)
          .send({
            error: {
              code: "VALIDATION_ERROR",
              message: "La contraseña debe tener entre 8 y 128 caracteres.",
              details: parsed.error.issues,
            },
          })
      try {
        await changePassword(
          request.params.id,
          await hashPassword(parsed.data.password),
        )
        return reply.code(204).send()
      } catch (error) {
        return handleError(error, reply)
      }
    },
  )
}
