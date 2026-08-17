const DATABASE_ERROR_PATTERNS = [
  /password authentication failed/i,
  /database .*failed/i,
  /connect ECONN/i,
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /role .* does not exist/i,
];

export function authErrorMessage(err: unknown, fallback: string) {
  const message = err instanceof Error ? err.message : "";
  if (DATABASE_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return "Database connection failed. Please check local Postgres and try again.";
  }
  return message || fallback;
}
