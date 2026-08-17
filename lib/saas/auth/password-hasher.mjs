/**
 * password-hasher.mjs — Cryptographically Secure Password Hasher
 *
 * Implements PBKDF2 with SHA-512, unique per-user salts, and timing-safe comparison.
 * Never stores plain-text passwords or vulnerable short hashes.
 */

import crypto from "node:crypto";

const ITERATIONS = 100000;
const KEYLEN = 64;
const DIGEST = "sha512";
const SALT_BYTES = 32;

export class PasswordHasher {
  /**
   * Hash a plain-text password with a freshly generated random salt.
   *
   * @param {string} password - Plaintext password
   * @returns {{ hash: string, salt: string }}
   */
  static hashPassword(password) {
    if (!password || typeof password !== "string" || password.length < 8) {
      throw new Error("Password must be at least 8 characters long");
    }

    const salt = crypto.randomBytes(SALT_BYTES).toString("hex");
    const derivedKey = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, DIGEST);
    return {
      hash: derivedKey.toString("hex"),
      salt,
      iterations: ITERATIONS,
      digest: DIGEST,
    };
  }

  /**
   * Verify a candidate password against a stored hash and salt using timing-safe comparison.
   *
   * @param {string} candidatePassword - Password to test
   * @param {string} storedHash - Stored hex hash
   * @param {string} salt - Stored hex salt
   * @param {number} [iterations=100000] - Iteration count
   * @returns {boolean}
   */
  static verifyPassword(candidatePassword, storedHash, salt, iterations = ITERATIONS) {
    if (!candidatePassword || !storedHash || !salt) return false;

    try {
      const candidateKey = crypto.pbkdf2Sync(candidatePassword, salt, iterations, KEYLEN, DIGEST);
      const storedKey = Buffer.from(storedHash, "hex");

      if (candidateKey.length !== storedKey.length) {
        return false;
      }

      return crypto.timingSafeEqual(candidateKey, storedKey);
    } catch {
      return false;
    }
  }

  /**
   * Validate password complexity requirements.
   *
   * @param {string} password
   * @returns {{ valid: boolean, errors: string[] }}
   */
  static validateComplexity(password) {
    const errors = [];
    if (!password || password.length < 8) {
      errors.push("Password must be at least 8 characters");
    }
    if (!/[A-Z]/.test(password)) {
      errors.push("Password must contain at least one uppercase letter");
    }
    if (!/[a-z]/.test(password)) {
      errors.push("Password must contain at least one lowercase letter");
    }
    if (!/[0-9]/.test(password)) {
      errors.push("Password must contain at least one number");
    }
    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
