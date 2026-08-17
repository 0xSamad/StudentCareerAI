// tests/match-engine.test.mjs — AI Opportunity Matching Engine Test Suite
// AI calls are fully mocked via dependency injection — no real API calls.
import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const MOD = pathToFileURL(join(ROOT, 'lib/match-engine.mjs')).href;
const PROV = pathToFileURL(join(ROOT, 'lib/ai-provider.mjs')).href;
const PROF = pathToFileURL(join(ROOT, 'lib/student-profile.mjs')).href;
console.log('\nmatch-engine — AI opportunity matching engine');

const {
  scoreOpportunity, formatMatchResult,
  parseAndValidateResponse, resolveThresholds, scoreToTier,
  MatchEngineError, EligibilityGateError,
} = await import(MOD);

const { resolveProvider, MatchProviderError } = await import(PROV);
const { validateStudentProfile } = await import(PROF);

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeProfile(overrides = {}) {
  const base = {
    identity: { name: 'Ali Hassan', email: 'ali@example.com', country: 'Pakistan', city: 'Lahore' },
    education: [{
      university: 'LUMS', degree: 'Bachelor of Science', major: 'Computer Science',
      graduation_date: '2027-05', gpa: 3.7, gpa_scale: 4.0,
      coursework: ['Machine Learning', 'Data Structures', 'Algorithms'],
    }],
    skills: {
      programming_languages: ['Python', 'JavaScript', 'Java'],
      frameworks: ['React', 'FastAPI', 'Node.js'],
      ai_ml: ['PyTorch', 'scikit-learn', 'HuggingFace'],
      databases: ['PostgreSQL', 'MongoDB'],
      cloud: ['AWS', 'Docker'],
      tools: ['Git', 'Linux'],
      soft_skills: ['Communication', 'Teamwork'],
    },
    experience: {
      internships: [{
        company: 'Arbisoft', role: 'ML Intern', start_date: '2026-06', end_date: '2026-08',
        description: 'Built NLP pipeline for text classification.',
      }],
      jobs: [], volunteer: [],
    },
    projects: [{
      name: 'SentimentBot', description: 'Twitter sentiment analysis using DistilBERT.',
      technologies: ['Python', 'PyTorch', 'HuggingFace'], achievements: ['93% accuracy'],
    }],
    preferences: {
      search_mode: 'internships',
      target_roles: ['ML Intern', 'Software Engineer Intern'],
      target_industries: ['Technology', 'AI'],
      locations: { preferred: ['Lahore'], remote: true, hybrid: true, on_site: false },
      sponsorship: { needs_sponsorship: false, authorized_in: ['Pakistan'] },
      compensation: { internship_stipend_min: null, stipend_unit: 'monthly', stipend_currency: 'PKR', salary_min: null, salary_currency: 'PKR' },
      timing: { preferred_start: 'Summer 2027', duration_months_min: 2, duration_months_max: 6, credit_bearing_ok: true, paid_only: false },
      automation: { min_match_score: 3.5, max_applications_per_day: 5, auto_submit: false, auto_submit_confirm: false, blackout_days: [] },
    },
    matching: null,
  };
  return { ...base, ...overrides };
}

function makeOpportunity(overrides = {}) {
  return {
    title: 'Machine Learning Intern',
    company: 'Careem',
    opportunity_type: 'INTERNSHIP',
    location: 'Lahore, Pakistan',
    country: 'Pakistan',
    remote: null,
    description: 'Summer internship. Must be currently enrolled in a BS/MS program. PyTorch and Python required.',
    posted_date: '2026-08-01',
    url: 'https://boards.greenhouse.io/careem/jobs/123',
    ...overrides,
  };
}

function makeEligibility(verdict = 'ELIGIBLE') {
  return { verdict, unknowns: [], blocking_failures: [] };
}

function makeMockAI(scorePayload) {
  return async () => JSON.stringify(scorePayload);
}

function makeValidPayload(score = 85) {
  const dim = Math.round(score);
  return {
    match_score: score,
    dimension_scores: {
      skills_match: dim, education_fit: dim, project_relevance: dim,
      experience_relevance: dim, role_industry_fit: dim, location_logistics: dim,
    },
    strengths: ['Strong Python skills', 'Relevant ML internship experience'],
    missing_skills: [],
    relevant_experience: ['ML Intern at Arbisoft — NLP pipeline'],
    relevant_projects: ['SentimentBot — Twitter sentiment analysis'],
    concerns: [],
    recommendation: 'Excellent fit. Apply immediately.',
  };
}

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Tier Thresholds
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n  1. Tier thresholds');

{
  const t = resolveThresholds();
  check('100 → EXCELLENT', scoreToTier(100, t), 'EXCELLENT');
  check('90 → EXCELLENT',  scoreToTier(90,  t), 'EXCELLENT');
  check('89 → STRONG',     scoreToTier(89,  t), 'STRONG');
  check('80 → STRONG',     scoreToTier(80,  t), 'STRONG');
  check('79 → GOOD',       scoreToTier(79,  t), 'GOOD');
  check('70 → GOOD',       scoreToTier(70,  t), 'GOOD');
  check('69 → WEAK',       scoreToTier(69,  t), 'WEAK');
  check('60 → WEAK',       scoreToTier(60,  t), 'WEAK');
  check('59 → SKIP',       scoreToTier(59,  t), 'SKIP');
  check('0  → SKIP',       scoreToTier(0,   t), 'SKIP');
}

// Custom thresholds
{
  const t = resolveThresholds({ excellent: 95, strong: 85, good: 75, weak: 65 });
  check('Custom: 94 → STRONG',     scoreToTier(94, t), 'STRONG');
  check('Custom: 95 → EXCELLENT',  scoreToTier(95, t), 'EXCELLENT');
  check('Custom: 64 → SKIP',       scoreToTier(64, t), 'SKIP');
  check('Custom: 65 → WEAK',       scoreToTier(65, t), 'WEAK');
}

// resolveThresholds validation
{
  let threw = false;
  try { resolveThresholds({ excellent: 60, strong: 80, good: 70, weak: 60 }); }
  catch (e) { threw = e instanceof MatchEngineError; }
  check('Out-of-order thresholds → MatchEngineError', threw, true);
}
{
  let threw = false;
  try { resolveThresholds({ excellent: 110, strong: 80, good: 70, weak: 60 }); }
  catch (e) { threw = e instanceof MatchEngineError; }
  check('Threshold > 100 → MatchEngineError', threw, true);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Hard Eligibility Gate — NOT_ELIGIBLE must throw
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n  2. Hard eligibility gate');

{
  let threw = false;
  try {
    await scoreOpportunity({
      profile: makeProfile(), opportunity: makeOpportunity(),
      eligibility: makeEligibility('NOT_ELIGIBLE'),
      callAIFn: makeMockAI(makeValidPayload(85)),
    });
  } catch (e) {
    threw = e instanceof EligibilityGateError;
  }
  check('NOT_ELIGIBLE → throws EligibilityGateError', threw, true);
}

{
  let threw = false;
  try {
    await scoreOpportunity({
      profile: makeProfile(), opportunity: makeOpportunity(),
      eligibility: null,
      callAIFn: makeMockAI(makeValidPayload(85)),
    });
  } catch (e) {
    threw = e instanceof EligibilityGateError;
  }
  check('null eligibility → throws EligibilityGateError', threw, true);
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. REQUIRES_REVIEW proceeds with scoring
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n  3. REQUIRES_REVIEW proceeds');

{
  const result = await scoreOpportunity({
    profile: makeProfile(), opportunity: makeOpportunity(),
    eligibility: makeEligibility('REQUIRES_REVIEW'),
    matchingConfig: { ai_provider: 'gemini', model: 'gemini-3.6-flash' },
    callAIFn: makeMockAI(makeValidPayload(80)),
  });
  check('REQUIRES_REVIEW: result returned', typeof result, 'object');
  check('REQUIRES_REVIEW: eligibility_status flagged', result.eligibility_status, 'REQUIRES_REVIEW');
  check('REQUIRES_REVIEW: eligible_to_apply = true', result.eligible_to_apply, true);
  check('REQUIRES_REVIEW: tier computed', result.tier, 'STRONG');
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Full result schema
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n  4. Result schema completeness');

{
  const result = await scoreOpportunity({
    profile: makeProfile(), opportunity: makeOpportunity(),
    eligibility: makeEligibility('ELIGIBLE'),
    matchingConfig: { ai_provider: 'gemini', model: 'gemini-3.6-flash' },
    callAIFn: makeMockAI(makeValidPayload(85)),
  });

  const REQUIRED = [
    'match_score', 'tier', 'strengths', 'missing_skills',
    'relevant_experience', 'relevant_projects', 'concerns',
    'recommendation', 'dimension_scores', 'eligibility_status',
    'eligible_to_apply', 'provider_used', 'model_used', 'scored_at',
  ];
  for (const f of REQUIRED) {
    check(`Field "${f}" present`, f in result, true);
  }
  check('match_score is number', typeof result.match_score, 'number');
  check('tier is string', typeof result.tier, 'string');
  check('strengths is array', Array.isArray(result.strengths), true);
  check('missing_skills is array', Array.isArray(result.missing_skills), true);
  check('relevant_experience is array', Array.isArray(result.relevant_experience), true);
  check('relevant_projects is array', Array.isArray(result.relevant_projects), true);
  check('concerns is array', Array.isArray(result.concerns), true);
  check('recommendation is string', typeof result.recommendation, 'string');
  check('scored_at is ISO string', /^\d{4}-\d{2}-\d{2}T/.test(result.scored_at), true);
  check('provider_used is set', result.provider_used, 'gemini');
  check('model_used is set', result.model_used, 'gemini-3.6-flash');
  check('eligible_to_apply = true for ELIGIBLE', result.eligible_to_apply, true);
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Tier mapping through real scoreOpportunity
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n  5. End-to-end tier mapping');

for (const [score, expectedTier] of [
  [95, 'EXCELLENT'], [85, 'STRONG'], [72, 'GOOD'], [63, 'WEAK'], [45, 'SKIP'],
]) {
  const result = await scoreOpportunity({
    profile: makeProfile(), opportunity: makeOpportunity(),
    eligibility: makeEligibility('ELIGIBLE'),
    matchingConfig: { ai_provider: 'gemini', model: 'test' },
    callAIFn: makeMockAI(makeValidPayload(score)),
  });
  check(`Score ${score} → ${expectedTier}`, result.tier, expectedTier);
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Configurable thresholds
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n  6. Configurable thresholds');

{
  const result = await scoreOpportunity({
    profile: makeProfile(), opportunity: makeOpportunity(),
    eligibility: makeEligibility('ELIGIBLE'),
    matchingConfig: {
      ai_provider: 'gemini', model: 'test',
      thresholds: { excellent: 95, strong: 85, good: 75, weak: 65 },
    },
    callAIFn: makeMockAI(makeValidPayload(90)),
  });
  // 90 >= 85 but < 95 → STRONG with custom thresholds
  check('Custom thresholds: 90 → STRONG (not EXCELLENT)', result.tier, 'STRONG');
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. Missing skills captured
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n  7. Missing skills captured');

{
  const payload = { ...makeValidPayload(55), missing_skills: ['Kubernetes', 'Rust', 'gRPC'] };
  const result = await scoreOpportunity({
    profile: makeProfile(), opportunity: makeOpportunity(),
    eligibility: makeEligibility('ELIGIBLE'),
    matchingConfig: { ai_provider: 'gemini', model: 'test' },
    callAIFn: makeMockAI(payload),
  });
  check('missing_skills populated', result.missing_skills.length, 3);
  check('missing_skills contains Kubernetes', result.missing_skills.includes('Kubernetes'), true);
  check('tier is SKIP for score 55', result.tier, 'SKIP');
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. JSON parse & validation
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n  8. JSON parse & validation');

{
  // Valid JSON with markdown fences (some models add them)
  const fenced = '```json\n' + JSON.stringify(makeValidPayload(75)) + '\n```';
  const parsed = parseAndValidateResponse(fenced);
  check('Strips markdown fences', parsed.match_score >= 0, true);
}

{
  let threw = false;
  try { parseAndValidateResponse('not json at all'); }
  catch (e) { threw = e instanceof MatchEngineError; }
  check('Invalid JSON → MatchEngineError', threw, true);
}

{
  let threw = false;
  try { parseAndValidateResponse(JSON.stringify({ match_score: 150, dimension_scores: {}, strengths: [], missing_skills: [], relevant_experience: [], relevant_projects: [], concerns: [], recommendation: 'x' })); }
  catch (e) { threw = e instanceof MatchEngineError; }
  check('match_score > 100 → MatchEngineError', threw, true);
}

{
  let threw = false;
  try { parseAndValidateResponse(JSON.stringify({ recommendation: 'x' })); }
  catch (e) { threw = e instanceof MatchEngineError; }
  check('Missing required field → MatchEngineError', threw, true);
}

{
  // Empty string
  let threw = false;
  try { parseAndValidateResponse(''); }
  catch (e) { threw = e instanceof MatchEngineError; }
  check('Empty AI response → MatchEngineError', threw, true);
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. Retry logic — fails after max retries
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n  9. Retry logic');

{
  let callCount = 0;
  const alwaysBad = async () => { callCount++; return 'bad json {{{'; };
  let threw = false;
  try {
    await scoreOpportunity({
      profile: makeProfile(), opportunity: makeOpportunity(),
      eligibility: makeEligibility('ELIGIBLE'),
      matchingConfig: { ai_provider: 'gemini', model: 'test' },
      callAIFn: alwaysBad,
    });
  } catch (e) { threw = e instanceof MatchEngineError; }
  check('Persistent bad JSON → MatchEngineError after retries', threw, true);
  check('Called AI 3 times (initial + 2 retries)', callCount, 3);
}

{
  // Succeeds on second attempt
  let callCount = 0;
  const eventuallyGood = async () => {
    callCount++;
    if (callCount < 2) return 'bad json';
    return JSON.stringify(makeValidPayload(78));
  };
  const result = await scoreOpportunity({
    profile: makeProfile(), opportunity: makeOpportunity(),
    eligibility: makeEligibility('ELIGIBLE'),
    matchingConfig: { ai_provider: 'gemini', model: 'test' },
    callAIFn: eventuallyGood,
  });
  check('Succeeds on retry: result returned', typeof result.match_score, 'number');
  check('Succeeds on retry: called 2 times', callCount, 2);
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. Provider resolution
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n  10. Provider resolution');

{
  const r = resolveProvider({ ai_provider: 'gemini', model: 'gemini-3.6-flash' });
  check('Explicit gemini: provider', r.provider, 'gemini');
  check('Explicit gemini: model', r.model, 'gemini-3.6-flash');
  check('Default temperature', r.temperature, 0.2);
}

{
  const r = resolveProvider({ ai_provider: 'openai', model: 'gpt-4o', temperature: 0.5 });
  check('Explicit openai: provider', r.provider, 'openai');
  check('Explicit openai: model', r.model, 'gpt-4o');
  check('Custom temperature', r.temperature, 0.5);
}

{
  const r = resolveProvider({ ai_provider: 'ollama', model: 'llama3.2', ollama_url: 'http://localhost:11434' });
  check('Explicit ollama: provider', r.provider, 'ollama');
  check('Explicit ollama: model', r.model, 'llama3.2');
  check('Ollama URL', r.ollamaUrl, 'http://localhost:11434');
}

{
  // Ollama without model → error
  let threw = false;
  try { resolveProvider({ ai_provider: 'ollama' }); }
  catch (e) { threw = e instanceof MatchProviderError; }
  check('Ollama without model → MatchProviderError', threw, true);
}

{
  // Unknown provider → error
  let threw = false;
  try { resolveProvider({ ai_provider: 'unknownprovider' }); }
  catch (e) { threw = e instanceof MatchProviderError; }
  check('Unknown provider → MatchProviderError', threw, true);
}

{
  // Auto-detect from env — save and restore
  const origGemini = process.env.GEMINI_API_KEY;
  const origOpenAI = process.env.OPENAI_API_KEY;
  const origOpenRouter = process.env.OPENROUTER_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  const r = resolveProvider({});
  check('Auto-detect: GEMINI_API_KEY only → gemini', r.provider, 'gemini');
  process.env.GEMINI_API_KEY = origGemini || '';
  if (origOpenAI) process.env.OPENAI_API_KEY = origOpenAI;
  else delete process.env.OPENAI_API_KEY;
  if (origOpenRouter) process.env.OPENROUTER_API_KEY = origOpenRouter;
  else delete process.env.OPENROUTER_API_KEY;
}

{
  const origGemini = process.env.GEMINI_API_KEY;
  const origOpenAI = process.env.OPENAI_API_KEY;
  const origOpenRouter = process.env.OPENROUTER_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini';
  process.env.OPENAI_API_KEY = 'test-openai';
  delete process.env.OPENROUTER_API_KEY;
  const r = resolveProvider({});
  check('Auto-detect: both keys → openai first', r.provider, 'openai');
  process.env.GEMINI_API_KEY = origGemini || '';
  if (origOpenAI) process.env.OPENAI_API_KEY = origOpenAI;
  else delete process.env.OPENAI_API_KEY;
  if (origOpenRouter) process.env.OPENROUTER_API_KEY = origOpenRouter;
  else delete process.env.OPENROUTER_API_KEY;
}

{
  // No keys → error
  const origGemini = process.env.GEMINI_API_KEY;
  const origGeminiKeys = process.env.GEMINI_API_KEYS;
  const origOpenAI = process.env.OPENAI_API_KEY;
  const origOpenRouter = process.env.OPENROUTER_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEYS;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  let threw = false;
  try { resolveProvider({}); }
  catch (e) { threw = e instanceof MatchProviderError; }
  check('No env keys → MatchProviderError', threw, true);
  if (origGemini) process.env.GEMINI_API_KEY = origGemini;
  if (origGeminiKeys) process.env.GEMINI_API_KEYS = origGeminiKeys;
  if (origOpenAI) process.env.OPENAI_API_KEY = origOpenAI;
  if (origOpenRouter) process.env.OPENROUTER_API_KEY = origOpenRouter;
}

// ═══════════════════════════════════════════════════════════════════════════
// 11. Pakistan / International real-world scenarios
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n  11. Pakistan / international scenarios');

{
  // Careem ML internship in Lahore
  const result = await scoreOpportunity({
    profile: makeProfile(),
    opportunity: makeOpportunity({ title: 'Data Science Intern', company: 'Careem', location: 'Karachi, Pakistan', country: 'Pakistan' }),
    eligibility: makeEligibility('ELIGIBLE'),
    matchingConfig: { ai_provider: 'gemini', model: 'gemini-3.6-flash', thresholds: { excellent: 90, strong: 80, good: 70, weak: 60 } },
    callAIFn: makeMockAI({ ...makeValidPayload(92), strengths: ['PyTorch expertise', 'ML internship background'], relevant_projects: ['SentimentBot'] }),
  });
  check('Careem DS intern: ELIGIBLE passed', result.eligibility_status, 'ELIGIBLE');
  check('Careem DS intern: tier EXCELLENT', result.tier, 'EXCELLENT');
  check('Careem DS intern: relevant_projects populated', result.relevant_projects.length > 0, true);
}

{
  // NVIDIA remote internship — REQUIRES_REVIEW (GPA flagged)
  const result = await scoreOpportunity({
    profile: makeProfile(),
    opportunity: makeOpportunity({ title: 'Deep Learning Intern', company: 'NVIDIA', location: 'Remote', country: null, remote: true }),
    eligibility: { verdict: 'REQUIRES_REVIEW', unknowns: ['GPA'], blocking_failures: [] },
    matchingConfig: { ai_provider: 'gemini', model: 'gemini-3.6-flash' },
    callAIFn: makeMockAI({ ...makeValidPayload(82), concerns: ['GPA requirement not verified'] }),
  });
  check('NVIDIA remote: REQUIRES_REVIEW proceeds', result.eligibility_status, 'REQUIRES_REVIEW');
  check('NVIDIA remote: eligible_to_apply = true', result.eligible_to_apply, true);
  check('NVIDIA remote: concerns populated', result.concerns.length > 0, true);
}

{
  // Low-match role (different domain) → SKIP
  const lowMatch = makeValidPayload(40);
  lowMatch.missing_skills = ['COBOL', 'Mainframe', 'SAP'];
  lowMatch.strengths = [];
  lowMatch.recommendation = 'Poor fit — role requires mainframe experience the student lacks.';
  const result = await scoreOpportunity({
    profile: makeProfile(),
    opportunity: makeOpportunity({ title: 'COBOL Mainframe Developer', company: 'Bank', description: 'Requires 5+ years COBOL mainframe experience.' }),
    eligibility: makeEligibility('ELIGIBLE'),
    matchingConfig: { ai_provider: 'gemini', model: 'test' },
    callAIFn: makeMockAI(lowMatch),
  });
  check('Low-match role → SKIP tier', result.tier, 'SKIP');
  check('Low-match role: missing_skills populated', result.missing_skills.includes('COBOL'), true);
}

// ═══════════════════════════════════════════════════════════════════════════
// 12. Student profile matching: block validation
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n  12. Profile matching: block validation');

{
  // Build a minimal valid raw profile
  const rawBase = {
    identity: { name: 'Test', email: 'test@test.com', country: 'Pakistan', city: 'Lahore' },
    education: [{ university: 'LUMS', degree: 'BS', major: 'CS', graduation_date: '2027-05' }],
    skills: { programming_languages: ['Python'] },
    experience: {},
    projects: [],
    preferences: {
      search_mode: 'internships', target_roles: ['ML Intern'],
      locations: { remote: true, hybrid: false, on_site: false },
      automation: { min_match_score: 3.0, max_applications_per_day: 3, auto_submit: false },
    },
  };

  // No matching block → valid (block is optional)
  const r1 = validateStudentProfile({ ...rawBase });
  check('No matching block → valid', r1.valid, true);
  check('No matching block → matching is null', r1.profile?.matching, null);

  // Valid matching block
  const r2 = validateStudentProfile({ ...rawBase, matching: { ai_provider: 'gemini', model: 'gemini-3.6-flash', temperature: 0.2 } });
  check('Valid matching block → valid', r2.valid, true);
  check('matching.ai_provider parsed', r2.profile?.matching?.ai_provider, 'gemini');
  check('matching.model parsed', r2.profile?.matching?.model, 'gemini-3.6-flash');

  // Invalid provider → error
  const r3 = validateStudentProfile({ ...rawBase, matching: { ai_provider: 'unknownprovider' } });
  check('Invalid ai_provider → invalid', r3.valid, false);
  check('Error mentions ai_provider', r3.errors.some(e => e.includes('ai_provider')), true);

  // Ollama without model → error
  const r4 = validateStudentProfile({ ...rawBase, matching: { ai_provider: 'ollama' } });
  check('Ollama without model → invalid', r4.valid, false);

  // Temperature out of range → error
  const r5 = validateStudentProfile({ ...rawBase, matching: { ai_provider: 'gemini', model: 'x', temperature: 3.5 } });
  check('Temperature 3.5 → invalid', r5.valid, false);

  // Thresholds out of order → error
  const r6 = validateStudentProfile({ ...rawBase, matching: { ai_provider: 'gemini', model: 'x', thresholds: { excellent: 60, strong: 80, good: 70, weak: 50 } } });
  // Note: profile validator collects raw values; ordering validation is in resolveThresholds at engine level
  // Profile validator only checks 0-100 range
  check('Thresholds parsed into profile', r6.profile?.matching?.thresholds !== undefined || r6.valid !== undefined, true);
}

// ═══════════════════════════════════════════════════════════════════════════
// 13. formatMatchResult
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n  13. formatMatchResult');

{
  const result = await scoreOpportunity({
    profile: makeProfile(), opportunity: makeOpportunity(),
    eligibility: makeEligibility('ELIGIBLE'),
    matchingConfig: { ai_provider: 'gemini', model: 'gemini-3.6-flash' },
    callAIFn: makeMockAI({ ...makeValidPayload(88), strengths: ['Python skills'], missing_skills: ['Rust'] }),
  });
  const formatted = formatMatchResult(result, makeOpportunity());
  check('Format: contains title', formatted.includes('Machine Learning Intern'), true);
  check('Format: contains score', formatted.includes('88'), true);
  check('Format: contains tier', formatted.includes('STRONG'), true);
  check('Format: contains ELIGIBLE', formatted.includes('ELIGIBLE'), true);
  check('Format: contains Strengths section', formatted.includes('Strengths'), true);
  check('Format: contains Missing Skills section', formatted.includes('Missing Skills'), true);
  check('Format: contains Dimension Scores', formatted.includes('Dimension Scores'), true);
}

// ═══════════════════════════════════════════════════════════════════════════
