import type { SourceGuarantee } from "./candidate-evidence.js";
import { candidateSetHash, hash } from "./candidate-evidence.js";

/** This is a concurrency token, not an authorization token. Every command still
 * checks the active DB account, row version and the entire current family. */
export function reviewFingerprint(row: { id: string; version: number; huellaDatos: string; versionPolitica: string }, sources: readonly SourceGuarantee[]) {
  return hash({ filaId: row.id, version: row.version, huellaDatos: row.huellaDatos, versionPolitica: row.versionPolitica, candidatas: candidateSetHash(sources) });
}
