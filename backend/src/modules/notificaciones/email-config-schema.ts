import { z } from "zod";

export const emailAddressSchema = z.string().trim().email().max(254);
export const updateEmailConfigSchema = z.object({ email: emailAddressSchema }).strict();
