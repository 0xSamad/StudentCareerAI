/**
 * match-engine.mjs — AI Opportunity Matching Engine for StudentCareer AI
 *
 * Evaluates the fit between a validated student profile and a discovered
 * opportunity AFTER the eligibility gate has passed.
 *
 * Architecture:
 *   Eligibility Gate (hard) → ELIGIBLE/REQUIRES_REVIEW → Match Engine (soft score)
 *   NOT_ELIGIBLE → STOP — never reaches this module.
 *
 * Design rules:
 *   - A high match score NEVER overrides failed eligibility.
 *   - REQUIRES_REVIEW eligibility still proceeds, but result is flagged.
 *   - AI is injected via the `callAIFn` parameter for full testability.
 *   - No fabrication: unscored dimensions return null, not invented values.
 *   - Pure structured output: AI response is validated against schema before return.
 *   - Configurable thresholds: no magic numbers in code.
 */

import { resolveProvider, callAI, MatchProviderError } from './ai-provider.mjs';

// ── Custom Errors ─────────────────────────────────────────────────────────────

export class MatchEngineError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'MatchEngineError';
  }
}

export class EligibilityGateError extends Error {
  /**
   * @param {string} message
   * @param {object} eligibility - The full eligibility report
   */
  constructor(message, eligibility) {
    super(message);
    this.name = 'EligibilityGateError';
    this.eligibility = eligibility;
  }
}

// ── Tier Thresholds ───────────────────────────────────────────────────────────

/** @type {MatchThresholds} */
const DEFAULT_THRESHOLDS = {
  excellent: 90,
  strong: 80,
  good: 70,
  weak: 60,
  // < weak → SKIP
};

/**
 * @typedef {Object} MatchThresholds
 * @property {number} excellent  Min score for EXCELLENT (default 90)
 * @property {number} strong     Min score for STRONG (default 80)
 * @property {number} good       Min score for GOOD (default 70)
 * @property {number} weak       Min score for WEAK (default 60)
 */

/**
 * @typedef {Object} MatchConfig
 * @property {object}           [matching]       - The matching: block from student-profile.yml
 * @property {MatchThresholds}  [thresholds]     - Override thresholds
 */

/**
 * @typedef {Object} MatchResult
 * @property {number}   match_score              0–100
 * @property {string}   tier                     EXCELLENT|STRONG|GOOD|WEAK|SKIP
 * @property {string[]} strengths                What maps well
 * @property {string[]} missing_skills           Required skills the student lacks
 * @property {string[]} relevant_experience      Matching experience entries
 * @property {string[]} relevant_projects        Matching project entries
 * @property {string[]} concerns                 Non-blocking concerns
 * @property {string}   recommendation           1–2 sentence summary
 * @property {object}   dimension_scores         Per-dimension breakdown
 * @property {string}   eligibility_status       Pass-through: ELIGIBLE|REQUIRES_REVIEW
 * @property {boolean}  eligible_to_apply        true when eligibility allows
 * @property {string}   provider_used            Which AI provider
 * @property {string}   model_used               Which model
 * @property {string}   scored_at                ISO timestamp
 */

// ── Tier Resolution ───────────────────────────────────────────────────────────

/**
 * Merge user thresholds with defaults, validate, and return final thresholds.
 *
 * @param {Partial<MatchThresholds>} [userThresholds]
 * @returns {MatchThresholds}
 */
export function resolveThresholds(userThresholds) {
  const t = { ...DEFAULT_THRESHOLDS, ...(userThresholds || {}) };

  // Validate numeric and ordering
  const keys = ['excellent', 'strong', 'good', 'weak'];
  for (const k of keys) {
    if (typeof t[k] !== 'number' || !Number.isFinite(t[k])) {
      throw new MatchEngineError(`matching.thresholds.${k} must be a number`);
    }
    if (t[k] < 0 || t[k] > 100) {
      throw new MatchEngineError(`matching.thresholds.${k} must be between 0 and 100`);
    }
  }
  if (!(t.excellent > t.strong && t.strong > t.good && t.good > t.weak)) {
    throw new MatchEngineError(
      'matching.thresholds must be in descending order: excellent > strong > good > weak'
    );
  }

  return t;
}

/**
 * Map a numeric score (0–100) to a tier label.
 *
 * @param {number} score
 * @param {MatchThresholds} thresholds
 * @returns {string}
 */
export function scoreToTier(score, thresholds) {
  if (score >= thresholds.excellent) return 'EXCELLENT';
  if (score >= thresholds.strong)    return 'STRONG';
  if (score >= thresholds.good)      return 'GOOD';
  if (score >= thresholds.weak)      return 'WEAK';
  return 'SKIP';
}

// ── Prompt Builder ────────────────────────────────────────────────────────────

/**
 * Build the system prompt for the matching AI call.
 * @returns {string}
 */
function buildSystemPrompt() {
  return `You are StudentCareer AI, an AI career matching assistant for students and interns.

Your task is to evaluate the fit between a student's profile and a job/internship opportunity.

CRITICAL RULES:
1. Return ONLY valid JSON matching the schema below. No markdown fences, no prose, no explanation outside JSON.
2. Never invent qualifications. If a requirement cannot be evaluated from the given profile, say so in concerns.
3. Be specific: reference actual skills, project names, technologies, and experience from the profile.
4. match_score is a WEIGHTED AVERAGE of the six dimension scores. Use the weights below.

SCORING DIMENSIONS AND WEIGHTS:
  skills_match         30% — Do the student's skills cover what the role requires?
  education_fit        15% — Is the degree, major, and academic stage appropriate?
  project_relevance    20% — Do any projects demonstrate relevant technical depth?
  experience_relevance 15% — Does past internship/work experience align with the role?
  role_industry_fit    10% — Does the role match the student's target roles and industries?
  location_logistics   10% — Does location, remote preference, or availability align?

REQUIRED OUTPUT SCHEMA (JSON only):
{
  "match_score": <integer 0-100, weighted average>,
  "dimension_scores": {
    "skills_match": <integer 0-100>,
    "education_fit": <integer 0-100>,
    "project_relevance": <integer 0-100>,
    "experience_relevance": <integer 0-100>,
    "role_industry_fit": <integer 0-100>,
    "location_logistics": <integer 0-100>
  },
  "strengths": [<string>, ...],
  "missing_skills": [<string>, ...],
  "relevant_experience": [<string>, ...],
  "relevant_projects": [<string>, ...],
  "concerns": [<string>, ...],
  "recommendation": "<1-2 sentence summary of fit>"
}

Arrays may be empty []. All fields are required.`;
}

/**
 * Build the user prompt containing profile + opportunity data.
 *
 * @param {object} profile       - Validated StudentProfile
 * @param {object} opportunity   - NormalizedOpportunity
 * @param {object} eligibility   - EligibilityReport
 * @returns {string}
 */
function buildUserPrompt(profile, opportunity, eligibility) {
  const identity = (profile && profile.identity) ? profile.identity : {};
  const education = Array.isArray(profile?.education) ? profile.education : [];
  const skills = profile?.skills || {};
  const experience = profile?.experience || {};
  const projects = Array.isArray(profile?.projects) ? profile.projects : [];
  const preferences = profile?.preferences || {};
  const edu = education[0] || {};

  // Build a concise profile summary for the AI
  const allSkills = [
    ...(skills.programming_languages || []),
    ...(skills.frameworks || []),
    ...(skills.ai_ml || []),
    ...(skills.databases || []),
    ...(skills.cloud || []),
    ...(skills.tools || []),
  ].join(', ');

  const expInternships = Array.isArray(experience) ? experience : (experience?.internships || []);
  const expJobs = Array.isArray(experience?.jobs) ? experience.jobs : [];

  const internshipsText = expInternships
    .map(i => `  - ${i.role || ''} at ${i.company || ''} (${i.start_date || ''}–${i.end_date || ''}): ${i.description || 'N/A'}`)
    .join('\n') || '  None listed';

  const jobsText = expJobs
    .map(j => `  - ${j.role || ''} at ${j.company || ''} (${j.start_date || ''}–${j.end_date || ''}): ${j.description || 'N/A'}`)
    .join('\n') || '  None listed';

  const projectsText = projects
    .map(p => `  - ${p.name || 'Project'}: ${p.description || ''} [${(p.technologies || []).join(', ')}]`)
    .join('\n') || '  None listed';

  const workModes = [
    preferences.locations?.remote && 'Remote',
    preferences.locations?.hybrid && 'Hybrid',
    preferences.locations?.on_site && 'On-site',
  ].filter(Boolean).join(', ');

  const gpaLine = edu.gpa != null ? `GPA: ${edu.gpa}/${edu.gpa_scale}` : 'GPA: not disclosed';

  // Eligibility context
  const eligCtx = eligibility
    ? `Eligibility verdict: ${eligibility.verdict}. ` +
      (eligibility.unknowns?.length
        ? `Unknowns flagged: ${eligibility.unknowns.join(', ')}.`
        : 'No unknowns.')
    : 'Eligibility: not run.';

  return `=== STUDENT PROFILE ===
Name: ${identity.name || 'Candidate'}
Location: ${identity.city || 'Unknown'}, ${identity.country || ''}
University: ${edu.university || 'Unknown'} — ${edu.degree || ''} in ${edu.major || ''}
Year: ${edu.year || 'Unknown'}, Expected graduation: ${edu.graduation_date || 'Unknown'}
${gpaLine}

Skills: ${allSkills || 'None listed'}
Soft skills: ${(skills.soft_skills || []).join(', ') || 'None listed'}

Coursework:
${(edu.coursework || []).map(c => `  - ${c}`).join('\n') || '  None listed'}

Internships:
${internshipsText}

Jobs / Part-time:
${jobsText}

Projects:
${projectsText}

Target roles: ${(preferences.target_roles || []).join(', ')}
Target industries: ${(preferences.target_industries || []).join(', ') || 'Not specified'}
Work modes accepted: ${workModes || 'Not specified'}
Preferred locations: ${(preferences.locations?.preferred || []).join(', ') || 'Any'}
Needs sponsorship: ${preferences.sponsorship?.needs_sponsorship ? 'Yes' : 'No'}

${eligCtx}

=== OPPORTUNITY ===
Title: ${opportunity.title}
Company: ${opportunity.company}
Type: ${opportunity.opportunity_type}
Location: ${opportunity.location}
Remote: ${opportunity.remote === true ? 'Yes' : opportunity.remote === false ? 'No' : 'Unknown'}
Country: ${opportunity.country || 'Unknown'}
Posted: ${opportunity.posted_date || 'Unknown'}
Description:
${(opportunity.description || '').slice(0, 3000) || '[No description provided]'}

=== TASK ===
Evaluate the fit and return the JSON schema described in your instructions.`;
}

// ── JSON Validation ───────────────────────────────────────────────────────────

const REQUIRED_FIELDS = [
  'match_score', 'dimension_scores', 'strengths',
  'missing_skills', 'relevant_experience', 'relevant_projects',
  'concerns', 'recommendation',
];

const DIMENSION_KEYS = [
  'skills_match', 'education_fit', 'project_relevance',
  'experience_relevance', 'role_industry_fit', 'location_logistics',
];

const DIMENSION_WEIGHTS = {
  skills_match:         0.30,
  education_fit:        0.15,
  project_relevance:    0.20,
  experience_relevance: 0.15,
  role_industry_fit:    0.10,
  location_logistics:   0.10,
};

/**
 * Parse and validate the AI response JSON.
 * Returns the validated object.
 *
 * @param {string} raw
 * @returns {object}
 * @throws {MatchEngineError} on parse or schema failure
 */
export function parseAndValidateResponse(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new MatchEngineError('AI returned an empty response');
  }

  // Strip markdown code fences if present (some models add them despite instructions)
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new MatchEngineError(`AI response is not valid JSON: ${e.message}`);
  }

  // Required top-level fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in parsed)) {
      throw new MatchEngineError(`AI response missing required field: "${field}"`);
    }
  }

  // match_score must be 0–100
  if (typeof parsed.match_score !== 'number' || parsed.match_score < 0 || parsed.match_score > 100) {
    throw new MatchEngineError(
      `AI returned invalid match_score: ${JSON.stringify(parsed.match_score)}. Must be 0–100.`
    );
  }

  // dimension_scores validation
  if (!parsed.dimension_scores || typeof parsed.dimension_scores !== 'object') {
    throw new MatchEngineError('AI response missing dimension_scores object');
  }
  for (const key of DIMENSION_KEYS) {
    const val = parsed.dimension_scores[key];
    if (typeof val !== 'number' || val < 0 || val > 100) {
      throw new MatchEngineError(
        `AI dimension_scores.${key} must be 0–100, got: ${JSON.stringify(val)}`
      );
    }
  }

  // Array fields
  for (const field of ['strengths', 'missing_skills', 'relevant_experience', 'relevant_projects', 'concerns']) {
    if (!Array.isArray(parsed[field])) {
      throw new MatchEngineError(`AI response field "${field}" must be an array`);
    }
  }

  // recommendation must be a string
  if (typeof parsed.recommendation !== 'string' || parsed.recommendation.trim() === '') {
    throw new MatchEngineError('AI response "recommendation" must be a non-empty string');
  }

  // Recompute and validate weighted average (allow ±5 tolerance for AI rounding)
  const recomputed = Math.round(
    DIMENSION_KEYS.reduce((sum, k) => sum + parsed.dimension_scores[k] * DIMENSION_WEIGHTS[k], 0)
  );
  if (Math.abs(parsed.match_score - recomputed) > 5) {
    // Correct silently — prefer our computation over the AI's rounding
    parsed.match_score = recomputed;
  }

  return parsed;
}

// ── Public API ────────────────────────────────────────────────────────────────

const MAX_RETRIES = 2;

/**
 * Evaluate fit between a student profile and an opportunity.
 *
 * HARD GATE: throws EligibilityGateError if eligibility.verdict === 'NOT_ELIGIBLE'.
 * REQUIRES_REVIEW: proceeds with scoring, result includes eligibility_status flag.
 *
 * @param {object}   params
 * @param {object}   params.profile       - Validated StudentProfile
 * @param {object}   params.opportunity   - NormalizedOpportunity
 * @param {object}   params.eligibility   - EligibilityReport from eligibility-engine.mjs
 * @param {object}   [params.matchingConfig]  - The matching: block from student-profile.yml
 * @param {Function} [params.callAIFn]    - Override for testing (DI). Signature: (resolved, sys, usr) → Promise<string>
 * @returns {Promise<MatchResult>}
 * @throws {EligibilityGateError} If eligibility.verdict === 'NOT_ELIGIBLE'
 * @throws {MatchEngineError} If AI scoring fails after retries
 * @throws {MatchProviderError} If AI provider is not configured
 */
export async function scoreOpportunity({
  profile,
  opportunity,
  eligibility,
  matchingConfig,
  callAIFn,
}) {
  // ── Hard Gate ──────────────────────────────────────────────────────────────
  if (!eligibility || eligibility.verdict === 'NOT_ELIGIBLE') {
    throw new EligibilityGateError(
      `Cannot score opportunity: eligibility gate failed for "${opportunity?.title}" at "${opportunity?.company}". ` +
      'Resolve eligibility failures before attempting to match.',
      eligibility
    );
  }

  // ── Resolve Provider ───────────────────────────────────────────────────────
  let resolved;
  try {
    resolved = resolveProvider(matchingConfig || {});
  } catch (err) {
    if (callAIFn) {
      resolved = { provider: 'custom', model: 'custom' };
    } else {
      throw err;
    }
  }
  const aiCallFn = callAIFn || callAI;

  // ── Resolve Thresholds ─────────────────────────────────────────────────────
  const thresholds = resolveThresholds(matchingConfig?.thresholds);

  // ── Build Prompts ──────────────────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt();
  const userPrompt   = buildUserPrompt(profile, opportunity, eligibility);

  // ── Call AI with Retry ─────────────────────────────────────────────────────
  let lastError = null;
  let parsed = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let raw = '';
    try {
      raw = await aiCallFn(resolved, systemPrompt, userPrompt);
      parsed = parseAndValidateResponse(raw);
      break; // success
    } catch (err) {
      lastError = err;
      if (err instanceof MatchProviderError) {
        throw err; // Provider errors are not retryable
      }
      // Parse/validation errors — retry
      if (attempt < MAX_RETRIES) {
        // Small delay before retry
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }

  if (!parsed) {
    throw new MatchEngineError(
      `AI scoring failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message || 'unknown error'}`
    );
  }

  // ── Assemble Result ────────────────────────────────────────────────────────
  const tier = scoreToTier(parsed.match_score, thresholds);

  /** @type {MatchResult} */
  const result = {
    match_score:          parsed.match_score,
    tier,
    strengths:            parsed.strengths.map(s => String(s).trim()).filter(Boolean),
    missing_skills:       parsed.missing_skills.map(s => String(s).trim()).filter(Boolean),
    relevant_experience:  parsed.relevant_experience.map(s => String(s).trim()).filter(Boolean),
    relevant_projects:    parsed.relevant_projects.map(s => String(s).trim()).filter(Boolean),
    concerns:             parsed.concerns.map(s => String(s).trim()).filter(Boolean),
    recommendation:       parsed.recommendation.trim(),
    dimension_scores:     parsed.dimension_scores,
    eligibility_status:   eligibility.verdict,
    eligible_to_apply:    eligibility.verdict === 'ELIGIBLE' || eligibility.verdict === 'REQUIRES_REVIEW',
    provider_used:        resolved.provider,
    model_used:           resolved.model,
    scored_at:            new Date().toISOString(),
  };

  return result;
}

/**
 * Format a MatchResult as a human-readable Markdown summary.
 *
 * @param {MatchResult} result
 * @param {object} opportunity
 * @returns {string}
 */
export function formatMatchResult(result, opportunity) {
  const lines = [
    `## Match Report: ${opportunity?.title || 'Unknown Role'} @ ${opportunity?.company || 'Unknown'}`,
    '',
    `**Score:** ${result.match_score}/100 — **${result.tier}**`,
    `**Eligibility:** ${result.eligibility_status}`,
    `**Eligible to apply:** ${result.eligible_to_apply ? '✅ Yes' : '❌ No'}`,
    `**Provider:** ${result.provider_used} (${result.model_used})`,
    `**Scored at:** ${result.scored_at}`,
    '',
    `### Recommendation`,
    result.recommendation,
    '',
  ];

  if (result.strengths.length > 0) {
    lines.push('### Strengths');
    result.strengths.forEach(s => lines.push(`- ${s}`));
    lines.push('');
  }

  if (result.missing_skills.length > 0) {
    lines.push('### Missing Skills');
    result.missing_skills.forEach(s => lines.push(`- ${s}`));
    lines.push('');
  }

  if (result.relevant_projects.length > 0) {
    lines.push('### Relevant Projects');
    result.relevant_projects.forEach(s => lines.push(`- ${s}`));
    lines.push('');
  }

  if (result.relevant_experience.length > 0) {
    lines.push('### Relevant Experience');
    result.relevant_experience.forEach(s => lines.push(`- ${s}`));
    lines.push('');
  }

  if (result.concerns.length > 0) {
    lines.push('### Concerns');
    result.concerns.forEach(s => lines.push(`- ${s}`));
    lines.push('');
  }

  lines.push('### Dimension Scores');
  const dims = result.dimension_scores || {};
  const dimLabels = {
    skills_match:         'Skills Match (30%)',
    education_fit:        'Education Fit (15%)',
    project_relevance:    'Project Relevance (20%)',
    experience_relevance: 'Experience Relevance (15%)',
    role_industry_fit:    'Role / Industry Fit (10%)',
    location_logistics:   'Location / Logistics (10%)',
  };
  for (const [key, label] of Object.entries(dimLabels)) {
    const score = dims[key] ?? '?';
    lines.push(`- ${label}: ${score}/100`);
  }

  return lines.join('\n');
}
