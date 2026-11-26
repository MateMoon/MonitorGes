import { WorkbookInputError } from "./validation-service.js";

/** Exact literals only: spaces, empty strings, 1, yes and TRUE cannot enable it. */
export function readImportRetentionConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.IMPORT_RETENTION_ENABLED;
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new WorkbookInputError("IMPORT_RETENTION_CONFIG_INVALID", 'IMPORT_RETENTION_ENABLED debe ser exactamente "true" o "false".', 503);
}
