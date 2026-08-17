// tests/application-workflow.test.mjs — Independent 20-step apply workflow
import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const MOD = pathToFileURL(join(ROOT, 'lib/saas/application-workflow.mjs')).href;
const QUEUE = pathToFileURL(join(ROOT, 'lib/saas/application-queue.mjs')).href;
const TENANT = pathToFileURL(join(ROOT, 'lib/saas/database/tenant-repository.mjs')).href;

console.log('\napplication-workflow — independent per-application apply, no fake success');

const {
  WORKFLOW_STATUS,
  SKIP_REASON,
  runApplicationWorkflow,
  runApplicationBatch,
  deadlineHasPassed,
  findDuplicateApplication,
  summarizeWorkflowOutcome,
  summarizeBatch,
} = await import(MOD);

const { applyQueueItems, QUEUE_MACHINE } = await import(QUEUE);
const { TenantApplicationRepository } = await import(TENANT);

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const liveFn = async () => ({ verified: true, status: 'active', reason: 'Listed on ATS API' });

function profile(overrides = {}) {
  return {
    identity: { name: 'Ali Hassan', email: 'ali@example.com' },
    education: [{ university: 'LUMS', degree: 'BS', major: 'CS', gpa: 3.8, graduation_year: 2027 }],
    skills: { programming_languages: ['Python', 'JavaScript'], frameworks: ['React'] },
    experience: { internships: [{ company: 'Arbisoft', role: 'Intern' }] },
    preferences: {
      locations: { preferred: ['Lahore'], remote: true, on_site: true },
      sponsorship: { needs_sponsorship: false, visa_status: 'citizen' },
    },
    ...overrides,
  };
}

function opp(overrides = {}) {
  return {
    id: 'opp_1',
    company: 'Careem',
    title: 'Software Engineer Intern',
    url: 'https://boards.greenhouse.io/careem/jobs/123',
    description: 'Python internship in Lahore. Remote ok.',
    ...overrides,
  };
}

{
  check('Past deadline detected', deadlineHasPassed({ deadline: '2020-01-01' }, {}, new Date('2026-08-13')).passed, true);
  check('Open deadline allowed', deadlineHasPassed({ deadline: '2026-12-31' }, {}, new Date('2026-08-13')).passed, false);
  const dup = findDuplicateApplication(
    opp(),
    [{ id: 'a1', opportunity_id: 'opp_1', state: 'SUBMITTED', submitted_at: '2026-08-01T00:00:00Z' }]
  );
  check('Duplicate submitted application found', Boolean(dup), true);
  check(
    'CAPTCHA outcome label',
    summarizeWorkflowOutcome({ status: 'REQUIRES_USER_INPUT', pause_reason: 'CAPTCHA' }),
    'CAPTCHA → requires user'
  );
  check(
    'Ineligible outcome label',
    summarizeWorkflowOutcome({ status: 'SKIPPED', skipReason: 'NOT_ELIGIBLE' }),
    'ineligible → skipped'
  );
}

{
  const closed = await runApplicationWorkflow({
    opportunity: opp(),
    profile: profile(),
    cvText: '# Ali\nPython intern at Arbisoft',
    skipBrowser: true,
    verifyLivenessFn: async () => ({ verified: false, status: 'expired', reason: 'ATS 404' }),
  });
  check('Closed posting is skipped', closed.status, WORKFLOW_STATUS.SKIPPED);
  check('Closed skip reason', closed.skipReason, SKIP_REASON.CLOSED);
  check('Closed is not submitted', closed.submitted, false);
}

{
  const expired = await runApplicationWorkflow({
    opportunity: opp({ deadline: '2020-06-01' }),
    profile: profile(),
    cvText: '# Ali',
    skipBrowser: true,
    verifyLivenessFn: liveFn,
    now: new Date('2026-08-13'),
  });
  check('Past deadline is skipped', expired.status, WORKFLOW_STATUS.SKIPPED);
  check('Deadline skip reason', expired.skipReason, SKIP_REASON.DEADLINE_PASSED);
}

{
  const duplicate = await runApplicationWorkflow({
    opportunity: opp(),
    profile: profile(),
    cvText: '# Ali',
    skipBrowser: true,
    verifyLivenessFn: liveFn,
    existingApplications: [
      { id: 'prev', opportunity_id: 'opp_1', state: 'SUBMITTED', submitted_at: '2026-08-01T00:00:00Z' },
    ],
  });
  check('Duplicate is skipped', duplicate.status, WORKFLOW_STATUS.SKIPPED);
  check('Duplicate skip reason', duplicate.skipReason, SKIP_REASON.DUPLICATE);
}

{
  const ineligible = await runApplicationWorkflow({
    opportunity: opp({ description: 'Minimum GPA: 3.9 required. Python internship.' }),
    profile: profile({ education: [{ university: 'LUMS', degree: 'BS', major: 'CS', gpa: 2.1, graduation_year: 2027 }] }),
    cvText: '# Ali',
    skipBrowser: true,
    verifyLivenessFn: liveFn,
  });
  check('Ineligible is skipped', ineligible.status, WORKFLOW_STATUS.SKIPPED);
  check('Ineligible skip reason', ineligible.skipReason, SKIP_REASON.NOT_ELIGIBLE);
  check('Ineligible is not fake-submitted', ineligible.submitted, false);
}

{
  const prepared = await runApplicationWorkflow({
    opportunity: opp(),
    profile: profile(),
    cvText: '# Ali Hassan\nPython intern at Arbisoft',
    skipBrowser: true,
    verifyLivenessFn: liveFn,
    autoApply: false,
  });
  check('Eligible package is READY not SUBMITTED when AUTO_APPLY is off', prepared.status, WORKFLOW_STATUS.READY);
  check('READY has no submitted_at', prepared.submitted_at, null);
  check('Step 1 ran', prepared.steps.some((s) => s.step === 1), true);
  check('Eligibility step ran', prepared.steps.some((s) => s.step === 4 && s.result === 'PASS'), true);
  check('Match step ran', prepared.steps.some((s) => s.step === 5), true);
  check('CV analysis ran', prepared.steps.some((s) => s.step === 7), true);
}

{
  const captchaPage = {
    content: async () => '<html><body><div class="g-recaptcha">please verify you are human</div></body></html>',
  };
  const paused = await runApplicationWorkflow({
    opportunity: opp(),
    profile: profile(),
    cvText: '# Ali Hassan\nPython intern at Arbisoft',
    skipBrowser: true,
    page: captchaPage,
    verifyLivenessFn: liveFn,
    autoApply: true,
  });
  check('CAPTCHA requires user', paused.status, WORKFLOW_STATUS.REQUIRES_USER_INPUT);
  check('CAPTCHA pause_reason', paused.pause_reason, 'CAPTCHA');
  check('CAPTCHA was not submitted', paused.submitted, false);
  check('CAPTCHA outcome text', paused.outcome.includes('CAPTCHA'), true);
}

{
  const batch = await runApplicationBatch({
    profile: profile(),
    cvText: '# Ali Hassan\nPython intern at Arbisoft',
    autoApply: false,
    skipBrowser: true,
    existingApplications: [],
    items: [
      { opportunity: opp({ id: 'o1', company: 'Careem', url: 'https://example.com/1' }), verifyLivenessFn: liveFn },
      {
        opportunity: opp({ id: 'o2', company: 'Acme', url: 'https://example.com/2' }),
        page: { content: async () => '<div class="g-recaptcha">please verify you are human</div>' },
        verifyLivenessFn: liveFn,
      },
      { opportunity: opp({ id: 'o3', company: 'IBM', url: 'https://example.com/3' }), verifyLivenessFn: liveFn },
      {
        opportunity: opp({
          id: 'o4',
          company: 'ClosedCo',
          url: 'https://example.com/4',
          description: 'Minimum GPA: 3.9 required.',
        }),
        verifyLivenessFn: liveFn,
      },
      { opportunity: opp({ id: 'o5', company: 'Systems Limited', url: 'https://example.com/5' }), verifyLivenessFn: liveFn },
    ],
  });

  check('Batch processed all 5', batch.processed, 5);
  check('Item 2 CAPTCHA did not stop the batch', batch.results.length, 5);
  check('Item 2 requires user', batch.results[1].status, WORKFLOW_STATUS.REQUIRES_USER_INPUT);
  check('Item 4 ineligible skipped', batch.results[3].status, WORKFLOW_STATUS.SKIPPED);
  check('Item 4 skip reason ineligible', batch.results[3].skipReason, SKIP_REASON.NOT_ELIGIBLE);
  check('No fake SUBMITTED in dry-run batch', batch.results.every((r) => r.status !== WORKFLOW_STATUS.SUBMITTED), true);
  check('Item 1 continued after item 2 pause', batch.results[2].status === WORKFLOW_STATUS.READY || batch.results[2].status === WORKFLOW_STATUS.REQUIRES_USER_INPUT, true);
  check('Item 5 processed after ineligible skip', batch.results[4].ok, true);

  const summary = summarizeBatch(batch.results);
  check('Summary counts 5', summary.total, 5);
  check('Summary headline mentions processed', summary.headline.includes('Processed 5'), true);
}

{
  const repo = new TenantApplicationRepository();
  const container = { applicationRepository: repo, opportunityRepository: { findById: async () => null } };
  const auth = { tenantId: 't', userId: 'u' };
  const rec = await repo.create(
    {
      opportunity_id: 'opp_iso',
      company: 'Careem',
      title: 'Intern',
      state: QUEUE_MACHINE.SELECTED,
      url: 'https://example.com/iso',
    },
    auth
  );
  const boom = await applyQueueItems({
    container,
    authContext: auth,
    ids: [rec.id],
    profile: profile(),
    cvText: '# Ali',
    processOpportunityFn: async () => {
      throw new Error('browser exploded');
    },
  });
  check('Thrown apply is FAILED not silent', boom.results[0].applicationStatus, QUEUE_MACHINE.FAILED);
  check('Thrown apply is not submitted', boom.results[0].submitted, false);
}

{
  const rec2 = await applyQueueItems({
    container: {
      applicationRepository: new TenantApplicationRepository(),
      opportunityRepository: { findById: async () => null },
    },
    authContext: { tenantId: 't', userId: 'u2' },
    ids: [],
    all: true,
    profile: profile(),
    processOpportunityFn: async () => ({ status: 'SUBMITTED', submitted: true, submitted_at: null }),
  });
  check('Empty queue processes 0', rec2.processed, 0);
}

{
  const repo = new TenantApplicationRepository();
  const auth = { tenantId: 't', userId: 'u3' };
  const a = await repo.create(
    { opportunity_id: 'a', company: 'One', title: 'A', state: QUEUE_MACHINE.SELECTED, url: 'https://example.com/a' },
    auth
  );
  const b = await repo.create(
    { opportunity_id: 'b', company: 'Two', title: 'B', state: QUEUE_MACHINE.SELECTED, url: 'https://example.com/b' },
    auth
  );
  const mixed = await applyQueueItems({
    container: { applicationRepository: repo, opportunityRepository: { findById: async () => null } },
    authContext: auth,
    all: true,
    profile: profile(),
    processOpportunityFn: async ({ rawOpportunity }) => {
      if (rawOpportunity.company === 'One') throw new Error('first failed');
      return { processed: true, status: 'DRY_RUN', submitted: false, submitted_at: null, artifacts: {} };
    },
  });
  check('Isolation: both items returned', mixed.processed, 2);
  const byCompany = Object.fromEntries(mixed.results.map((r) => [r.company, r.applicationStatus]));
  check('Isolation: first FAILED', byCompany.One, QUEUE_MACHINE.FAILED);
  check('Isolation: second still READY', byCompany.Two, QUEUE_MACHINE.READY);
}
