import { z } from "zod";

export const emailAddressSchema = z.string().trim()
  .max(254, "Cada correo puede tener hasta 254 caracteres.")
  .email("Ingresa una direccion de correo valida.");

export const emailRecipientListSchema = z.array(emailAddressSchema.transform((email) => email.toLowerCase()))
  .max(50, "Puedes configurar hasta 50 destinatarios.")
  .transform((emails) => [...new Set(emails)]);

export const updateEmailConfigSchema = z.object({
  emails: emailRecipientListSchema.optional(),
  email: emailAddressSchema.optional(),
}).strict()
  .refine((value) => (value.emails === undefined) !== (value.email === undefined), "Envía emails o el campo legado email, no ambos.")
  .transform((value) => ({ emails: value.emails ?? [value.email!] }));
