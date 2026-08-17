/**
 * discovery-strategy.mjs — Per-source incremental discovery strategy.
 *
 * Each external source declares its capabilities; planFetch() turns the
 * capabilities plus the persisted per-source state into a concrete plan:
 *
 *   INITIAL      — first fetch ever: controlled historical window
 *   INCREMENTAL  — "what changed since our last successful fetch?"
 *   SKIP         — source is fresh or rate-limited; do not hit the API
 *
 * Sources that support none of cursor/published_after/updated_since fall back
 * to a conservative overlap window: re-fetch from (lastSuccessfulFetchAt −
 * overlap) and let the Opportunity Store deduplicate.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export class DiscoveryStrategy {
  constructor({
    sourceId,
    supportsCursor = false,
    supportsPublishedAfter = false,
    supportsUpdatedSince = false,
    supportsPagination = false,
    recommendedRefreshIntervalMs = 6 * HOUR,
    initialWindowDays = 14,
    overlapHours = 24,
    maxRequestsPerRun = 60,
    minRequestSpacingMs = 250,
    maxConcurrent = 4,
  }) {
    if (!sourceId) throw new Error('DiscoveryStrategy requires sourceId');
    this.sourceId = sourceId;
    this.supportsCursor = supportsCursor;
    this.supportsPublishedAfter = supportsPublishedAfter;
    this.supportsUpdatedSince = supportsUpdatedSince;
    this.supportsPagination = supportsPagination;
    this.recommendedRefreshIntervalMs = recommendedRefreshIntervalMs;
    this.initialWindowDays = initialWindowDays;
    this.overlapHours = overlapHours;
    this.maxRequestsPerRun = maxRequestsPerRun;
    this.minRequestSpacingMs = minRequestSpacingMs;
    this.maxConcurrent = maxConcurrent;
  }
}

/** Built-in strategies for the sources this app scans. */
export const STRATEGIES = {
  // Adzuna: date filters (max_days_old) + sort_by=date + page pagination.
  adzuna: new DiscoveryStrategy({
    sourceId: 'adzuna',
    supportsPublishedAfter: true, // via max_days_old + sort_by=date cutoff
    supportsPagination: true,
    recommendedRefreshIntervalMs: 6 * HOUR,
    initialWindowDays: 14,
    overlapHours: 24,
    maxRequestsPerRun: 40,
    minRequestSpacingMs: 300,
    maxConcurrent: 4,
  }),
  // Official employer careers pages: plain HTML, no date filters at all.
  'pakistan-top100': new DiscoveryStrategy({
    sourceId: 'pakistan-top100',
    recommendedRefreshIntervalMs: 12 * HOUR,
    initialWindowDays: 30, // pages show whatever is live; window is informational
    overlapHours: 0, // dedupe-only source: the DB is the diff
    maxRequestsPerRun: 100,
    maxConcurrent: 12,
  }),
  'international-top100': new DiscoveryStrategy({
    sourceId: 'international-top100',
    recommendedRefreshIntervalMs: 12 * HOUR,
    initialWindowDays: 30,
    overlapHours: 0,
    maxRequestsPerRun: 100,
    maxConcurrent: 12,
  }),
  // Configured ATS APIs (Greenhouse/Lever/Ashby/…): full feed per company,
  // no published_after — dedupe-only with a shorter refresh interval.
  'ats-round-robin': new DiscoveryStrategy({
    sourceId: 'ats-round-robin',
    supportsPagination: true,
    recommendedRefreshIntervalMs: 4 * HOUR,
    initialWindowDays: 30,
    overlapHours: 0,
    maxRequestsPerRun: 60,
    maxConcurrent: 6,
  }),
};

/**
 * Decide how (and whether) to fetch a source right now.
 *
 * @param {DiscoveryStrategy} strategy
 * @param {object|null} state — persisted per-source discovery state
 * @param {{ now?: number|string|Date, force?: boolean }} [opts]
 * @returns {{
 *   mode: 'initial'|'incremental'|'skip',
 *   reason: string,
 *   publishedAfter: string|null,
 *   maxDaysOld: number|null,
 *   cursor: string|null,
 *   page: number|null,
 *   dedupeOnly: boolean,
 * }}
 */
export function planFetch(strategy, state = null, opts = {}) {
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const base = {
    mode: 'skip',
    reason: '',
    publishedAfter: null,
    maxDaysOld: null,
    cursor: null,
    page: null,
    dedupeOnly: false,
  };

  // Rate-limit protection wins over everything, even force.
  const resetAt = Math.max(
    state?.rateLimitResetAt ? new Date(state.rateLimitResetAt).getTime() : 0,
    state?.backoffUntil ? new Date(state.backoffUntil).getTime() : 0
  );
  if (resetAt && resetAt > now) {
    return { ...base, reason: 'rate_limited' };
  }

  const lastOk = state?.lastSuccessfulFetchAt ? new Date(state.lastSuccessfulFetchAt).getTime() : 0;

  // Freshness gate: prefer the configurable policy interval when provided.
  const intervalMs = Number(opts.intervalMs) || strategy.recommendedRefreshIntervalMs;
  if (!opts.force && lastOk && now - lastOk < intervalMs) {
    return { ...base, reason: 'fresh' };
  }

  // INITIAL DISCOVERY: no successful fetch yet → controlled historical window.
  if (!lastOk) {
    return {
      ...base,
      mode: 'initial',
      reason: 'first_fetch',
      maxDaysOld: strategy.initialWindowDays,
      publishedAfter: new Date(now - strategy.initialWindowDays * DAY).toISOString(),
      page: strategy.supportsPagination ? 1 : null,
    };
  }

  // INCREMENTAL DISCOVERY: only what may have changed since the last success.
  const overlapMs = strategy.overlapHours * HOUR;
  const anchor = state?.lastPublishedAt
    ? Math.min(new Date(state.lastPublishedAt).getTime(), lastOk)
    : lastOk;
  const since = anchor - overlapMs;

  if (strategy.supportsCursor && state?.lastCursor) {
    return {
      ...base,
      mode: 'incremental',
      reason: 'cursor',
      cursor: state.lastCursor,
      publishedAfter: new Date(since).toISOString(),
    };
  }

  if (strategy.supportsPublishedAfter || strategy.supportsUpdatedSince) {
    return {
      ...base,
      mode: 'incremental',
      reason: strategy.supportsUpdatedSince ? 'updated_since' : 'published_after',
      publishedAfter: new Date(since).toISOString(),
      maxDaysOld: Math.max(1, Math.ceil((now - since) / DAY)),
      page: strategy.supportsPagination ? 1 : null,
    };
  }

  // No incremental API at all: conservative overlap window — re-fetch what the
  // source currently lists and rely on the Opportunity Store to deduplicate.
  return {
    ...base,
    mode: 'incremental',
    reason: 'overlap_window',
    publishedAfter: overlapMs ? new Date(since).toISOString() : null,
    dedupeOnly: true,
  };
}
