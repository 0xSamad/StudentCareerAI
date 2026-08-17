// tests/cv-tailor.test.mjs — CV Tailoring Engine Test Suite
// All AI calls mocked via DI — no real API calls.
import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const MOD = pathToFileURL(join(ROOT, 'lib/cv-tailor.mjs')).href;
console.log('\ncv-tailor — intelligent CV tailoring engine');

const {
  extractSourceFacts, validateAgainstSourceFacts,
  parseDraftResponse, renderTailoredHTML,
  tailorCV, TailorError, FabricationError,
} = await import(MOD);

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MASTER_CV = `# Ali Hassan — Software Engineer

## Experience
**ML Intern** | Arbisoft | Jun 2026 – Aug 2026
- Built NLP pipeline reducing manual review time by 40%
- Deployed model serving 10K documents/day

## Projects
**SentimentBot**: Twitter sentiment analysis with DistilBERT. Accuracy: 93.2%
**StudySync**: Study group matching app, 500+ active users across 3 universities.
`;

function makeProfile(overrides = {}) {
  return {
    identity: { name: 'Ali Hassan', email: 'ali@example.com', phone: '+92-300-0000000', country: 'Pakistan', city: 'Lahore', linkedin: 'linkedin.com/in/alihassan', github: 'github.com/alihassan', portfolio: 'alihassan.dev' },
    education: [{ university: 'LUMS', degree: 'Bachelor of Science', major: 'Computer Science', year: 3, semester: 'Fall 2026', graduation_date: '2027-05', gpa: 3.7, gpa_scale: 4.0, coursework: ['Machine Learning', 'Data Structures'] }],
    skills: { programming_languages: ['Python', 'JavaScript', 'Java'], frameworks: ['React', 'FastAPI'], ai_ml: ['PyTorch', 'scikit-learn', 'HuggingFace'], databases: ['PostgreSQL', 'MongoDB'], cloud: ['AWS', 'Docker'], tools: ['Git', 'Linux'], soft_skills: ['Communication'] },
    experience: {
      internships: [{ company: 'Arbisoft', role: 'ML Intern', start_date: '2026-06', end_date: '2026-08', location: 'Lahore, Pakistan', description: 'Built NLP pipeline for text classification.', achievements: ['Reduced manual review time by 40%', 'Deployed model serving 10K documents/day'] }],
      jobs: [{ company: 'LUMS Library', role: 'Research Assistant', start_date: '2025-09', end_date: 'Present', location: 'Lahore', description: 'Support faculty research.', achievements: ['Processed 50K academic paper abstracts'] }],
      volunteer: [],
    },
    projects: [
      { name: 'SentimentBot', description: 'Twitter sentiment analysis using DistilBERT.', technologies: ['Python', 'PyTorch', 'HuggingFace'], achievements: ['93.2% accuracy on SST-2', 'Processes 1K tweets/minute'], url: 'https://sentimentbot.dev' },
      { name: 'StudySync', description: 'Study group matching app.', technologies: ['Python', 'FastAPI', 'PostgreSQL', 'React'], achievements: ['500+ active users across 3 universities'] },
    ],
    preferences: { search_mode: 'internships', target_roles: ['ML Intern'], target_industries: ['Technology'], locations: { preferred: ['Lahore'], remote: true, hybrid: true, on_site: false }, sponsorship: { needs_sponsorship: false }, compensation: {}, timing: {}, automation: { min_match_score: 3.5, max_applications_per_day: 5, auto_submit: false } },
    matching: null,
    ...overrides,
  };
}

function makeOpportunity(overrides = {}) {
  return {
    title: 'Machine Learning Intern',
    company: 'Careem',
    opportunity_type: 'INTERNSHIP',
    location: 'Lahore, Pakistan',
    country: 'Pakistan',
    remote: null,
    description: 'Looking for a BS/MS student with Python and PyTorch experience to join our ML team.',
    url: 'https://boards.greenhouse.io/careem/jobs/456',
    ...overrides,
  };
}

function makeMatchResult() {
  return { match_score: 85, tier: 'STRONG', strengths: ['Python', 'PyTorch'], missing_skills: [], relevant_projects: ['SentimentBot'], relevant_experience: ['ML Intern at Arbisoft'], concerns: [] };
}

function makeValidDraft() {
  return {
    summary: 'Third-year CS student at LUMS with hands-on ML experience at Arbisoft. Skilled in Python, PyTorch, and NLP pipelines targeting applied AI roles.',
    competencies: ['Python', 'PyTorch', 'HuggingFace', 'FastAPI', 'React', 'Git'],
    experience: [
      { company: 'Arbisoft', role: 'ML Intern', start_date: '2026-06', end_date: '2026-08', location: 'Lahore, Pakistan', bullets: ['Built NLP pipeline reducing manual review time by 40%', 'Deployed model serving 10K documents/day'] },
      { company: 'LUMS Library', role: 'Research Assistant', start_date: '2025-09', end_date: 'Present', location: 'Lahore', bullets: ['Processed 50K academic paper abstracts'] },
    ],
    projects: [
      { name: 'SentimentBot', description: 'Twitter sentiment analysis using DistilBERT.', technologies: ['Python', 'PyTorch', 'HuggingFace'], achievements: ['93.2% accuracy on SST-2', 'Processes 1K tweets/minute'] },
    ],
    tailoring_notes: 'Highlighted SentimentBot and NLP experience to align with ML internship requirements.',
  };
}

function mockAI(draft) { return async () => JSON.stringify(draft); }

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// ═══════════════════════════════════════════════════════════════
// 1. Source fact extraction
// ═══════════════════════════════════════════════════════════════
console.log('\n  1. Source fact extraction');
{
  const sf = extractSourceFacts(makeProfile(), MASTER_CV);

  check('companies: Arbisoft detected', sf.companies.has('arbisoft'), true);
  check('companies: LUMS Library detected', sf.companies.has('lums library'), true);
  check('projectNames: SentimentBot detected', sf.projectNames.has('sentimentbot'), true);
  check('projectNames: StudySync detected', sf.projectNames.has('studysync'), true);
  check('dates: 2026-06 detected', sf.dates.has('2026-06'), true);
  check('dates: 2026-08 detected', sf.dates.has('2026-08'), true);
  check('dates: 2027-05 detected', sf.dates.has('2027-05'), true);
  check('skills: python detected', sf.skills.has('python'), true);
  check('skills: pytorch detected', sf.skills.has('pytorch'), true);
  check('skills: react detected', sf.skills.has('react'), true);
  check('metrics: 40% detected', sf.metrics.has('40%'), true);
  check('metrics: 10k detected from achievements', sf.metrics.size > 0, true);
  check('institutions: lums detected', sf.institutions.has('lums'), true);
  check('rawCvText preserved', sf.rawCvText.includes('Arbisoft'), true);
}

// ═══════════════════════════════════════════════════════════════
// 2. Fabrication: invented company → REJECTED
// ═══════════════════════════════════════════════════════════════
console.log('\n  2. Fabrication: invented company → REJECTED');
{
  const sf = extractSourceFacts(makeProfile(), MASTER_CV);
  const fakeDraft = { ...makeValidDraft(), experience: [{ company: 'Google', role: 'SWE Intern', start_date: '2026-06', end_date: '2026-08', location: 'Remote', bullets: ['Built features'] }] };
  const v = validateAgainstSourceFacts(fakeDraft, sf);
  check('REJECTED for invented company', v.result, 'REJECTED');
  check('Violation mentions Google', v.violations.some(x => x.includes('Google')), true);
  check('valid = false', v.valid, false);
}

// ═══════════════════════════════════════════════════════════════
// 3. Fabrication: invented project → REJECTED
// ═══════════════════════════════════════════════════════════════
console.log('\n  3. Fabrication: invented project → REJECTED');
{
  const sf = extractSourceFacts(makeProfile(), MASTER_CV);
  const fakeDraft = { ...makeValidDraft(), projects: [{ name: 'FakeProject', description: 'Invented.', technologies: ['Python'], achievements: [] }] };
  const v = validateAgainstSourceFacts(fakeDraft, sf);
  check('REJECTED for invented project', v.result, 'REJECTED');
  check('Violation mentions FakeProject', v.violations.some(x => x.includes('FakeProject')), true);
}

// ═══════════════════════════════════════════════════════════════
// 4. Fabrication: invented metric → REJECTED
// ═══════════════════════════════════════════════════════════════
console.log('\n  4. Fabrication: invented metric → REJECTED');
{
  const sf = extractSourceFacts(makeProfile(), MASTER_CV);
  // Source has 40%, invented 80%
  const fakeDraft = {
    ...makeValidDraft(),
    experience: [{ company: 'Arbisoft', role: 'ML Intern', start_date: '2026-06', end_date: '2026-08', location: 'Lahore, Pakistan', bullets: ['Reduced latency by 80%'] }],
  };
  const v = validateAgainstSourceFacts(fakeDraft, sf);
  check('REJECTED for invented metric', v.result, 'REJECTED');
  check('Violation mentions 80%', v.violations.some(x => x.includes('80%')), true);
}

// ═══════════════════════════════════════════════════════════════
// 5. Fabrication: invented skill in competencies → REJECTED
// ═══════════════════════════════════════════════════════════════
console.log('\n  5. Fabrication: invented skill → REJECTED');
{
  const sf = extractSourceFacts(makeProfile(), MASTER_CV);
  const fakeDraft = { ...makeValidDraft(), competencies: ['Python', 'Rust', 'COBOL'] };
  const v = validateAgainstSourceFacts(fakeDraft, sf);
  check('REJECTED for invented skills', v.result, 'REJECTED');
  check('Violation mentions Rust', v.violations.some(x => x.includes('Rust')), true);
  check('Violation mentions COBOL', v.violations.some(x => x.includes('COBOL')), true);
}

// ═══════════════════════════════════════════════════════════════
// 6. Fabrication: invented start_date → REJECTED
// ═══════════════════════════════════════════════════════════════
console.log('\n  6. Fabrication: invented date → REJECTED');
{
  const sf = extractSourceFacts(makeProfile(), MASTER_CV);
  const fakeDraft = {
    ...makeValidDraft(),
    experience: [{ company: 'Arbisoft', role: 'ML Intern', start_date: '2024-01', end_date: '2026-08', location: 'Lahore', bullets: ['Built pipeline'] }],
  };
  const v = validateAgainstSourceFacts(fakeDraft, sf);
  check('REJECTED for invented date', v.result, 'REJECTED');
  check('Violation mentions 2024-01', v.violations.some(x => x.includes('2024-01')), true);
}

// ═══════════════════════════════════════════════════════════════
// 7. Valid rewrite passes (CLEAN)
// ═══════════════════════════════════════════════════════════════
console.log('\n  7. Valid rewrite passes → CLEAN');
{
  const sf = extractSourceFacts(makeProfile(), MASTER_CV);
  const validDraft = makeValidDraft();
  const v = validateAgainstSourceFacts(validDraft, sf);
  check('CLEAN for valid draft', v.result, 'CLEAN');
  check('No violations', v.violations.length, 0);
  check('valid = true', v.valid, true);
}

// ═══════════════════════════════════════════════════════════════
// 8. Valid project subsetting (select fewer projects)
// ═══════════════════════════════════════════════════════════════
console.log('\n  8. Valid project subsetting → CLEAN');
{
  const sf = extractSourceFacts(makeProfile(), MASTER_CV);
  const draft = { ...makeValidDraft(), projects: [{ name: 'SentimentBot', description: 'NLP analysis.', technologies: ['Python', 'PyTorch'], achievements: ['93.2% accuracy on SST-2'] }] };
  const v = validateAgainstSourceFacts(draft, sf);
  check('CLEAN when subset of projects selected', v.result, 'CLEAN');
}

// ═══════════════════════════════════════════════════════════════
// 9. parseDraftResponse validation
// ═══════════════════════════════════════════════════════════════
console.log('\n  9. parseDraftResponse');
{
  const parsed = parseDraftResponse(JSON.stringify(makeValidDraft()));
  check('Valid draft parsed', typeof parsed.summary, 'string');
  check('Competencies is array', Array.isArray(parsed.competencies), true);

  // With markdown fences
  const fenced = '```json\n' + JSON.stringify(makeValidDraft()) + '\n```';
  const p2 = parseDraftResponse(fenced);
  check('Strips fences', typeof p2.summary, 'string');

  // Missing field → error
  let threw = false;
  try { parseDraftResponse(JSON.stringify({ summary: 'x', competencies: [] })); }
  catch (e) { threw = e instanceof TailorError; }
  check('Missing field → TailorError', threw, true);

  // Bad JSON → error
  let threw2 = false;
  try { parseDraftResponse('not json'); }
  catch (e) { threw2 = e instanceof TailorError; }
  check('Bad JSON → TailorError', threw2, true);
}

// ═══════════════════════════════════════════════════════════════
// 10. Full pipeline — valid output
// ═══════════════════════════════════════════════════════════════
console.log('\n  10. Full pipeline — valid output');
{
  const record = await tailorCV({
    profile: makeProfile(), cvText: MASTER_CV,
    opportunity: makeOpportunity(), matchResult: makeMatchResult(),
    matchingConfig: { ai_provider: 'gemini', model: 'gemini-3.6-flash' },
    callAIFn: mockAI(makeValidDraft()),
  });
  check('record returned', typeof record, 'object');
  check('opportunity_id set', typeof record.opportunity_id, 'string');
  check('opportunity_title', record.opportunity_title, 'Machine Learning Intern');
  check('opportunity_company', record.opportunity_company, 'Careem');
  check('tailored_at is ISO', /^\d{4}-\d{2}-\d{2}T/.test(record.tailored_at), true);
  check('provider_used', record.provider_used, 'gemini');
  check('model_used', record.model_used, 'gemini-3.6-flash');
  check('validation_result CLEAN', record.validation_result, 'CLEAN');
  check('original_cv preserved', record.original_cv, MASTER_CV);
  check('tailored_draft has summary', typeof record.tailored_draft.summary, 'string');
  check('tailored_html is string', typeof record.tailored_html, 'string');
  check('tailored_html non-empty', record.tailored_html.length > 100, true);
  check('source_facts.companies is array', Array.isArray(record.source_facts.companies), true);
  check('source_facts.project_names is array', Array.isArray(record.source_facts.project_names), true);
  check('tailoring_notes set', typeof record.tailoring_notes, 'string');
}

// ═══════════════════════════════════════════════════════════════
// 11. Full pipeline — fabricated company → FabricationError
// ═══════════════════════════════════════════════════════════════
console.log('\n  11. Fabricated company in pipeline → FabricationError');
{
  const fakeDraft = { ...makeValidDraft(), experience: [{ company: 'DeepMind', role: 'Research Intern', start_date: '2026-06', end_date: '2026-08', location: 'London', bullets: ['Invented achievement'] }] };
  let threw = false;
  try {
    await tailorCV({
      profile: makeProfile(), cvText: MASTER_CV,
      opportunity: makeOpportunity(),
      matchingConfig: { ai_provider: 'gemini', model: 'test' },
      callAIFn: mockAI(fakeDraft),
    });
  } catch (e) { threw = e instanceof FabricationError; }
  check('FabricationError thrown for invented company', threw, true);
}

// ═══════════════════════════════════════════════════════════════
// 12. Full pipeline — fabricated metric → FabricationError
// ═══════════════════════════════════════════════════════════════
console.log('\n  12. Fabricated metric in pipeline → FabricationError');
{
  const fakeDraft = {
    ...makeValidDraft(),
    experience: [{ company: 'Arbisoft', role: 'ML Intern', start_date: '2026-06', end_date: '2026-08', location: 'Lahore', bullets: ['Improved accuracy by 99%'] }],
  };
  let threw = false;
  try {
    await tailorCV({
      profile: makeProfile(), cvText: MASTER_CV,
      opportunity: makeOpportunity(),
      matchingConfig: { ai_provider: 'gemini', model: 'test' },
      callAIFn: mockAI(fakeDraft),
    });
  } catch (e) { threw = e instanceof FabricationError; }
  check('FabricationError thrown for invented metric', threw, true);
}

// ═══════════════════════════════════════════════════════════════
// 13. Retry logic — persistent failure → TailorError
// ═══════════════════════════════════════════════════════════════
console.log('\n  13. Retry logic');
{
  let callCount = 0;
  const alwaysBad = async () => { callCount++; return 'bad json'; };
  let threw = false;
  try {
    await tailorCV({
      profile: makeProfile(), cvText: MASTER_CV, opportunity: makeOpportunity(),
      matchingConfig: { ai_provider: 'gemini', model: 'test' }, callAIFn: alwaysBad,
    });
  } catch (e) { threw = e instanceof TailorError; }
  check('TailorError thrown after retries', threw, true);
  check('Called AI 3 times (initial + 2 retries)', callCount, 3);
}

{
  let callCount = 0;
  const eventuallyGood = async () => {
    callCount++;
    return callCount < 2 ? 'bad json' : JSON.stringify(makeValidDraft());
  };
  const record = await tailorCV({
    profile: makeProfile(), cvText: MASTER_CV, opportunity: makeOpportunity(),
    matchingConfig: { ai_provider: 'gemini', model: 'test' }, callAIFn: eventuallyGood,
  });
  check('Succeeds on retry', record.validation_result, 'CLEAN');
  check('Retry count = 2', callCount, 2);
}

// ═══════════════════════════════════════════════════════════════
// 14. HTML rendering
// ═══════════════════════════════════════════════════════════════
console.log('\n  14. HTML rendering');
{
  const html = renderTailoredHTML(makeValidDraft(), makeProfile());
  check('HTML contains candidate name', html.includes('Ali Hassan'), true);
  check('HTML contains summary text', html.includes('Third-year CS student'), true);
  check('HTML contains Arbisoft', html.includes('Arbisoft'), true);
  check('HTML contains SentimentBot', html.includes('SentimentBot'), true);
  check('HTML contains LUMS', html.includes('LUMS'), true);
  check('HTML contains Python', html.includes('Python'), true);
  check('HTML is valid html', html.includes('<!DOCTYPE html>'), true);
}

// ═══════════════════════════════════════════════════════════════
// 15. Record schema completeness
// ═══════════════════════════════════════════════════════════════
console.log('\n  15. Record schema completeness');
{
  const record = await tailorCV({
    profile: makeProfile(), cvText: MASTER_CV, opportunity: makeOpportunity(),
    matchingConfig: { ai_provider: 'gemini', model: 'test' },
    callAIFn: mockAI(makeValidDraft()),
  });
  const FIELDS = ['opportunity_id','opportunity_title','opportunity_company','tailored_at','provider_used','model_used','source_facts','validation_result','validation_violations','validation_flagged','original_cv','tailored_draft','tailored_html','tailoring_notes'];
  for (const f of FIELDS) check(`Field "${f}" present`, f in record, true);
}

// ═══════════════════════════════════════════════════════════════
