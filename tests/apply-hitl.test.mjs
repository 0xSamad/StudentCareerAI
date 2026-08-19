import { fail, pass, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const APPLY = pathToFileURL(join(ROOT, 'web/src/lib/apply/multi-url-apply.mjs')).href;
const NOTIFY = pathToFileURL(join(ROOT, 'web/src/lib/apply/apply-notifications.mjs')).href;
const HITL = pathToFileURL(join(ROOT, 'web/src/lib/apply/hitl-state.mjs')).href;

const {
  URL_APPLY_PHASE,
  classifyLiveOutcome,
  createUrlApplyBatch,
  getUrlApplyBatch,
  runUrlApplyBatch,
  resumeUrlApplyJob,
  phaseToQueueState,
  isWaitingPhase,
  resetUrlApplyBatchesForTests,
} = await import(APPLY);
const {
  createApplyNotificationHub,
  buildActionRequiredCard,
  EmailApplyChannel,
  resetApplyNotificationsForTests,
} = await import(NOTIFY);
const { waitUntilHumanChallengeCleared, buildHitlSnapshot, indexUserAnswers, resetHitlStateForTests } = await import(HITL);

console.log('\napply-hitl — human-in-the-loop pause/resume (no CAPTCHA bypass)');

resetUrlApplyBatchesForTests();
resetApplyNotificationsForTests();
resetHitlStateForTests();

{
  const captcha = classifyLiveOutcome({ issues: [{ code: 'captcha-present' }], filledCount: 3 });
  const login = classifyLiveOutcome({ issues: [{ code: 'login-wall' }], filledCount: 0 });
  const email = classifyLiveOutcome({ issues: [{ code: 'email-verification' }], message: 'Check your inbox for a verification code' });
  const info = classifyLiveOutcome({
    waitingFields: [{ fieldId: 'sponsor', label: 'Will you now or in the future require sponsorship?' }],
    filledCount: 4,
  });
  const hint = classifyLiveOutcome({ filledCount: 5, message: 'Continue in Chrome if a password or extra page appears.' });
  if (
    captcha.phase === URL_APPLY_PHASE.CAPTCHA_REQUIRED &&
    login.phase === URL_APPLY_PHASE.LOGIN_REQUIRED &&
    email.phase === URL_APPLY_PHASE.EMAIL_VERIFICATION_REQUIRED &&
    info.phase === URL_APPLY_PHASE.INFORMATION_REQUIRED &&
    hint.phase === URL_APPLY_PHASE.COMPLETED
  ) {
    pass('CAPTCHA / login / email / unknown-question / completed are distinct first-class states');
  } else fail(`classify ${[captcha.phase, login.phase, email.phase, info.phase, hint.phase].join(',')}`);
}

{
  if (
    phaseToQueueState(URL_APPLY_PHASE.LOGIN_REQUIRED) === 'REQUIRES_USER_INPUT' &&
    phaseToQueueState(URL_APPLY_PHASE.EMAIL_VERIFICATION_REQUIRED) === 'REQUIRES_USER_INPUT' &&
    phaseToQueueState(URL_APPLY_PHASE.RUNNING) === 'APPLYING' &&
    isWaitingPhase(URL_APPLY_PHASE.CAPTCHA_REQUIRED)
  ) {
    pass('New HITL phases map onto existing applications.state without a new DB enum');
  } else fail('Phase mapping drifted');
}

function fakeExtract({ url, companyHint, roleHint }) {
  const company = companyHint || (url.includes('microsoft') ? 'Microsoft' : url.includes('google') ? 'Google' : 'Company X');
  const title = roleHint || (url.includes('microsoft') ? 'ML Intern' : url.includes('google') ? 'AI Intern' : 'Data Science Intern');
  return {
    hasDescription: true,
    job: { company, title, role: title, description: `${title} at ${company}. Python internship.`, url },
  };
}

function fakeTailor({ opportunity }) {
  const company = opportunity.company;
  const role = opportunity.title || opportunity.role;
  return {
    cvText: `CV for ${role} at ${company}. Python.`,
    cvHtml: `<p>CV for ${role} at ${company}</p>`,
    coverLetter: `Cover for ${role} at ${company}. Python.`,
    coverHtml: `<p>${company}</p>`,
    usedExistingEngine: true,
  };
}

{
  resetUrlApplyBatchesForTests();
  resetApplyNotificationsForTests();
  const hub = createApplyNotificationHub();
  const notices = [];
  hub.notify = async (payload) => {
    notices.push(payload.kind);
    return [{ channel: 'in_app', status: 'delivered' }];
  };
  const batch = createUrlApplyBatch([
    'https://careers.google.com/jobs/ai-intern',
    'https://careers.microsoft.com/jobs/ml-intern',
    'https://companyx.example/jobs/ds-intern',
  ]);
  await runUrlApplyBatch(batch.id, {
    extractExternalJob: fakeExtract,
    tailorUrlApplyDocuments: fakeTailor,
    notifyHub: hub,
    watchCaptcha: false,
    runStudentCareerLiveApply: async ({ company }) => {
      if (company === 'Microsoft') {
        return {
          filledCount: 2,
          steps: [{ fieldId: 'name', label: 'Name', ok: true }],
          issues: [{ code: 'captcha-present', message: 'Tick the captcha' }],
          waitingFields: [],
          stages: [{ name: 'Personal Information', status: 'complete' }],
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
    withChromeLock: (fn) => fn(),
  });
  const after = getUrlApplyBatch(batch.id);
  const card = after.jobs[1].actionRequired;
  if (
    after.jobs[0].phase === URL_APPLY_PHASE.COMPLETED &&
    after.jobs[1].phase === URL_APPLY_PHASE.CAPTCHA_REQUIRED &&
    after.jobs[2].phase === URL_APPLY_PHASE.COMPLETED &&
    after.jobs[1].snapshot?.status === URL_APPLY_PHASE.CAPTCHA_REQUIRED &&
    card?.title.includes('Action Required') &&
    /CAPTCHA/.test(card.body) &&
    notices.includes('captcha_required')
  ) {
    pass('CAPTCHA pauses only Microsoft; Google and Company X keep running and a snapshot is saved');
  } else fail(`Isolation ${after.jobs.map((j) => j.phase).join(',')} notices=${notices.join(',')}`);
}

{
  resetUrlApplyBatchesForTests();
  const batch = createUrlApplyBatch([
    'https://careers.google.com/jobs/ai-intern',
    'https://careers.microsoft.com/jobs/ml-intern',
    'https://companyx.example/jobs/ds-intern',
  ]);
  await runUrlApplyBatch(batch.id, {
    extractExternalJob: fakeExtract,
    tailorUrlApplyDocuments: fakeTailor,
    watchCaptcha: false,
    runStudentCareerLiveApply: async ({ company }) => {
      if (company === 'Microsoft') {
        return {
          filledCount: 2,
          steps: [{ fieldId: 'name', label: 'Name', ok: true }],
          waitingFields: [{ fieldId: 'sponsor', label: 'Will you now or in the future require sponsorship?' }],
          issues: [],
          message: 'Needs sponsorship answer',
        };
      }
      return { filledCount: 3, steps: [{ fieldId: 'name', label: 'Name', ok: true }], issues: [], message: `${company} filled` };
    },
    listingUrl: { isCredibleListingUrl: () => true },
    withChromeLock: (fn) => fn(),
  });
  const after = getUrlApplyBatch(batch.id);
  if (
    after.jobs[0].phase === URL_APPLY_PHASE.COMPLETED &&
    after.jobs[1].phase === URL_APPLY_PHASE.INFORMATION_REQUIRED &&
    after.jobs[2].phase === URL_APPLY_PHASE.COMPLETED &&
    after.jobs[1].actionRequired?.question?.label.includes('sponsorship')
  ) {
    pass('Unknown sponsorship question pauses only that application');
  } else fail(`Info isolation ${after.jobs.map((j) => j.phase).join(',')}`);
}

{
  resetUrlApplyBatchesForTests();
  const batch = createUrlApplyBatch(['https://careers.microsoft.com/jobs/ml-intern']);
  await runUrlApplyBatch(batch.id, {
    extractExternalJob: fakeExtract,
    tailorUrlApplyDocuments: fakeTailor,
    watchCaptcha: false,
    runStudentCareerLiveApply: async () => ({
      filledCount: 1,
      sessionId: 'sess-ms',
      steps: [{ fieldId: 'name', label: 'Name', ok: true }],
      waitingFields: [{ fieldId: 'sponsor', label: 'Will you now or in the future require sponsorship?' }],
      issues: [],
      stages: [{ name: 'Personal Information', status: 'complete' }],
    }),
    listingUrl: { isCredibleListingUrl: () => true },
    withChromeLock: (fn) => fn(),
  });
  const job = getUrlApplyBatch(batch.id).jobs[0];
  const resumed = await resumeUrlApplyJob(
    batch.id,
    job.id,
    { answers: [{ fieldId: 'sponsor', label: 'Will you now or in the future require sponsorship?', value: 'No' }] },
    {
      continueLiveApply: async ({ userAnswers }) => {
        const value = userAnswers?.byId?.sponsor || '';
        return {
          filledCount: 2,
          sessionId: 'sess-ms',
          steps: [
            { fieldId: 'name', label: 'Name', ok: true },
            { fieldId: 'sponsor', label: 'Sponsorship', ok: value === 'No' },
          ],
          waitingFields: [],
          issues: [],
          message: 'Filled your answer',
        };
      },
      withChromeLock: (fn) => fn(),
      watchCaptcha: false,
    },
  );
  if (resumed.jobs[0].phase === URL_APPLY_PHASE.COMPLETED && resumed.jobs[0].fields.completed.includes('Sponsorship')) {
    pass('User answer is saved, filled, verified, and the application resumes');
  } else fail(`Resume ${resumed.jobs[0].phase} ${JSON.stringify(resumed.jobs[0].fields)}`);
}

{
  resetUrlApplyBatchesForTests();
  const batch = createUrlApplyBatch(['https://careers.microsoft.com/jobs/ml-intern']);
  await runUrlApplyBatch(batch.id, {
    extractExternalJob: fakeExtract,
    tailorUrlApplyDocuments: fakeTailor,
    watchCaptcha: false,
    runStudentCareerLiveApply: async () => ({
      filledCount: 1,
      sessionId: 'sess-cap',
      issues: [{ code: 'captcha-present' }],
      steps: [{ fieldId: 'name', label: 'Name', ok: true }],
      message: 'CAPTCHA',
    }),
    listingUrl: { isCredibleListingUrl: () => true },
    withChromeLock: (fn) => fn(),
  });
  const job = getUrlApplyBatch(batch.id).jobs[0];
  const still = await resumeUrlApplyJob(batch.id, job.id, {}, {
    captchaStillPresent: async () => true,
    continueLiveApply: async () => {
      throw new Error('must not resume while CAPTCHA is visible');
    },
    withChromeLock: (fn) => fn(),
    watchCaptcha: false,
  });
  if (still.jobs[0].phase === URL_APPLY_PHASE.CAPTCHA_REQUIRED) {
    pass('Resume refuses to continue while CAPTCHA is still on the page');
  } else fail(`CAPTCHA still: ${still.jobs[0].phase}`);
}

{
  let polls = 0;
  const result = await waitUntilHumanChallengeCleared({
    stillBlocked: async () => {
      polls += 1;
      return polls < 3;
    },
    isUsable: async () => true,
    intervalMs: 1,
    timeoutMs: 1000,
    sleepFn: async () => {},
  });
  if (result.cleared && result.usable && polls === 3) {
    pass('CAPTCHA watcher only observes the page and resumes after the human completes it');
  } else fail(`Watcher ${JSON.stringify(result)} polls=${polls}`);
}

{
  const email = new EmailApplyChannel();
  const sent = await email.send({ title: '🟡 Action Required', body: 'CAPTCHA', kind: 'captcha_required' });
  if (sent.status === 'skipped' && /not configured/.test(sent.reason)) {
    pass('Email channel is a plug-in stub and does not read API keys');
  } else fail(`Email stub ${JSON.stringify(sent)}`);
}

{
  const snap = buildHitlSnapshot({
    id: 'urljob-1',
    applicationId: 'app-1',
    url: 'https://careers.microsoft.com/jobs/ml-intern',
    phase: URL_APPLY_PHASE.CAPTCHA_REQUIRED,
    stages: [
      { name: 'Personal Information', status: 'complete' },
      { name: 'Education', status: 'complete' },
    ],
    fields: { completed: ['Name', 'Email'], pending: [] },
    waitingFields: [],
    files: { cvName: 'microsoft_ml_intern_tailored_cv.pdf', coverName: 'microsoft_ml_intern_cover_letter.pdf' },
    sessionId: 'sess-1',
  }, 'batch-1');
  const indexed = indexUserAnswers([{ fieldId: 'sponsor', value: 'No' }]);
  if (
    snap.applicationId === 'app-1' &&
    snap.currentUrl.includes('microsoft') &&
    snap.completedStages.includes('Education') &&
    snap.generatedCV &&
    indexed.byId.sponsor === 'No'
  ) {
    pass('Pause snapshot stores stage, URL, documents, and later user answers');
  } else fail(`Snapshot ${JSON.stringify(snap)}`);
}

{
  const card = buildActionRequiredCard({
    phase: URL_APPLY_PHASE.CAPTCHA_REQUIRED,
    company: 'Company X',
    role: 'AI Intern',
    documents: { cvText: 'cv', coverLetter: 'letter' },
    stages: [
      { name: 'Personal Information', status: 'complete' },
      { name: 'Education', status: 'complete' },
      { name: 'Projects', status: 'complete' },
    ],
  });
  if (card.title.includes('Action Required') && card.primaryCta === 'I solved it' && card.body.includes('CAPTCHA')) {
    pass('Action Required copy tells the user to complete CAPTCHA in Chrome');
  } else fail(`Card ${JSON.stringify(card)}`);
}
