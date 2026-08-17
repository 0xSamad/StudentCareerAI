/**
 * isolated-browser-context.mjs — Ephemeral Browser Session Sandbox
 *
 * Guarantees complete isolation for every user application session:
 * - Isolated temporary userDataDir (cookies, localStorage, indexedDB, caches)
 * - Isolated temporary attachments and download directories
 * - Deterministic cleanup and destruction on session termination
 * - Session TTL expiration tracking
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes max session lifetime

export class IsolatedBrowserContext {
  constructor({ baseDir = "data/temp_browser_sessions" } = {}) {
    this.baseDir = baseDir;
    this.activeSessions = new Map(); // sessionId -> sessionMetadata
  }

  /**
   * Create an isolated ephemeral session sandbox for a user application run.
   *
   * @param {object} context - { tenantId, userId }
   * @returns {{ sessionId: string, sessionDir: string, cookies: Map, localStorage: Map, expiresAt: string }}
   */
  createSession(context = {}) {
    const tenantId = context.tenantId || "default";
    const userId = context.userId || "shared";
    const sessionId = `bsess_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
    const sessionDir = path.join(this.baseDir, tenantId, userId, sessionId);

    // Create isolated directory structure
    fs.mkdirSync(path.join(sessionDir, "user_data"), { recursive: true });
    fs.mkdirSync(path.join(sessionDir, "downloads"), { recursive: true });
    fs.mkdirSync(path.join(sessionDir, "uploads"), { recursive: true });

    const session = {
      sessionId,
      tenantId,
      userId,
      sessionDir,
      userDataDir: path.join(sessionDir, "user_data"),
      downloadDir: path.join(sessionDir, "downloads"),
      uploadDir: path.join(sessionDir, "uploads"),
      cookies: new Map(),
      localStorage: new Map(),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      active: true,
    };

    this.activeSessions.set(sessionId, session);
    return session;
  }

  /**
   * Check if a session has expired its TTL.
   */
  isExpired(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return true;
    return new Date(session.expiresAt) < new Date();
  }

  /**
   * Destroy an isolated session and wipe all temporary files immediately.
   *
   * @param {string} sessionId
   * @returns {boolean}
   */
  destroySession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return false;

    session.active = false;
    session.cookies.clear();
    session.localStorage.clear();

    // Deterministically delete temporary directories and scratch files
    if (fs.existsSync(session.sessionDir)) {
      try {
        fs.rmSync(session.sessionDir, { recursive: true, force: true });
      } catch (err) {
        console.warn(`[IsolatedBrowserContext] Warning deleting session dir '${session.sessionDir}':`, err.message);
      }
    }

    this.activeSessions.delete(sessionId);
    return true;
  }

  /**
   * Clean up all expired sessions.
   */
  cleanExpiredSessions() {
    let count = 0;
    for (const [id, session] of this.activeSessions.entries()) {
      if (new Date(session.expiresAt) < new Date()) {
        this.destroySession(id);
        count++;
      }
    }
    return count;
  }
}
