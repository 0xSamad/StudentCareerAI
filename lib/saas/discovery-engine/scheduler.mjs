/**
 * scheduler.mjs — Backend discovery scheduler.
 *
 * The frontend NEVER decides whether a scan is needed. Opening the dashboard,
 * Jobs, Internships, or searching existing opportunities must not hit
 * external APIs. This process-wide scheduler (plus SourceCache + canRefresh)
 * is the authority.
 *
 * Timers live on globalThis so Next.js HMR does not duplicate them. The first
 * tick waits one interval — a page load that boots the scheduler does not
 * immediately scan.
 */

import { loadRefreshPolicy } from './refresh-policy.mjs';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

function registry() {
  if (!globalThis.__studentcareerDiscoverySchedules) {
    globalThis.__studentcareerDiscoverySchedules = new Map();
  }
  return globalThis.__studentcareerDiscoverySchedules;
}

function globalSlot() {
  if (!globalThis.__studentcareerGlobalDiscovery) {
    globalThis.__studentcareerGlobalDiscovery = { timer: null, run: null, intervalMs: DEFAULT_INTERVAL_MS, startedAt: null, lastTickAt: null };
  }
  return globalThis.__studentcareerGlobalDiscovery;
}

/**
 * Process-wide backend scheduler. Idempotent. `run` is refreshed if already
 * started so the latest container/repoRoot closure is used.
 */
export function ensureGlobalDiscoveryScheduler({ run, intervalMs, policy } = {}) {
  const cfg = policy || loadRefreshPolicy();
  if (cfg.scheduler?.enabled === false) return globalSlot();
  const ms = intervalMs || cfg.scheduler?.tickMs || DEFAULT_INTERVAL_MS;
  const slot = globalSlot();
  if (typeof run === 'function') slot.run = run;
  slot.intervalMs = ms;
  if (slot.timer) return slot;

  slot.startedAt = new Date().toISOString();
  slot.busy = false;
  slot.timer = setInterval(() => {
    if (slot.busy) return;
    if (typeof slot.run !== 'function') return;
    slot.lastTickAt = new Date().toISOString();
    slot.busy = true;
    Promise.resolve()
      .then(() => slot.run())
      .catch(() => {})
      .finally(() => {
        slot.busy = false;
      });
  }, ms);
  if (typeof slot.timer.unref === 'function') slot.timer.unref();
  return slot;
}

export function stopGlobalDiscoveryScheduler() {
  const slot = globalThis.__studentcareerGlobalDiscovery;
  if (!slot) return false;
  if (slot.timer) clearInterval(slot.timer);
  slot.timer = null;
  slot.run = null;
  slot.busy = false;
  return Boolean(slot.startedAt);
}

export function getGlobalDiscoveryScheduler() {
  const slot = globalThis.__studentcareerGlobalDiscovery;
  if (!slot) return null;
  return {
    running: Boolean(slot.timer),
    intervalMs: slot.intervalMs,
    startedAt: slot.startedAt,
    lastTickAt: slot.lastTickAt,
  };
}

/**
 * Legacy per-user timer (kept for tests). Prefer ensureGlobalDiscoveryScheduler.
 */
export function ensureDiscoverySchedule({ userId, run, intervalMs = 30 * 60 * 1000 }) {
  if (!userId || typeof run !== 'function') return null;
  const key = String(userId);
  const existing = registry().get(key);
  if (existing) clearInterval(existing.timer);

  const timer = setInterval(() => {
    Promise.resolve()
      .then(run)
      .catch(() => {});
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  const entry = { userId: key, timer, intervalMs, registeredAt: new Date().toISOString() };
  registry().set(key, entry);
  return entry;
}

export function stopDiscoverySchedule(userId) {
  const entry = registry().get(String(userId));
  if (!entry) return false;
  clearInterval(entry.timer);
  registry().delete(String(userId));
  return true;
}

export function listDiscoverySchedules() {
  return [...registry().values()].map(({ userId, intervalMs, registeredAt }) => ({
    userId,
    intervalMs,
    registeredAt,
  }));
}
