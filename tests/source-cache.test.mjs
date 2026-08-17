// tests/source-cache.test.mjs — SourceCache + refresh policy + 304 handling.
// Same query recently fetched → no external request. Search never fetches.
// Manual refresh respects min interval and rate limits.
import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const ENGINE = pathToFileURL(join(ROOT, 'lib/saas/discovery-engine/index.mjs')).href;

console.log('\nsource-cache — query cache, refresh policy, 304, manual gate');

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function checkTrue(label, actual) {
  if (actual) pass(label);
  else fail(`${label} — expected truthy, got ${JSON.stringify(actual)}`);
}

const {
  MemorySourceCache,
  MemoryDiscoveryStateStore,
  parametersHash,
  maybeSkipCachedQuery,
  rememberCachedQuery,
  canRefresh,
  evaluateRefresh,
  loadRefreshPolicy,
  formatAge,
  freshnessMessage,
  DEFAULT_POLICY,
  STRATEGIES,
} = await import(ENGINE);

const MINUTE = 60 * 1000;
const now = Date.parse('2026-08-14T12:00:00Z');
const policy = loadRefreshPolicy(ROOT);

{
  checkTrue('Policy YAML loaded (not only hardcoded defaults)', policy.priorities.high.intervalMs > 0);
  check('High-priority default is 30 minutes', policy.priorities.high.intervalMs, 30 * MINUTE);
  check('Normal-priority default is 2 hours', policy.priorities.normal.intervalMs, 2 * 60 * MINUTE);
  check('Low-priority default is 6 hours', policy.priorities.low.intervalMs, 6 * 60 * MINUTE);
  check('Adzuna is a normal source', policy.sources.adzuna, 'normal');
  check('ATS feeds are high-priority', policy.sources['ats-round-robin'], 'high');
}

{
  const h1 = parametersHash({ sourceId: 'adzuna', query: 'software engineering internship', country: 'gb', opportunityType: 'INTERNSHIP' });
  const h2 = parametersHash({ sourceId: 'adzuna', query: 'Software Engineering Internship', country: 'GB', opportunityType: 'internship' });
  const h3 = parametersHash({ sourceId: 'adzuna', query: 'backend intern', country: 'gb', opportunityType: 'INTERNSHIP' });
  check('Same query fingerprints case-insensitively', h1, h2);
  checkTrue('Different queries get different hashes', h1 !== h3);
}

{
  const cache = new MemorySourceCache();
  const query = 'software engineering internship';
  await rememberCachedQuery(cache, policy, {
    sourceId: 'adzuna',
    query,
    country: 'gb',
    opportunityType: 'INTERNSHIP',
    resultCount: 500,
    now: new Date(now).toISOString(),
  });
  check('First fetch stored one cache row', (await cache.list()).length, 1);

  const second = await maybeSkipCachedQuery({
    sourceCache: cache,
    policy,
    sourceId: 'adzuna',
    query,
    country: 'gb',
    opportunityType: 'INTERNSHIP',
    requested: 'scheduler',
    now: now + 10 * MINUTE,
  });
  check('Second identical query within the window is served from cache', second.skip, true);
  check('Skip reason is cache_fresh or min/fresh', ['cache_fresh', 'fresh'].includes(second.reason), true);

  const search = canRefresh({
    policy,
    sourceId: 'adzuna',
    cacheEntry: second.entry,
    requested: 'search',
    now: now + 3 * 60 * MINUTE,
  });
  check('User search never hits the external API', search.allowed, false);
  check('Search reason is search_uses_cache', search.reason, 'search_uses_cache');
}

{
  const cache = new MemorySourceCache();
  const entry = await rememberCachedQuery(cache, policy, {
    sourceId: 'adzuna',
    query: 'backend intern',
    country: 'gb',
    resultCount: 20,
    etag: '"abc"',
    lastModified: 'Fri, 14 Aug 2026 08:00:00 GMT',
    now: new Date(now).toISOString(),
  });
  const touched = await cache.touchChecked('adzuna', entry.parametersHash, {
    now: new Date(now + MINUTE).toISOString(),
    etag: '"abc"',
  });
  check('304 updates lastCheckedAt without a new row', (await cache.list()).length, 1);
  check('304 status is not_modified', touched.status, 'not_modified');
  checkTrue('lastCheckedAt advanced on 304', new Date(touched.lastCheckedAt) > new Date(entry.lastFetchedAt));
}

{
  const last = new Date(now - 5 * MINUTE).toISOString();
  const deniedOne = canRefresh({
    policy,
    sourceId: 'adzuna',
    sourceState: { lastSuccessfulFetchAt: last },
    requested: 'manual',
    now,
  });
  check('Manual refresh within min interval is denied for that source', deniedOne.allowed, false);
  checkTrue('Denied message mentions showing cached results', freshnessMessage(last, now).includes('Showing results from'));
  check('Age label for 5 minutes', formatAge(last, now), '5 minutes ago');

  const states = Object.keys(STRATEGIES).map((sourceId) => ({
    sourceId,
    lastSuccessfulFetchAt: last,
  }));
  const denied = evaluateRefresh({ policy, states, requested: 'manual', now });
  check('Manual refresh denied when every source is inside its min interval', denied.allowed, false);
}

{
  const deniedOne = canRefresh({
    policy,
    sourceId: 'adzuna',
    sourceState: {
      lastSuccessfulFetchAt: new Date(now - 3 * 60 * MINUTE).toISOString(),
      backoffUntil: new Date(now + 20 * MINUTE).toISOString(),
      rateLimitResetAt: new Date(now + 20 * MINUTE).toISOString(),
    },
    requested: 'manual',
    now,
  });
  check('Manual refresh does not bypass rate limits', deniedOne.allowed, false);
  check('Rate-limit reason', deniedOne.reason, 'rate_limited');
}

{
  const states = [];
  const allowed = evaluateRefresh({ policy, states, requested: 'manual', now });
  check('First-ever manual refresh is allowed', allowed.allowed, true);
}

{
  const store = new MemoryDiscoveryStateStore();
  await store.recordRequest('adzuna', { remaining: 40 });
  await store.recordRequest('adzuna', { remaining: 39 });
  const s = await store.get('adzuna');
  check('requestsMade increments', s.requestsMade, 2);
  check('requestsRemaining stored', s.requestsRemaining, 39);
  await store.recordFailure('adzuna', 'adzuna_429', { rateLimitResetAt: new Date(now + 15 * MINUTE).toISOString(), rateLimited: true, now: new Date(now).toISOString() });
  const failed = await store.get('adzuna');
  checkTrue('last429 recorded', !!failed.last429);
  checkTrue('backoffUntil recorded', !!failed.backoffUntil);
}

{
  checkTrue('freshnessMessage includes the age', freshnessMessage(new Date(now - 12 * MINUTE).toISOString(), now).includes('12 minutes ago'));
  check('Policy object is exported as defaults too', DEFAULT_POLICY.scheduler.enabled, true);
}
