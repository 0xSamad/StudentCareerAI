// tests/discovery-pipeline.test.mjs — Scheduler → Fetch NEW/UPDATED →
// Opportunity DB. Opening the app must not fetch; ticks are incremental.
import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

console.log('\ndiscovery-pipeline — scheduler fetch callback, skip-when-fresh, store ingest');

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function checkTrue(label, actual) {
  if (actual) pass(label);
  else fail(`${label} — expected truthy, got ${JSON.stringify(actual)}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ENGINE = pathToFileURL(join(ROOT, 'lib/saas/discovery-engine/index.mjs')).href;
const STORE = pathToFileURL(join(ROOT, 'lib/saas/opportunity-store/index.mjs')).href;

const {
  STRATEGIES,
  MemoryDiscoveryStateStore,
  MemorySourceCache,
  ensureDiscoveryPipeline,
  stopGlobalDiscoveryScheduler,
  getGlobalDiscoveryScheduler,
  runGlobalDiscoveryTick,
  loadRefreshPolicy,
} = await import(ENGINE);
const { MemoryOpportunityStore, createStoreIngestRepository } = await import(STORE);

const duePolicy = {
  scheduler: { tickMs: 80, enabled: true, runImmediately: false },
  priorities: {
    high: { intervalMs: 1, minRefreshIntervalMs: 1 },
    normal: { intervalMs: 1, minRefreshIntervalMs: 1 },
    low: { intervalMs: 1, minRefreshIntervalMs: 1 },
  },
  sources: {
    adzuna: 'high',
    'ats-round-robin': 'high',
    'pakistan-top100': 'high',
    'international-top100': 'high',
  },
};

function emptyContainer(overrides = {}) {
  return {
    discoveryRefreshPolicy: duePolicy,
    discoveryStateStore: new MemoryDiscoveryStateStore(),
    sourceCache: new MemorySourceCache(),
    opportunityStore: new MemoryOpportunityStore(),
    ...overrides,
  };
}

stopGlobalDiscoveryScheduler();

{
  let calls = 0;
  const seen = [];
  const container = emptyContainer();
  const first = ensureDiscoveryPipeline({
    container,
    repoRoot: ROOT,
    scanFn: async (opts) => {
      calls += 1;
      seen.push(opts);
      return { ok: true };
    },
  });
  ensureDiscoveryPipeline({
    container,
    repoRoot: ROOT,
    scanFn: async (opts) => {
      calls += 1;
      seen.push(opts);
      return { ok: true };
    },
  });
  check('Opening Jobs/Dashboard does not fetch immediately', calls, 0);
  checkTrue('Scheduler timer is armed at boot', Boolean(first.timer));
  const status = getGlobalDiscoveryScheduler();
  checkTrue('Scheduler reports a fetch callback', Boolean(status?.running));

  await sleep(220);
  checkTrue('Scheduler tick fetches after one interval', calls >= 1);
  check('Scheduler ticks request incremental (not force)', seen[0]?.force, false);
  check('Scheduler ticks are tagged scheduler', seen[0]?.requested, 'scheduler');
  stopGlobalDiscoveryScheduler();
}

{
  const stateStore = new MemoryDiscoveryStateStore();
  const now = new Date().toISOString();
  for (const sourceId of Object.keys(STRATEGIES)) {
    await stateStore.recordSuccess(sourceId, { now });
  }
  let scanCalls = 0;
  const result = await runGlobalDiscoveryTick({
    container: emptyContainer({
      discoveryRefreshPolicy: loadRefreshPolicy(ROOT),
      discoveryStateStore: stateStore,
    }),
    repoRoot: ROOT,
    scanFn: async () => {
      scanCalls += 1;
      return { fetched: 99 };
    },
  });
  check('Fresh sources skip the scheduler fetch', result.skipped, true);
  check('scan is not called while sources are fresh', scanCalls, 0);
}

{
  let scanCalls = 0;
  let opts = null;
  const result = await runGlobalDiscoveryTick({
    container: emptyContainer(),
    repoRoot: ROOT,
    scanFn: async (options) => {
      scanCalls += 1;
      opts = options;
      return { metrics: { fetched: 6, new: 1, updated: 1, duplicates: 4 } };
    },
  });
  check('Due sources run the scheduler tick', scanCalls, 1);
  check('Due tick is incremental', opts.force, false);
  check('Due tick is not a user page-load scan', opts.requested, 'scheduler');
  check('Tick result is passed through', result.metrics.new, 1);
}

{
  const store = new MemoryOpportunityStore();
  const ingest = createStoreIngestRepository(store);
  const first = await ingest.upsertDiscovered({
    company: 'Google',
    title: 'Google Intern',
    url: 'https://careers.google.com/jobs/intern-1',
    type: 'INTERNSHIP',
    source_name: 'adzuna',
    source_id: 'google-intern-1',
  });
  const second = await ingest.upsertDiscovered({
    company: 'Google',
    title: 'Google Intern',
    url: 'https://careers.google.com/jobs/intern-1',
    type: 'INTERNSHIP',
    source_name: 'adzuna',
    source_id: 'google-intern-1',
    description: 'Updated description',
  });
  const microsoft = await ingest.upsertDiscovered({
    company: 'Microsoft',
    title: 'Microsoft Intern',
    url: 'https://careers.microsoft.com/jobs/intern-1',
    type: 'INTERNSHIP',
    source_name: 'ats',
    source_id: 'ms-intern-1',
  });
  check('First persist is new', first.isNew, true);
  check('Same URL is not a second row', second.isNew, false);
  checkTrue('Content change is marked updated', second.changed === true);
  check('Microsoft intern is a separate listing', microsoft.isNew, true);
  check('Store has 2 rows not 3', await store.count(), 2);
  const urls = await ingest.listKnownUrls();
  checkTrue(
    'Known URLs include the persisted internships',
    urls.has('https://careers.google.com/jobs/intern-1') && urls.has('https://careers.microsoft.com/jobs/intern-1')
  );
}

{
  const disabled = await runGlobalDiscoveryTick({
    container: emptyContainer({
      discoveryRefreshPolicy: { ...duePolicy, scheduler: { ...duePolicy.scheduler, enabled: false } },
    }),
    scanFn: async () => ({ fetched: 1 }),
  });
  check('Disabled scheduler does not fetch', disabled.reason, 'disabled');
}

stopGlobalDiscoveryScheduler();
