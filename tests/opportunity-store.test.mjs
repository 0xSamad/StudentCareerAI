// tests/opportunity-store.test.mjs — Global Opportunity Store:
// normalize → deduplicate → persist → incremental refresh, plus per-user
// saved states. Core requirement: fetching the same job twice yields ONE
// record with lastSeenAt updated, never a duplicate.
import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const STORE = pathToFileURL(join(ROOT, 'lib/saas/opportunity-store/index.mjs')).href;

console.log('\nopportunity-store — dedup, persistence, incremental refresh, user states');

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function checkTrue(label, actual) {
  if (actual) pass(label);
  else fail(`${label} — expected truthy, got ${JSON.stringify(actual)}`);
}

const {
  normalizeOpportunity,
  dedupeKeyFor,
  MemoryOpportunityStore,
  createDualWriteRepository,
} = await import(STORE);

// ── Normalization & dedupe keys ─────────────────────────────────────────────
{
  const record = normalizeOpportunity({
    title: 'Software Engineering Intern',
    company: 'Google',
    url: 'https://careers.google.com/jobs/results/123?utm_source=adzuna#apply',
    source_name: 'Greenhouse',
    source_id: 'GH-123',
    location: 'Lahore, Pakistan',
  });
  check('Type inferred from intern title', record.opportunityType, 'INTERNSHIP');
  check('Country inferred from Pakistan location', record.country, 'Pakistan');
  check('source+sourceId wins as dedupe key', record.dedupeKey, 'src:greenhouse:gh-123');
  check('URL key strips query string and fragment', record.urlKey, 'https://careers.google.com/jobs/results/123');
  checkTrue('Content hash computed', /^[a-f0-9]{64}$/.test(record.contentHash));

  const urlOnly = dedupeKeyFor({ source: 'unknown', sourceId: null, applicationUrl: 'https://x.com/jobs/1/?a=b' });
  check('URL fallback dedupe key', urlOnly, 'url:https://x.com/jobs/1');

  const fp1 = dedupeKeyFor({ source: '', sourceId: null, company: 'ACME Corp.', title: 'ML Engineer!', location: 'Karachi' });
  const fp2 = dedupeKeyFor({ source: '', sourceId: null, company: 'acme corp', title: 'ml engineer', location: 'Karachi' });
  check('Fingerprint ignores case and punctuation', fp1, fp2);
}

// ── CORE TEST: fetch the same job twice → ONE record, lastSeenAt updated ────
{
  const store = new MemoryOpportunityStore();
  const job = {
    title: 'Backend Engineer Intern',
    company: 'Careem',
    url: 'https://boards.greenhouse.io/careem/jobs/456',
    source_name: 'greenhouse',
    source_id: '456',
    description: 'Build APIs.',
    location: 'Karachi, Pakistan',
  };

  const first = await store.upsert(job, { now: '2026-08-14T06:00:00.000Z' });
  check('First fetch creates a new record', first.isNew, true);
  check('firstDiscoveredAt set on create', first.opportunity.firstDiscoveredAt, '2026-08-14T06:00:00.000Z');

  const second = await store.upsert(job, { now: '2026-08-14T07:00:00.000Z' });
  check('Second fetch is NOT a new record', second.isNew, false);
  check('Same record id both times', second.opportunity.id, first.opportunity.id);
  check('Store still holds exactly one opportunity', await store.count(), 1);
  check('lastSeenAt updated on re-fetch', second.opportunity.lastSeenAt, '2026-08-14T07:00:00.000Z');
  check('lastCheckedAt updated on re-fetch', second.opportunity.lastCheckedAt, '2026-08-14T07:00:00.000Z');
  check('firstDiscoveredAt unchanged on re-fetch', second.opportunity.firstDiscoveredAt, '2026-08-14T06:00:00.000Z');

  // Same job arriving via a different source with no sourceId → matched by URL.
  const viaCareersPage = await store.upsert(
    { title: 'Backend Engineer Intern', company: 'Careem', url: 'https://boards.greenhouse.io/careem/jobs/456/', source_name: 'official-careers' },
    { now: '2026-08-14T08:00:00.000Z' }
  );
  check('Same URL from another source deduplicates', viaCareersPage.isNew, false);
  check('Still one record after cross-source fetch', await store.count(), 1);

  // Content change → update in place, no new record.
  const changed = await store.upsert(
    { ...job, description: 'Build APIs and event pipelines.', deadline: '2026-09-30' },
    { now: '2026-08-14T09:00:00.000Z' }
  );
  check('Changed description updates existing record', changed.opportunity.description, 'Build APIs and event pipelines.');
  check('Deadline update applied', changed.opportunity.deadline, '2026-09-30');
  check('Content change does not create a duplicate', await store.count(), 1);

  // Status change (e.g. liveness check marks it expired).
  const expired = await store.upsert({ ...job, status: 'EXPIRED' }, { now: '2026-08-14T10:00:00.000Z' });
  check('Status change applied', expired.opportunity.status, 'EXPIRED');
  check('isActive follows status', expired.opportunity.isActive, false);
}

// ── touchSeenByUrl: incremental refresh path for already-known URLs ─────────
{
  const store = new MemoryOpportunityStore();
  await store.upsert(
    { title: 'Data Analyst', company: 'HBL', url: 'https://hbl.com/careers/data-analyst-1' },
    { now: '2026-08-14T06:00:00.000Z' }
  );
  const touched = await store.touchSeenByUrl('https://hbl.com/careers/data-analyst-1?ref=scan', { now: '2026-08-14T07:30:00.000Z' });
  check('touchSeenByUrl finds record despite query string', touched, true);
  const { opportunities } = await store.list({});
  check('touchSeenByUrl bumps lastSeenAt without a new row', opportunities[0].lastSeenAt, '2026-08-14T07:30:00.000Z');
  check('touchSeenByUrl on unknown URL is a no-op', await store.touchSeenByUrl('https://nowhere.example/job'), false);
}

// ── Global store, per-user state isolation ──────────────────────────────────
{
  const store = new MemoryOpportunityStore();
  const { opportunity } = await store.upsert({
    title: 'Software Engineer Intern',
    company: 'Google',
    url: 'https://careers.google.com/jobs/789',
  });

  await store.setUserState({ userId: 'user_a', opportunityId: opportunity.id, status: 'SAVED' });
  await store.setUserState({ userId: 'user_b', opportunityId: opportunity.id, status: 'HIDDEN' });

  const forA = await store.list({}, { userId: 'user_a' });
  const forB = await store.list({}, { userId: 'user_b' });
  check('User A sees the opportunity as SAVED', forA.opportunities[0]?.userState, 'SAVED');
  check('User B (hidden) does not see it', forB.opportunities.length, 0);
  check('One global record serves both users', await store.count(), 1);

  const savedA = await store.listUserStates('user_a');
  check('User A has one saved state', savedA.length, 1);
  check('Saved state carries the opportunity', savedA[0].opportunity.id, opportunity.id);

  // APPLIED for A must not affect B.
  await store.setUserState({ userId: 'user_a', opportunityId: opportunity.id, status: 'APPLIED' });
  const statesB = await store.listUserStates('user_b');
  check("User A applying does not change user B's state", statesB[0].status, 'HIDDEN');

  const savedOnly = await store.list({ savedOnly: true }, { userId: 'user_a' });
  check('savedOnly filter returns SAVED/APPLIED rows', savedOnly.opportunities.length, 1);

  await store.clearUserState({ userId: 'user_b', opportunityId: opportunity.id });
  const forBAfter = await store.list({}, { userId: 'user_b' });
  check('Unhide (clear state) restores visibility', forBAfter.opportunities.length, 1);

  let rejected = false;
  try {
    await store.setUserState({ userId: 'user_a', opportunityId: opportunity.id, status: 'BOGUS' });
  } catch {
    rejected = true;
  }
  check('Invalid saved status is rejected', rejected, true);
}

// ── List filters ────────────────────────────────────────────────────────────
{
  const store = new MemoryOpportunityStore();
  await store.upsert({ title: 'ML Intern', company: 'OpenAI', url: 'https://openai.com/careers/1', location: 'Remote' });
  await store.upsert({ title: 'DevOps Engineer', company: 'Systems Limited', url: 'https://systemsltd.com/careers/2', location: 'Lahore, Pakistan' });

  const interns = await store.list({ type: 'INTERNSHIP' });
  check('Type filter returns internships only', interns.opportunities.length, 1);
  const pk = await store.list({ country: 'pakistan' });
  check('Country filter matches case-insensitively', pk.opportunities.length, 1);
  const searched = await store.list({ search: 'systems' });
  check('Search matches company name', searched.opportunities.length, 1);

  await store.upsert(
    {
      title: 'On-site US Engineer',
      company: 'Acme US',
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      location: 'New York, United States',
    },
    { now: '2026-08-16T12:00:00.000Z' }
  );
  const ranked = await store.list({ type: 'JOB' });
  check('Pakistan jobs sort ahead of foreign on-site', ranked.opportunities[0]?.company, 'Systems Limited');
}

{
  const { passesDisplayFilters } = await import(STORE);
  check(
    'Careem Pakistan job passes display filters',
    passesDisplayFilters({
      title: 'Software Engineer II',
      url: 'https://boards.greenhouse.io/careem/jobs/7004825002',
      location: 'Lahore, Pakistan',
      type: 'JOB',
    }),
    true
  );
  check(
    'Bain internships hub fails display filters',
    passesDisplayFilters({
      title: 'Internships & Programs',
      url: 'https://www.bain.com/careers/work-with-us/internships-programs/',
      location: 'Remote',
      type: 'INTERNSHIP',
      remote: true,
    }),
    false
  );
}

// ── Dual-write: discovery persists to global store + tenant feed ────────────
{
  const store = new MemoryOpportunityStore();
  const tenantWrites = [];
  const repository = {
    async upsertDiscovered(record, context) {
      tenantWrites.push({ record, context });
      return { id: `tenant_${tenantWrites.length}`, isNew: true };
    },
    async listKnownUrls() {
      return new Set();
    },
  };
  const dual = createDualWriteRepository({ repository, store });

  const saved = await dual.upsertDiscovered(
    { title: 'QA Intern', company: '10Pearls', url: 'https://10pearls.com/careers/qa-intern' },
    { tenantId: 't1', userId: 'u1' }
  );
  check('Dual-write hits the tenant repository', tenantWrites.length, 1);
  check('Dual-write persists to the global store', await store.count(), 1);
  checkTrue('Dual-write reports the global opportunity id', Boolean(saved.globalOpportunityId));

  await dual.noteSeen('https://10pearls.com/careers/qa-intern');
  const { opportunities } = await store.list({});
  checkTrue('noteSeen bumps lastSeenAt in the global store', Boolean(opportunities[0].lastSeenAt));
}

{
  const store = new MemoryOpportunityStore();
  const created = await store.upsert({
    company: 'Google',
    title: 'Google Internship',
    url: 'https://careers.google.com/jobs/intern-99',
    type: 'INTERNSHIP',
  });
  const byUrl = await store.getByUrl('https://careers.google.com/jobs/intern-99?utm=1');
  check('getByUrl finds the persisted listing', byUrl.id, created.opportunity.id);

  const seenBefore = created.opportunity.lastSeenAt;
  await store.touchChecked(created.opportunity.id, { now: '2026-08-14T18:00:00.000Z' });
  const afterTouch = await store.getById(created.opportunity.id);
  check('touchChecked updates lastCheckedAt', afterTouch.lastCheckedAt, '2026-08-14T18:00:00.000Z');
  check('touchChecked does not change lastSeenAt', afterTouch.lastSeenAt, seenBefore);

  const closed = await store.markStatus(created.opportunity.id, 'CLOSED');
  check('markStatus sets CLOSED', closed.status, 'CLOSED');
  check('CLOSED listing is not active', closed.isActive, false);
  check('CLOSED listing is not deleted', await store.count(), 1);
}
