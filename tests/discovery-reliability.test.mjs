// tests/discovery-reliability.test.mjs — Final architecture checks:
// persist, dedupe, incremental metrics, DB-only listing, refresh gate,
// apply-without-scan, multi-user isolation, source failure does not empty the store.
import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

console.log('\ndiscovery-reliability — persist, cache, apply-from-store, isolation, source failure');

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function checkTrue(label, actual) {
  if (actual) pass(label);
  else fail(`${label} — expected truthy, got ${JSON.stringify(actual)}`);
}

const ENGINE = pathToFileURL(join(ROOT, 'lib/saas/discovery-engine/index.mjs')).href;
const STORE = pathToFileURL(join(ROOT, 'lib/saas/opportunity-store/index.mjs')).href;
const QUEUE = pathToFileURL(join(ROOT, 'lib/saas/application-queue.mjs')).href;
const TENANT = pathToFileURL(join(ROOT, 'lib/saas/database/tenant-repository.mjs')).href;

const {
  DiscoveryStrategy,
  DiscoveryEngine,
  MemoryDiscoveryStateStore,
  MemorySourceCache,
  maybeSkipCachedQuery,
  rememberCachedQuery,
  evaluateRefresh,
  loadRefreshPolicy,
  summarizeDiscoveryHealth,
  sourceWarningsFrom,
  formatScanMetrics,
  STRATEGIES,
} = await import(ENGINE);
const { MemoryOpportunityStore, listPersistedOpportunitiesForUi } = await import(STORE);
const { enqueueOpportunities, applyQueueItems, QUEUE_MACHINE } = await import(QUEUE);
const { TenantApplicationRepository, TenantOpportunityRepository } = await import(TENANT);

const HOUR = 60 * 60 * 1000;
const names = ['Google', 'Microsoft', 'Jazz', 'Systems Limited', 'Company X'];

function listing(company, i = 1) {
  return {
    company,
    title: `${company} Internship`,
    url: `https://example.com/careers/${company.toLowerCase().replace(/\s+/g, '-')}-intern-${i}`,
    type: 'INTERNSHIP',
    source_name: 'fixture-board',
    source_id: `${company}-${i}`,
    description: `Internship at ${company}.`,
    postedAt: '2026-08-01T00:00:00.000Z',
  };
}

// ── DISCOVERY: first scan vs second scan ────────────────────────────────────
{
  const strategy = new DiscoveryStrategy({
    sourceId: 'fixture-board',
    supportsPublishedAfter: true,
    recommendedRefreshIntervalMs: 6 * HOUR,
    initialWindowDays: 14,
    overlapHours: 12,
  });
  const board = names.map((company, i) => listing(company, i + 1));
  const fetchLog = [];
  const fetcher = async (plan) => {
    fetchLog.push({ plan, at: Date.now() });
    return { items: board.map((j) => ({ ...j })) };
  };
  const opportunityStore = new MemoryOpportunityStore();
  const engine = new DiscoveryEngine({
    opportunityStore,
    stateStore: new MemoryDiscoveryStateStore(),
  });

  const firstAt = Date.parse('2026-08-14T08:00:00Z');
  const first = await engine.runSource({ strategy, fetcher, options: { now: firstAt } });
  console.log('\nFIRST SCAN\n' + formatScanMetrics(first.metrics));
  check('FIRST SCAN fetched 5', first.metrics.fetched, 5);
  check('FIRST SCAN new 5', first.metrics.new, 5);
  check('FIRST SCAN duplicates 0', first.metrics.duplicates, 0);
  check('FIRST SCAN updated 0', first.metrics.updated, 0);
  check('FIRST SCAN failed 0', first.metrics.failed, 0);
  check('Store holds 5 after first scan', await opportunityStore.count(), 5);

  board.push(listing('Nvidia', 6));
  board[0] = { ...board[0], description: 'Google Internship — updated JD' };

  const secondAt = Date.parse('2026-08-14T16:00:00Z');
  const second = await engine.runSource({ strategy, fetcher, options: { now: secondAt, force: true } });
  console.log('\nSECOND SCAN\n' + formatScanMetrics(second.metrics));
  check('SECOND SCAN fetched 6', second.metrics.fetched, 6);
  check('SECOND SCAN new 1', second.metrics.new, 1);
  check('SECOND SCAN updated 1', second.metrics.updated, 1);
  check('SECOND SCAN duplicates 4', second.metrics.duplicates, 4);
  check('Store still 6 rows, not 11', await opportunityStore.count(), 6);
  checkTrue('Second scan did not re-insert the original five', (await opportunityStore.count()) < 11);
}

// ── CACHE: listing/search never fetch externally ────────────────────────────
{
  let fetches = 0;
  const opportunityStore = new MemoryOpportunityStore();
  for (const company of names) {
    await opportunityStore.upsert(listing(company));
  }
  const container = {
    opportunityStore,
    fetchExternal: async () => {
      fetches += 1;
      throw new Error('Jobs page must not call external sources');
    },
  };
  const listed = await listPersistedOpportunitiesForUi(container, { type: 'INTERNSHIP', search: 'google' }, { userId: 'u1' });
  check('Jobs-style list is served from the store', listed.servedFrom, 'opportunity_store');
  checkTrue('Search matched the persisted Google internship', listed.opportunities.some((o) => o.company === 'Google'));
  check('Opening/search did not call an external API', fetches, 0);

  const cache = new MemorySourceCache();
  const policy = loadRefreshPolicy(ROOT);
  const now = Date.parse('2026-08-14T12:00:00Z');
  await rememberCachedQuery(cache, policy, {
    sourceId: 'adzuna',
    query: 'software engineering internship',
    country: 'gb',
    opportunityType: 'INTERNSHIP',
    resultCount: 40,
    now: new Date(now).toISOString(),
  });
  const skip = await maybeSkipCachedQuery({
    sourceCache: cache,
    policy,
    sourceId: 'adzuna',
    query: 'software engineering internship',
    country: 'gb',
    opportunityType: 'INTERNSHIP',
    requested: 'scheduler',
    now: now + 10 * 60 * 1000,
  });
  checkTrue('Same Adzuna query within the window is skipped', skip.skip === true);
}

{
  const { readFileSync } = await import('node:fs');
  const autoScan = readFileSync(join(ROOT, 'web/src/components/auto-scan-runner.tsx'), 'utf8');
  checkTrue('AutoScanRunner is a no-op (does not POST /scan)', /return null/.test(autoScan) && !/fetch\("\/api\/opportunities\/scan"/.test(autoScan));
}

// ── REFRESH: rate-limit / min-interval gate serves cache ────────────────────
{
  const policy = loadRefreshPolicy(ROOT);
  const now = Date.parse('2026-08-14T12:00:00Z');
  const last = new Date(now - 5 * 60 * 1000).toISOString();
  const allFresh = Object.keys(STRATEGIES).map((sourceId) => ({ sourceId, lastSuccessfulFetchAt: last }));
  const denied = evaluateRefresh({ policy, states: allFresh, requested: 'manual', now });
  check('Manual refresh within min interval is denied', denied.allowed, false);
  checkTrue('Denied refresh explains that cached/database results are shown', /minutes ago|not available|Showing results/i.test(denied.message || ''));

  const limited = evaluateRefresh({
    policy,
    states: Object.keys(STRATEGIES).map((sourceId) => ({
      sourceId,
      lastSuccessfulFetchAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
      rateLimitResetAt: new Date(now + 20 * 60 * 1000).toISOString(),
      backoffUntil: new Date(now + 20 * 60 * 1000).toISOString(),
    })),
    requested: 'manual',
    now,
  });
  check('Manual refresh still respects rate limits', limited.allowed, false);
}

// ── APPLICATION: persist 5, "restart", apply without a scan ─────────────────
{
  const liveStore = new MemoryOpportunityStore();
  for (const company of names) {
    await liveStore.upsert(listing(company));
  }
  check('Five opportunities persisted before restart', await liveStore.count(), 5);

  const snapshot = liveStore.exportAll();
  const restarted = new MemoryOpportunityStore();
  restarted.importAll(snapshot);
  check('After restart the same 5 opportunities still exist', await restarted.count(), 5);
  const google = await restarted.getByUrl('https://example.com/careers/google-intern-1');
  checkTrue('Google internship survived restart', Boolean(google?.id));

  let scanRuns = 0;
  const container = {
    opportunityStore: restarted,
    applicationRepository: new TenantApplicationRepository(),
    opportunityRepository: new TenantOpportunityRepository(),
    runScan: async () => {
      scanRuns += 1;
    },
  };
  const auth = { tenantId: 't1', userId: 'user_a' };
  const ids = (await restarted.list({})).opportunities.map((o) => o.id);
  const enq = await enqueueOpportunities({ container, authContext: auth, opportunityIds: ids, count: 5 });
  check('Add to Applications queued 5 persisted ids', enq.addedCount, 5);

  const applied = await applyQueueItems({
    container,
    authContext: auth,
    all: true,
    profile: { identity: { name: 'Ali' } },
    processOpportunityFn: async ({ opportunity }) => ({
      processed: true,
      status: 'DRY_RUN',
      submitted: false,
      submitted_at: null,
      company: opportunity.company,
      artifacts: {},
    }),
  });
  check('Apply All processed 5 without a discovery scan', applied.processed, 5);
  check('Apply All did not trigger discovery', scanRuns, 0);
  check('Apply All did not fake SUBMITTED', applied.submitted, false);
}

// ── USER: global listing, private application state ─────────────────────────
{
  const store = new MemoryOpportunityStore();
  const { opportunity } = await store.upsert(listing('Google'));
  await store.setUserState({ userId: 'user_a', tenantId: 't1', opportunityId: opportunity.id, status: 'SAVED' });

  const listedB = await store.list({}, { userId: 'user_b' });
  check('User B can see the global Google internship', listedB.opportunities[0].company, 'Google');
  check('User B does not inherit User A saved state', listedB.opportunities[0].userState, null);

  const apps = new TenantApplicationRepository();
  await apps.create(
    {
      opportunity_id: opportunity.id,
      company: 'Google',
      title: 'Google Internship',
      state: QUEUE_MACHINE.SELECTED,
      url: opportunity.applicationUrl,
      metadata: { notes: 'User A private note', cv: 'User A CV path' },
    },
    { tenantId: 't1', userId: 'user_a' }
  );
  const bQueue = await apps.findMany({}, { tenantId: 't1', userId: 'user_b' });
  check("User B cannot see User A's application queue", bQueue.length, 0);
  const bDirect = await apps.getByOpportunityId(opportunity.id, 'user_b', 't1');
  check("User B cannot read User A's application row", bDirect, null);
}

// ── SOURCE FAILURE: disable Adzuna, listings remain, warning shown ──────────
{
  const store = new MemoryOpportunityStore();
  for (const company of names) await store.upsert(listing(company));
  const stateStore = new MemoryDiscoveryStateStore();
  await stateStore.recordFailure('adzuna', 'Adzuna disabled for source-failure test');

  const engine = new DiscoveryEngine({ opportunityStore: store, stateStore });
  const failed = await engine.runSource({
    strategy: new DiscoveryStrategy({ sourceId: 'adzuna', supportsPublishedAfter: true, recommendedRefreshIntervalMs: 0 }),
    fetcher: async () => {
      throw new Error('Adzuna is currently unavailable');
    },
    options: { force: true, now: Date.parse('2026-08-14T18:00:00Z') },
  });
  checkTrue('Failed Adzuna fetch is recorded as failed', failed.failed === true);
  check('Existing opportunities are still visible after Adzuna failure', await store.count(), 5);

  const listed = await listPersistedOpportunitiesForUi(
    { opportunityStore: store },
    { type: 'INTERNSHIP' },
    { userId: 'user_a' }
  );
  check('UI still lists 5 persisted internships', listed.opportunities.length, 5);

  const health = await summarizeDiscoveryHealth({
    stateStore,
    sourceCache: new MemorySourceCache(),
    hasPersistedOpportunities: true,
  });
  const warning = (health.sourceWarnings || []).find((w) => w.sourceId === 'adzuna');
  checkTrue('Adzuna unavailable warning is shown', Boolean(warning));
  check(
    'Warning text matches the required copy',
    warning?.message,
    'Showing previously discovered opportunities. Adzuna is currently unavailable.'
  );

  const recovered = await engine.runSource({
    strategy: new DiscoveryStrategy({ sourceId: 'adzuna', supportsPublishedAfter: true, recommendedRefreshIntervalMs: 0 }),
    fetcher: async () => ({ items: [listing('Stripe', 9)] }),
    options: { force: true, now: Date.parse('2026-08-14T19:00:00Z') },
  });
  check('When Adzuna recovers, incremental discovery persists new listings', recovered.metrics.new, 1);
  check('Recovered scan does not wipe the previous 5', await store.count(), 6);
}

{
  const none = sourceWarningsFrom({ states: [], hasPersistedOpportunities: true });
  check('No warning when Adzuna has never failed', none.length, 0);
}
