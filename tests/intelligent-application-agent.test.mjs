// tests/intelligent-application-agent.test.mjs — Intelligent Application Agent
import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const MOD = pathToFileURL(join(ROOT, 'lib/application-agent.mjs')).href;
const CLASSIFIER = pathToFileURL(join(ROOT, 'lib/saas/application-agent/field-classifier.mjs')).href;
const RESOLVER = pathToFileURL(join(ROOT, 'lib/saas/application-agent/knowledge-resolver.mjs')).href;

console.log('\nintelligent-application-agent — semantic classification, knowledge, DRY_RUN, PAUSE');

const {
  SESSION_STATUS,
  classifyApplicationField,
  verifyPreFlight,
  mapFieldToAnswer,
  runApplicationAgent,
  canSafelySubmit,
  FIELD_INTENT,
} = await import(MOD);
const { classifyApplicationField: classifyDirect } = await import(CLASSIFIER);
const { resolveFieldFromKnowledge } = await import(RESOLVER);

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function makeOpportunity(overrides = {}) {
  return {
    id: 'opp_ia',
    title: 'Software Engineer Intern',
    company: 'Careem',
    url: 'https://boards.greenhouse.io/careem/jobs/45678',
    eligibility_status: 'ELIGIBLE',
    ...overrides,
  };
}

function makeApplicationRecord(overrides = {}) {
  return {
    opportunity_id: 'opp_ia',
    tailored_cv: { tailored_html: '<html><body>CV</body></html>' },
    cover_letter: {
      body: 'I want to join Careem because my attested internships in mobility software match this role.',
    },
    application_answers: [
      {
        question: 'Full name',
        answer: 'Ali Hassan',
        confidence: 1.0,
        requires_user_input: false,
        sensitive: false,
        category: 'name',
      },
      {
        question: 'Email address',
        answer: 'ali@example.com',
        confidence: 1.0,
        requires_user_input: false,
        sensitive: false,
        category: 'email',
      },
    ],
    ...overrides,
  };
}

console.log('\n  1. Semantic field classification');
{
  const motivationField = { label: 'Why do you want to join our team?', type: 'textarea' };
  const motivation = classifyApplicationField(motivationField);
  check('Motivation question intent', motivation.intent, FIELD_INTENT.MOTIVATION_QUESTION);
  check('Motivation classifier export matches module', classifyDirect(motivationField).intent, FIELD_INTENT.MOTIVATION_QUESTION);

  const workAuth = classifyApplicationField({
    label: 'Are you legally authorized to work in the United States?',
    type: 'radio',
  });
  check('Work authorization intent', workAuth.intent, FIELD_INTENT.WORK_AUTHORIZATION);
  check('Work authorization is sensitive', workAuth.isSensitive, true);

  const resume = classifyApplicationField({
    label: 'Resume',
    name: 'resume',
    type: 'file',
  });
  check('Resume file intent', resume.intent, FIELD_INTENT.CV_UPLOAD);

  const coverFile = classifyApplicationField({
    label: 'Upload your cover letter',
    type: 'file',
  });
  check('Cover letter file intent', coverFile.intent, FIELD_INTENT.COVER_LETTER_UPLOAD);
}

console.log('\n  2. Unknown work authorization is never guessed');
{
  const rec = makeApplicationRecord();
  const field = {
    label: 'Are you legally authorized to work in the United States?',
    name: 'work_auth',
    required: true,
    type: 'radio',
  };
  const mapped = mapFieldToAnswer(field, rec);
  check('Work auth mapping requires user input', mapped.requires_user_input, true);
  check('Work auth mapping is sensitive', mapped.sensitive, true);
  check('Work auth answer is empty (no guess)', mapped.answer, '');

  const knowledge = {
    async retrieveRelevantEvidence() {
      return { status: 'UNKNOWN', facts: [], evidence: [], reason: 'UNKNOWN' };
    },
    async getCandidateContextForOpportunity() {
      return { evidencePackets: [], matchingProjects: [] };
    },
  };
  const resolved = await resolveFieldFromKnowledge({
    field,
    classification: classifyApplicationField(field),
    applicationRecord: rec,
    candidateKnowledgeService: knowledge,
    authContext: { tenantId: 't', userId: 'u' },
  });
  check('Knowledge resolver does not guess work auth', resolved.requires_user_input, true);
  check('Knowledge resolver work-auth answer empty', resolved.answer, '');
}

console.log('\n  3. Motivation question uses attested cover letter, never fabricates');
{
  const rec = makeApplicationRecord();
  const field = { label: 'Why do you want to join our team?', type: 'textarea' };
  const resolved = await resolveFieldFromKnowledge({
    field,
    classification: classifyApplicationField(field),
    applicationRecord: rec,
  });
  check('Motivation uses cover letter', resolved.requires_user_input, false);
  check('Motivation answer is attested letter', resolved.answer.includes('attested internships'), true);

  const skipped = makeApplicationRecord({
    cover_letter: { skipped: true, requirement: 'NOT_NEEDED', body: null },
  });
  const knowledge = {
    async getCandidateContextForOpportunity() {
      return { evidencePackets: [], matchingProjects: [] };
    },
    async retrieveRelevantEvidence() {
      return { status: 'UNKNOWN', facts: [], evidence: [] };
    },
  };
  const unknownMotivation = await resolveFieldFromKnowledge({
    field,
    classification: classifyApplicationField(field),
    applicationRecord: skipped,
    candidateKnowledgeService: knowledge,
    authContext: { tenantId: 't', userId: 'u' },
    opportunity: { title: 'Intern', company: 'Careem' },
  });
  check('Unknown motivation requires user input', unknownMotivation.requires_user_input, true);
  check('Unknown motivation is not guessed', unknownMotivation.answer, '');
}

console.log('\n  4. Skipped cover letter does not fail preflight');
{
  const opp = makeOpportunity();
  const rec = makeApplicationRecord({
    cover_letter: { skipped: true, requirement: 'NOT_NEEDED', body: null },
    cover_letter_decision: { skipped: true, requirement: 'NOT_NEEDED' },
  });
  const pre = verifyPreFlight({ opportunity: opp, applicationRecord: rec, existingApplications: [] });
  check('Skipped cover letter preflight passed', pre.passed, true);
  check('correct_cover_letter when skipped', pre.checks.correct_cover_letter, true);

  const session = await runApplicationAgent({
    opportunity: opp,
    applicationRecord: rec,
    page: {
      content: async () => '<html><body><form></form></body></html>',
      evaluate: async () => [],
    },
  });
  check('Skipped cover letter is not uploaded', session.upload_log.some((u) => u.type === 'COVER_LETTER'), false);
  check('Skipped cover letter DRY_RUN ready', session.status, SESSION_STATUS.READY_TO_SUBMIT);
}

console.log('\n  5. DRY_RUN never submits; canSafelySubmit blocks dry-run');
{
  const sessionLike = {
    dry_run: true,
    unanswered_fields: [],
    validation_errors: [],
    pause_reason: null,
  };
  const safety = canSafelySubmit(sessionLike, { liveSubmit: false });
  check('DRY_RUN cannot submit', safety.ok, false);

  const liveBlocked = canSafelySubmit(
    { dry_run: false, unanswered_fields: [{ sensitive: true, field: { required: true } }], validation_errors: [], pause_reason: null },
    { liveSubmit: true }
  );
  check('Sensitive unanswered cannot submit', liveBlocked.ok, false);
}

console.log('\n  6. Playwright: label/ARIA fill (no hardcoded ids) + DRY_RUN no submit');
{
  const fixture = pathToFileURL(join(ROOT, 'tests', 'fixtures', 'semantic-label-form.html')).href;
  const rec = makeApplicationRecord();
  const opp = makeOpportunity({ company: 'Example Corp' });
  let browser;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(fixture, { waitUntil: 'domcontentloaded' });

    const session = await runApplicationAgent({
      opportunity: opp,
      applicationRecord: rec,
      page,
      liveSubmit: false,
    });

    check('Semantic form DRY_RUN flag', session.dry_run, true);
    check('Semantic form did not submit', session.status !== SESSION_STATUS.SUBMITTED, true);
    check('Semantic form extracted a name field without relying on #id', session.fields.some((f) => /full name/i.test(f.label || '')), true);
    check(
      'Semantic form classified motivation',
      session.fields.some((f) => /join our team/i.test(`${f.label || ''} ${f.accessibleName || ''} ${f.ariaLabel || ''}`)),
      true
    );
    check(
      'Semantic fill log is DRY_RUN or REQUIRES_USER_INPUT',
      session.fill_log.every((e) => String(e.action).includes('DRY_RUN') || e.action === 'REQUIRES_USER_INPUT'),
      true
    );
    check('Semantic action log is populated', session.action_log.length > 0, true);
    const submitClicked = await page.evaluate(() => document.querySelector('form')?.dataset.submitted === '1');
    check('Semantic form submit was not clicked', submitClicked, false);

    const nameValue = await page.locator('input[name="applicant_name"]').inputValue();
    check('Semantic form filled name via label', nameValue, 'Ali Hassan');
  } catch (err) {
    fail(`Semantic Playwright fixture failed: ${err.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

console.log('\n  7. Playwright: unknown work authorization PAUSE, never submit');
{
  const fixture = pathToFileURL(join(ROOT, 'tests', 'fixtures', 'gated-apply-form.html')).href;
  const rec = makeApplicationRecord();
  const opp = makeOpportunity({ company: 'Example Corp' });
  let browser;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(fixture, { waitUntil: 'domcontentloaded' });

    const session = await runApplicationAgent({
      opportunity: opp,
      applicationRecord: rec,
      page,
      liveSubmit: false,
    });

    check('Work-auth form paused', session.status, SESSION_STATUS.PAUSED);
    check('Work-auth pause reason', session.pause_reason, 'SENSITIVE_QUESTION');
    check('Work-auth unanswered is sensitive', session.unanswered_fields.some((u) => u.sensitive), true);
    const yesChecked = await page.locator('input[name="work_auth"][value="yes"]').isChecked().catch(() => false);
    const noChecked = await page.locator('input[name="work_auth"][value="no"]').isChecked().catch(() => false);
    check('Work-auth was not guessed (neither radio selected)', yesChecked === false && noChecked === false, true);
    const submitClicked = await page.evaluate(() => document.querySelector('form')?.dataset.submitted === '1');
    check('Gated form submit was not clicked', submitClicked, false);
  } catch (err) {
    fail(`Gated Playwright fixture failed: ${err.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

console.log('\n  8. CAPTCHA HTML pauses and never bypasses');
{
  const session = await runApplicationAgent({
    opportunity: makeOpportunity(),
    applicationRecord: makeApplicationRecord(),
    page: {
      content: async () => '<html><body><div class="g-recaptcha">please verify you are human</div></body></html>',
    },
  });
  check('CAPTCHA session is PAUSED', session.status, SESSION_STATUS.PAUSED);
  check('CAPTCHA pause_reason', session.pause_reason, 'CAPTCHA');
  check('CAPTCHA never submitted', session.status !== SESSION_STATUS.SUBMITTED, true);
}

