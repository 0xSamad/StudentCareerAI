/**
 * refresh-policy.mjs — Configurable discovery refresh intervals.
 *
 * High / normal / low priorities are defaults, not hardcoded assumptions:
 * config/discovery-refresh.yml plus DISCOVERY_INTERVAL_{HIGH,NORMAL,LOW}_MS
 * and DISCOVERY_MIN_REFRESH_{HIGH,NORMAL,LOW}_MS env overrides.
 *
 * canRefresh() is the gate for both the backend scheduler and a manual
 * Refresh click. Manual refresh never blindly bypasses rate limits or the
 * per-priority minimum interval.
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { STRATEGIES } from './discovery-strategy.mjs';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const DEFAULT_POLICY = {
  priorities: {
    high: { intervalMs: 30 * MINUTE, minRefreshIntervalMs: 10 * MINUTE },
    normal: { intervalMs: 2 * HOUR, minRefreshIntervalMs: 30 * MINUTE },
    low: { intervalMs: 6 * HOUR, minRefreshIntervalMs: 2 * HOUR },
  },
  sources: {
    'ats-round-robin': 'high',
    adzuna: 'normal',
    'pakistan-top100': 'high',
    'international-top100': 'low',
  },
  scheduler: { tickMs: 5 * MINUTE, enabled: true, runImmediately: false },
  search: { serveFromCache: true, neverFetchOnSearch: true },
};

function envMs(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function mergePolicy(base, extra) {
  return {
    priorities: {
      high: { ...base.priorities.high, ...(extra.priorities?.high || {}) },
      normal: { ...base.priorities.normal, ...(extra.priorities?.normal || {}) },
      low: { ...base.priorities.low, ...(extra.priorities?.low || {}) },
    },
    sources: { ...base.sources, ...(extra.sources || {}) },
    scheduler: { ...base.scheduler, ...(extra.scheduler || {}) },
    search: { ...base.search, ...(extra.search || {}) },
  };
}

export function loadRefreshPolicy(repoRoot) {
  let fromFile = {};
  if (repoRoot) {
    const file = path.join(repoRoot, 'config', 'discovery-refresh.yml');
    if (fs.existsSync(file)) {
      try {
        fromFile = yaml.load(fs.readFileSync(file, 'utf-8')) || {};
      } catch {
        fromFile = {};
      }
    }
  }
  const merged = mergePolicy(DEFAULT_POLICY, fromFile);
  merged.priorities.high.intervalMs = envMs('DISCOVERY_INTERVAL_HIGH_MS', merged.priorities.high.intervalMs);
  merged.priorities.normal.intervalMs = envMs('DISCOVERY_INTERVAL_NORMAL_MS', merged.priorities.normal.intervalMs);
  merged.priorities.low.intervalMs = envMs('DISCOVERY_INTERVAL_LOW_MS', merged.priorities.low.intervalMs);
  merged.priorities.high.minRefreshIntervalMs = envMs(
    'DISCOVERY_MIN_REFRESH_HIGH_MS',
    merged.priorities.high.minRefreshIntervalMs
  );
  merged.priorities.normal.minRefreshIntervalMs = envMs(
    'DISCOVERY_MIN_REFRESH_NORMAL_MS',
    merged.priorities.normal.minRefreshIntervalMs
  );
  merged.priorities.low.minRefreshIntervalMs = envMs(
    'DISCOVERY_MIN_REFRESH_LOW_MS',
    merged.priorities.low.minRefreshIntervalMs
  );
  merged.scheduler.tickMs = envMs('DISCOVERY_SCHEDULER_TICK_MS', merged.scheduler.tickMs);
  if (process.env.DISCOVERY_SCHEDULER === '0') merged.scheduler.enabled = false;
  return merged;
}

export function priorityFor(policy, sourceId) {
  return policy.sources?.[sourceId] || 'normal';
}

export function intervalFor(policy, sourceId) {
  const p = priorityFor(policy, sourceId);
  return policy.priorities[p]?.intervalMs || policy.priorities.normal.intervalMs;
}

export function minRefreshFor(policy, sourceId) {
  const p = priorityFor(policy, sourceId);
  return policy.priorities[p]?.minRefreshIntervalMs || policy.priorities.normal.minRefreshIntervalMs;
}

function ts(value) {
  if (!value) return 0;
  const n = new Date(value).getTime();
  return Number.isFinite(n) ? n : 0;
}

/**
 * Relative label: "just now" / "12 minutes ago" / "3 hours ago".
 */
export function formatAge(iso, now = Date.now()) {
  const then = ts(iso);
  if (!then) return null;
  const delta = Math.max(0, now - then);
  const minutes = Math.round(delta / MINUTE);
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 48) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

export function freshnessMessage(lastFetchedAt, now = Date.now()) {
  const age = formatAge(lastFetchedAt, now);
  if (!age) return 'Fresh data is not available yet. Showing saved results from the database.';
  return `Fresh data is not available yet. Showing results from ${age}.`;
}

/**
 * Decide whether an external fetch is allowed right now.
 *
 * @param {object} args
 * @param {object} args.policy
 * @param {string} args.sourceId
 * @param {object|null} [args.cacheEntry]
 * @param {object|null} [args.sourceState]  discovery_state row
 * @param {'scheduler'|'manual'|'search'} [args.requested]
 * @param {number|string|Date} [args.now]
 * @returns {{ allowed: boolean, reason: string, nextFetchAt: string|null, lastFetchedAt: string|null }}
 */
export function canRefresh({
  policy,
  sourceId,
  cacheEntry = null,
  sourceState = null,
  requested = 'scheduler',
  now = Date.now(),
} = {}) {
  const t = typeof now === 'number' ? now : new Date(now).getTime();
  const lastFetchedAt =
    cacheEntry?.lastFetchedAt || sourceState?.lastSuccessfulFetchAt || null;
  const nextFetchAt = cacheEntry?.nextFetchAt || null;

  const backoff = Math.max(ts(sourceState?.backoffUntil), ts(sourceState?.rateLimitResetAt));
  if (backoff && backoff > t) {
    return {
      allowed: false,
      reason: 'rate_limited',
      nextFetchAt: new Date(backoff).toISOString(),
      lastFetchedAt,
    };
  }

  // User search never hits external APIs — database/cache only.
  if (requested === 'search') {
    return { allowed: false, reason: 'search_uses_cache', nextFetchAt, lastFetchedAt };
  }

  const last = ts(lastFetchedAt);
  if (!last) {
    return { allowed: true, reason: 'never_fetched', nextFetchAt: null, lastFetchedAt: null };
  }

  if (nextFetchAt && ts(nextFetchAt) > t && requested !== 'manual') {
    return { allowed: false, reason: 'cache_fresh', nextFetchAt, lastFetchedAt };
  }

  const minMs = requested === 'manual' ? minRefreshFor(policy, sourceId) : intervalFor(policy, sourceId);
  if (t - last < minMs) {
    const until = new Date(last + minMs).toISOString();
    return { allowed: false, reason: requested === 'manual' ? 'min_interval' : 'fresh', nextFetchAt: until, lastFetchedAt };
  }

  return { allowed: true, reason: 'due', nextFetchAt: null, lastFetchedAt };
}

/**
 * Across all known sources: allow a scan if at least one source is due.
 * Deny only when every source is fresh or rate-limited.
 */
export function evaluateRefresh({
  policy,
  states = [],
  cacheEntries = [],
  requested = 'manual',
  now = Date.now(),
} = {}) {
  const sourceIds = Object.keys(STRATEGIES);
  const stateById = new Map((states || []).map((s) => [s.sourceId, s]));
  const cacheBySource = new Map();
  for (const entry of cacheEntries || []) {
    const prev = cacheBySource.get(entry.sourceId);
    if (!prev || ts(entry.lastFetchedAt) > ts(prev.lastFetchedAt)) {
      cacheBySource.set(entry.sourceId, entry);
    }
  }

  const perSource = sourceIds.map((sourceId) => ({
    sourceId,
    ...canRefresh({
      policy,
      sourceId,
      cacheEntry: cacheBySource.get(sourceId) || null,
      sourceState: stateById.get(sourceId) || null,
      requested,
      now,
    }),
  }));

  const allowed = perSource.filter((s) => s.allowed);
  const lastFetchedAt = perSource
    .map((s) => s.lastFetchedAt)
    .filter(Boolean)
    .sort()
    .at(-1) || null;

  if (allowed.length === 0) {
    const allRateLimited = perSource.length > 0 && perSource.every((s) => s.reason === 'rate_limited');
    const reason = allRateLimited ? 'rate_limited' : (perSource[0]?.reason || 'fresh');
    return {
      allowed: false,
      reason,
      lastFetchedAt,
      perSource,
      message: allRateLimited
        ? `A source is rate-limited. ${freshnessMessage(lastFetchedAt, now)}`
        : freshnessMessage(lastFetchedAt, now),
    };
  }

  return { allowed: true, reason: 'due', lastFetchedAt, perSource, message: null };
}

export function nextFetchAtFrom(policy, sourceId, fetchedAt = Date.now()) {
  const t = typeof fetchedAt === 'number' ? fetchedAt : new Date(fetchedAt).getTime();
  return new Date(t + intervalFor(policy, sourceId)).toISOString();
}
