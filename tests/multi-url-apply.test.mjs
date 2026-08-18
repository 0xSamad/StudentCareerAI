import { fail, pass, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const MOD = pathToFileURL(join(ROOT, 'web/src/lib/apply/multi-url-apply.mjs')).href;
const {
  URL_APPLY_PHASE,
  parseUrlApplyInputs,
  phaseToQueueState,
  classifyLiveOutcome,
  createUrlApplyBatch,
  getUrlApplyBatch,
  runUrlApplyBatch,
  resetUrlApplyBatchesForTests,
  MAX_URL_APPLY_JOBS,
  takeLocalChromeWork,
  fillUrlApplyJob,
  updateUrlApplyJob,
} = await import(MOD);

console.log('\nmulti-url-apply — independent jobs around existing URL apply');

resetUrlApplyBatchesForTests();

{
  const one = parseUrlApplyInputs(['https://boards.greenhouse.io/acme/jobs/1']);
  const two = parseUrlApplyInputs(['https://a.example/jobs/1', 'https://b.example/jobs/2']);
  const three = parseUrlApplyInputs([
    { url: 'https://a.example/jobs/1' },
    { url: 'https://b.example/jobs/2', company: 'Microsoft', role: 'ML Intern' },
    'https://c.example/jobs/3',
  ]);
  const skippedEmpty = parseUrlApplyInputs(['https://a.example/jobs/1', '  ', { url: '' }]);
  if (one.length === 1 && two.length === 2 && three.length === 3 && skippedEmpty.length === 1) {
    pass('Parses 1, 2, or 3 URLs dynamically and skips blanks');
  } else fail('URL parse did not stay dynamic');
}

{
  if (phaseToQueueState(URL_APPLY_PHASE.CAPTCHA_REQUIRED) === 'REQUIRES_USER_INPUT' && phaseToQueueState(URL_APPLY_PHASE.COMPLETED) === 'DRY_RUN_COMPLETED') {
    pass('Phases map onto existing application states (no new DB enum)');
  } else fail('Phase mapping left existing applications.state');
}

{
  const captcha = classifyLiveOutcome({
    filledCount: 4,
    issues: [{ code: 'captcha-present', message: 'Tick the captcha' }],
    message: 'Chrome is open',
  });
  const filled = classifyLiveOutcome({ filledCount: 6, issues: [], message: 'Filled attested fields' });
  if (captcha.phase === URL_APPLY_PHASE.CAPTCHA_REQUIRED && filled.phase === URL_APPLY_PHASE.COMPLETED) {
    pass('CAPTCHA pauses that job; a successful fill is completed without submitting');
  } else fail('Live outcome classification is wrong');
}

function fakeExtract({ url, pastedDescription, companyHint, roleHint }) {
  if (/fail/.test(url)) {
    const err = new Error('Could not fetch that posting');
    throw err;
  }
  if (/nodesc/.test(url)) {
    return {
      hasDescription: false,
      warning: 'Paste the job description',
      job: { company: 'SparseCo', title: 'Intern', description: '', url },
    };
  }
  const company = companyHint || (url.includes('microsoft') ? 'Microsoft' : url.includes('google') ? 'Google' : 'Company X');
  const title = roleHint || (url.includes('microsoft') ? 'ML Intern' : url.includes('google') ? 'AI Intern' : 'Data Science Intern');
  return {
    hasDescription: true,
    job: {
      company,
      title,
      role: title,
      description: pastedDescription || `${title} at ${company}. Python, SQL, and student internships.`,
      url,
    },
  };
}

function fakeTailor({ opportunity }) {
  return {
    cvText: `CV for ${opportunity.company}`,
    cvHtml: `<html>${opportunity.company}</html>`,
    coverLetter: `Cover for ${opportunity.title} at ${opportunity.company}`,
    coverHtml: `<p>${opportunity.company}</p>`,
    usedExistingEngine: true,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

{
  resetUrlApplyBatchesForTests();
  const batch = createUrlApplyBatch(['https://careers.google.com/jobs/ai-intern']);
  const liveCalls = [];
  await runUrlApplyBatch(batch.id, {
    extractExternalJob: fakeExtract,
    tailorUrlApplyDocuments: fakeTailor,
    runStudentCareerLiveApply: async (args) => {
      liveCalls.push(args.company);
      return {
        filledCount: 5,
        sessionId: 's1',
        steps: [
          { fieldId: 'name', label: 'Name', ok: true },
          { fieldId: 'email', label: 'Email', ok: true },
        ],
        issues: [],
        message: 'Filled attested fields. Nothing was submitted.',
        reviewPath: '/apply/review?company=Google&role=AI Intern',
      };
    },
    listingUrl: { isCredibleListingUrl: () => true },
    withChromeLock: (fn) => fn(),
  });
  const after = getUrlApplyBatch(batch.id);
  if (after.jobs.length === 1 && after.jobs[0].phase === URL_APPLY_PHASE.COMPLETED && after.jobs[0].company === 'Google' && liveCalls.length === 1) {
    pass('One URL becomes one independent completed application');
  } else fail('Single-URL batch did not complete independently');
}

{
  resetUrlApplyBatchesForTests();
  const batch = createUrlApplyBatch([
    'https://careers.google.com/jobs/ai-intern',
    'https://careers.microsoft.com/jobs/ml-intern',
  ]);
  await runUrlApplyBatch(batch.id, {
    extractExternalJob: fakeExtract,
    tailorUrlApplyDocuments: fakeTailor,
    runStudentCareerLiveApply: async ({ company }) => ({
      filledCount: 3,
      steps: [{ fieldId: 'name', label: 'Name', ok: true }],
      issues: [],
      message: `${company} filled`,
    }),
    listingUrl: { isCredibleListingUrl: () => true },
    withChromeLock: (fn) => fn(),
  });
  const after = getUrlApplyBatch(batch.id);
  const companies = after.jobs.map((j) => j.company).sort().join(',');
  if (after.jobs.length === 2 && after.jobs.every((j) => j.phase === URL_APPLY_PHASE.COMPLETED) && companies === 'Google,Microsoft') {
    pass('Two URLs create two independent completed applications');
  } else fail('Two-URL batch did not stay independent');
}

{
  resetUrlApplyBatchesForTests();
  const batch = createUrlApplyBatch([
    'https://careers.google.com/jobs/ai-intern',
    'https://careers.microsoft.com/jobs/ml-intern',
    'https://companyx.example/jobs/ds-intern',
  ]);
  const tailored = [];
  await runUrlApplyBatch(batch.id, {
    extractExternalJob: fakeExtract,
    tailorUrlApplyDocuments: async (args) => {
      tailored.push(args.opportunity.company);
      return fakeTailor(args);
    },
    runStudentCareerLiveApply: async ({ company, role }) => ({
      filledCount: 4,
      steps: [{ fieldId: 'name', label: 'Name', ok: true }],
      issues: [],
      message: `${company} ${role}`,
      reviewPath: `/apply/review?company=${company}`,
    }),
    listingUrl: { isCredibleListingUrl: () => true },
    withChromeLock: (fn) => fn(),
  });
  const after = getUrlApplyBatch(batch.id);
  if (
    after.jobs.length === 3 &&
    after.jobs.every((j) => j.phase === URL_APPLY_PHASE.COMPLETED) &&
    after.jobs[0].role === 'AI Intern' &&
    after.jobs[1].role === 'ML Intern' &&
    after.jobs[2].role === 'Data Science Intern' &&
    tailored.length === 3
  ) {
    pass('Three URLs each get their own job info, documents, and completed state');
  } else fail('Three-URL batch mixed jobs together');
}

{
  resetUrlApplyBatchesForTests();
  const batch = createUrlApplyBatch([
    'https://careers.google.com/jobs/ai-intern',
    'https://fail.example/jobs/broken',
    'https://careers.microsoft.com/jobs/ml-intern',
  ]);
  await runUrlApplyBatch(batch.id, {
    extractExternalJob: fakeExtract,
    tailorUrlApplyDocuments: fakeTailor,
    runStudentCareerLiveApply: async ({ company }) => ({
      filledCount: 2,
      steps: [{ fieldId: 'name', label: 'Name', ok: true }],
      issues: [],
      message: `${company} filled`,
    }),
    listingUrl: { isCredibleListingUrl: () => true },
    withChromeLock: (fn) => fn(),
  });
  const after = getUrlApplyBatch(batch.id);
  const phases = after.jobs.map((j) => j.phase);
  if (phases[0] === URL_APPLY_PHASE.COMPLETED && phases[1] === URL_APPLY_PHASE.FAILED && phases[2] === URL_APPLY_PHASE.COMPLETED) {
    pass('One failed URL does not fail sibling applications');
  } else fail(`Failure isolation broke: ${phases.join(',')}`);
}

{
  resetUrlApplyBatchesForTests();
  const batch = createUrlApplyBatch([
    'https://careers.google.com/jobs/ai-intern',
    'https://careers.microsoft.com/jobs/ml-intern',
    'https://companyx.example/jobs/ds-intern',
  ]);
  const order = [];
  await runUrlApplyBatch(batch.id, {
    extractExternalJob: fakeExtract,
    tailorUrlApplyDocuments: fakeTailor,
    runStudentCareerLiveApply: async ({ company }) => {
      if (company === 'Microsoft') {
        return {
          filledCount: 1,
          steps: [{ fieldId: 'email', label: 'Email', ok: true }],
          issues: [{ code: 'captcha-present', message: 'Tick the captcha' }],
          message: 'CAPTCHA on Microsoft',
        };
      }
      return {
        filledCount: 3,
        steps: [{ fieldId: 'name', label: 'Name', ok: true }],
        issues: [],
        message: `${company} filled`,
      };
    },
    listingUrl: { isCredibleListingUrl: () => true },
    withChromeLock: async (fn) => {
      order.push('lock');
      return fn();
    },
  });
  const after = getUrlApplyBatch(batch.id);
  if (
    after.jobs[0].phase === URL_APPLY_PHASE.COMPLETED &&
    after.jobs[1].phase === URL_APPLY_PHASE.CAPTCHA_REQUIRED &&
    after.jobs[2].phase === URL_APPLY_PHASE.COMPLETED &&
    after.jobs[1].captcha === true
  ) {
    pass('CAPTCHA on one application leaves the others running to completion');
  } else fail(`CAPTCHA isolation broke: ${after.jobs.map((j) => j.phase).join(',')}`);
}

{
  resetUrlApplyBatchesForTests();
  const batch = createUrlApplyBatch(['https://nodesc.example/jobs/intern']);
  await runUrlApplyBatch(batch.id, {
    extractExternalJob: fakeExtract,
    tailorUrlApplyDocuments: fakeTailor,
    runStudentCareerLiveApply: async () => {
      throw new Error('live apply should not run without a JD');
    },
    listingUrl: { isCredibleListingUrl: () => true },
    withChromeLock: (fn) => fn(),
  });
  const after = getUrlApplyBatch(batch.id);
  if (after.jobs[0].phase === URL_APPLY_PHASE.INFORMATION_REQUIRED) {
    pass('Missing JD asks for user information instead of failing the engine');
  } else fail('Missing JD was not INFORMATION_REQUIRED');
}

{
  resetUrlApplyBatchesForTests();
  let concurrent = 0;
  let maxConcurrent = 0;
  const batch = createUrlApplyBatch([
    'https://careers.google.com/jobs/ai-intern',
    'https://careers.microsoft.com/jobs/ml-intern',
  ]);
  await runUrlApplyBatch(batch.id, {
    extractExternalJob: fakeExtract,
    tailorUrlApplyDocuments: fakeTailor,
    runStudentCareerLiveApply: async ({ company }) => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await delay(40);
      concurrent -= 1;
      return { filledCount: 1, steps: [{ fieldId: 'n', label: 'Name', ok: true }], issues: [], message: company };
    },
    listingUrl: { isCredibleListingUrl: () => true },
  });
  if (maxConcurrent >= 2) {
    pass('Chrome fills run at the same time — one tab per URL, not one after the other');
  } else fail(`Chrome fills were serialized (max concurrent ${maxConcurrent})`);
}

{
  resetUrlApplyBatchesForTests();
  let generating = 0;
  let fillWhileSiblingGenerating = false;
  const batch = createUrlApplyBatch([
    'https://careers.google.com/jobs/ai-intern',
    'https://careers.microsoft.com/jobs/ml-intern',
  ]);
  await runUrlApplyBatch(batch.id, {
    extractExternalJob: fakeExtract,
    tailorUrlApplyDocuments: async (args) => {
      generating += 1;
      if (args?.opportunity?.company === 'Google') await delay(80);
      generating -= 1;
      return fakeTailor(args);
    },
    runStudentCareerLiveApply: async ({ company }) => {
      await delay(15);
      if (generating > 0) fillWhileSiblingGenerating = true;
      await delay(20);
      return { filledCount: 1, steps: [{ fieldId: 'n', label: 'Name', ok: true }], issues: [], message: company };
    },
    listingUrl: { isCredibleListingUrl: () => true },
  });
  if (fillWhileSiblingGenerating) {
    pass('A job starts filling as soon as its documents are ready — it does not wait for siblings');
  } else fail('Fills waited for every sibling to finish generating documents');
}

{
  if (MAX_URL_APPLY_JOBS >= 3) pass('UI/API allow more than three URLs');
  else fail('Max URL cap is too low');
}

{
  resetUrlApplyBatchesForTests();
  const batch = createUrlApplyBatch(['https://jobs.lever.co/acme/1'], { userId: 'user-1' });
  const job = getUrlApplyBatch(batch.id).jobs[0];
  updateUrlApplyJob(batch.id, job.id, {
    documents: { cvText: 'cv', coverLetter: 'cover' },
    description: 'Intern role',
    company: 'Acme',
    role: 'Intern',
  });
  const wait = fillUrlApplyJob(batch.id, job.id, {
    useLocalChrome: true,
    localChromeWaitMs: 2500,
    localChromePollMs: 40,
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const work = takeLocalChromeWork('user-1');
  if (work?.action === 'fill' && /lever/.test(work.url || '')) {
    pass('Local Chrome helper claims a queued fill for this computer');
  } else fail('Local Chrome helper did not receive the queued job');
  updateUrlApplyJob(batch.id, job.id, { phase: URL_APPLY_PHASE.COMPLETED, pauseReason: null });
  await wait;
}
