/**
 * application-generator.mjs — Application Content Generator for StudentCareer AI
 *
 * For every selected opportunity, generates:
 *   - Tailored CV         (delegates to cv-tailor.mjs)
 *   - Cover letter        (AI-generated, no fabrication)
 *   - Application summary (deterministic from profile)
 *   - Application answers (per-question with confidence scores)
 *
 * FABRICATION CONTRACT:
 *   - Answers are derived ONLY from profile data.
 *   - If an answer cannot be confidently derived: REQUIRES_USER_INPUT.
 *   - SENSITIVE categories always force REQUIRES_USER_INPUT regardless of
 *     confidence — no exceptions.
 *
 * SENSITIVE CATEGORIES (always REQUIRES_USER_INPUT):
 *   work_authorization | sponsorship | salary | demographic |
 *   disability | criminal_legal | citizenship | relocation
 */

import { resolveProvider, callAI, MatchProviderError } from './ai-provider.mjs';
import { tailorCV, extractSourceFacts, FabricationError } from './cv-tailor.mjs';

// ── Custom Errors ─────────────────────────────────────────────────────────────

export class ApplicationGeneratorError extends Error {
  constructor(message) { super(message); this.name = 'ApplicationGeneratorError'; }
}

// ── Sensitive Categories ──────────────────────────────────────────────────────

export const SENSITIVE_CATEGORIES = Object.freeze([
  'work_authorization',
  'sponsorship',
  'salary',
  'demographic',
  'disability',
  'criminal_legal',
  'citizenship',
  'relocation',
]);

// Keyword patterns → category
const CATEGORY_PATTERNS = [
  { category: 'work_authorization', patterns: [/work\s*authori[sz]/i, /authorized\s+to\s+work/i, /legally\s+eligible/i, /right\s+to\s+work/i, /visa\s+status/i, /employment\s+eligib/i, /work\s+permit/i] },
  { category: 'sponsorship',        patterns: [/sponsor/i, /visa\s+sponsor/i, /h[-\s]?1b/i, /opt\b/i, /cpt\b/i, /ead\b/i] },
  { category: 'salary',             patterns: [/salary\s*expect/i, /compensation\s*expect/i, /desired\s*salary/i, /desired\s*comp/i, /pay\s*expect/i, /stipend\s*expect/i, /hourly\s*rate/i, /annual\s*comp/i] },
  { category: 'demographic',        patterns: [/racial?\b/i, /ethnicity/i, /gender\b/i, /sex\b(?!\s*ual\s+misconduct)/i, /pronouns/i, /\bveteran\b/i, /lgbtq/i, /national\s*origin/i, /religion/i] },
  { category: 'disability',         patterns: [/disability/i, /disabled/i, /accommodation/i, /ada\b/i, /differently\s*abled/i] },
  { category: 'criminal_legal',     patterns: [/criminal/i, /felony/i, /misdemeanor/i, /convicted/i, /background\s*check/i, /legal\s*history/i, /arrest/i, /probation/i] },
  { category: 'citizenship',        patterns: [/citizen\b/i, /citizenship/i, /permanent\s*residen/i, /green\s*card/i, /naturali[sz]/i, /passport/i] },
  { category: 'relocation',         patterns: [/relocat/i, /willing\s+to\s+move/i, /open\s+to\s+relocation/i] },
];

const PROFILE_DERIVABLE_PATTERNS = [
  { category: 'university',   patterns: [/university/i, /college\b/i, /institution/i, /school\b/i] },
  { category: 'degree',       patterns: [/degree\b/i, /major\b/i, /field\s+of\s+study/i, /program\b/i, /education\s+qualification/i, /qualification/i, /highest\s+education/i] },
  { category: 'location',     patterns: [/city\b/i, /location\b/i, /address\b/i, /where\s+are\s+you\s+based/i, /current\s+location/i] },
  { category: 'name',         patterns: [/applicant\s*name/i, /\b(first|last|given|family)\s*name\b/i, /\bfull\s*name\b/i] },
  { category: 'email',        patterns: [/email\s*(address)?/i, /e-mail/i] },
  { category: 'phone',        patterns: [/phone/i, /telephone/i, /mobile/i, /contact\s*number/i] },
  { category: 'graduation',   patterns: [/graduation/i, /expected\s+grad/i, /finish\s+degree/i, /degree\s+completion/i] },
  { category: 'gpa',          patterns: [/\bgpa\b/i, /grade\s*point/i, /academic\s*performance/i, /cumulative\s*average/i] },
  { category: 'linkedin',     patterns: [/linkedin/i] },
  { category: 'github',       patterns: [/github/i, /portfolio/i, /personal\s+website/i, /personal\s+url/i] },
  { category: 'availability', patterns: [/available\s*(to\s*start)?/i, /start\s*date/i, /when\s+can\s+you\s+start/i, /availability/i, /career\s+start/i] },
  { category: 'why_company',  patterns: [/why\s+(do\s+you\s+want\s+to\s+join|are\s+you\s+interested\s+in|this\s+company|us\b)/i, /what\s+excites\s+you\s+about/i, /motivation/i] },
  { category: 'experience',   patterns: [/years?\s+of\s+experience/i, /total\s+experience/i, /how\s+long\s+have\s+you/i, /relevant\s+experience/i, /prior\s+experience/i] },
  { category: 'skills',       patterns: [/\bskills?\b/i, /technologies/i, /programming\s+languages?/i, /tech\s*stack/i] },
  { category: 'cover_text',   patterns: [/cover\s+letter/i, /personal\s+statement/i, /tell\s+us\s+about\s+yourself/i, /introduce\s+yourself/i] },
];

/**
 * Detect the category of a form question.
 * Returns { category: string, isSensitive: boolean }
 */
export function categorizeQuestion(questionText) {
  const q = questionText || '';

  // Sensitive check first — order matters
  for (const { category, patterns } of CATEGORY_PATTERNS) {
    if (patterns.some(re => re.test(q))) {
      return { category, isSensitive: true };
    }
  }

  for (const { category, patterns } of PROFILE_DERIVABLE_PATTERNS) {
    if (patterns.some(re => re.test(q))) {
      return { category, isSensitive: false };
    }
  }

  return { category: 'unknown', isSensitive: false };
}

export function isSensitiveCategory(category) {
  return SENSITIVE_CATEGORIES.includes(category);
}

// ── Deterministic Answer Derivation ──────────────────────────────────────────

const CONFIDENCE_THRESHOLDS = { auto_answer: 0.7 };

/**
 * Split a full name into first/last when the field is clearly one of those.
 * "Full name" stays the whole string.
 */
export function nameAnswerForField(fullName, field = {}) {
  const name = String(fullName || "").trim();
  if (!name) return "";
  const parts = name.split(/\s+/).filter(Boolean);
  const blob = [
    field.name,
    field.id,
    field.nativeName,
    field.nativeId,
    field.label,
    field.accessibleName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/university|college|school|institution|company|employer|tool|file/.test(blob)) return name;
  if (parts.length >= 2 && /first|given/.test(blob) && !/last|full/.test(blob)) return parts[0];
  if (parts.length >= 2 && /last|surname|family/.test(blob)) return parts.slice(1).join(" ");
  return name;
}

/**
 * Try to derive an answer from profile data without AI.
 * Returns { answer, confidence } or null if not derivable.
 */
export function deriveFromProfile(category, profile = {}, opportunity = {}) {
  const identity = (profile && profile.identity) ? profile.identity : {};
  const education = Array.isArray(profile?.education) ? profile.education : [];
  const skills = profile?.skills || {};
  const experience = profile?.experience || {};
  const preferences = profile?.preferences || {};
  const edu = education[0] || {};

  switch (category) {
    case 'name':
      return identity.name ? { answer: identity.name, confidence: 1.0 } : null;
    case 'email':
      return identity.email ? { answer: identity.email, confidence: 1.0 } : null;
    case 'phone':
      return identity.phone ? { answer: identity.phone, confidence: 1.0 } : null;
    case 'location':
      return identity.city ? { answer: `${identity.city}, ${identity.country || ''}`.trim(), confidence: 1.0 } : null;
    case 'university':
      return edu.university ? { answer: edu.university, confidence: 1.0 } : null;
    case 'degree':
      return edu.degree ? { answer: `${edu.degree} in ${edu.major}`, confidence: 1.0 } : null;
    case 'graduation':
      return edu.graduation_date ? { answer: edu.graduation_date, confidence: 1.0 } : null;
    case 'gpa':
      return edu.gpa != null
        ? { answer: `${edu.gpa} / ${edu.gpa_scale || 4.0}`, confidence: 1.0 }
        : { answer: 'Not disclosed', confidence: 0.6 };
    case 'linkedin':
      return identity.linkedin ? { answer: identity.linkedin, confidence: 1.0 } : null;
    case 'github':
      return (identity.github || identity.portfolio)
        ? { answer: identity.github || identity.portfolio, confidence: 1.0 }
        : null;
    case 'availability': {
      const pref = preferences?.timing?.preferred_start;
      return pref ? { answer: pref, confidence: 0.9 } : null;
    }
    case 'experience': {
      const internships = experience?.internships || [];
      const jobs = experience?.jobs || [];
      const total = internships.length + jobs.length;
      return total > 0
        ? { answer: `${total} internship/work position${total > 1 ? 's' : ''}`, confidence: 0.8 }
        : { answer: 'Currently seeking first professional experience', confidence: 0.7 };
    }
    case 'skills': {
      const allSkills = [
        ...(skills.programming_languages || []),
        ...(skills.frameworks || []),
        ...(skills.ai_ml || []),
      ].slice(0, 10);
      return allSkills.length
        ? { answer: allSkills.join(', '), confidence: 0.95 }
        : null;
    }
    default:
      return null;
  }
}

// ── Cover Letter Generation ───────────────────────────────────────────────────

function buildCoverLetterSystemPrompt() {
  return `You are StudentCareer AI, a professional cover letter writer for students.

Write a concise, genuinely personalized cover letter using ONLY attested facts.

RULES:
1. Return ONLY valid JSON (no markdown fences).
2. Never invent experience, skills, projects, companies, metrics, education, or dates.
3. Do not mention salary, compensation, or work authorization.
4. Four short paragraphs after the greeting: specific interest in THIS role/company, academic/technical background that matches THIS job, one concrete attested project or experience, what you can contribute. Close professionally.
5. Internship letters: about 250-350 words. Other roles: 250-400 words.
6. Tone: professional, specific, human. No gushing. No buzzword stuffing.
7. FORBIDDEN openings: "I am writing to express my keen interest", "I am thrilled to apply", "I believe I would be a perfect fit", "I am confident that my skills and experience make me an ideal candidate".
8. FORBIDDEN: a generic letter whose only specificity is the company or job title. You MUST use the selected evidence list. If a fact is not in the profile, CV excerpt, or grounded evidence, omit it.
9. Do not copy sentences from the job description.
10. Do not force unrelated cybersecurity claims into an AI, data, or software letter. Pick evidence for THIS role.
11. Never claim years of experience, team leadership, production LLM systems, or tools that are not attested.

OUTPUT SCHEMA:
{
  "subject_line": "<Subject: Application for [Role] at [Company]>",
  "body": "<full cover letter text, paragraphs separated by \\n\\n, starting with Dear Hiring Manager,>",
  "word_count": <integer>,
  "confidence": <float 0.0-1.0, how well profile matches JD>
}`;
}

function buildCoverLetterUserPrompt(
  profile = {},
  opportunity = {},
  matchResult = null,
  evidencePackets = [],
  extras = {}
) {
  const identity = (profile && profile.identity) ? profile.identity : (profile || {});
  const education = (profile && Array.isArray(profile.education)) ? profile.education : [];
  const skills = (profile && profile.skills) ? profile.skills : {};
  const experience = (profile && profile.experience) ? profile.experience : {};
  const projects = (profile && Array.isArray(profile.projects)) ? profile.projects : [];
  const edu = education[0] || {};
  const internships = Array.isArray(experience) ? experience : (experience?.internships || []);
  const relevantExperience = extras.relevantExperience?.length
    ? extras.relevantExperience
    : internships.map((e) => `${e.role} at ${e.company}`).filter((s) => s.trim() !== "at");
  const relevantProjects = extras.relevantProjects?.length
    ? extras.relevantProjects
    : projects.map((p) => p.name).filter(Boolean);
  const goals = extras.goals || [];
  const topSkills = [
    ...(skills?.programming_languages || []),
    ...(skills?.ai_ml || []),
    ...(skills?.frameworks || []),
  ].slice(0, 8).join(', ');

  const grounded = Array.isArray(evidencePackets) && evidencePackets.length
    ? `\nGROUNDED EVIDENCE (retrieved snippets only — never invent beyond this):\n${evidencePackets.map((p) => p.text).join('\n---\n').slice(0, 2800)}`
    : '';

  const internLines = internships
    .map((e) => `- ${e.role} at ${e.company} (${e.start_date || ''}–${e.end_date || ''}): ${e.description || ''}`)
    .join('\n');
  const projectLines = projects
    .map((p) => `- ${p.name} — ${p.description || ''} [${(p.technologies || []).join(', ')}]`)
    .join('\n');
  const selected = Array.isArray(extras.selectedEvidence) && extras.selectedEvidence.length
    ? extras.selectedEvidence.map((e) => `- ${e.kind || 'fact'}: ${e.label}${e.detail ? ` — ${e.detail}` : ''}`).join('\n')
    : '';
  const cvExcerpt = extras.masterCvExcerpt
    ? `\nMASTER CV EXCERPT (source of truth — do not contradict or embellish):\n${String(extras.masterCvExcerpt).slice(0, 2400)}`
    : '';

  return `STUDENT: ${identity.name || 'Student Candidate'} | ${identity.email || ''}
DEGREE: ${edu.degree || 'Bachelor of Science'} in ${edu.major || 'Computer Science'} at ${edu.university || 'University'}, graduating ${edu.graduation_date || ''}
STUDENT GOALS: ${goals.join('; ') || 'Not stated'}
ROLE FAMILY: ${extras.roleFamily || 'unspecified'}
JD FOCUS (only mention if also attested): ${Array.isArray(extras.jdFocus) ? extras.jdFocus.join(', ') : (extras.jdFocus || 'n/a')}
SELECTED EVIDENCE FOR THIS JOB (use 3-5 of these; do not add others):
${selected || '(use relevant experience/projects below)'}
RELEVANT EXPERIENCE TO EMPHASIZE: ${relevantExperience.join('; ') || 'None listed'}
RELEVANT PROJECTS TO EMPHASIZE: ${relevantProjects.join('; ') || 'None listed'}
EXPERIENCE:
${internLines || '- None yet'}
PROJECTS:
${projectLines || '- None listed'}
SKILLS: ${topSkills || 'Not listed'}
STRENGTHS: ${(matchResult?.strengths || []).join(', ') || 'N/A'}
${grounded}
${cvExcerpt}

COMPANY: ${extras.company || opportunity.company}
POSITION: ${extras.position || opportunity.title || opportunity.role}
JD EXCERPT: ${(opportunity.description || '').slice(0, 1600)}

Write a personalized cover letter JSON for THIS job only. Cite selected evidence by name. If a fact is not in the profile, CV excerpt, or grounded evidence, omit it. Never invent. Do not write a generic excitement template.`;
}

/**
 * Generate a cover letter. Returns CoverLetterResult.
 */
export async function generateCoverLetter({
  profile,
  opportunity,
  matchResult,
  resolved,
  callAIFn,
  matchingConfig,
  evidencePackets = [],
  relevantExperience = [],
  relevantProjects = [],
  goals = [],
  company,
  position,
  roleFamily,
  selectedEvidence = [],
  masterCvExcerpt = "",
  jdFocus = [],
}) {
  const MAX_RETRIES = 2;
  let lastError = null;
  let resolvedProvider = resolved;
  if (!resolvedProvider) {
    try {
      resolvedProvider = resolveProvider(matchingConfig || {});
    } catch (err) {
      if (callAIFn) resolvedProvider = { provider: 'custom', model: 'custom' };
      else throw err;
    }
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const raw = await callAIFn(
        resolvedProvider,
        buildCoverLetterSystemPrompt(),
        buildCoverLetterUserPrompt(profile, opportunity, matchResult, evidencePackets, {
          relevantExperience,
          relevantProjects,
          goals,
          company,
          position,
          roleFamily,
          selectedEvidence,
          masterCvExcerpt,
          jdFocus,
        })
      );
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      const parsed = JSON.parse(cleaned);

      if (!parsed.body || typeof parsed.body !== 'string') {
        throw new ApplicationGeneratorError('Cover letter missing body field');
      }

      return {
        subject_line: parsed.subject_line || `Application for ${opportunity.title} at ${opportunity.company}`,
        body: parsed.body.trim(),
        word_count: parsed.word_count || parsed.body.trim().split(/\s+/).length,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.8,
        generated_at: new Date().toISOString(),
      };
    } catch (err) {
      lastError = err;
      if (err instanceof MatchProviderError) throw err;
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }

  throw new ApplicationGeneratorError(`Cover letter generation failed: ${lastError?.message}`);
}

// ── Application Summary ───────────────────────────────────────────────────────

/**
 * Generate a deterministic application summary (no AI).
 * Safe to call without API keys.
 */
export function generateApplicationSummary(profile = {}, opportunity = {}, matchResult = null) {
  const identity = (profile && profile.identity) ? profile.identity : (profile || {});
  const education = (profile && Array.isArray(profile.education)) ? profile.education : [];
  const skills = (profile && profile.skills) ? profile.skills : {};
  const experience = (profile && profile.experience) ? profile.experience : {};
  const edu = education[0] || {};
  const internships = Array.isArray(experience) ? experience : (experience?.internships || []);
  const allSkills = [
    ...(skills?.programming_languages || []),
    ...(skills?.ai_ml || []),
    ...(skills?.frameworks || []),
  ].slice(0, 8);

  const expLine = internships.length
    ? `${internships.length} internship${internships.length > 1 ? 's' : ''} including ${internships[0].company}`
    : 'no prior internship experience';

  const tierLine = matchResult
    ? `Match: ${matchResult.match_score}/100 (${matchResult.tier}).`
    : '';

  const text = [
    `${identity.name || 'Candidate'} — ${edu.degree || 'Student'} in ${edu.major || 'an undeclared major'} at ${edu.university || 'university'}, expected graduation ${edu.graduation_date || 'TBD'}.`,
    `Skills: ${allSkills.join(', ') || 'N/A'}.`,
    `Experience: ${expLine}.`,
    tierLine,
    `Applying for: ${opportunity.title} at ${opportunity.company} (${opportunity.location || 'location TBD'}).`,
  ].filter(Boolean).join(' ');

  return {
    text,
    word_count: text.split(/\s+/).length,
    confidence: 1.0, // Fully deterministic
    generated_at: new Date().toISOString(),
  };
}

// ── Application Answer Generation ─────────────────────────────────────────────

function buildAnswerSystemPrompt() {
  return `You are StudentCareer AI answering a job application form question on behalf of a student.

RULES:
1. Return ONLY valid JSON (no markdown fences).
2. Derive the answer ONLY from the provided student profile facts. Never invent.
3. If you cannot confidently answer, set "requires_user_input": true.
4. Keep answers concise and professional (under 100 words unless the question demands more).

OUTPUT SCHEMA:
{
  "answer": "<your answer text, or empty string if requires_user_input>",
  "confidence": <float 0.0-1.0>,
  "requires_user_input": <boolean>,
  "rationale": "<one sentence: why this answer or why input needed>"
}`;
}

/**
 * Generate an answer to a single application question.
 * Always returns an AnswerResult — never throws for REQUIRES_USER_INPUT.
 *
 * @param {object} params
 * @param {string} params.question
 * @param {object} params.profile
 * @param {object} params.opportunity
 * @param {object} params.resolved     - From resolveProvider()
 * @param {Function} params.callAIFn
 * @returns {Promise<AnswerResult>}
 */
export async function generateApplicationAnswer({ question, profile, opportunity, resolved, callAIFn }) {
  const { category, isSensitive } = categorizeQuestion(question);

  // ── Hard gate: sensitive categories ─────────────────────────────────────────
  if (isSensitive) {
    return {
      question,
      answer: '',
      confidence: 0.0,
      category,
      requires_user_input: true,
      sensitive: true,
      rationale: `"${category}" is a sensitive category that always requires the applicant's direct input.`,
      generated_at: new Date().toISOString(),
    };
  }

  // ── Deterministic derivation ──────────────────────────────────────────────
  const derived = deriveFromProfile(category, profile, opportunity);
  if (derived && derived.confidence >= CONFIDENCE_THRESHOLDS.auto_answer) {
    return {
      question,
      answer: derived.answer,
      confidence: derived.confidence,
      category,
      requires_user_input: false,
      sensitive: false,
      rationale: `Answer derived directly from profile (${category}).`,
      generated_at: new Date().toISOString(),
    };
  }

  // ── AI-assisted answer for open/complex questions ─────────────────────────
  const identity = (profile && profile.identity) ? profile.identity : {};
  const education = Array.isArray(profile?.education) ? profile.education : [];
  const skills = profile?.skills || {};
  const experience = profile?.experience || {};
  const projects = Array.isArray(profile?.projects) ? profile.projects : [];
  const edu = education[0] || {};
  const userPrompt = `QUESTION: ${question}

STUDENT PROFILE:
Name: ${identity.name || 'Candidate'}
Degree: ${edu.degree || ''} in ${edu.major || ''} at ${edu.university || ''}, graduating ${edu.graduation_date || ''}
Skills: ${Object.values(skills || {}).flat().join(', ')}
Internships: ${(experience?.internships || []).map(i => `${i.role || ''} at ${i.company || ''}`).join(', ') || 'none'}
Projects: ${projects.map(p => p.name).join(', ') || 'none'}

OPPORTUNITY: ${opportunity.title || opportunity.role || 'role'} at ${opportunity.company || 'company'}

Answer the question based only on profile facts. Return the JSON schema.`;

  const MAX_RETRIES = 1;
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const raw = await callAIFn(resolved, buildAnswerSystemPrompt(), userPrompt);
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      const parsed = JSON.parse(cleaned);

      const confidence = typeof parsed.confidence === 'number'
        ? Math.min(Math.max(parsed.confidence, 0), 1)
        : 0.5;
      const requiresInput = parsed.requires_user_input === true || confidence < CONFIDENCE_THRESHOLDS.auto_answer;

      return {
        question,
        answer: requiresInput ? '' : (parsed.answer || '').trim(),
        confidence,
        category,
        requires_user_input: requiresInput,
        sensitive: false,
        rationale: parsed.rationale || '',
        generated_at: new Date().toISOString(),
      };
    } catch (err) {
      lastError = err;
      if (err instanceof MatchProviderError) throw err;
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 300));
    }
  }

  // Fallback: if AI fails, require user input
  return {
    question,
    answer: '',
    confidence: 0.0,
    category,
    requires_user_input: true,
    sensitive: false,
    rationale: `Could not generate answer automatically: ${lastError?.message || 'AI unavailable'}`,
    generated_at: new Date().toISOString(),
  };
}

// ── Main Orchestrator ─────────────────────────────────────────────────────────

/**
 * Generate all application content for a selected opportunity.
 *
 * @param {object}   params
 * @param {object}   params.profile
 * @param {string}   [params.cvText]
 * @param {object}   params.opportunity
 * @param {object}   [params.eligibility]
 * @param {object}   [params.matchResult]
 * @param {string[]} [params.questions]       Application form questions
 * @param {object}   [params.matchingConfig]
 * @param {Function} [params.callAIFn]        DI override for tests
 * @returns {Promise<ApplicationRecord>}
 */
export async function generateApplicationContent({
  profile,
  cvText = '',
  opportunity,
  tailoredCV = null,
  tailoredCv: inputTailoredCv = null,
  eligibility = null,
  matchResult = null,
  questions = [],
  matchingConfig,
  callAIFn,
  candidateKnowledgeService = null,
  authContext = null,
  cvDecisionEngine = null,
  coverLetterDecisionEngine = null,
  coverLetter: providedCoverLetter = undefined,
  skipCoverLetter = false,
}) {
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

  const errors = [];
  const generated_at = new Date().toISOString();

  let knowledgeContext = null;
  let evidencePackets = [];
  if (candidateKnowledgeService && authContext) {
    try {
      knowledgeContext = await candidateKnowledgeService.getCandidateContextForOpportunity(opportunity, authContext);
      evidencePackets = knowledgeContext?.evidencePackets || [];
    } catch (err) {
      errors.push(`candidate_knowledge: ${err.message}`);
    }
  }

  // ── 1. CV decision (reuse master when already appropriate) ─────────────────
  let tailoredCv = tailoredCV || inputTailoredCv;
  let cvError = null;
  let cvDecision = null;
  if (!tailoredCv) {
    try {
      if (cvDecisionEngine && authContext) {
        const decision = await cvDecisionEngine.decideAndPrepare({
          profile,
          cvText,
          opportunity,
          eligibility,
          matchResult,
          matchingConfig,
          callAIFn: aiCallFn,
          context: authContext,
        });
        tailoredCv = decision.record;
        cvDecision = {
          ...decision.analysis,
          reusedMaster: decision.reusedMaster,
          regenerated: decision.regenerated,
          rejectedTailor: decision.rejectedTailor || false,
          changesMade: decision.changesMade,
          reasonForChanges: decision.reasonForChanges,
          originalCv: decision.originalCv,
          tailoredCv: decision.tailoredCv,
        };
      } else {
        tailoredCv = await tailorCV({
          profile, cvText, opportunity, eligibility, matchResult,
          matchingConfig, callAIFn: aiCallFn,
        });
      }
    } catch (err) {
      cvError = err.message;
      errors.push(`tailored_cv: ${err.message}`);
    }
  }

  // ── 2. Cover letter decision (generate only if required/recommended) ───────
  let coverLetter = providedCoverLetter !== undefined ? providedCoverLetter : null;
  let coverLetterError = null;
  let coverLetterDecision = providedCoverLetter?.requirement
    ? { requirement: providedCoverLetter.requirement, reason: providedCoverLetter.reason, skipped: providedCoverLetter.skipped }
    : null;
  if (providedCoverLetter !== undefined) {
    const hasBody = Boolean(providedCoverLetter?.body || providedCoverLetter?.coverLetter);
    if (providedCoverLetter?.requirement === 'REQUIRED' && !hasBody) {
      coverLetterError = providedCoverLetter.reason || 'Required cover letter was not accepted.';
      errors.push(`cover_letter: ${coverLetterError}`);
    }
  } else if (!skipCoverLetter) {
    try {
      if (coverLetterDecisionEngine && authContext) {
        const decision = await coverLetterDecisionEngine.decideAndPrepare({
          profile,
          opportunity,
          matchResult,
          eligibility,
          cvText,
          callAIFn: aiCallFn,
          matchingConfig,
          context: authContext,
        });
        coverLetter = decision.record;
        coverLetterDecision = {
          ...decision.analysis,
          generated: decision.generated,
          skipped: decision.skipped,
          rejected: decision.rejected || false,
        };
        if (decision.analysis.requirement === 'REQUIRED' && !decision.generated) {
          coverLetterError = decision.analysis.reason || 'Required cover letter was not accepted.';
          errors.push(`cover_letter: ${coverLetterError}`);
        }
      } else {
        coverLetter = await generateCoverLetter({
          profile, opportunity, matchResult, resolved, callAIFn: aiCallFn, evidencePackets,
        });
        if (candidateKnowledgeService && authContext && coverLetter?.body) {
          const listed = await candidateKnowledgeService.listKnowledge(authContext);
          if ((listed.documents || []).length > 0) {
            const check = await candidateKnowledgeService.validateGeneratedClaim(coverLetter.body, authContext);
            coverLetter.grounding = { status: check.status, unknownClaims: check.unknownClaims, violations: check.violations };
            if (check.status === 'REJECTED') {
              coverLetterError = 'Cover letter rejected: fabricated claims are not allowed.';
              errors.push(`cover_letter: ${coverLetterError}`);
            } else if (check.status === 'UNKNOWN') {
              coverLetterError = 'Cover letter contains claims with UNKNOWN evidence.';
              errors.push(`cover_letter: ${coverLetterError}`);
            }
          }
        }
      }
    } catch (err) {
      coverLetterError = err.message;
      errors.push(`cover_letter: ${err.message}`);
    }
  }

  // ── 3. Application Summary ─────────────────────────────────────────────────
  const applicationSummary = generateApplicationSummary(profile, opportunity, matchResult);

  // ── 4. Application Answers ─────────────────────────────────────────────────
  const applicationAnswers = [];
  for (const question of questions) {
    const ans = await generateApplicationAnswer({
      question, profile, opportunity, resolved, callAIFn: aiCallFn,
    });
    applicationAnswers.push(ans);
  }

  // ── Assemble record ────────────────────────────────────────────────────────
  const pendingQuestions = applicationAnswers.filter(a => a.requires_user_input);
  const requiresUserInput = pendingQuestions.length > 0 || cvError !== null || coverLetterError !== null;

  const opportunityId = (opportunity.url || '')
    .replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').slice(0, 80)
    || `${(opportunity.company || '').toLowerCase()}-${(opportunity.title || '').toLowerCase()}`.replace(/\s+/g, '-');

  /** @type {ApplicationRecord} */
  return {
    opportunity_id:       opportunityId,
    opportunity_title:    opportunity.title,
    opportunity_company:  opportunity.company,
    generated_at,
    provider_used:        resolved.provider,
    model_used:           resolved.model,
    tailored_cv:          tailoredCv,
    tailored_cv_error:    cvError,
    cv_decision:          cvDecision,
    cover_letter:         coverLetter,
    cover_letter_error:   coverLetterError,
    cover_letter_decision: coverLetterDecision,
    application_summary:  applicationSummary,
    application_answers:  applicationAnswers,
    requires_user_input:  requiresUserInput,
    pending_questions:    pendingQuestions.map(a => ({ question: a.question, category: a.category, sensitive: a.sensitive })),
    generation_errors:    errors,
    knowledge_context:    knowledgeContext
      ? {
          fullCorpusIncluded: false,
          retrievedChunkCount: knowledgeContext.retrievedChunkCount,
          missingSkills: knowledgeContext.missingSkills,
          missingInformation: knowledgeContext.missingInformation,
          status: knowledgeContext.status,
        }
      : null,
  };
}
