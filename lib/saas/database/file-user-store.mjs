/**
 * file-user-store.mjs — Dev/local persistence for tenants, users, and sessions.
 *
 * Used when DATABASE_URL is unset (Postgres mock mode) in non-production environments.
 * Production deploys MUST use PgUserStore + PostgreSQL instead.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_TENANT_ID = "default";

function projectRoot() {
  const env = process.env.CAREER_OPS_ROOT?.trim();
  if (env) return env;
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "lib", "saas"))) return cwd;
  if (fs.existsSync(path.join(cwd, "..", "lib", "saas"))) return path.resolve(cwd, "..");
  return cwd;
}

function defaultState() {
  return { tenants: {}, users: {}, sessions: {} };
}

export class FileUserStore {
  /**
   * @param {object} [options]
   * @param {string} [options.filePath]
   */
  constructor(options = {}) {
    this.filePath =
      options.filePath ||
      process.env.AUTH_STORE_FILE ||
      path.join(projectRoot(), "data", "saas-auth", "store.json");
    this._state = null;
  }

  _load() {
    if (this._state) return this._state;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      if (fs.existsSync(this.filePath)) {
        this._state = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      } else {
        this._state = defaultState();
      }
    } catch {
      this._state = defaultState();
    }
    if (!this._state.tenants) this._state.tenants = {};
    if (!this._state.users) this._state.users = {};
    if (!this._state.sessions) this._state.sessions = {};
    return this._state;
  }

  _save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(this._state, null, 2), "utf8");
    fs.renameSync(tmp, this.filePath);
  }

  async ensureDefaultTenant() {
    const state = this._load();
    if (state.tenants[DEFAULT_TENANT_ID]) return state.tenants[DEFAULT_TENANT_ID];
    return this.createTenant({
      id: DEFAULT_TENANT_ID,
      name: "default",
      plan: "starter",
    });
  }

  async createTenant({ id, name, plan = "starter" }) {
    const state = this._load();
    const tenantId = id || `tenant_${crypto.randomBytes(8).toString("hex")}`;
    const tenant = {
      id: tenantId,
      name: name.trim(),
      plan,
      active: true,
      createdAt: new Date().toISOString(),
    };
    state.tenants[tenantId] = tenant;
    this._save();
    return tenant;
  }

  async findTenantById(tenantId) {
    const state = this._load();
    return state.tenants[tenantId] || null;
  }

  async createUser(user) {
    const state = this._load();
    state.users[user.id] = { ...user };
    this._save();
    return this.findUserById(user.id);
  }

  async findUserById(userId) {
    const state = this._load();
    return state.users[userId] || null;
  }

  async findUserByEmail(email, tenantId = null) {
    const state = this._load();
    const norm = email.toLowerCase().trim();
    const matches = Object.values(state.users).filter((u) => u.email === norm);
    if (tenantId) {
      return matches.find((u) => u.tenantId === tenantId) || null;
    }
    return matches.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0] || null;
  }

  async updateUser(userId, updates) {
    const state = this._load();
    const user = state.users[userId];
    if (!user) return null;
    state.users[userId] = { ...user, ...updates, updatedAt: new Date().toISOString() };
    this._save();
    return state.users[userId];
  }

  async createSession(session) {
    const state = this._load();
    state.sessions[session.token] = { ...session };
    this._save();
    return session;
  }

  async findSession(token) {
    const state = this._load();
    return state.sessions[token] || null;
  }

  async touchSession(token, lastActiveAt = new Date().toISOString()) {
    const state = this._load();
    if (!state.sessions[token]) return;
    state.sessions[token].lastActiveAt = lastActiveAt;
    this._save();
  }

  async deleteSession(token) {
    const state = this._load();
    const existed = Boolean(state.sessions[token]);
    delete state.sessions[token];
    if (existed) this._save();
    return existed;
  }

  async deleteUserSessions(userId, tenantId = null) {
    const state = this._load();
    let count = 0;
    for (const [token, session] of Object.entries(state.sessions)) {
      if (session.userId !== userId) continue;
      if (tenantId && session.tenantId !== tenantId) continue;
      delete state.sessions[token];
      count++;
    }
    if (count) this._save();
    return count;
  }

  async listUserSessions(userId, tenantId = null) {
    const state = this._load();
    return Object.values(state.sessions).filter((s) => {
      if (s.userId !== userId) return false;
      if (tenantId && s.tenantId !== tenantId) return false;
      return true;
    });
  }
}

export { DEFAULT_TENANT_ID };
