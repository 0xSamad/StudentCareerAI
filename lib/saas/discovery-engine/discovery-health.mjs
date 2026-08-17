/**
 * discovery-health.mjs — Dashboard snapshot of the discovery system.
 *
 * Last discovery, new/updated counts, sources healthy vs rate-limited.
 * Reads only from persisted state/cache — never triggers a fetch.
 */

import { formatAge } from './refresh-policy.mjs';
import { STRATEGIES } from './discovery-strategy.mjs';

const ADZUNA_UNAVAILABLE =
  'Showing previously discovered opportunities. Adzuna is currently unavailable.';

/**
 * User-visible source failures. Existing listings stay on screen.
 */
export function sourceWarningsFrom({
  states = [],
  cacheEntries = [],
  hasPersistedOpportunities = true,
} = {}) {
  if (!hasPersistedOpportunities) return [];
  const warnings = [];
  const adzunaState = states.find((s) => s.sourceId === 'adzuna');
  const adzunaCaches = cacheEntries.filter((c) => String(c.sourceId || '').startsWith('adzuna'));
  const lastError = String(adzunaState?.lastError || '');
  const adzunaDown =
    Number(adzunaState?.consecutiveFailures || 0) > 0 ||
    /missing_app|unavailable|disabled|error|ECONN|ENOTFOUND|timeout|401|403|429/i.test(lastError) ||
    adzunaCaches.some((c) => c.status === 'error');
  if (adzunaDown) {
    warnings.push({ sourceId: 'adzuna', message: ADZUNA_UNAVAILABLE });
  }
  return warnings;
}

export async function summarizeDiscoveryHealth({
  stateStore,
  sourceCache,
  now = Date.now(),
  hasPersistedOpportunities = true,
  lastSeenFallback = null,
} = {}) {
  const states = typeof stateStore?.list === 'function' ? await stateStore.list() : [];
  const cacheEntries = typeof sourceCache?.list === 'function' ? await sourceCache.list() : [];

  let lastDiscoveryAt = null;
  let newOpportunities = 0;
  let updatedOpportunities = 0;
  for (const s of states) {
    if (s.lastSuccessfulFetchAt && (!lastDiscoveryAt || s.lastSuccessfulFetchAt > lastDiscoveryAt)) {
      lastDiscoveryAt = s.lastSuccessfulFetchAt;
    }
    newOpportunities += Number(s.lastNewCount) || 0;
    updatedOpportunities += Number(s.lastUpdatedCount) || 0;
  }
  for (const c of cacheEntries) {
    if (c.lastFetchedAt && (!lastDiscoveryAt || c.lastFetchedAt > lastDiscoveryAt)) {
      lastDiscoveryAt = c.lastFetchedAt;
    }
  }

  if (!lastDiscoveryAt && lastSeenFallback) {
    lastDiscoveryAt = lastSeenFallback;
  }

  const t = typeof now === 'number' ? now : new Date(now).getTime();
  const knownIds = new Set([
    ...Object.keys(STRATEGIES),
    ...states.map((s) => s.sourceId),
    ...cacheEntries.map((c) => c.sourceId),
  ]);

  const cacheRows = cacheEntries.filter((c) => !c.sourceId?.startsWith('_'));
  const healthRows = cacheRows.length > 0
    ? cacheRows
    : [...knownIds].map((id) => {
        const s = states.find((row) => row.sourceId === id);
        const limited = s && Math.max(
          s.backoffUntil ? new Date(s.backoffUntil).getTime() : 0,
          s.rateLimitResetAt ? new Date(s.rateLimitResetAt).getTime() : 0
        ) > t;
        return {
          sourceId: id,
          status: limited ? 'rate_limited' : s?.lastError ? 'error' : 'ok',
          nextFetchAt: s?.rateLimitResetAt || s?.backoffUntil || null,
        };
      });

  const sourcesRateLimited = healthRows.filter((r) => {
    if (r.status === 'rate_limited') return true;
    const s = states.find((row) => row.sourceId === r.sourceId);
    const until = Math.max(
      s?.backoffUntil ? new Date(s.backoffUntil).getTime() : 0,
      s?.rateLimitResetAt ? new Date(s.rateLimitResetAt).getTime() : 0,
      r.nextFetchAt && r.status === 'rate_limited' ? new Date(r.nextFetchAt).getTime() : 0
    );
    return until > t;
  }).length;

  const sourcesError = healthRows.filter((r) => r.status === 'error').length;
  const sourcesTotal = healthRows.length || Object.keys(STRATEGIES).length;
  const sourcesHealthy = Math.max(0, sourcesTotal - sourcesRateLimited - sourcesError);
  const sourceWarnings = sourceWarningsFrom({ states, cacheEntries, hasPersistedOpportunities });

  return {
    lastDiscoveryAt,
    lastDiscoveryAgo: formatAge(lastDiscoveryAt, t),
    newOpportunities,
    updatedOpportunities,
    sourcesTotal,
    sourcesHealthy,
    sourcesRateLimited,
    sourcesError,
    sourceWarnings,
  };
}
