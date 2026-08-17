// tests/application-agent.test.mjs — Application Agent Test Suite
import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const MOD = pathToFileURL(join(ROOT, 'lib/application-agent.mjs')).href;
console.log('\napplication-agent — browser-based application agent (Playwright-driven)');

const {
  ApplicationSession,
  SESSION_STATUS,
  detectATS,
  detectSecurityObstacles,
  verifyPreFlight,
  mapFieldToAnswer,
  runApplicationAgent,
  ApplicationAgentError,
} = await import(MOD);

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOpportunity(overrides = {}) {
  return {
    id: 'opp_123',
    title: 'Software Engineer Intern',
    company: 'Careem',
    url: 'https://boards.greenhouse.io/careem/jobs/45678',
    eligibility_status: 'ELIGIBLE',
    ...overrides,
  };
}

function makeApplicationRecord(overrides = {}) {
  return {
    opportunity_id: 'opp_123',
    opportunity_title: 'Software Engineer Intern',
    opportunity_company: 'Careem',
    provider_used: 'gemini',
    model_used: 'gemini-3.6-flash',
    tailored_cv: {
      tailored_html: '<html><body>CV Content</body></html>',
    },
    cover_letter: {
      body: 'Dear Hiring Manager, I am applying for the Software Engineer Intern role...',
    },
    application_answers: [
      {
        question: 'What is your full name?',
        answer: 'Ali Hassan',
        confidence: 1.0,
        requires_user_input: false,
        sensitive: false,
        category: 'name',
      },
      {
        question: 'Why do you want to join Careem?',
        answer: 'Careem is transforming transport in the region.',
        confidence: 0.85,
        requires_user_input: false,
        sensitive: false,
        category: 'why_company',
      },
    ],
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// 1. ApplicationSession schema & lifecycle
// ═══════════════════════════════════════════════════════════════
console.log('\n  1. ApplicationSession schema & lifecycle');
{
  const session = new ApplicationSession({
    opportunity_id: 'opp_99',
    url: 'https://jobs.lever.co/test/123',
    company: '10Pearls',
    job_title: 'Backend Intern',
  });

  check('session_id exists', typeof session.session_id, 'string');
  check('company', session.company, '10Pearls');
  check('job title', session.job, 'Backend Intern');
  check('ats detected', session.ats, 'lever');
  check('dry_run is true', session.dry_run, true);
  check('initial status', session.status, SESSION_STATUS.SKIPPED);

  session.complete(SESSION_STATUS.READY_TO_SUBMIT, 'All tests passed');
  check('final status', session.status, SESSION_STATUS.READY_TO_SUBMIT);
  check('end_time populated', typeof session.end_time, 'string');
  check('status_reason set', session.status_reason, 'All tests passed');

  const json = session.toJSON();
  check('toJSON has session_id', json.session_id, session.session_id);
  check('toJSON has dry_run = true', json.dry_run, true);
}

// ═══════════════════════════════════════════════════════════════
// 2. ATS Detection
// ═══════════════════════════════════════════════════════════════
console.log('\n  2. ATS Detection');
{
  const cases = [
    ['https://boards.greenhouse.io/careem/jobs/123', 'greenhouse'],
    ['https://greenhouse.io/embed/job?id=123', 'greenhouse'],
    ['https://jobs.lever.co/company/abc-123', 'lever'],
    ['https://jobs.eu.lever.co/company/abc-123', 'lever'],
    ['https://jobs.ashbyhq.com/company/xyz', 'ashby'],
    ['https://company.myworkdayjobs.com/en-US/Careers/job/123', 'workday'],
    ['https://careers.company.com/job/456', 'generic'],
  ];

  for (const [url, expectedATS] of cases) {
    check(`detectATS("${url}")`, detectATS(url), expectedATS);
  }
}

// ═══════════════════════════════════════════════════════════════
// 3. Security Obstacles Detection (CAPTCHA / MFA / Anti-bot)
// ═══════════════════════════════════════════════════════════════
console.log('\n  3. Security Obstacles Detection');
{
  const recaptchaHtml = '<div>Please solve the recaptcha challenge to submit.</div>';
  const sec1 = detectSecurityObstacles(recaptchaHtml);
  check('CAPTCHA detected', sec1.hasSecurityObstacle, true);
  check('CAPTCHA obstacle listed', sec1.obstacles.includes('CAPTCHA'), true);

  const invisible = '<html><head><script src="https://www.google.com/recaptcha/api.js"></script></head><body><form><input name="first_name"></form><div class="grecaptcha-badge"></div></body></html>';
  const secInvisible = detectSecurityObstacles(invisible);
  check('Invisible reCAPTCHA script is not a pause', secInvisible.hasSecurityObstacle, false);

  const mfaText = 'Enter verification code sent to your phone for two-factor authentication';
  const sec2 = detectSecurityObstacles(mfaText);
  check('MFA detected', sec2.hasSecurityObstacle, true);
  check('MFA obstacle listed', sec2.obstacles.includes('MFA'), true);

  const cfText = 'Cloudflare attention required: access denied';
  const sec3 = detectSecurityObstacles(cfText);
  check('Anti-bot detected', sec3.hasSecurityObstacle, true);
  check('Anti-bot obstacle listed', sec3.obstacles.includes('Anti-bot'), true);

  const cleanHtml = '<form><h1>Apply for ML Intern</h1><button type="submit">Submit</button></form>';
  const sec4 = detectSecurityObstacles(cleanHtml);
  check('Clean page has no security obstacle', sec4.hasSecurityObstacle, false);
}

// ═══════════════════════════════════════════════════════════════
// 4. Pre-flight Verification
// ═══════════════════════════════════════════════════════════════
console.log('\n  4. Pre-flight Verification');
{
  const opp = makeOpportunity();
  const rec = makeApplicationRecord();

  const validPre = verifyPreFlight({ opportunity: opp, applicationRecord: rec, existingApplications: [] });
  check('Valid preflight passed', validPre.passed, true);
  check('url_valid', validPre.checks.url_valid, true);
  check('correct_company', validPre.checks.correct_company, true);
  check('correct_position', validPre.checks.correct_position, true);
  check('no_duplicate', validPre.checks.no_duplicate, true);

  // Test duplicate check failure
  const existing = [{ company: 'Careem', role: 'Software Engineer Intern', status: 'Applied' }];
  const dupPre = verifyPreFlight({ opportunity: opp, applicationRecord: rec, existingApplications: existing });
  check('Duplicate preflight failed', dupPre.passed, false);
  check('no_duplicate is false', dupPre.checks.no_duplicate, false);

  // Test NOT_ELIGIBLE failure
  const ineligibleOpp = makeOpportunity({ eligibility_status: 'NOT_ELIGIBLE' });
  const ineligPre = verifyPreFlight({ opportunity: ineligibleOpp, applicationRecord: rec, existingApplications: [] });
  check('Ineligible preflight failed', ineligPre.passed, false);
  check('eligibility_valid is false', ineligPre.checks.eligibility_valid, false);
}

// ═══════════════════════════════════════════════════════════════
// 5. Field Mapping & Hard-Gate Enforcement
// ═══════════════════════════════════════════════════════════════
console.log('\n  5. Field Mapping & Hard-Gate Enforcement');
{
  const rec = makeApplicationRecord();

  // 1. Sensitive question -> REQUIRES_USER_INPUT
  const workAuthField = { label: 'Are you authorized to work in Pakistan?', name: 'work_auth', required: true, type: 'radio' };
  const map1 = mapFieldToAnswer(workAuthField, rec);
  check('Sensitive question requires_user_input', map1.requires_user_input, true);
  check('Sensitive question confidence', map1.confidence, 0.0);
  check('Sensitive question sensitive flag', map1.sensitive, true);

  // 2. Pre-generated answer from ApplicationRecord
  const nameField = { label: 'What is your full name?', name: 'full_name', required: true, type: 'text' };
  const map2 = mapFieldToAnswer(nameField, rec);
  check('Name mapped answer correct', map2.answer, 'Ali Hassan');
  check('Name mapped requires_user_input is false', map2.requires_user_input, false);
  check('Name mapped confidence', map2.confidence, 1.0);

  // 3. Unmapped unknown question
  const unknownField = { label: 'What is your favorite programming paradigm?', name: 'fav_paradigm', required: false, type: 'text' };
  const map3 = mapFieldToAnswer(unknownField, rec);
  check('Unmapped question requires_user_input', map3.requires_user_input, true);
}

// ═══════════════════════════════════════════════════════════════
// 6. Fabrication Protection during Field Mapping
// ═══════════════════════════════════════════════════════════════
console.log('\n  6. Fabrication Protection during Field Mapping');
{
  const recWithFabrication = makeApplicationRecord({
    application_answers: [
      {
        question: 'Tell us about your experience',
        answer: 'I worked at FakeCorp as a Senior VP in 2020.',
        confidence: 0.9,
        requires_user_input: false,
        sensitive: false,
        category: 'experience',
      },
    ],
  });

  const sourceFacts = {
    companies: ['Arbisoft'],
    projectNames: ['SentimentBot'],
    dates: ['2026-06'],
    skills: ['python'],
    metrics: ['40%'],
    institutions: ['lums'],
  };

  const expField = { label: 'Tell us about your experience', name: 'exp', required: true, type: 'textarea' };
  const mapFab = mapFieldToAnswer(expField, recWithFabrication, sourceFacts);
  check('Fabricated answer requires_user_input', mapFab.requires_user_input, true);
  check('Fabricated answer confidence', mapFab.confidence, 0.0);
  check('Fabrication rationale mentions violation', mapFab.rationale.includes('Fabrication detected'), true);
}

// ═══════════════════════════════════════════════════════════════
// 7. Full Workflow via runApplicationAgent (DRY_RUN)
// ═══════════════════════════════════════════════════════════════
console.log('\n  7. Full Workflow via runApplicationAgent (DRY_RUN)');
{
  const opp = makeOpportunity();
  const rec = makeApplicationRecord();

  // Test Pre-flight rejection
  const dupExisting = [{ company: 'Careem', role: 'Software Engineer Intern', status: 'Applied' }];
  const sessionDup = await runApplicationAgent({ opportunity: opp, applicationRecord: rec, existingApplications: dupExisting });
  check('Duplicate application skipped', sessionDup.status, SESSION_STATUS.SKIPPED);
  check('Duplicate status reason set', sessionDup.status_reason.includes('Pre-flight failed'), true);

  // Test Security obstacle rejection
  const mockPageSecurity = {
    content: async () => '<html><body>Please complete the recaptcha challenge to proceed</body></html>',
  };
  const sessionSec = await runApplicationAgent({ opportunity: opp, applicationRecord: rec, page: mockPageSecurity });
  check('Security paused session status', sessionSec.status, SESSION_STATUS.PAUSED);

  // Test Application requiring user input for sensitive work auth field
  const sessionUserInputs = await runApplicationAgent({ opportunity: opp, applicationRecord: rec });
  check('Unanswered sensitive fields require user input', sessionUserInputs.status, SESSION_STATUS.REQUIRES_USER_INPUT);
  check('Unanswered fields populated', sessionUserInputs.unanswered_fields.length > 0, true);
  check('Dry run flag is true', sessionUserInputs.dry_run, true);
  check('Fill log populated with DRY_RUN entries', sessionUserInputs.fill_log.length > 0, true);
}

// ═══════════════════════════════════════════════════════════════
// 8. Clean Application READY_TO_SUBMIT (DRY_RUN)
// ═══════════════════════════════════════════════════════════════
console.log('\n  8. Clean Application READY_TO_SUBMIT (DRY_RUN)');
{
  const opp = makeOpportunity();
  const rec = makeApplicationRecord({
    application_answers: [
      { question: 'What is your full name?', answer: 'Ali Hassan', confidence: 1.0, requires_user_input: false, sensitive: false, category: 'name' },
      { question: 'Email address', answer: 'ali@example.com', confidence: 1.0, requires_user_input: false, sensitive: false, category: 'email' },
    ],
  });

  const mockCleanPage = {
    content: async () => '<html><body><form><input id="first_name" name="first_name" label="What is your full name?" /><input id="email" name="email" label="Email address" /></form></body></html>',
    evaluate: async () => [
      { id: 'first_name', name: 'first_name', label: 'What is your full name?', type: 'text', required: true },
      { id: 'email', name: 'email', label: 'Email address', type: 'email', required: true },
    ],
  };

  const sessionClean = await runApplicationAgent({
    opportunity: opp,
    applicationRecord: rec,
    pdfPath: 'output/ali_hassan_cv.pdf',
    page: mockCleanPage,
  });

  check('Clean application status is READY_TO_SUBMIT', sessionClean.status, SESSION_STATUS.READY_TO_SUBMIT);
  check('Dry run is enforced', sessionClean.dry_run, true);
  check('No unanswered fields', sessionClean.unanswered_fields.length, 0);
  check('Upload log contains CV', sessionClean.upload_log.some(u => u.type === 'CV_PDF'), true);
  check('Upload log contains Cover letter', sessionClean.upload_log.some(u => u.type === 'COVER_LETTER'), true);

  const mockEmptyPage = {
    content: async () => '<html><body><p>Job description only. No application form.</p></body></html>',
    evaluate: async () => [],
  };
  const sessionEmpty = await runApplicationAgent({
    opportunity: opp,
    applicationRecord: rec,
    page: mockEmptyPage,
  });
  check('Empty live page does not invent first_name/email', sessionEmpty.fields.length, 0);
  check('Empty live page stays DRY_RUN ready', sessionEmpty.status, SESSION_STATUS.READY_TO_SUBMIT);
}

// ═══════════════════════════════════════════════════════════════
// 9. Playwright DRY_RUN against a local application form
// ═══════════════════════════════════════════════════════════════
console.log('\n  9. Playwright DRY_RUN against local form fixture');
{
  const fixture = pathToFileURL(join(ROOT, 'tests', 'fixtures', 'dry-run-apply-form.html')).href;
  const rec = makeApplicationRecord({
    application_answers: [
      { question: 'Full name', answer: 'Ali Hassan', confidence: 1.0, requires_user_input: false, sensitive: false, category: 'name' },
      { question: 'Email address', answer: 'ali@example.com', confidence: 1.0, requires_user_input: false, sensitive: false, category: 'email' },
    ],
  });
  // Preflight requires a public https URL; the live page is the local form fixture.
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

    check('Fixture DRY_RUN flag is true', session.dry_run, true);
    check('Fixture DRY_RUN did not submit', session.status !== SESSION_STATUS.SUBMITTED, true);
    check('Fixture extracted real Full name field', session.fields.some(f => f.id === 'first_name'), true);
    check('Fixture extracted real Email field', session.fields.some(f => f.id === 'email'), true);
    check('Fixture fill log uses DRY_RUN actions', session.fill_log.every(e => String(e.action).includes('DRY_RUN') || e.action === 'REQUIRES_USER_INPUT'), true);
    check(
      'Fixture stays in DRY_RUN (READY_TO_SUBMIT or REQUIRES_USER_INPUT, never SUBMITTED)',
      session.status === SESSION_STATUS.READY_TO_SUBMIT || session.status === SESSION_STATUS.REQUIRES_USER_INPUT,
      true
    );

    const submitClicked = await page.evaluate(() => document.querySelector('form')?.dataset.submitted === '1');
    check('Fixture submit button was not clicked', submitClicked, false);
  } catch (err) {
    fail(`Playwright DRY_RUN fixture failed: ${err.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

