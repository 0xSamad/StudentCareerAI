// tests/application-generator.test.mjs — Application Content Generation Test Suite
// All AI calls mocked via dependency injection — no real API calls.
import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const MOD = pathToFileURL(join(ROOT, 'lib/application-generator.mjs')).href;
console.log('\napplication-generator — application content generation');

const {
  SENSITIVE_CATEGORIES,
  categorizeQuestion, isSensitiveCategory,
  generateCoverLetter, generateApplicationSummary,
  generateApplicationAnswer, generateApplicationContent,
  ApplicationGeneratorError,
} = await import(MOD);

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeProfile() {
  return {
    identity: { name: 'Ali Hassan', email: 'ali@example.com', phone: '+92-300-0000000', country: 'Pakistan', city: 'Lahore', linkedin: 'linkedin.com/in/alihassan', github: 'github.com/alihassan', portfolio: 'alihassan.dev' },
    education: [{ university: 'LUMS', degree: 'Bachelor of Science', major: 'Computer Science', year: 3, graduation_date: '2027-05', gpa: 3.7, gpa_scale: 4.0, coursework: ['Machine Learning', 'Data Structures'] }],
    skills: { programming_languages: ['Python', 'JavaScript'], frameworks: ['FastAPI', 'React'], ai_ml: ['PyTorch', 'scikit-learn'], databases: ['PostgreSQL'], cloud: ['AWS'], tools: ['Git'], soft_skills: ['Communication'] },
    experience: {
      internships: [{ company: 'Arbisoft', role: 'ML Intern', start_date: '2026-06', end_date: '2026-08', location: 'Lahore', description: 'Built NLP pipeline.', achievements: ['Reduced manual review time by 40%'] }],
      jobs: [], volunteer: [],
    },
    projects: [{ name: 'SentimentBot', description: 'Twitter sentiment analysis.', technologies: ['Python', 'PyTorch'], achievements: ['93% accuracy'] }],
    preferences: { search_mode: 'internships', target_roles: ['ML Intern'], target_industries: ['Technology'], locations: { preferred: ['Lahore'], remote: true, hybrid: true, on_site: false }, sponsorship: { needs_sponsorship: false }, compensation: {}, timing: { preferred_start: 'Summer 2027' }, automation: { min_match_score: 3.5, max_applications_per_day: 5, auto_submit: false } },
    matching: null,
  };
}

function makeOpportunity() {
  return { title: 'ML Intern', company: 'Careem', opportunity_type: 'INTERNSHIP', location: 'Lahore, Pakistan', country: 'Pakistan', remote: null, description: 'Join our ML team. Python and PyTorch experience required.', url: 'https://boards.greenhouse.io/careem/jobs/789' };
}

function makeMatchResult() {
  return { match_score: 85, tier: 'STRONG', strengths: ['Python', 'PyTorch'], missing_skills: [], relevant_projects: ['SentimentBot'], relevant_experience: ['ML Intern at Arbisoft'], concerns: [] };
}

function makeCoverLetterAI() {
  return async () => JSON.stringify({ subject_line: 'Application for ML Intern at Careem', body: 'Dear Hiring Manager,\n\nI am a third-year CS student at LUMS with hands-on ML experience.\n\nMy NLP work at Arbisoft aligns directly with your requirements.\n\nI look forward to contributing.', word_count: 38, confidence: 0.88 });
}

function makeAnswerAI(answer = 'I am highly motivated by Careem\'s mission in emerging markets.', confidence = 0.85) {
  return async () => JSON.stringify({ answer, confidence, requires_user_input: false, rationale: 'Derived from profile and JD.' });
}

function makeValidCVDraft() {
  return { summary: 'Third-year CS student at LUMS with ML experience at Arbisoft.', competencies: ['Python', 'PyTorch', 'FastAPI', 'React', 'Git'], experience: [{ company: 'Arbisoft', role: 'ML Intern', start_date: '2026-06', end_date: '2026-08', location: 'Lahore, Pakistan', bullets: ['Built NLP pipeline reducing manual review time by 40%'] }], projects: [{ name: 'SentimentBot', description: 'Twitter sentiment analysis.', technologies: ['Python', 'PyTorch'], achievements: ['93% accuracy'] }], tailoring_notes: 'Highlighted ML skills.' };
}

// Composite mock AI that handles both CV tailoring and cover letter/answers
function makeCompositeAI(cvDraft, coverLetter, answerPayload) {
  let callCount = 0;
  return async (resolved, system, user) => {
    callCount++;
    if (system.includes('ALLOWED COMPANIES')) return JSON.stringify(cvDraft);
    if (system.includes('cover letter')) return JSON.stringify(coverLetter);
    return JSON.stringify(answerPayload);
  };
}

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// ═══════════════════════════════════════════════════════════════
// 1. SENSITIVE_CATEGORIES constant
// ═══════════════════════════════════════════════════════════════
console.log('\n  1. SENSITIVE_CATEGORIES constant');
{
  const expected = ['work_authorization','sponsorship','salary','demographic','disability','criminal_legal','citizenship','relocation'];
  check('All 8 categories present', SENSITIVE_CATEGORIES.length, 8);
  for (const cat of expected) {
    check(`Category "${cat}" in list`, SENSITIVE_CATEGORIES.includes(cat), true);
  }
  check('isSensitiveCategory(salary)', isSensitiveCategory('salary'), true);
  check('isSensitiveCategory(name) = false', isSensitiveCategory('name'), false);
}

// ═══════════════════════════════════════════════════════════════
// 2. categorizeQuestion — sensitive detection
// ═══════════════════════════════════════════════════════════════
console.log('\n  2. Sensitive question detection');
{
  const cases = [
    ['Are you authorized to work in Pakistan?',                    'work_authorization'],
    ['Will you require visa sponsorship?',                         'sponsorship'],
    ['Do you require H-1B sponsorship?',                          'sponsorship'],
    ['What are your salary expectations?',                         'salary'],
    ['What is your desired compensation?',                         'salary'],
    ['Please indicate your race/ethnicity.',                       'demographic'],
    ['Do you identify as a veteran?',                              'demographic'],
    ['Do you have a disability?',                                  'disability'],
    ['Have you ever been convicted of a felony?',                  'criminal_legal'],
    ['Are you a US citizen or permanent resident?',                'citizenship'],
    ['Are you willing to relocate?',                               'relocation'],
    ['Are you open to relocation for this role?',                  'relocation'],
  ];
  for (const [q, expectedCat] of cases) {
    const { category, isSensitive } = categorizeQuestion(q);
    check(`"${q.slice(0,35)}..." → ${expectedCat}`, category, expectedCat);
    check(`"${q.slice(0,35)}..." isSensitive`, isSensitive, true);
  }
}

// ═══════════════════════════════════════════════════════════════
// 3. categorizeQuestion — profile-derivable detection
// ═══════════════════════════════════════════════════════════════
console.log('\n  3. Profile-derivable question detection');
{
  const cases = [
    ['What is your full name?',              'name'],
    ['Email address:',                       'email'],
    ['Phone number:',                        'phone'],
    ['Current city or location:',            'location'],
    ['Which university do you attend?',      'university'],
    ['What is your degree and major?',       'degree'],
    ['Expected graduation date:',            'graduation'],
    ['What is your GPA?',                    'gpa'],
    ['LinkedIn profile URL:',               'linkedin'],
    ['GitHub or portfolio URL:',             'github'],
    ['When are you available to start?',     'availability'],
    ['How many years of experience do you have?', 'experience'],
    ['List your technical skills.',          'skills'],
  ];
  for (const [q, expectedCat] of cases) {
    const { category, isSensitive } = categorizeQuestion(q);
    check(`"${q.slice(0,35)}..." → ${expectedCat}`, category, expectedCat);
    check(`"${q.slice(0,35)}..." not sensitive`, isSensitive, false);
  }
}

// ═══════════════════════════════════════════════════════════════
// 4. Sensitive questions always → REQUIRES_USER_INPUT (no AI call)
// ═══════════════════════════════════════════════════════════════
console.log('\n  4. Sensitive questions always → REQUIRES_USER_INPUT');
{
  const profile = makeProfile();
  const opp = makeOpportunity();
  const resolved = { provider: 'gemini', model: 'test', temperature: 0.2, ollamaUrl: null };
  let aiCalled = false;
  const noCallAI = async () => { aiCalled = true; return '{}'; };

  const sensitiveQuestions = [
    'Are you authorized to work in Pakistan?',
    'Will you require visa sponsorship?',
    'What are your salary expectations?',
    'Do you identify with any of the following racial categories?',
    'Do you have any disability?',
    'Have you been convicted of a crime?',
    'Are you a citizen of Pakistan?',
    'Are you willing to relocate?',
  ];

  for (const q of sensitiveQuestions) {
    aiCalled = false;
    const ans = await generateApplicationAnswer({ question: q, profile, opportunity: opp, resolved, callAIFn: noCallAI });
    check(`Sensitive: requires_user_input = true`, ans.requires_user_input, true);
    check(`Sensitive: AI not called for "${q.slice(0,30)}..."`, aiCalled, false);
    check(`Sensitive: sensitive = true`, ans.sensitive, true);
    check(`Sensitive: answer is empty string`, ans.answer, '');
    check(`Sensitive: confidence = 0`, ans.confidence, 0.0);
  }
}

// ═══════════════════════════════════════════════════════════════
// 5. Deterministic answers — no AI call for profile-derivable
// ═══════════════════════════════════════════════════════════════
console.log('\n  5. Deterministic answers — no AI call');
{
  const profile = makeProfile();
  const opp = makeOpportunity();
  const resolved = { provider: 'gemini', model: 'test', temperature: 0.2, ollamaUrl: null };
  let aiCalled = false;
  const noCallAI = async () => { aiCalled = true; return '{}'; };

  const cases = [
    ['What is your full name?',      'Ali Hassan',                     1.0],
    ['Email address:',               'ali@example.com',                1.0],
    ['Phone number:',                '+92-300-0000000',                1.0],
    ['Which university do you attend?', 'LUMS',                        1.0],
    ['What is your degree and major?',  'Bachelor of Science in Computer Science', 1.0],
    ['Expected graduation date:',    '2027-05',                        1.0],
    ['What is your GPA?',            '3.7 / 4',                        1.0],
    ['LinkedIn profile URL:',        'linkedin.com/in/alihassan',      1.0],
  ];

  for (const [q, expectedAnswer, expectedConf] of cases) {
    aiCalled = false;
    const ans = await generateApplicationAnswer({ question: q, profile, opportunity: opp, resolved, callAIFn: noCallAI });
    check(`"${q.slice(0,30)}": answer correct`, ans.answer, expectedAnswer);
    check(`"${q.slice(0,30)}": confidence = ${expectedConf}`, ans.confidence, expectedConf);
    check(`"${q.slice(0,30)}": AI not called`, aiCalled, false);
    check(`"${q.slice(0,30)}": not requires_user_input`, ans.requires_user_input, false);
  }
}

// ═══════════════════════════════════════════════════════════════
// 6. AI-assisted answers — complex questions
// ═══════════════════════════════════════════════════════════════
console.log('\n  6. AI-assisted answers — complex questions');
{
  const profile = makeProfile();
  const opp = makeOpportunity();
  const resolved = { provider: 'gemini', model: 'test', temperature: 0.2, ollamaUrl: null };

  const ans = await generateApplicationAnswer({
    question: 'Why do you want to join Careem?',
    profile, opportunity: opp, resolved,
    callAIFn: makeAnswerAI('I am excited by Careem\'s mission.', 0.85),
  });
  check('AI answer returned', ans.answer.length > 0, true);
  check('AI confidence = 0.85', ans.confidence, 0.85);
  check('requires_user_input = false', ans.requires_user_input, false);
  check('category = why_company', ans.category, 'why_company');
}

{
  // Low-confidence AI response → REQUIRES_USER_INPUT
  const profile = makeProfile();
  const opp = makeOpportunity();
  const resolved = { provider: 'gemini', model: 'test', temperature: 0.2, ollamaUrl: null };

  const ans = await generateApplicationAnswer({
    question: 'Describe a time you led a cross-functional team.',
    profile, opportunity: opp, resolved,
    callAIFn: async () => JSON.stringify({ answer: '', confidence: 0.3, requires_user_input: true, rationale: 'Not enough profile data.' }),
  });
  check('Low confidence → requires_user_input', ans.requires_user_input, true);
  check('Low confidence → answer empty', ans.answer, '');
}

// ═══════════════════════════════════════════════════════════════
// 7. generateApplicationSummary — deterministic
// ═══════════════════════════════════════════════════════════════
console.log('\n  7. Application summary');
{
  const summary = generateApplicationSummary(makeProfile(), makeOpportunity(), makeMatchResult());
  check('Summary has text', typeof summary.text, 'string');
  check('Summary non-empty', summary.text.length > 20, true);
  check('Summary contains name', summary.text.includes('Ali Hassan'), true);
  check('Summary contains university', summary.text.includes('LUMS'), true);
  check('Summary contains ML Intern', summary.text.includes('ML Intern'), true);
  check('Summary contains Careem', summary.text.includes('Careem'), true);
  check('Summary confidence = 1.0', summary.confidence, 1.0);
  check('Summary word_count is number', typeof summary.word_count, 'number');
  check('Summary word_count > 0', summary.word_count > 0, true);
  check('Summary generated_at is ISO', /^\d{4}-\d{2}-\d{2}T/.test(summary.generated_at), true);
}

// ═══════════════════════════════════════════════════════════════
// 8. generateCoverLetter — schema
// ═══════════════════════════════════════════════════════════════
console.log('\n  8. Cover letter generation');
{
  const resolved = { provider: 'gemini', model: 'test', temperature: 0.2, ollamaUrl: null };
  const cl = await generateCoverLetter({
    profile: makeProfile(), opportunity: makeOpportunity(), matchResult: makeMatchResult(),
    resolved, callAIFn: makeCoverLetterAI(),
  });
  check('subject_line set', typeof cl.subject_line, 'string');
  check('body set', typeof cl.body, 'string');
  check('body non-empty', cl.body.length > 20, true);
  check('word_count > 0', cl.word_count > 0, true);
  check('confidence 0.88', cl.confidence, 0.88);
  check('generated_at is ISO', /^\d{4}-\d{2}-\d{2}T/.test(cl.generated_at), true);
}

{
  // Bad AI response → ApplicationGeneratorError
  const resolved = { provider: 'gemini', model: 'test', temperature: 0.2, ollamaUrl: null };
  let threw = false;
  try {
    await generateCoverLetter({
      profile: makeProfile(), opportunity: makeOpportunity(), matchResult: null,
      resolved, callAIFn: async () => 'bad json',
    });
  } catch (e) { threw = e instanceof ApplicationGeneratorError; }
  check('Bad AI → ApplicationGeneratorError', threw, true);
}

// ═══════════════════════════════════════════════════════════════
// 9. Full pipeline — generateApplicationContent
// ═══════════════════════════════════════════════════════════════
console.log('\n  9. Full pipeline — ApplicationRecord');
{
  const questions = [
    'What is your full name?',
    'Are you authorized to work in Pakistan?',   // sensitive
    'Will you require visa sponsorship?',          // sensitive
    'Why do you want to join Careem?',
    'What are your salary expectations?',          // sensitive
  ];

  const compositeAI = makeCompositeAI(
    makeValidCVDraft(),
    { subject_line: 'Application for ML Intern at Careem', body: 'Dear Hiring Manager,\n\nI am excited about this role.\n\nLooking forward to connecting.', word_count: 20, confidence: 0.85 },
    { answer: 'I am excited by Careem\'s mission.', confidence: 0.85, requires_user_input: false, rationale: 'From profile.' }
  );

  const record = await generateApplicationContent({
    profile: makeProfile(), cvText: '# Ali Hassan\n\nML Intern at Arbisoft — reduced review by 40%',
    opportunity: makeOpportunity(), matchResult: makeMatchResult(),
    questions,
    matchingConfig: { ai_provider: 'gemini', model: 'test' },
    callAIFn: compositeAI,
  });

  // Record schema
  const FIELDS = ['opportunity_id','opportunity_title','opportunity_company','generated_at','provider_used','model_used','tailored_cv','cover_letter','application_summary','application_answers','requires_user_input','pending_questions','generation_errors'];
  for (const f of FIELDS) check(`Field "${f}" present`, f in record, true);

  check('opportunity_title', record.opportunity_title, 'ML Intern');
  check('opportunity_company', record.opportunity_company, 'Careem');
  check('provider_used', record.provider_used, 'gemini');
  check('generated_at ISO', /^\d{4}-\d{2}-\d{2}T/.test(record.generated_at), true);

  // CV
  check('tailored_cv generated', record.tailored_cv !== null, true);
  check('tailored_cv has html', typeof record.tailored_cv?.tailored_html, 'string');

  // Cover letter
  check('cover_letter generated', record.cover_letter !== null, true);
  check('cover_letter body non-empty', record.cover_letter?.body.length > 5, true);

  // Summary
  check('application_summary.confidence', record.application_summary.confidence, 1.0);

  // Answers
  check('5 answers generated', record.application_answers.length, 5);

  // Sensitive questions forced to REQUIRES_USER_INPUT
  const authAns = record.application_answers.find(a => a.category === 'work_authorization');
  const sponsorAns = record.application_answers.find(a => a.category === 'sponsorship');
  const salaryAns = record.application_answers.find(a => a.category === 'salary');
  check('work_authorization → requires_user_input', authAns?.requires_user_input, true);
  check('sponsorship → requires_user_input', sponsorAns?.requires_user_input, true);
  check('salary → requires_user_input', salaryAns?.requires_user_input, true);

  // Name derivable
  const nameAns = record.application_answers.find(a => a.category === 'name');
  check('name → not requires_user_input', nameAns?.requires_user_input, false);
  check('name → answer = Ali Hassan', nameAns?.answer, 'Ali Hassan');

  // requires_user_input flag on record
  check('record.requires_user_input = true (has pending)', record.requires_user_input, true);
  check('pending_questions.length = 3', record.pending_questions.length, 3);
  check('pending sensitive = true for auth', record.pending_questions.find(q => q.category === 'work_authorization')?.sensitive, true);
}

// ═══════════════════════════════════════════════════════════════
// 10. Answer confidence scores
// ═══════════════════════════════════════════════════════════════
console.log('\n  10. Confidence scores');
{
  const profile = makeProfile();
  const opp = makeOpportunity();
  const resolved = { provider: 'gemini', model: 'test', temperature: 0.2, ollamaUrl: null };
  const noAI = async () => '{}';

  // Direct profile derivations should be exactly 1.0
  for (const [q, expConf] of [
    ['What is your full name?', 1.0],
    ['Email address:', 1.0],
    ['Which university do you attend?', 1.0],
  ]) {
    const ans = await generateApplicationAnswer({ question: q, profile, opportunity: opp, resolved, callAIFn: noAI });
    check(`"${q}" confidence = ${expConf}`, ans.confidence, expConf);
  }

  // Sensitive always 0.0
  const sensAns = await generateApplicationAnswer({ question: 'Are you a citizen?', profile, opportunity: opp, resolved, callAIFn: noAI });
  check('Sensitive confidence = 0.0', sensAns.confidence, 0.0);

  // AI answer confidence clamped to [0, 1]
  const highAns = await generateApplicationAnswer({
    question: 'Why do you want to work here?', profile, opportunity: opp, resolved,
    callAIFn: async () => JSON.stringify({ answer: 'Great mission.', confidence: 1.5, requires_user_input: false, rationale: 'test' }),
  });
  check('Confidence clamped to 1.0 max', highAns.confidence <= 1.0, true);
}

// ═══════════════════════════════════════════════════════════════
// 11. All answer results have required fields
// ═══════════════════════════════════════════════════════════════
console.log('\n  11. Answer result schema');
{
  const profile = makeProfile();
  const opp = makeOpportunity();
  const resolved = { provider: 'gemini', model: 'test', temperature: 0.2, ollamaUrl: null };
  const ANSWER_FIELDS = ['question', 'answer', 'confidence', 'category', 'requires_user_input', 'sensitive', 'rationale', 'generated_at'];

  for (const q of ['What is your name?', 'Are you authorized to work?', 'Why this company?']) {
    const ans = await generateApplicationAnswer({ question: q, profile, opportunity: opp, resolved, callAIFn: makeAnswerAI() });
    for (const f of ANSWER_FIELDS) check(`"${q.slice(0,25)}..." field "${f}"`, f in ans, true);
  }
}

// ═══════════════════════════════════════════════════════════════
