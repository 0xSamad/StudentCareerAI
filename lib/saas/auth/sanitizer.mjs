/**
 * sanitizer.mjs — Zero-Secret Logging & Sensitive Data Redactor
 *
 * Recursively redacts passwords, salts, hashes, tokens, cookies, and secret keys
 * from objects before logging to disk, database, or telemetry.
 */

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordhash",
  "salt",
  "token",
  "sessiontoken",
  "resettoken",
  "verificationtoken",
  "apikey",
  "secret",
  "authorization",
  "cookie",
  "cookies",
  "set-cookie",
  "privatekey",
  "access_token",
  "refresh_token",
  "ssn",
  "nationalid",
  "passport",
  "dateofbirth",
]);

export class Sanitizer {
  /**
   * Deeply sanitize an object or array, masking sensitive values.
   *
   * @param {any} input
   * @param {number} [depth=0]
   * @returns {any}
   */
  static sanitize(input, depth = 0) {
    if (depth > 10 || input === null || typeof input !== "object") {
      return input;
    }

    if (Array.isArray(input)) {
      return input.map((item) => this.sanitize(item, depth + 1));
    }

    const sanitized = {};
    for (const [key, value] of Object.entries(input)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");

      if (
        SENSITIVE_KEYS.has(normalizedKey) ||
        normalizedKey.includes("password") ||
        normalizedKey.includes("secret") ||
        normalizedKey.includes("cookie") ||
        normalizedKey.includes("token")
      ) {
        sanitized[key] = "***REDACTED***";
      } else if (typeof value === "object" && value !== null) {
        sanitized[key] = this.sanitize(value, depth + 1);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
}
