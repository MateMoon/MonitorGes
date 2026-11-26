import { RowPersistenceError } from "./contracts.js";

/** Separate from IMPORT_RETENTION_ENABLED. Backend review is not deployed to
 * officials until both migrations and the complete UI/audit flow are approved. */
export function readDataQualityConfig(env: NodeJS.ProcessEnv = process.env) {
  const value = env.DATA_QUALITY_ENABLED;
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new RowPersistenceError("DATA_QUALITY_CONFIG_INVALID", 'DATA_QUALITY_ENABLED debe ser exactamente "true" o "false".', 503);
}
