import { z } from "zod"

const roles = ["ADMIN", "COORDINADOR_SOME", "PROFESIONAL", "LECTOR"] as const
const nombre = z
  .string()
  .trim()
  .min(2, "El nombre debe tener al menos 2 caracteres.")
  .max(120)
const nombres = z
  .string()
  .trim()
  .min(1, "Ingresa el nombre.")
  .max(120)
  .nullable()
  .optional()
const apellido = z
  .string()
  .trim()
  .min(1, "Ingresa el apellido.")
  .max(120)
  .nullable()
  .optional()
const tiposGarantia = z
  .array(z.string().min(1).max(500))
  .max(10_000)
  .transform((values) => [...new Set(values)])
  .optional()
export const assignmentRulesSchema = z.array(z.object({
  problemaSalud: z.string().max(500),
  establecimiento: z.string().max(500),
  tipoGarantia: z.string().max(500),
}).strict().refine((rule) => Boolean(rule.problemaSalud || rule.establecimiento || rule.tipoGarantia), {
  message: "Selecciona al menos un criterio en cada regla.",
})).max(1000)

const fields = {
  nombre,
  nombres,
  apellido,
  email: z.string().trim().email("Ingresa un correo válido.").max(254),
  rol: z.enum(roles),
  puedeCargarNominas: z.boolean().optional(),
  recibirInformeAutomatico: z.boolean().optional(),
  tiposGarantia,
  reglasAsignacion: assignmentRulesSchema.optional(),
}

export const createSchema = z
  .object({
    ...fields,
    apellido: z.string().trim().min(1, "Ingresa el apellido.").max(120),
    username: z
      .string()
      .trim()
      .min(3)
      .max(100)
      .regex(/^[\w.-]+$/, "Usa letras, números, punto, guion o guion bajo."),
    password: z
      .string()
      .min(8, "La contraseña debe tener al menos 8 caracteres.")
      .max(128),
    activo: z.boolean().default(true),
    puedeCargarNominas: z.boolean().default(false),
    recibirInformeAutomatico: z.boolean().default(false),
  })
  .strict()
  .refine((user) => user.rol !== "LECTOR" || !user.puedeCargarNominas, {
    message: "LECTOR no puede recibir permiso para cargar nóminas.",
    path: ["puedeCargarNominas"],
  })
  .refine(
    (user) => `${user.nombres ?? user.nombre} ${user.apellido}`.length <= 120,
    {
      message: "El nombre completo puede tener hasta 120 caracteres.",
      path: ["nombre"],
    },
  )

export const updateSchema = z
  .object({ ...fields, activo: z.boolean() })
  .strict()
  .refine((user) => user.rol !== "LECTOR" || user.puedeCargarNominas !== true, {
    message: "LECTOR no puede recibir permiso para cargar nóminas.",
    path: ["puedeCargarNominas"],
  })
  .refine(
    (user) =>
      user.nombres == null ||
      (user.apellido != null &&
        `${user.nombres} ${user.apellido}`.length <= 120),
    {
      message:
        "Completa el apellido y usa hasta 120 caracteres para el nombre completo.",
      path: ["apellido"],
    },
  )
  .refine(
    (user) => (user.nombres === undefined) === (user.apellido === undefined),
    {
      message: "Envía nombre y apellido separados juntos.",
      path: ["apellido"],
    },
  )
  .refine((user) => (user.nombres == null) === (user.apellido == null), {
    message:
      "Completa ambos campos separados o conserva el nombre anterior completo.",
    path: ["apellido"],
  })

export const passwordSchema = z
  .object({ password: z.string().min(8).max(128) })
  .strict()
export type CreateUserInput = z.infer<typeof createSchema>
export type UpdateUserInput = z.infer<typeof updateSchema>
