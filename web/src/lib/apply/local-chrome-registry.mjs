/**
 * Pairing tokens for the local Chrome helper.
 * The helper runs on the user's computer and opens a real window.
 */
import { randomBytes } from "node:crypto";

const TOKENS = (globalThis.__coLocalChromeTokens ??= new Map());
const HOSTS = (globalThis.__coLocalChromeHosts ??= new Map());

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ONLINE_MS = 12_000;

function prune() {
  const now = Date.now();
  for (const [token, row] of TOKENS) {
    if (now - row.createdAt > TOKEN_TTL_MS) {
      TOKENS.delete(token);
      HOSTS.delete(token);
    }
  }
}

export function tokenForUser(userId, tenantId = "") {
  prune();
  const uid = String(userId || "");
  if (!uid) return "";
  for (const [token, row] of TOKENS) {
    if (row.userId === uid) return token;
  }
  const token = randomBytes(24).toString("hex");
  TOKENS.set(token, { userId: uid, tenantId: String(tenantId || ""), createdAt: Date.now() });
  return token;
}

export function authLocalChromeToken(token) {
  prune();
  const row = TOKENS.get(String(token || "").trim());
  if (!row) return null;
  return row;
}

export function heartbeatLocalChrome(token) {
  const row = authLocalChromeToken(token);
  if (!row) return null;
  HOSTS.set(token, { userId: row.userId, tenantId: row.tenantId, lastSeen: Date.now() });
  return row;
}

export function localChromeConnected(userId) {
  const uid = String(userId || "");
  const now = Date.now();
  for (const host of HOSTS.values()) {
    if (host.userId === uid && now - host.lastSeen < ONLINE_MS) return true;
  }
  return false;
}

export function localChromeCommand(serverUrl, token) {
  const origin = String(serverUrl || "").replace(/\/$/, "");
  return `npm run apply:chrome -- --server ${origin} --token ${token}`;
}
