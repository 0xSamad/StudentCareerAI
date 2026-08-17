/**
 * pg-user-store.mjs — Persist tenants, users, and sessions to PostgreSQL.
 *
 * Uses tables from migrations/001_initial_schema.sql and 003_sessions.sql.
 * Only active when a real (non-mock) PostgresClient is provided.
 */

import crypto from "node:crypto";

const DEFAULT_TENANT_ID = "default";

export class PgUserStore {
  /**
   * @param {import('./postgres-client.mjs').PostgresClient} client
   */
  constructor(client) {
    if (!client || client.isMock) {
      throw new Error("PgUserStore requires a real PostgresClient with DATABASE_URL");
    }
    this.client = client;
  }

  async ensureDefaultTenant() {
    const existing = await this.findTenantById(DEFAULT_TENANT_ID);
    if (existing) return existing;
    return this.createTenant({
      id: DEFAULT_TENANT_ID,
      name: "default",
      plan: "starter",
    });
  }

  async createTenant({ id, name, plan = "starter" }) {
    const tenantId = id || `tenant_${crypto.randomBytes(8).toString("hex")}`;
    await this.client.query(
      `INSERT INTO tenants (id, name, plan, active, created_at, updated_at)
       VALUES ($1, $2, $3, TRUE, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [tenantId, name.trim(), plan]
    );
    return this.findTenantById(tenantId);
  }

  async findTenantById(tenantId) {
    const { rows } = await this.client.query(
      `SELECT id, name, plan, active, created_at AS "createdAt"
       FROM tenants WHERE id = $1 AND deleted_at IS NULL`,
      [tenantId]
    );
    return rows[0] || null;
  }

  async createUser(user) {
    await this.client.query(
      `INSERT INTO users (
         id, tenant_id, email, name, role, password_hash, password_salt,
         email_verified, email_verified_at, active, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, NOW(), NOW())`,
      [
        user.id,
        user.tenantId,
        user.email,
        user.name,
        user.role || "student",
        user.passwordHash,
        user.passwordSalt,
        !!user.emailVerified,
        user.emailVerifiedAt || null,
      ]
    );
    return this.findUserById(user.id);
  }

  async findUserById(userId) {
    const { rows } = await this.client.query(
      `SELECT id, tenant_id AS "tenantId", email, name, role,
              password_hash AS "passwordHash", password_salt AS "passwordSalt",
              email_verified AS "emailVerified",
              email_verified_at AS "emailVerifiedAt",
              active, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    return rows[0] || null;
  }

  async findUserByEmail(email, tenantId = null) {
    const norm = email.toLowerCase().trim();
    if (tenantId) {
      const { rows } = await this.client.query(
        `SELECT id, tenant_id AS "tenantId", email, name, role,
                password_hash AS "passwordHash", password_salt AS "passwordSalt",
                email_verified AS "emailVerified",
                email_verified_at AS "emailVerifiedAt",
                active, created_at AS "createdAt", updated_at AS "updatedAt"
         FROM users
         WHERE email = $1 AND tenant_id = $2 AND deleted_at IS NULL
         LIMIT 1`,
        [norm, tenantId]
      );
      return rows[0] || null;
    }
    const { rows } = await this.client.query(
      `SELECT id, tenant_id AS "tenantId", email, name, role,
              password_hash AS "passwordHash", password_salt AS "passwordSalt",
              email_verified AS "emailVerified",
              email_verified_at AS "emailVerifiedAt",
              active, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM users
       WHERE email = $1 AND deleted_at IS NULL
       ORDER BY created_at ASC
       LIMIT 1`,
      [norm]
    );
    return rows[0] || null;
  }

  async updateUser(userId, updates) {
    const fields = [];
    const values = [];
    let i = 1;
    const map = {
      passwordHash: "password_hash",
      passwordSalt: "password_salt",
      emailVerified: "email_verified",
      emailVerifiedAt: "email_verified_at",
      name: "name",
      role: "role",
      active: "active",
    };
    for (const [key, col] of Object.entries(map)) {
      if (updates[key] !== undefined) {
        fields.push(`${col} = $${i++}`);
        values.push(updates[key]);
      }
    }
    if (fields.length === 0) return this.findUserById(userId);
    fields.push("updated_at = NOW()");
    values.push(userId);
    await this.client.query(
      `UPDATE users SET ${fields.join(", ")} WHERE id = $${i} AND deleted_at IS NULL`,
      values
    );
    return this.findUserById(userId);
  }

  async createSession(session) {
    await this.client.query(
      `INSERT INTO sessions (
         token, user_id, tenant_id, role, user_agent, ip_address,
         created_at, last_active_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        session.token,
        session.userId,
        session.tenantId,
        session.role,
        session.userAgent || null,
        session.ipAddress || null,
        session.createdAt || new Date().toISOString(),
        session.lastActiveAt || new Date().toISOString(),
        session.expiresAt,
      ]
    );
    return session;
  }

  async findSession(token) {
    const { rows } = await this.client.query(
      `SELECT token, user_id AS "userId", tenant_id AS "tenantId", role,
              user_agent AS "userAgent", ip_address AS "ipAddress",
              created_at AS "createdAt", last_active_at AS "lastActiveAt",
              expires_at AS "expiresAt"
       FROM sessions WHERE token = $1`,
      [token]
    );
    return rows[0] || null;
  }

  async touchSession(token, lastActiveAt = new Date().toISOString()) {
    await this.client.query(
      `UPDATE sessions SET last_active_at = $2 WHERE token = $1`,
      [token, lastActiveAt]
    );
  }

  async deleteSession(token) {
    const { rowCount } = await this.client.query(`DELETE FROM sessions WHERE token = $1`, [token]);
    return rowCount > 0;
  }

  async deleteUserSessions(userId, tenantId = null) {
    if (tenantId) {
      const { rowCount } = await this.client.query(
        `DELETE FROM sessions WHERE user_id = $1 AND tenant_id = $2`,
        [userId, tenantId]
      );
      return rowCount;
    }
    const { rowCount } = await this.client.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
    return rowCount;
  }

  async listUserSessions(userId, tenantId = null) {
    const { rows } = await this.client.query(
      tenantId
        ? `SELECT token, user_id AS "userId", tenant_id AS "tenantId", role,
                  user_agent AS "userAgent", ip_address AS "ipAddress",
                  created_at AS "createdAt", last_active_at AS "lastActiveAt",
                  expires_at AS "expiresAt"
           FROM sessions WHERE user_id = $1 AND tenant_id = $2`
        : `SELECT token, user_id AS "userId", tenant_id AS "tenantId", role,
                  user_agent AS "userAgent", ip_address AS "ipAddress",
                  created_at AS "createdAt", last_active_at AS "lastActiveAt",
                  expires_at AS "expiresAt"
           FROM sessions WHERE user_id = $1`,
      tenantId ? [userId, tenantId] : [userId]
    );
    return rows;
  }
}

export { DEFAULT_TENANT_ID };
