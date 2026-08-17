/**
 * auth-service.mjs — Production-Grade Multi-Tenant Authentication Service
 *
 * Implements IAuthService supporting:
 * - Secure Registration (PBKDF2/SHA-512 + Salt)
 * - Email Verification & Single-Use Tokens
 * - Rate-Limited Login & Brute-Force Lockout
 * - Session Lifecycle Management & Revocation
 * - Password Reset with Single-Use Expiring Tokens
 * - Multi-Device Session Rotation
 * - Zero-Secret Logging & Output Sanitization
 *
 * Persistence: when `userStore` (PgUserStore) is provided, tenants/users/sessions
 * are written to PostgreSQL. Without it, in-memory Maps are used (unit tests).
 */

import crypto from "node:crypto";
import { PasswordHasher } from "./password-hasher.mjs";
import { Sanitizer } from "./sanitizer.mjs";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const RESET_TOKEN_DURATION_MS = 60 * 60 * 1000; // 1 hour
const VERIFY_TOKEN_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

export class IAuthService {
  async registerTenant(tenantData) { throw new Error("Method not implemented"); }
  async registerUser(userData) { throw new Error("Method not implemented"); }
  async verifyEmail(token) { throw new Error("Method not implemented"); }
  async authenticateUser(email, password, tenantId, metadata) { throw new Error("Method not implemented"); }
  async logout(token) { throw new Error("Method not implemented"); }
  async requestPasswordReset(email, tenantId) { throw new Error("Method not implemented"); }
  async resetPassword(token, newPassword) { throw new Error("Method not implemented"); }
  async generateApiKey(userId, tenantId) { throw new Error("Method not implemented"); }
  async verifyApiKey(apiKey) { throw new Error("Method not implemented"); }
  async verifyToken(token) { throw new Error("Method not implemented"); }
  async revokeAllUserSessions(userId, tenantId) { throw new Error("Method not implemented"); }
  async getActiveSessions(userId, tenantId) { throw new Error("Method not implemented"); }
}

export class AuthService extends IAuthService {
  /**
   * @param {object} [options]
   * @param {object} [options.userRepository] - legacy profile repository (unused for auth identity)
   * @param {import('../database/pg-user-store.mjs').PgUserStore|null} [options.userStore]
   */
  constructor({ userRepository, userStore = null } = {}) {
    super();
    this.userRepository = userRepository;
    this.userStore = userStore;
    this.tenants = new Map(); // tenantId -> tenant
    this.users = new Map(); // userId -> user
    this.sessions = new Map(); // token -> session
    this.apiKeys = new Map(); // apiKey -> keyRecord
    this.resetTokens = new Map(); // resetToken -> resetRecord
    this.verifyTokens = new Map(); // verifyToken -> verifyRecord
    this.failedAttempts = new Map(); // `${tenantId}:${email}` -> { count, lockedUntil }
  }

  get usesPostgres() {
    return !!this.userStore;
  }

  /**
   * Register a new Tenant / Organization.
   */
  async registerTenant({ name, plan = "starter", tenantId: customTenantId, id: customId } = {}) {
    if (!name || typeof name !== "string") throw new Error("Tenant name is required");
    const tenantId = customTenantId || customId || `tenant_${crypto.randomBytes(8).toString("hex")}`;
    const tenant = {
      id: tenantId,
      name: name.trim(),
      plan,
      createdAt: new Date().toISOString(),
      active: true,
    };

    if (this.userStore) {
      const saved = await this.userStore.createTenant(tenant);
      this.tenants.set(tenantId, { ...tenant, ...saved });
      return Sanitizer.sanitize(this.tenants.get(tenantId));
    }

    this.tenants.set(tenantId, tenant);
    return Sanitizer.sanitize(tenant);
  }

  async ensureDefaultTenant() {
    if (this.tenants.has("default")) return Sanitizer.sanitize(this.tenants.get("default"));
    if (this.userStore) {
      const tenant = await this.userStore.ensureDefaultTenant();
      if (tenant) {
        this.tenants.set(tenant.id, {
          id: tenant.id,
          name: tenant.name,
          plan: tenant.plan,
          createdAt: tenant.createdAt || new Date().toISOString(),
          active: tenant.active !== false,
        });
        return Sanitizer.sanitize(this.tenants.get(tenant.id));
      }
    }
    return this.registerTenant({ name: "default", tenantId: "default", plan: "starter" });
  }

  async _tenantExists(tenantId) {
    if (this.tenants.has(tenantId)) return true;
    if (this.userStore) {
      const t = await this.userStore.findTenantById(tenantId);
      if (t) {
        this.tenants.set(tenantId, {
          id: t.id,
          name: t.name,
          plan: t.plan,
          createdAt: t.createdAt || new Date().toISOString(),
          active: t.active !== false,
        });
        return true;
      }
    }
    return false;
  }

  async _findUserByEmail(normalizedEmail, tenantId) {
    for (const user of this.users.values()) {
      if (user.email === normalizedEmail && (!tenantId || user.tenantId === tenantId)) {
        return user;
      }
    }
    if (this.userStore) {
      const u = await this.userStore.findUserByEmail(normalizedEmail, tenantId || null);
      if (u) {
        this.users.set(u.id, u);
        return u;
      }
    }
    return null;
  }

  async _getUser(userId) {
    if (this.users.has(userId)) return this.users.get(userId);
    if (this.userStore) {
      const u = await this.userStore.findUserById(userId);
      if (u) {
        this.users.set(u.id, u);
        return u;
      }
    }
    return null;
  }

  /**
   * Register a new User under a Tenant with salted PBKDF2 hash.
   */
  async registerUser({ tenantId, email, name, password, role = "student" }) {
    if (!tenantId || !(await this._tenantExists(tenantId))) {
      throw new Error(`Tenant '${tenantId}' not found`);
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Invalid email address format");
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await this._findUserByEmail(normalizedEmail, tenantId);
    if (existing) {
      throw new Error(`User with email '${normalizedEmail}' already exists in tenant '${tenantId}'`);
    }

    const complexity = PasswordHasher.validateComplexity(password);
    if (!complexity.valid) {
      throw new Error(`Password does not meet security requirements: ${complexity.errors.join("; ")}`);
    }

    const { hash, salt } = PasswordHasher.hashPassword(password);
    const userId = `usr_${crypto.randomBytes(8).toString("hex")}`;
    const verificationToken = `vtok_${crypto.randomBytes(32).toString("hex")}`;

    const user = {
      id: userId,
      tenantId,
      email: normalizedEmail,
      name: name ? name.trim() : "Student",
      role,
      passwordHash: hash,
      passwordSalt: salt,
      emailVerified: false,
      createdAt: new Date().toISOString(),
      active: true,
    };

    if (this.userStore) {
      await this.userStore.createUser(user);
    }
    this.users.set(userId, user);

    this.verifyTokens.set(verificationToken, {
      userId,
      tenantId,
      expiresAt: new Date(Date.now() + VERIFY_TOKEN_DURATION_MS).toISOString(),
    });

    return {
      user: Sanitizer.sanitize({
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        name: user.name,
        role: user.role,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
      }),
      verificationToken,
    };
  }

  /**
   * Convenience signup: ensure default tenant, register, return auth-ready user.
   */
  async signup({ name, email, password, tenantId = "default" }) {
    await this.ensureDefaultTenant();
    const targetTenant = tenantId || "default";
    if (!(await this._tenantExists(targetTenant))) {
      await this.registerTenant({ name: targetTenant, tenantId: targetTenant });
    }
    return this.registerUser({
      tenantId: targetTenant,
      email,
      name,
      password,
      role: "student",
    });
  }

  /**
   * Verify a user's email using a single-use verification token.
   */
  async verifyEmail(verificationToken) {
    if (!verificationToken || !this.verifyTokens.has(verificationToken)) {
      throw new Error("Invalid or expired email verification token");
    }

    const record = this.verifyTokens.get(verificationToken);
    if (new Date(record.expiresAt) < new Date()) {
      this.verifyTokens.delete(verificationToken);
      throw new Error("Email verification token has expired");
    }

    const user = await this._getUser(record.userId);
    if (!user) throw new Error("User associated with token not found");

    user.emailVerified = true;
    user.emailVerifiedAt = new Date().toISOString();
    if (this.userStore) {
      await this.userStore.updateUser(user.id, {
        emailVerified: true,
        emailVerifiedAt: user.emailVerifiedAt,
      });
    }
    this.users.set(user.id, user);
    this.verifyTokens.delete(verificationToken);

    return {
      success: true,
      message: "Email verified successfully",
      userId: user.id,
    };
  }

  /**
   * Authenticate a user with brute-force lockout protection and constant-time password check.
   */
  async authenticateUser(email, password, tenantId, metadata = {}) {
    if (!email || !password) throw new Error("Email and password are required");

    const normalizedEmail = email.toLowerCase().trim();
    const attemptKey = `${tenantId || "default"}:${normalizedEmail}`;
    const attempt = this.failedAttempts.get(attemptKey) || { count: 0, lockedUntil: null };

    if (attempt.lockedUntil && new Date(attempt.lockedUntil) > new Date()) {
      const waitMinutes = Math.ceil((new Date(attempt.lockedUntil) - new Date()) / 60000);
      throw new Error(`Account temporarily locked due to consecutive failed attempts. Please try again in ${waitMinutes} minutes.`);
    }

    const matchedUser = await this._findUserByEmail(normalizedEmail, tenantId || null);

    if (!matchedUser) {
      this._recordFailedAttempt(attemptKey);
      throw new Error("Invalid email or password");
    }

    const isValid = PasswordHasher.verifyPassword(password, matchedUser.passwordHash, matchedUser.passwordSalt);
    if (!isValid) {
      this._recordFailedAttempt(attemptKey);
      throw new Error("Invalid email or password");
    }

    this.failedAttempts.delete(attemptKey);

    const token = `sess_${crypto.randomBytes(32).toString("hex")}`;
    const session = {
      token,
      userId: matchedUser.id,
      tenantId: matchedUser.tenantId,
      role: matchedUser.role,
      userAgent: metadata.userAgent || "Unknown Client",
      ipAddress: metadata.ipAddress || "127.0.0.1",
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS).toISOString(),
    };

    if (this.userStore) {
      await this.userStore.createSession(session);
    }
    this.sessions.set(token, session);

    return {
      user: Sanitizer.sanitize({
        id: matchedUser.id,
        tenantId: matchedUser.tenantId,
        email: matchedUser.email,
        name: matchedUser.name,
        role: matchedUser.role,
        emailVerified: matchedUser.emailVerified,
      }),
      token,
      expiresAt: session.expiresAt,
    };
  }

  _recordFailedAttempt(attemptKey) {
    const attempt = this.failedAttempts.get(attemptKey) || { count: 0, lockedUntil: null };
    attempt.count += 1;
    if (attempt.count >= MAX_FAILED_ATTEMPTS) {
      attempt.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
    }
    this.failedAttempts.set(attemptKey, attempt);
  }

  /**
   * Log out and revoke active session token.
   */
  async logout(token) {
    if (!token) return false;
    let deleted = this.sessions.delete(token);
    if (this.userStore) {
      const pgDeleted = await this.userStore.deleteSession(token);
      deleted = deleted || pgDeleted;
    }
    return deleted;
  }

  /**
   * Request a single-use password reset token.
   */
  async requestPasswordReset(email, tenantId) {
    if (!email) throw new Error("Email is required");
    const normalizedEmail = email.toLowerCase().trim();

    const matchedUser = await this._findUserByEmail(normalizedEmail, tenantId || null);

    if (!matchedUser) {
      return { success: true, message: "If the email is registered, a password reset link has been sent." };
    }

    const resetToken = `rst_${crypto.randomBytes(32).toString("hex")}`;
    this.resetTokens.set(resetToken, {
      userId: matchedUser.id,
      tenantId: matchedUser.tenantId,
      expiresAt: new Date(Date.now() + RESET_TOKEN_DURATION_MS).toISOString(),
      used: false,
    });

    return {
      success: true,
      message: "Password reset link generated",
      resetToken,
    };
  }

  /**
   * Complete password reset with single-use token and revoke all active user sessions.
   */
  async resetPassword(resetToken, newPassword) {
    if (!resetToken || !this.resetTokens.has(resetToken)) {
      throw new Error("Invalid or expired password reset token");
    }

    const record = this.resetTokens.get(resetToken);
    if (record.used || new Date(record.expiresAt) < new Date()) {
      this.resetTokens.delete(resetToken);
      throw new Error("Password reset token has expired or was already used");
    }

    const complexity = PasswordHasher.validateComplexity(newPassword);
    if (!complexity.valid) {
      throw new Error(`New password does not meet security requirements: ${complexity.errors.join("; ")}`);
    }

    const user = await this._getUser(record.userId);
    if (!user) throw new Error("User associated with reset token not found");

    const { hash, salt } = PasswordHasher.hashPassword(newPassword);
    user.passwordHash = hash;
    user.passwordSalt = salt;
    user.updatedAt = new Date().toISOString();

    if (this.userStore) {
      await this.userStore.updateUser(user.id, {
        passwordHash: hash,
        passwordSalt: salt,
      });
    }
    this.users.set(user.id, user);

    record.used = true;
    this.resetTokens.delete(resetToken);

    await this.revokeAllUserSessions(user.id, user.tenantId);

    return {
      success: true,
      message: "Password reset successfully. All previous sessions have been revoked.",
    };
  }

  /**
   * Revoke all active sessions for a user across all devices.
   */
  async revokeAllUserSessions(userId, tenantId) {
    let count = 0;
    for (const [token, session] of this.sessions.entries()) {
      if (session.userId === userId && (!tenantId || session.tenantId === tenantId)) {
        this.sessions.delete(token);
        count += 1;
      }
    }
    if (this.userStore) {
      const pgCount = await this.userStore.deleteUserSessions(userId, tenantId || null);
      count = Math.max(count, pgCount);
    }
    return count;
  }

  /**
   * Get all active sessions for security inspection.
   */
  async getActiveSessions(userId, tenantId) {
    const byToken = new Map();
    for (const session of this.sessions.values()) {
      if (session.userId === userId && (!tenantId || session.tenantId === tenantId)) {
        byToken.set(session.token, session);
      }
    }
    if (this.userStore) {
      const rows = await this.userStore.listUserSessions(userId, tenantId || null);
      for (const session of rows) {
        byToken.set(session.token, session);
      }
    }

    const active = [];
    for (const session of byToken.values()) {
      if (new Date(session.expiresAt) > new Date()) {
        active.push(
          Sanitizer.sanitize({
            tokenPrefix: session.token.slice(0, 10) + "...",
            userAgent: session.userAgent,
            ipAddress: session.ipAddress,
            createdAt: session.createdAt,
            lastActiveAt: session.lastActiveAt,
            expiresAt: session.expiresAt,
          })
        );
      }
    }
    return active;
  }

  /**
   * Generate an API key for CLI / headless automation.
   */
  async generateApiKey(userId, tenantId) {
    const user = await this._getUser(userId);
    if (!user || user.tenantId !== tenantId) {
      throw new Error("Invalid user or tenant for API key generation");
    }

    const apiKey = `sc_${crypto.randomBytes(24).toString("hex")}`;
    this.apiKeys.set(apiKey, {
      apiKey,
      userId,
      tenantId,
      role: user.role,
      createdAt: new Date().toISOString(),
    });
    return apiKey;
  }

  /**
   * Verify an API key.
   */
  async verifyApiKey(apiKey) {
    const record = this.apiKeys.get(apiKey);
    if (!record) throw new Error("Invalid or expired API key");
    return {
      userId: record.userId,
      tenantId: record.tenantId,
      role: record.role,
      authMethod: "api_key",
    };
  }

  /**
   * Verify a session token with sliding activity renewal.
   */
  async verifyToken(token) {
    if (!token) throw new Error("Authentication token required");

    let session = this.sessions.get(token) || null;
    if (!session && this.userStore) {
      session = await this.userStore.findSession(token);
      if (session) this.sessions.set(token, session);
    }
    if (!session) throw new Error("Invalid or expired session token");

    if (new Date(session.expiresAt) < new Date()) {
      this.sessions.delete(token);
      if (this.userStore) await this.userStore.deleteSession(token);
      throw new Error("Session token expired");
    }

    session.lastActiveAt = new Date().toISOString();
    this.sessions.set(token, session);
    if (this.userStore) {
      await this.userStore.touchSession(token, session.lastActiveAt);
    }

    return {
      userId: session.userId,
      tenantId: session.tenantId,
      role: session.role,
      authMethod: "session_token",
    };
  }

  /**
   * Resolve authenticated user profile for /me.
   */
  async getUserForAuth(auth) {
    const user = await this._getUser(auth.userId);
    if (!user) throw new Error("User not found");
    if (user.tenantId !== auth.tenantId) throw new Error("Tenant mismatch");
    return Sanitizer.sanitize({
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      role: user.role,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    });
  }
}
