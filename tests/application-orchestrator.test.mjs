import { fail, pass, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const APPLY = pathToFileURL(join(ROOT, 'web/src/lib/apply/multi-url-apply.mjs')).href;
const MANAGER = pathToFileURL(join(ROOT, 'web/src/lib/apply/application-manager.mjs')).href;
const LIVE = join(ROOT, 'web/src/lib/apply/live-from-profile.ts');
const ROUTE = join(ROOT, 'web/src/app/api/opportunities/apply/route.ts');
const CLIENT = join(ROOT, 'web/src/lib/opportunity-client.ts');
const PAGE = join(ROOT, 'web/src/app/apply/page.tsx');
const URL_BAR = join(ROOT, 'web/src/components/apply/url-apply-bar.tsx');
const DASHBOARD = join(ROOT, 'web/src/components/dashboard/dashboard-view.tsx');
const CARD = join(ROOT, 'web/src/components/dashboard/opportunity-card.tsx');

const {
  URL_APPLY_PHASE,
  createUrlApplyBatch,
  getUrlApplyBatch,
  runUrlApplyBatch,
  resumeUrlApplyJob,
  resetUrlApplyBatchesForTests,
} = await import(APPLY);
const {
  withTimeout,
  withRetry,
  classifyApplyError,
  qualityGateApplication,
  applyQualityToOutcome,
  formatActionRequiredEmail,
  formatCompletionEmail,
  setBatchPersistPath,
  resetManagedBatchHydration,
} = await import(MANAGER);

console.log('\napplication-orchestrator — multi-job manager around existing apply engines');

resetUrlApplyBatchesForTests();

function fakeExtract({ url, pastedDescription, companyHint, roleHint }) {
  if (/fail/.test(url)) throw new Error('Could not fetch that posting');
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
    cvText: `CV for ${opportunity.title} at ${opportunity.company}. Python.`,
    cvHtml: `<p>CV for ${opportunity.title} at ${opportunity.company}</p>`,
    coverLetter: `Cover for ${opportunity.title} at ${opportunity.company}. Python.`,
    coverHtml: `<p>${opportunity.company}</p>`,
    usedExistingEngine: true,
  };
}

function liveOk({ company, role }) {
  return {
    filledCount: 4,
    sessionId: `sess-${company}`,
    steps: [
      { fieldId: 'name', label: 'Name', ok: true },
      { fieldId: 'email', label: 'Email', ok: true },
    ],
    issues: [],
    stages: [
      { name: 'Personal Information', status: 'complete' },
      { name: 'Review', status: 'complete' },
    ],
    waitingFields: [],
    message: `${company} ${role} filled. Nothing was submitted.`,
  };
}

const baseDeps = {
  extractExternalJob: fakeExtract,
  tailorUrlApplyDocuments: fakeTailor,
  listingUrl: { isCredibleListingUrl: () => true },
  withChromeLock: (fn) => fn(),
  retryAttempts: 1,
};

{
  const src = readFileSync(ROUTE, 'utf8');
  if (
    src.includes('const isUrlApply = !opportunityId') &&
    src.includes('useFormAgent: isUrlApply') &&
    /runStudentCareerLiveApply\(/.test(src)
  ) {
    pass('In-app Apply still uses POST /api/opportunities/apply with form-agent off when opportunityId is present');
  } else fail('In-app Apply route drifted');
}

{
  const client = readFileSync(CLIENT, 'utf8');
  const card = readFileSync(CARD, 'utf8');
  if (
    client.includes('startListingApplications') &&
    card.includes('startListingApplications') &&
    card.includes('finishApplyLaunch') &&
    card.includes('adoptApplyBatch')
  ) {
    pass('Jobs card Apply shows Application Center progress');
  } else fail('Jobs card Apply did not open the live application window');
}

{
  const watch = readFileSync(join(ROOT, 'web/src/lib/apply/open-watch-window.ts'), 'utf8');
  const applyUrls = readFileSync(join(ROOT, 'web/src/app/api/opportunities/apply-urls/route.ts'), 'utf8');
  if (
    watch.includes('finishApplyLaunch') &&
    watch.includes('Chrome opened on this computer') &&
    applyUrls.includes('liveWindow: applyUsesHeadlessBrowser()')
  ) {
    pass('Local Apply uses headed Chrome on this computer instead of a remote preview');
  } else fail('Local Apply still always opens the remote live window');
}

{
  const panel = readFileSync(join(ROOT, 'web/src/components/apply/multi-url-apply-panel.tsx'), 'utf8');
  const adopt = readFileSync(join(ROOT, 'web/src/lib/apply/adopt-apply-batch.ts'), 'utf8');
  if (
    panel.includes('APPLY_CENTER_ID') &&
    panel.includes('APPLY_BATCH_EVENT') &&
    adopt.includes('scrollIntoView') &&
    adopt.includes('adoptApplyBatch')
  ) {
    pass('Listing Apply reuses Application Center progress from URL apply');
  } else fail('Listing Apply does not show Application Center progress');
}

{
  const windowSrc = readFileSync(join(ROOT, 'web/src/components/apply/apply-live-window.tsx'), 'utf8');
  const liveRoute = readFileSync(join(ROOT, 'web/src/app/api/apply/live/route.ts'), 'utf8');
  const session = readFileSync(join(ROOT, 'web/src/lib/apply/session.ts'), 'utf8');
  const batch = readFileSync(join(ROOT, 'web/src/lib/apply/multi-url-apply.mjs'), 'utf8');
  if (
    windowSrc.includes('image=1') &&
    windowSrc.includes('createObjectURL') &&
    liveRoute.includes('latestLiveJpeg') &&
    liveRoute.includes('dispatchApplyPointerBatch') &&
    !liveRoute.includes('snapshotSession') &&
    session.includes('Page.startScreencast') &&
    /preview:\s*null/.test(batch)
  ) {
    pass('Live application window streams JPEG frames instead of JSON screenshots');
  } else fail('Live application window still polls full JSON screenshots');
}

{
  const page = readFileSync(PAGE, 'utf8');
  const bar = readFileSync(URL_BAR, 'utf8');
  if (page.includes('UrlApplyBar') && page.includes('MultiUrlApplyPanel') && bar.includes('startUrlApplications')) {
    pass('Existing single-URL Apply bar remains on the apply page beside the orchestrator');
  } else fail('URL Apply bar was removed or no longer opens the live application window');
}

{
  const dashboard = readFileSync(DASHBOARD, 'utf8');
  if (dashboard.includes('MultiUrlApplyPanel') && !dashboard.includes('UrlApplyBar')) {
    pass('Dashboard URL apply reuses the Jobs multi-URL apply panel');
  } else fail('Dashboard still uses the single-URL apply bar');
}

{
  const live = readFileSync(LIVE, 'utf8');
  if (
    live.includes('useFormAgent = false') &&
    live.includes('if (!live)') &&
    live.includes('return runStudentCareerLiveApply')
  ) {
    pass('Browser recovery reopens the form through the existing live apply engine when the session is gone');
  } else fail('continueStudentCareerLiveApply no longer falls back to a fresh live apply');
}

{
  const live = readFileSync(LIVE, 'utf8');
  const session = readFileSync(join(ROOT, 'web/src/lib/apply/session.ts'), 'utf8');
  const abortsOnCaptcha = /sessionHasInteractiveCaptcha[\s\S]{0,280}break;/.test(live);
  const gatesAdvanceOnStay =
    /if \(!stayOnPage && empties/.test(live) || /navigation !== ["']stay["'] && empties/.test(live);
  if (
    live.includes('noteCaptcha') &&
    !abortsOnCaptcha &&
    !gatesAdvanceOnStay &&
    live.includes('skipFieldIds: [...touched, ...waitingSeen]') &&
    live.includes('fillableEmpty') &&
    live.includes('PLAN_TURN_BUDGET_MS') &&
    session.includes('FIELD_FILL_BUDGET_MS') &&
    /withBudget\(FIELD_FILL_BUDGET_MS/.test(session)
  ) {
    pass('CAPTCHA is noted without aborting the fill loop');
    pass('A stuck or unknown field is skipped; fill continues and Next is not blocked by stay');
  } else fail('Live apply still freezes on a waiting/stuck field');
}

{
  const email = formatActionRequiredEmail({
    company: 'Microsoft',
    role: 'ML Intern',
    phase: 'CAPTCHA_REQUIRED',
    progress: 72,
    url: 'https://careers.microsoft.com/jobs/ml-intern',
  });
  const done = formatCompletionEmail({ company: 'Google', role: 'AI Intern' });
  if (
    email.subject === 'StudentCareer AI — Action Required' &&
    email.body.includes('ML Intern — Microsoft') &&
    email.body.includes('CAPTCHA required.') &&
    email.body.includes('72%') &&
    email.body.includes('[Open Application]') &&
    done.subject === 'StudentCareer AI — Application Completed' &&
    done.body.includes('AI Intern — Google') &&
    done.body.includes('has been completed.')
  ) {
    pass('Action-required and completion emails match the StudentCareer AI copy');
  } else fail('Notification copy drifted');
}

{
  const ok = qualityGateApplication(
    {
      company: 'Google',
      role: 'AI Intern',
      documents: { cvText: 'CV for Google AI Intern', coverLetter: 'Cover for Google' },
      files: { cvName: 'google_ai_intern_tailored_cv.pdf', coverName: 'google_ai_intern_cover_letter.pdf' },
      captcha: false,
      waitingFields: [],
    },
    { waitingFields: [], issues: [] },
  );
  const blocked = applyQualityToOutcome(
    { company: 'Google', role: 'AI Intern', documents: { cvText: 'generic cv', coverLetter: '' }, files: {} },
    { waitingFields: [], issues: [] },
    { phase: URL_APPLY_PHASE.COMPLETED },
  );
  if (ok.ok && blocked.phase === URL_APPLY_PHASE.WAITING_FOR_USER && blocked.submitted !== true) {
    pass('Quality gate only marks COMPLETED when company, role, CV, cover letter, and attachments check out');
  } else fail(`Quality gate ${ok.ok} ${blocked.phase}`);
}

{
  const timeout = classifyApplyError(new Error('Fetch job timed out after 45ms'));
  const net = classifyApplyError(new Error('fetch failed'));
  const captcha = classifyApplyError(new Error('captcha-present'));
  if (timeout.class === 'TIMEOUT' && timeout.retryable && net.class === 'NETWORK' && captcha.class === 'CAPTCHA' && !captcha.retryable) {
    pass('Errors are classified with retryable timeouts/network and non-retryable CAPTCHA');
  } else fail('Error classification drifted');
}

{
  let n = 0;
  const value = await withRetry(
    async () => {
      n += 1;
      if (n < 2) throw new Error('ECONNRESET');
      return 'ok';
    },
    { attempts: 2, delayMs: 1 },
  );
  let timedOut = false;
  try {
    await withTimeout(async () => new Promise(() => {}), 30, 'Fill application');
  } catch (err) {
    timedOut = /timed out/.test(err instanceof Error ? err.message : '');
  }
  if (value === 'ok' && n === 2 && timedOut) {
    pass('Retries recover from a transient failure and timeouts abort hung steps');
  } else fail(`retry n=${n} timeout=${timedOut}`);
}

{
  resetUrlApplyBatchesForTests();
  const batch = createUrlApplyBatch(['https://careers.google.com/jobs/ai-intern']);
  await runUrlApplyBatch(batch.id, {
    ...baseDeps,
    runStudentCareerLiveApply: async (args) => liveOk(args),
  });
  const job = getUrlApplyBatch(batch.id).jobs[0];
  if (job.phase === URL_APPLY_PHASE.COMPLETED && job.company === 'Google' && job.role === 'AI Intern' && job.qualityGate?.ok) {
    pass('1. One URL completes as its own application without submitting');
  } else fail(`One URL ${job.phase}`);
}

{
  resetUrlApplyBatchesForTests();
  const batch = createUrlApplyBatch([
    'https://careers.google.com/jobs/ai-intern',
    'https://careers.microsoft.com/jobs/ml-intern',
  ]);
  await runUrlApplyBatch(batch.id, { ...baseDeps, runStudentCareerLiveApply: async (args) => liveOk(args) });
  const jobs = getUrlApplyBatch(batch.id).jobs;
  if (jobs.length === 2 && jobs.every((job) => job.phase === URL_APPLY_PHASE.COMPLETED) && jobs[0].company !== jobs[1].company) {
    pass('2. Two URLs stay independent through completion');
  } else fail('Two URL batch mixed jobs');
}

{
  resetUrlApplyBatchesForTests();
  const batch = createUrlApplyBatch([
    'https://careers.google.com/jobs/ai-intern',
    'https://careers.microsoft.com/jobs/ml-intern',
    'https://companyx.example/jobs/ds-intern',
  ]);
  await runUrlApplyBatch(batch.id, { ...baseDeps, runStudentCareerLiveApply: async (args) => liveOk(args) });
  const jobs = getUrlApplyBatch(batch.id).jobs;
  const roles = jobs.map((job) => job.role).join(',');
  const cvs = new Set(jobs.map((job) => job.files?.cvName));
  const covers = new Set(jobs.map((job) => job.files?.coverName));
  if (
    jobs.length === 3 &&
    jobs.every((job) => job.phase === URL_APPLY_PHASE.COMPLETED) &&
    roles === 'AI Intern,ML Intern,Data Science Intern' &&
    cvs.size === 3 &&
    covers.size === 3
  ) {
    pass('3–7. Three different companies get different roles, CVs, and cover letters');
  } else fail(`Isolation roles=${roles} cvs=${cvs.size} covers=${covers.size}`);
}

{
  resetUrlApplyBatchesForTests();
  const batch = createUrlApplyBatch(['https://careers.google.com/jobs/ai-intern']);
  await runUrlApplyBatch(batch.id, {
    ...baseDeps,
    runStudentCareerLiveApply: async () => ({
      ...liveOk({ company: 'Google', role: 'AI Intern' }),
      stages: [
        { name: 'Personal Information', status: 'complete' },
        { name: 'Education', status: 'complete' },
        { name: 'Work Authorization', status: 'complete' },
      ],
    }),
  });
  const job = getUrlApplyBatch(batch.id).jobs[0];
  if (job.currentStage === 'Work Authorization' && job.stages?.length === 3) {
    pass('8. Multi-stage applications expose the current stage on the dashboard job');
  } else fail(`Stages ${job.currentStage} ${JSON.stringify(job.stages)}`);
}

{
  resetUrlApplyBatchesForTests();
  const batch = createUrlApplyBatch([
    'https://careers.google.com/jobs/ai-intern',
    'https://careers.microsoft.com/jobs/ml-intern',
    'https://companyx.example/jobs/ds-intern',
  ]);
  await runUrlApplyBatch(batch.id, {
    ...baseDeps,
    runStudentCareerLiveApply: async ({ company, role }) => {
      if (company === 'Microsoft') {
        return {
          filledCount: 2,
          sessionId: 'sess-ms',
          steps: [{ fieldId: 'name', label: 'Name', ok: true }],
          issues: [{ code: 'captcha-present', message: 'Tick the captcha' }],
          stages: [{ name: 'Personal Information', status: 'complete' }],
          waitingFields: [],
          message: 'CAPTCHA required',
        };
      }
      return liveOk({ company, role });
    },
  });
  const jobs = getUrlApplyBatch(batch.id).jobs;
  if (
    jobs[0].phase === URL_APPLY_PHASE.COMPLETED &&
    jobs[1].phase === URL_APPLY_PHASE.CAPTCHA_REQUIRED &&
    jobs[2].phase === URL_APPLY_PHASE.COMPLETED &&
    jobs[1].actionRequired?.primaryCta === 'I solved it'
  ) {
    pass('9+11. CAPTCHA pauses only that job; siblings keep running to completion');
  } else fail(`CAPTCHA isolation ${jobs.map((job) => job.phase).join(',')}`);
}

{
  resetUrlApplyBatchesForTests();
  const batch = createUrlApplyBatch([
    'https://careers.google.com/jobs/ai-intern',
    'https://careers.microsoft.com/jobs/ml-intern',
  ]);
  await runUrlApplyBatch(batch.id, {
    ...baseDeps,
    runStudentCareerLiveApply: async ({ company, role }) => {
      if (company === 'Microsoft') {
        return {
          filledCount: 2,
          sessionId: 'sess-ms',
          steps: [{ fieldId: 'name', label: 'Name', ok: true }],
          waitingFields: [{ fieldId: 'sponsor', label: 'Will you now or in the future require sponsorship?' }],
          issues: [],
          message: 'Needs sponsorship answer',
        };
      }
      return liveOk({ company, role });
    },
  });
  const jobs = getUrlApplyBatch(batch.id).jobs;
  const resumed = await resumeUrlApplyJob(
    batch.id,
    jobs[1].id,
    { answers: [{ fieldId: 'sponsor', label: 'Will you now or in the future require sponsorship?', value: 'No' }] },
    {
      continueLiveApply: async ({ userAnswers }) => ({
        ...liveOk({ company: 'Microsoft', role: 'ML Intern' }),
        steps: [
          { fieldId: 'name', label: 'Name', ok: true },
          { fieldId: 'sponsor', label: 'Sponsorship', ok: userAnswers?.byId?.sponsor === 'No' },
        ],
      }),
      withChromeLock: (fn) => fn(),
    },
  );
  if (
    jobs[0].phase === URL_APPLY_PHASE.COMPLETED &&
    jobs[1].phase === URL_APPLY_PHASE.INFORMATION_REQUIRED &&
    resumed.jobs[1].phase === URL_APPLY_PHASE.COMPLETED
  ) {
    pass('10+12. Unknown question pauses one job; answering resumes only that application');
  } else fail(`Unknown question ${jobs.map((j) => j.phase).join(',')} resume=${resumed.jobs[1].phase}`);
}

{
  resetUrlApplyBatchesForTests();
  const batch = createUrlApplyBatch([
    'https://careers.google.com/jobs/ai-intern',
    'https://fail.example/jobs/broken',
    'https://careers.microsoft.com/jobs/ml-intern',
  ]);
  await runUrlApplyBatch(batch.id, { ...baseDeps, runStudentCareerLiveApply: async (args) => liveOk(args) });
  const jobs = getUrlApplyBatch(batch.id).jobs;
  if (jobs[0].phase === URL_APPLY_PHASE.COMPLETED && jobs[1].phase === URL_APPLY_PHASE.FAILED && jobs[2].phase === URL_APPLY_PHASE.COMPLETED && jobs[1].errorClass) {
    pass('13. A failed URL is classified and does not fail sibling applications');
  } else fail(`Failure ${jobs.map((job) => job.phase).join(',')} class=${jobs[1].errorClass}`);
}

{
  resetUrlApplyBatchesForTests();
  const dir = mkdtempSync(join(tmpdir(), 'co-apply-batches-'));
  const file = join(dir, 'apply-batches.json');
  setBatchPersistPath(file);
  const batch = createUrlApplyBatch(['https://careers.google.com/jobs/ai-intern']);
  await runUrlApplyBatch(batch.id, { ...baseDeps, runStudentCareerLiveApply: async (args) => liveOk(args) });
  const id = batch.id;
  resetUrlApplyBatchesForTests();
  setBatchPersistPath(file);
  const restored = getUrlApplyBatch(id);
  const resumed = await resumeUrlApplyJob(
    id,
    restored.jobs[0].id,
    { captchaCleared: true },
    {
      continueLiveApply: async ({ sessionId }) => {
        if (!sessionId) return liveOk({ company: 'Google', role: 'AI Intern' });
        return liveOk({ company: 'Google', role: 'AI Intern' });
      },
      withChromeLock: (fn) => fn(),
    },
  );
  setBatchPersistPath('');
  resetManagedBatchHydration();
  rmSync(dir, { recursive: true, force: true });
  if (restored?.jobs?.[0]?.company === 'Google' && restored.jobs[0].files?.cvName && resumed.jobs[0].phase === URL_APPLY_PHASE.COMPLETED) {
    pass('14. Crash recovery restores persisted job state and can resume without restarting the whole batch');
  } else fail(`Recovery restored=${Boolean(restored)} phase=${resumed?.jobs?.[0]?.phase}`);
}
