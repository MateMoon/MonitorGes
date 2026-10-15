export const MAX_EMAIL_ATTEMPTS = 5;
export const EMAIL_RETRY_DELAY_MS = 5 * 60_000;
export const ABANDONED_EMAIL_ATTEMPT_MS = 15 * 60_000;

const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNECTION",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ESOCKET",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);

export interface EmailFailureCode {
  code?: string | null;
  responseCode?: number | null;
}

export function isTransientEmailFailure(error: EmailFailureCode): boolean {
  if (typeof error.responseCode === "number") {
    return error.responseCode >= 400 && error.responseCode < 500;
  }
  return Boolean(error.code && TRANSIENT_NETWORK_CODES.has(error.code));
}

export function isStoredFailureTransient(code: string | null | undefined): boolean {
  if (!code) return false;
  const separator = code.lastIndexOf(":");
  if (separator >= 0) {
    const codePart = code.slice(0, separator);
    const responseCode = Number(code.slice(separator + 1));
    return isTransientEmailFailure({ code: codePart, responseCode });
  }
  return isTransientEmailFailure({ code });
}

export function serializeEmailFailureCode(error: EmailFailureCode): string | null {
  if (!error.code && typeof error.responseCode !== "number") return null;
  if (typeof error.responseCode === "number") return `${error.code ?? "SMTP"}:${error.responseCode}`;
  return error.code ?? null;
}
