/**
 * input-validator.mjs — Comprehensive Input Validation, XSS, CSRF & SQLi Defense
 *
 * Implements:
 * - HTML/XSS Entity Escaping
 * - CSRF Token Issuance & Verification
 * - SQL Injection and Parameterization Validation
 */

import crypto from "node:crypto";

export class InputValidator {
  /**
   * Escape HTML entities to prevent Cross-Site Scripting (XSS).
   *
   * @param {string} str
   * @returns {string}
   */
  static escapeHtml(str = "") {
    if (typeof str !== "string") return String(str);
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Generate a cryptographically secure CSRF Token.
   *
   * @returns {string} 64-char hex string
   */
  static generateCsrfToken() {
    return crypto.randomBytes(32).toString("hex");
  }

  /**
   * Verify CSRF Token with timing-safe comparison.
   *
   * @param {string} candidateToken
   * @param {string} expectedToken
   * @returns {boolean}
   */
  static verifyCsrfToken(candidateToken, expectedToken) {
    if (!candidateToken || !expectedToken || candidateToken.length !== expectedToken.length) {
      return false;
    }
    const a = Buffer.from(candidateToken);
    const b = Buffer.from(expectedToken);
    return crypto.timingSafeEqual(a, b);
  }

  /**
   * Check for potential SQL injection patterns in raw strings.
   *
   * @param {string} input
   * @returns {{ safe: boolean, error: string|null }}
   */
  static checkSqlInjection(input = "") {
    if (typeof input !== "string") return { safe: true, error: null };

    const SQLI_PATTERNS = [
      /(\%27)|(\')|(\-\-)|(\%23)|(#)/i,
      /\b(UNION\s+ALL\s+SELECT|UNION\s+SELECT|SELECT.*FROM|INSERT\s+INTO|DROP\s+TABLE|DELETE\s+FROM)\b/i,
      /\b(OR\s+1\s*=\s*1|AND\s+1\s*=\s*1)\b/i,
    ];

    for (const pattern of SQLI_PATTERNS) {
      if (pattern.test(input)) {
        return { safe: false, error: "Potential SQL injection pattern detected. Use parameterized queries." };
      }
    }

    return { safe: true, error: null };
  }
}
