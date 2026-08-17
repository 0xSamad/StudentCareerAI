// tests/incremental-discovery.test.mjs — Incremental discovery engine:
// initial window on first fetch, incremental window afterwards, freshness and
// rate-limit gates, backoff, and the core guarantee that a SECOND SCAN does
// not repeat the entire FIRST SCAN.
import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const ENGINE = pathToFileURL(join(ROOT, 'lib/saas/discovery-engine/index.mjs')).href;
const STORE = pathToFileURL(join(ROOT, 'lib/saas/opportunity-store/index.mjs')).href;

console.log('\nincremental-discovery — strategy, state, rate limits, first vs second scan');

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function checkTrue(label, actual) {
  if (actual) pass(label);
  else fail(`${label} — expected truthy, got ${JSON.stringify(actual)}`);
}

const {
  DiscoveryStrategy,
  STRATEGIES,
  planFetch,
  MemoryDiscoveryStateStore,
  SourceRateLimiter,
  fetchWithBackoff,
  retryAfterToIso,
  RateLimitError,
  DiscoveryEngine,
} = await import(ENGINE);
const { MemoryOpportunityStore } = await import(STORE);

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// ── planFetch: initial vs incremental vs skip ───────────────────────────────
{
  const strategy = new DiscoveryStrategy({
    sourceId: 'test-src',
    supportsPublishedAfter: true,
    recommendedRefreshIntervalMs: 6 * HOUR,
    initialWindowDays: 14,
    overlapHours: 24,
  });
  const now = Date.parse('2026-08-14T12:00:00Z');

  const first = planFetch(strategy, null, { now });
  check('First ever fetch → INITIAL', first.mode, 'initial');
  check('Initial uses the historical window (days)', first.maxDaysOld, 14);

  const freshState = { lastSuccessfulFetchAt: new Date(now - HOUR).toISOString() };
  const fresh = planFetch(strategy, freshState, { now });
  check('Fetched 1h ago with 6h interval → SKIP', fresh.mode, 'skip');
  check('Skip reason is fresh', fresh.reason, 'fresh');

  const forced = planFetch(strategy, freshState, { now, force: true });
  check('force bypasses the freshness gate', forced.mode, 'incremental');

  const staleState = { lastSuccessfulFetchAt: new Date(now - 2 * DAY).toISOString() };
  const incremental = planFetch(strategy, staleState, { now });
  check('Fetched 2 days ago → INCREMENTAL', incremental.mode, 'incremental');
  check('Strategy picks published_after', incremental.reason, 'published_after');
  // Window = lastSuccess − 24h overlap → 3 days back from now.
  check('publishedAfter = last success minus overlap', incremental.publishedAfter, new Date(now - 3 * DAY).toISOString());
  check('maxDaysOld covers window + overlap', incremental.maxDaysOld, 3);

  const rateLimited = planFetch(strategy, {
    ...staleState,
    rateLimitResetAt: new Date(now + HOUR).toISOString(),
  }, { now, force: true });
  check('Rate limit window → SKIP even when forced', rateLimited.mode, 'skip');
  check('Skip reason is rate_limited', rateLimited.reason, 'rate_limited');

  const noApi = new DiscoveryStrategy({ sourceId: 'scrape-src', recommendedRefreshIntervalMs: 0, overlapHours: 0 });
  const overlap = planFetch(noApi, staleState, { now });
  check('Source with no incremental API → overlap window + DB dedupe', overlap.reason, 'overlap_window');
  checkTrue('Overlap plan is dedupe-only', overlap.dedupeOnly);

  checkTrue('Built-in adzuna strategy supports published_after', STRATEGIES.adzuna.supportsPublishedAfter);
  checkTrue('Built-in careers-page strategies are dedupe-only (no cursor/date API)',
    !STRATEGIES['pakistan-top100'].supportsPublishedAfter && !STRATEGIES['pakistan-top100'].supportsCursor);
}

// ── Discovery state store round-trip ─────────────────────────────────────────
{
  const store = new MemoryDiscoveryStateStore();
  check('Unknown source has no state', await store.get('adzuna'), null);

  await store.recordAttempt('adzuna');
  checkTrue('Attempt recorded', (await store.get('adzuna')).lastAttemptAt);

  await store.recordSuccess('adzuna', { lastPublishedAt: '2026-08-14T09:00:00Z', lastPage: 3 });
  const ok = await store.get('adzuna');
  checkTrue('Success sets lastSuccessfulFetchAt', ok.lastSuccessfulFetchAt);
  check('Success stores lastPublishedAt anchor', ok.lastPublishedAt, '2026-08-14T09:00:00Z');
  check('Success stores lastPage', ok.lastPage, 3);
  check('Success resets failures', ok.consecutiveFailures, 0);

  await store.recordFailure('adzuna', 'adzuna_429', { rateLimitResetAt: '2026-08-14T13:00:00Z' });
  const failed = await store.get('adzuna');
  check('Failure keeps lastSuccessfulFetchAt', failed.lastSuccessfulFetchAt, ok.lastSuccessfulFetchAt);
  check('Failure stores the error', failed.lastError, 'adzuna_429');
  check('Failure stores rate-limit reset', failed.rateLimitResetAt, '2026-08-14T13:00:00Z');
  check('Failure increments counter', failed.consecutiveFailures, 1);
}

// ── Rate limiter: backoff, retry-after, budgets, concurrency ────────────────
{
  let attempts = 0;
  const result = await fetchWithBackoff(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('flaky');
      return 'ok';
    },
    { retries: 3, baseDelayMs: 1, sleepFn: async () => {} }
  );
  check('Backoff retries transient errors until success', result, 'ok');
  check('Backoff attempt count', attempts, 3);

  let rlAttempts = 0;
  let rlError = null;
  try {
    await fetchWithBackoff(
      async () => {
        rlAttempts += 1;
        throw new RateLimitError('adzuna_429', { rateLimitResetAt: '2026-08-14T13:00:00Z' });
      },
      { retries: 5, baseDelayMs: 1, sleepFn: async () => {} }
    );
  } catch (err) {
    rlError = err;
  }
  check('Rate-limit errors are never retried through', rlAttempts, 1);
  check('Rate-limit reset propagates', rlError?.rateLimitResetAt, '2026-08-14T13:00:00Z');

  const now = Date.parse('2026-08-14T12:00:00Z');
  check('Retry-After seconds → ISO reset', retryAfterToIso('120', { now }), new Date(now + 120_000).toISOString());
  check('Retry-After HTTP date → ISO reset', retryAfterToIso('Fri, 14 Aug 2026 13:00:00 GMT', { now }), '2026-08-14T13:00:00.000Z');

  const limiter = new SourceRateLimiter({ minIntervalMs: 0, maxConcurrent: 2, maxRequests: 5 });
  let inFlight = 0;
  let maxInFlight = 0;
  await Promise.all(
    [1, 2, 3, 4, 5].map(() =>
      limiter.schedule(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
      })
    )
  );
  checkTrue('Concurrency cap respected', maxInFlight <= 2);
  let budgetError = null;
  try {
    await limiter.schedule(async () => 'over budget');
  } catch (err) {
    budgetError = err;
  }
  check('Per-run request budget enforced', budgetError?.message, 'request_budget_exhausted');
}

// ── CORE TEST: FIRST SCAN full window, SECOND SCAN incremental only ─────────
{
  const strategy = new DiscoveryStrategy({
    sourceId: 'fake-board',
    supportsPublishedAfter: true,
    recommendedRefreshIntervalMs: 0, // let the second scan run immediately
    initialWindowDays: 30,
    overlapHours: 12,
  });

  const t0 = Date.parse('2026-08-01T00:00:00Z');
  const firstScanAt = Date.parse('2026-08-14T08:00:00Z');
  const secondScanAt = Date.parse('2026-08-15T08:00:00Z');

  // Upstream board: 20 historical postings; later 3 new ones appear and 2 old
  // descriptions change.
  const board = [];
  for (let i = 0; i < 20; i += 1) {
    board.push({
      title: `Software Engineer ${i}`,
      company: 'FakeBoard Inc',
      url: `https://fakeboard.example/jobs/${i}`,
      source_name: 'fake-board',
      source_id: `fb-${i}`,
      description: `Role ${i}`,
      postedAt: new Date(t0 + i * HOUR).toISOString(),
    });
  }

  const fetchLog = [];
  const fetcher = async (plan) => {
    fetchLog.push(plan);
    const cutoff = plan.publishedAfter ? Date.parse(plan.publishedAfter) : 0;
    // An honest incremental API: only returns postings inside the window.
    // Changed postings surface too (job boards bump them on edit).
    const items = board.filter(
      (job) => Date.parse(job.postedAt) >= cutoff || job.updated
    );
    return { items, lastPublishedAt: board.at(-1).postedAt };
  };

  const opportunityStore = new MemoryOpportunityStore();
  const stateStore = new MemoryDiscoveryStateStore();
  const engine = new DiscoveryEngine({ opportunityStore, stateStore });

  // FIRST SCAN — initial import of the historical window.
  const first = await engine.runSource({ strategy, fetcher, options: { now: firstScanAt } });
  check('First scan runs in INITIAL mode', first.mode, 'initial');
  check('First scan imports all 20 postings', first.newCount, 20);
  check('First scan fetched 20', first.fetched, 20);
  check('First scan duplicates 0', first.unchangedCount, 0);
  check('First scan failed 0', first.metrics.failed, 0);
  check('Store holds 20 opportunities', await opportunityStore.count(), 20);
  checkTrue('First scan requested a bounded historical window', !!fetchLog[0].publishedAfter);

  // Upstream changes before the second scan: 3 new postings, 2 edited.
  for (let i = 20; i < 23; i += 1) {
    board.push({
      title: `Software Engineer ${i}`,
      company: 'FakeBoard Inc',
      url: `https://fakeboard.example/jobs/${i}`,
      source_name: 'fake-board',
      source_id: `fb-${i}`,
      description: `Role ${i}`,
      postedAt: new Date(secondScanAt - 2 * HOUR + i * 1000).toISOString(),
    });
  }
  board[0] = { ...board[0], description: 'Role 0 — updated requirements', updated: true };
  board[1] = { ...board[1], description: 'Role 1 — updated requirements', updated: true };

  // SECOND SCAN — must NOT repeat the whole first scan.
  const second = await engine.runSource({ strategy, fetcher, options: { now: secondScanAt } });
  check('Second scan runs in INCREMENTAL mode', second.mode, 'incremental');
  // Window anchors at the newest posting seen in scan 1 (t0+19h) minus the
  // 12h overlap — never re-fetching the whole 30-day historical window.
  check('Second scan asked only for changes since last success (published_after set)',
    fetchLog[1].publishedAfter, new Date(t0 + 7 * HOUR).toISOString());
  checkTrue('Second scan fetched far fewer than the full 23 postings', second.fetched < 23);
  check('Second scan persists 3 new opportunities', second.newCount, 3);
  check('Second scan records 2 updated opportunities', second.updatedCount, 2);
  check('No duplicates: store holds 23, not 43', await opportunityStore.count(), 23);

  const state = await stateStore.get('fake-board');
  check('State counts two successful fetches', state.totalFetches, 2);
  checkTrue('lastPublishedAt anchor advanced past the first scan',
    Date.parse(state.lastPublishedAt) > firstScanAt);

  // THIRD SCAN with a real refresh interval → gated by the backend, no fetch.
  const gated = new DiscoveryStrategy({ ...strategy, sourceId: 'fake-board', supportsPublishedAfter: true, recommendedRefreshIntervalMs: 6 * HOUR });
  const third = await engine.runSource({ strategy: gated, fetcher, options: { now: secondScanAt + HOUR } });
  check('Third scan within the refresh interval → SKIP', third.mode, 'skip');
  check('Skip did not hit the source', fetchLog.length, 2);
}
