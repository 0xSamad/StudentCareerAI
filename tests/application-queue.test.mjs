import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const QUEUE_MOD = pathToFileURL(join(ROOT, 'lib/saas/application-queue.mjs')).href;
const TENANT_MOD = pathToFileURL(join(ROOT, 'lib/saas/database/tenant-repository.mjs')).href;

console.log('\napplication-queue — per-user selection queue, state machine, no fake submit');

const {
  QUEUE_MACHINE,
  enqueueOpportunities,
  listQueue,
  pauseQueueItem,
  removeQueueItem,
  applyQueueItems,
  mapEngineStatusToQueueState,
  shapeQueueItem,
} = await import(QUEUE_MOD);

const {
  TenantApplicationRepository,
  TenantOpportunityRepository,
} = await import(TENANT_MOD);

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function makeOpp(overrides = {}) {
  return {
    id: 'opp_careem',
    company: 'Careem',
    role: 'Software Engineer Intern',
    title: 'Software Engineer Intern',
    type: 'INTERNSHIP',
    location: 'Lahore, Pakistan',
    url: 'https://boards.greenhouse.io/careem/jobs/123',
    eligibility: 'ELIGIBLE',
    matchScore: 82,
    source: 'Greenhouse',
    source_name: 'Greenhouse',
    source_url: 'https://boards.greenhouse.io/careem/jobs/123',
    market: 'NATIONAL',
    deadline: '2026-09-01',
    ...overrides,
  };
}

function makeContainer() {
  return {
    applicationRepository: new TenantApplicationRepository(),
    opportunityRepository: new TenantOpportunityRepository(),
  };
}

const userA = { tenantId: 'tenant_a', userId: 'user_a' };
const userB = { tenantId: 'tenant_a', userId: 'user_b' };

{
  check('SUBMITTED without timestamp maps to READY', mapEngineStatusToQueueState('SUBMITTED', null), QUEUE_MACHINE.READY);
  check('SUBMITTED with timestamp stays SUBMITTED', mapEngineStatusToQueueState('SUBMITTED', '2026-08-13T00:00:00Z'), QUEUE_MACHINE.SUBMITTED);
  check('DRY_RUN maps to READY', mapEngineStatusToQueueState('DRY_RUN'), QUEUE_MACHINE.READY);
  check('COVER_LETTER_PREPARATION maps through', mapEngineStatusToQueueState('COVER_LETTER_PREPARATION'), QUEUE_MACHINE.COVER_LETTER_PREPARATION);
  check('FAILED maps to FAILED', mapEngineStatusToQueueState('FAILED'), QUEUE_MACHINE.FAILED);
  check('NOT_ELIGIBLE maps to SKIPPED', mapEngineStatusToQueueState('NOT_ELIGIBLE'), QUEUE_MACHINE.SKIPPED);
  check('SKIPPED stays SKIPPED', mapEngineStatusToQueueState('SKIPPED'), QUEUE_MACHINE.SKIPPED);
  check(
    'Skipped cover letter is not treated as ready',
    shapeQueueItem({ id: 'a1', artifacts: { cover_letter: { skipped: true, requirement: 'NOT_NEEDED', body: null } } }).coverLetterStatus,
    'skipped'
  );
}

{
  const container = makeContainer();
  const result = await enqueueOpportunities({
    container,
    authContext: userA,
    opportunities: [makeOpp(), makeOpp({ id: 'opp_ibm', company: 'IBM', url: 'https://ibm.com/jobs/1', role: 'Data Intern' })],
    count: 2,
  });
  check('Enqueue adds 2 items', result.addedCount, 2);
  check('Enqueue does not submit', result.submitted, false);
  check('Enqueue submitted_at is null', result.submitted_at, null);
  check('First item state is SELECTED', result.added[0].applicationStatus, QUEUE_MACHINE.SELECTED);

  const listed = await listQueue({ container, authContext: userA });
  check('List returns user A queue', listed.length, 2);
}

{
  const container = makeContainer();
  await enqueueOpportunities({
    container,
    authContext: userA,
    opportunities: [makeOpp()],
    count: 1,
  });
  await enqueueOpportunities({
    container,
    authContext: userB,
    opportunities: [makeOpp({ id: 'opp_b', url: 'https://example.com/b', company: 'Systems Limited' })],
    count: 1,
  });
  const aList = await listQueue({ container, authContext: userA });
  const bList = await listQueue({ container, authContext: userB });
  check('User A sees only own queue', aList.length, 1);
  check('User B sees only own queue', bList.length, 1);
  check('User A company is Careem', aList[0].company, 'Careem');
  check('User B company is Systems Limited', bList[0].company, 'Systems Limited');
}

{
  const container = makeContainer();
  const enq = await enqueueOpportunities({
    container,
    authContext: userA,
    opportunities: [makeOpp()],
    count: 1,
  });
  const id = enq.added[0].id;
  const paused = await pauseQueueItem({ container, authContext: userA, applicationId: id, reason: 'Wait for transcript' });
  check('Pause sets PAUSED', paused.applicationStatus, QUEUE_MACHINE.PAUSED);

  try {
    await pauseQueueItem({ container, authContext: userB, applicationId: id });
    fail('User B must not pause User A item');
  } catch {
    pass('User B cannot pause User A item');
  }

  const removed = await removeQueueItem({ container, authContext: userA, applicationId: id });
  check('Remove deletes owned item', removed.removed, true);
  const after = await listQueue({ container, authContext: userA });
  check('Queue empty after remove', after.length, 0);
}

{
  const container = makeContainer();
  const enq = await enqueueOpportunities({
    container,
    authContext: userA,
    opportunities: [makeOpp(), makeOpp({ id: 'opp_2', url: 'https://example.com/2', company: 'Arbisoft' })],
    count: 2,
  });

  const fakeSubmit = await applyQueueItems({
    container,
    authContext: userA,
    ids: [enq.added[0].id],
    profile: { identity: { name: 'Ali' } },
    processOpportunityFn: async () => ({
      processed: true,
      status: 'SUBMITTED',
      submitted: false,
      submitted_at: null,
      artifacts: {},
    }),
  });
  check('Fake SUBMITTED without timestamp is not SUBMITTED', fakeSubmit.results[0].applicationStatus, QUEUE_MACHINE.READY);
  check('Apply result submitted flag is false', fakeSubmit.submitted, false);

  const dry = await applyQueueItems({
    container,
    authContext: userA,
    ids: [enq.added[1].id],
    profile: { identity: { name: 'Ali' } },
    processOpportunityFn: async ({ onQueueState }) => {
      await onQueueState('ANALYZING');
      await onQueueState('CV_PREPARATION');
      await onQueueState('APPLICATION_PREPARATION');
      await onQueueState('READY', { artifacts: { tailored_cv: { tailored_html: '<html/>' }, cover_letter: { body: 'Dear team' } } });
      return {
        processed: true,
        status: 'DRY_RUN',
        submitted: false,
        submitted_at: null,
        artifacts: { tailored_cv: { tailored_html: '<html/>' }, cover_letter: { body: 'Dear team' } },
      };
    },
  });
  check('DRY_RUN apply lands in READY', dry.results[0].applicationStatus, QUEUE_MACHINE.READY);
  check('CV status tailored after artifacts', dry.results[0].cvStatus, 'tailored');
  check('Cover letter status ready after artifacts', dry.results[0].coverLetterStatus, 'ready');
}

{
  const container = makeContainer();
  const five = Array.from({ length: 5 }, (_, i) =>
    makeOpp({ id: `opp_${i}`, url: `https://example.com/jobs/${i}`, company: `Co ${i}` })
  );
  const result = await enqueueOpportunities({
    container,
    authContext: userA,
    opportunities: five,
    count: 5,
  });
  check('Configurable count 5 enqueues 5', result.addedCount, 5);

  const dup = await enqueueOpportunities({
    container,
    authContext: userA,
    opportunities: five.slice(0, 1),
    count: 1,
  });
  check('Duplicate enqueue is skipped', dup.addedCount, 0);
  check('Duplicate skip reason recorded', dup.skipped[0].reason, 'already_in_queue');
}

{
  const shaped = shapeQueueItem({
    id: 'x',
    company: 'Acme',
    title: 'Intern',
    state: 'SUBMITTED',
    submitted_at: null,
    eligibility_status: 'ELIGIBLE',
  });
  check('shapeQueueItem refuses fake SUBMITTED', shaped.applicationStatus, QUEUE_MACHINE.READY);
}

{
  const container = makeContainer();
  const result = await enqueueOpportunities({
    container,
    authContext: userA,
    opportunities: [makeOpp({ url: '', source_url: 'https://boards.greenhouse.io/careem/jobs/999' })],
    count: 1,
  });
  check('source_url-only enqueue adds 1', result.addedCount, 1);
  const listed = await listQueue({ container, authContext: userA });
  check('source_url-only item is listed', listed.length, 1);
  check('source_url-only keeps company', listed[0].company, 'Careem');
}

{
  const container = makeContainer();
  const result = await enqueueOpportunities({
    container,
    authContext: userA,
    opportunities: [makeOpp({ url: undefined, source_url: undefined, sourceUrl: 'https://example.com/jobs/camel' })],
    count: 1,
  });
  check('sourceUrl camelCase enqueue adds 1', result.addedCount, 1);
}

{
  const STORE = pathToFileURL(join(ROOT, 'lib/saas/opportunity-store/index.mjs')).href;
  const { MemoryOpportunityStore } = await import(STORE);

  const store = new MemoryOpportunityStore();
  const names = ['Google', 'Microsoft', 'Jazz', 'Systems Limited', 'Company X'];
  const persisted = [];
  for (const company of names) {
    const { opportunity } = await store.upsert({
      company,
      title: `${company} Internship`,
      url: `https://example.com/careers/${company.toLowerCase().replace(/\s+/g, '-')}-intern`,
      type: 'INTERNSHIP',
    });
    persisted.push(opportunity);
  }

  const container = {
    ...makeContainer(),
    opportunityStore: store,
  };

  const enq = await enqueueOpportunities({
    container,
    authContext: userA,
    opportunityIds: persisted.map((o) => o.id),
    count: 5,
  });
  check('Enqueue five internships by opportunityId', enq.addedCount, 5);
  check('Queue item stores opportunityId not a copy-only blob', enq.added[0].opportunityId, persisted[0].id);

  const blobIgnored = await enqueueOpportunities({
    container,
    authContext: userA,
    opportunityIds: ['does-not-exist'],
    opportunities: [{ id: 'does-not-exist', company: 'Fake', title: 'Intern', url: 'https://fake.example/job' }],
    count: 1,
  });
  check('Store present: unknown id is not_found, blob is not source of truth', blobIgnored.skipped[0].reason, 'not_found');

  const later = await applyQueueItems({
    container,
    authContext: userA,
    ids: [persisted[0].id],
    profile: { identity: { name: 'Ali' } },
    processOpportunityFn: async ({ opportunity }) => {
      check('Apply hydrates Google from the store without a scan', opportunity.company, 'Google');
      check(
        'Apply uses the persisted application URL',
        opportunity.url,
        'https://example.com/careers/google-intern'
      );
      return { processed: true, status: 'DRY_RUN', submitted: false, submitted_at: null, artifacts: {} };
    },
  });
  check('Apply from persisted id does not require a discovery scan', later.results[0].applicationStatus, QUEUE_MACHINE.READY);

  await store.markStatus(persisted[1].id, 'CLOSED');
  const closedApply = await applyQueueItems({
    container,
    authContext: userA,
    ids: [persisted[1].id],
    profile: { identity: { name: 'Ali' } },
    processOpportunityFn: async () => {
      throw new Error('must not apply a closed listing');
    },
  });
  check('Closed listing is SKIPPED', closedApply.results[0].applicationStatus, QUEUE_MACHINE.SKIPPED);
  check('Closed listing is not submitted', closedApply.results[0].submitted, false);
  check('Closed listing remains in the store', await store.count(), 5);
  check('Closed listing status stays CLOSED', (await store.getById(persisted[1].id)).status, 'CLOSED');

  const livenessClosed = await applyQueueItems({
    container,
    authContext: userA,
    ids: [persisted[2].id],
    profile: { identity: { name: 'Ali' } },
    verifyLivenessFn: async () => ({ verified: false, status: 'expired', reason: 'No longer accepting applications' }),
    processOpportunityFn: async () => {
      throw new Error('must not apply after liveness CLOSED');
    },
  });
  check('Liveness failure skips apply', livenessClosed.results[0].applicationStatus, QUEUE_MACHINE.SKIPPED);
  check('Liveness failure marks store CLOSED', (await store.getById(persisted[2].id)).status, 'CLOSED');
  check('Liveness failure does not delete the listing', await store.count(), 5);
}

{
  const container = makeContainer();
  const opp = makeOpp({ id: 'store_careem' });
  await enqueueOpportunities({
    container,
    authContext: userA,
    opportunities: [opp],
    count: 1,
  });
  const apps = await container.applicationRepository.findMany({}, userA);
  apps[0].opportunity_id = 'legacy_pg_id';
  apps[0].url = opp.url;
  apps[0].metadata = { ...(apps[0].metadata || {}), globalOpportunityId: 'store_careem', url: opp.url };

  const applied = await applyQueueItems({
    container,
    authContext: userA,
    ids: ['store_careem'],
    profile: { identity: { name: 'Ali' } },
    skipBrowser: true,
    processOpportunityFn: async () => ({ status: 'READY', reason: 'dry', submitted: false }),
  });
  check('Apply by store id finds remapped queue row', applied.processed, 1);
}

