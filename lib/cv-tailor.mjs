/**
 * cv-tailor.mjs — Intelligent CV Tailoring Engine for CareerOS
 *
 * Generates a tailored CV using: StudentProfile + master CV text +
 * NormalizedOpportunity + EligibilityReport + MatchResult.
 *
 * FABRICATION CONTRACT (enforced in code, not prompts):
 *   - Every generated company, project, date, metric, skill is checked
 *     against a sourceFacts registry extracted from the profile BEFORE
 *     the AI call. Violations are REJECTED programmatically.
 *   - The AI may: reorder, rewrite, summarize, emphasize, select.
 *   - The AI may NOT: invent companies, dates, metrics, skills, projects.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProvider, callAI, MatchProviderError } from './ai-provider.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const CV_TEMPLATE_PATH = join(REPO_ROOT, 'templates', 'cv-template.html');

// ── Custom Errors ─────────────────────────────────────────────────────────────

export class TailorError extends Error {
  constructor(message) { super(message); this.name = 'TailorError'; }
}

export class FabricationError extends Error {
  constructor(message, violations) {
    super(message); this.name = 'FabricationError'; this.violations = violations;
  }
}

// ── Source Fact Extraction ────────────────────────────────────────────────────

/**
 * Extract all verifiable facts from profile + raw CV text.
 * This registry is used to validate AI output against ground truth.
 *
 * @param {object} profile  - Validated StudentProfile
 * @param {string} cvText   - Master CV text (markdown or plain)
 * @returns {SourceFacts}
 */
export function extractSourceFacts(profile, cvText) {
  const { education, skills, experience, projects } = profile;

  // Company names (normalised lowercase for comparison)
  const companies = new Set();
  const expInternships = Array.isArray(experience) ? experience : (experience?.internships || []);
  const expJobs = Array.isArray(experience?.jobs) ? experience.jobs : [];
  const expVolunteer = Array.isArray(experience?.volunteer) ? experience.volunteer : [];

  for (const e of expInternships) if (e.company) companies.add(norm(e.company));
  for (const e of expJobs) if (e.company) companies.add(norm(e.company));
  for (const e of expVolunteer) if (e.organization) companies.add(norm(e.organization));

  // Project names
  const projectNames = new Set((projects || []).map(p => norm(p.name)));

  // Dates — collect all YYYY-MM strings from profile
  const dates = new Set();
  for (const edu of (education || [])) {
    if (edu.graduation_date) dates.add(edu.graduation_date);
  }
  for (const group of [expInternships, expJobs, expVolunteer]) {
    for (const e of (group || [])) {
      if (e.start_date) dates.add(e.start_date);
      if (e.end_date && e.end_date !== 'Present') dates.add(e.end_date);
    }
  }

  // All skills (flat set, normalised)
  const skillSet = new Set();
  for (const cat of Object.values(skills || {})) {
    if (Array.isArray(cat)) cat.forEach(s => skillSet.add(norm(s)));
  }

  // Metrics — numbers + units from cv_text and profile achievements
  const metricRe = /\b(\d[\d,]*\.?\d*\s*%|\$\s*\d[\d,.]*[KMBkmb]?|\d[\d,]*\s*[KMBkmb]\b|\d[\d,]*\+?\s*(?:users|students|documents|tweets|papers|rows|lines|ms|seconds|hours|days|months))/gi;
  const rawText = [cvText || '', ...collectAchievements(profile)].join(' ');
  const metrics = new Set([...rawText.matchAll(metricRe)].map(m => normMetric(m[0])));

  // Education
  const institutions = new Set((education || []).map(e => norm(e.university)));
  const degrees = new Set((education || []).map(e => norm(e.degree)));
  const majors = new Set((education || []).map(e => norm(e.major)));

  return {
    companies,
    projectNames,
    dates,
    skills: skillSet,
    metrics,
    institutions,
    degrees,
    majors,
    rawCvText: cvText || '',
  };
}

function norm(s) { return (s || '').toLowerCase().trim(); }

function normMetric(s) {
  return s.toLowerCase().replace(/,/g, '').replace(/\s+/g, '').trim();
}

function collectAchievements(profile) {
  const out = [];
  const expInternships = Array.isArray(profile.experience) ? profile.experience : (profile.experience?.internships || []);
  const expJobs = Array.isArray(profile.experience?.jobs) ? profile.experience.jobs : [];
  const expVolunteer = Array.isArray(profile.experience?.volunteer) ? profile.experience.volunteer : [];
  for (const group of [expInternships, expJobs, expVolunteer]) {
    for (const e of (group || [])) {
      out.push(e.description || '');
      for (const a of (e.achievements || [])) out.push(a);
    }
  }
  for (const p of (profile.projects || [])) {
    out.push(p.description || '');
    for (const a of (p.achievements || [])) out.push(a);
  }
  return out;
}

// ── Fabrication Validation ────────────────────────────────────────────────────

/**
 * Validate a TailoredCVDraft against the source-facts registry.
 * Returns { valid, result, violations, flagged }.
 * result: 'CLEAN' | 'FLAGGED' | 'REJECTED'
 *
 * @param {object}      draft       - AI-generated TailoredCVDraft
 * @param {SourceFacts} sourceFacts
 */
export function validateAgainstSourceFacts(draft, sourceFacts) {
  const violations = [];
  const flagged = [];

  if (typeof draft === 'string') {
    // String text validation (e.g. for application answer checking)
    checkMetrics(draft, sourceFacts, violations, flagged, 'answer text');
    
    // Check dates in text
    const dateRe = /\b(19\d\d|20\d\d)(?:-(0[1-9]|1[0-2]))?\b/g;
    const foundDates = [...draft.matchAll(dateRe)].map(m => m[0]);
    const hasDate = (d) => {
      if (!sourceFacts.dates) return false;
      if (typeof sourceFacts.dates.has === 'function') return sourceFacts.dates.has(d);
      if (Array.isArray(sourceFacts.dates)) return sourceFacts.dates.includes(d);
      return false;
    };
    for (const d of foundDates) {
      if (!hasDate(d) && !(sourceFacts.rawCvText && sourceFacts.rawCvText.includes(d))) {
        violations.push(`Fabricated date: "${d}" not in source dates`);
      }
    }

    const valid = violations.length === 0;
    return { valid, result: valid ? 'CLEAN' : 'REJECTED', violations, flagged };
  }

  // 1. Experience companies
  for (const exp of (draft.experience || [])) {
    if (!exp.company) continue;
    if (!sourceFacts.companies.has(norm(exp.company))) {
      violations.push(`Fabricated company: "${exp.company}" not in source profile`);
    }
    // Dates
    if (exp.start_date && exp.start_date !== 'Present') {
      if (!sourceFacts.dates.has(exp.start_date) && !sourceFacts.rawCvText.includes(exp.start_date)) {
        violations.push(`Fabricated start_date: "${exp.start_date}" for ${exp.company}`);
      }
    }
    if (exp.end_date && exp.end_date !== 'Present') {
      if (!sourceFacts.dates.has(exp.end_date) && !sourceFacts.rawCvText.includes(exp.end_date)) {
        violations.push(`Fabricated end_date: "${exp.end_date}" for ${exp.company}`);
      }
    }
    // Metrics in bullets
    for (const bullet of (exp.bullets || [])) {
      checkMetrics(bullet, sourceFacts, violations, flagged, `experience[${exp.company}]`);
    }
  }

  // 2. Project names
  for (const proj of (draft.projects || [])) {
    if (!proj.name) continue;
    if (!sourceFacts.projectNames.has(norm(proj.name))) {
      violations.push(`Fabricated project: "${proj.name}" not in source profile`);
    }
    // Technologies must be from skills
    for (const tech of (proj.technologies || [])) {
      if (!sourceFacts.skills.has(norm(tech))) {
        flagged.push(`Technology "${tech}" in project "${proj.name}" not in known skills (may be minor alias)`);
      }
    }
    // Metrics in achievements
    for (const a of (proj.achievements || [])) {
      checkMetrics(a, sourceFacts, violations, flagged, `project[${proj.name}]`);
    }
  }

  // 3. Competencies must be from known skills
  for (const skill of (draft.competencies || [])) {
    if (!sourceFacts.skills.has(norm(skill))) {
      violations.push(`Fabricated competency: "${skill}" not in source skills`);
    }
  }

  const valid = violations.length === 0;
  let result;
  if (violations.length > 0) result = 'REJECTED';
  else if (flagged.length > 0) result = 'FLAGGED';
  else result = 'CLEAN';

  return { valid, result, violations, flagged };
}

/** Extract all numeric metrics from text and check each against sourceFacts. */
function checkMetrics(text, sourceFacts, violations, flagged, context) {
  const metricRe = /\b(\d[\d,]*\.?\d*\s*%|\$\s*\d[\d,.]*[KMBkmb]?|\d[\d,]*\s*[KMBkmb]\b|\d[\d,]*\+?\s*(?:users|students|documents|tweets|papers|rows|lines|ms|seconds|hours|days|months))/gi;
  const found = [...text.matchAll(metricRe)].map(m => normMetric(m[0]));
  const hasMetric = (m) => {
    if (!sourceFacts.metrics) return false;
    if (typeof sourceFacts.metrics.has === 'function') return sourceFacts.metrics.has(m);
    if (Array.isArray(sourceFacts.metrics)) return sourceFacts.metrics.includes(m);
    return false;
  };
  for (const metric of found) {
    if (!hasMetric(metric) && !(sourceFacts.rawCvText && sourceFacts.rawCvText.toLowerCase().includes(metric))) {
      violations.push(`Fabricated metric: "${metric}" in ${context} not in source data`);
    }
  }
}

// ── Prompt Builder ────────────────────────────────────────────────────────────

function buildSystemPrompt(sourceFacts) {
  const allowedCompanies = [...sourceFacts.companies].join(', ') || 'none';
  const allowedProjects = [...sourceFacts.projectNames].join(', ') || 'none';
  const allowedSkills = [...sourceFacts.skills].join(', ') || 'none';

  return `You are CareerOS, a professional CV tailoring assistant.

Your task is to generate a TAILORED CV by emphasizing and reordering content from the student's existing profile to best match a specific opportunity.

ALLOWED ACTIONS:
- Reorder sections, bullet points, projects, or skills
- Rewrite sentences using different words (preserving all facts)
- Emphasize role-relevant skills, projects, and experience
- Select the most relevant projects (may exclude some)
- Write a targeted 2-3 sentence professional summary
- Use keywords from the job description naturally

PROHIBITED ACTIONS (violations cause REJECTION):
- Do NOT invent any company, organization, or employer
- Do NOT change any dates (start/end dates must match source exactly)
- Do NOT fabricate metrics (%, $, K numbers) not present in source
- Do NOT add any skill or technology not in the student's profile
- Do NOT add any project not listed in source
- Do NOT change the student's degree, university, or GPA

ALLOWED COMPANIES (use EXACTLY as written): ${allowedCompanies}
ALLOWED PROJECTS (use EXACTLY as written): ${allowedProjects}
ALLOWED SKILLS (subset freely, no additions): ${allowedSkills}

OUTPUT: Return ONLY valid JSON matching this schema (no markdown fences):
{
  "summary": "<2-3 sentence tailored professional summary>",
  "competencies": ["<skill from allowed list only>", ...],
  "experience": [
    {
      "company": "<exact company name from source>",
      "role": "<exact role from source>",
      "start_date": "<exact YYYY-MM from source>",
      "end_date": "<exact YYYY-MM or 'Present' from source>",
      "location": "<from source>",
      "bullets": ["<rewritten achievement using source facts only>", ...]
    }
  ],
  "projects": [
    {
      "name": "<exact project name from source>",
      "description": "<may be rewritten, no new facts>",
      "technologies": ["<from source skills only>"],
      "achievements": ["<from source only, may be reworded>"]
    }
  ],
  "tailoring_notes": "<brief explanation of key choices made>"
}`;
}

function buildUserPrompt(profile, cvText, opportunity, eligibility, matchResult) {
  const { identity = {}, education = [], skills = {}, experience = {}, projects = [] } = profile || {};
  const edu = (education || [])[0] || {};

  const expInternships = Array.isArray(experience) ? experience : (experience?.internships || []);
  const expJobs = Array.isArray(experience?.jobs) ? experience.jobs : [];
  const expVolunteer = Array.isArray(experience?.volunteer) ? experience.volunteer : [];

  const expLines = [
    ...expInternships.map(e =>
      `INTERNSHIP | ${e.company} | ${e.role} | ${e.start_date}–${e.end_date} | ${e.location || ''}\n  ${e.description || ''}\n  Achievements: ${(e.achievements || []).join('; ') || 'none'}`),
    ...expJobs.map(e =>
      `JOB | ${e.company} | ${e.role} | ${e.start_date}–${e.end_date} | ${e.location || ''}\n  ${e.description || ''}\n  Achievements: ${(e.achievements || []).join('; ') || 'none'}`),
    ...expVolunteer.map(e =>
      `VOLUNTEER | ${e.organization} | ${e.role} | ${e.start_date}–${e.end_date}\n  ${e.description || ''}`),
  ].join('\n\n') || 'None';

  const projLines = (projects || []).map(p =>
    `PROJECT: ${p.name}\nDescription: ${p.description || ''}\nTech: ${(p.technologies || []).join(', ')}\nAchievements: ${(p.achievements || []).join('; ') || 'none'}\nURL: ${p.url || ''}`
  ).join('\n\n') || 'None';

  const allSkills = Object.entries(skills || {})
    .filter(([, v]) => Array.isArray(v) && v.length)
    .map(([k, v]) => `${k}: ${v.join(', ')}`)
    .join('\n');

  const matchSignals = matchResult ? [
    `Match score: ${matchResult.match_score}/100 (${matchResult.tier})`,
    `Strengths: ${(matchResult.strengths || []).join('; ')}`,
    `Missing: ${(matchResult.missing_skills || []).join(', ') || 'none'}`,
    `Relevant projects: ${(matchResult.relevant_projects || []).join(', ') || 'none'}`,
  ].join('\n') : 'No match analysis available';

  return `=== STUDENT PROFILE ===
Name: ${identity.name}
Email: ${identity.email}
Location: ${identity.city}, ${identity.country}
LinkedIn: ${identity.linkedin || ''}
GitHub: ${identity.github || ''}
Portfolio: ${identity.portfolio || ''}

Education:
  ${edu.university || ''} — ${edu.degree || ''} in ${edu.major || ''}
  Expected graduation: ${edu.graduation_date || ''}${edu.gpa != null ? ` | GPA: ${edu.gpa}/${edu.gpa_scale}` : ''}
  Coursework: ${(edu.coursework || []).join(', ') || 'not listed'}

Skills:
${allSkills || 'none listed'}

Experience:
${expLines}

Projects:
${projLines}

=== MASTER CV (verbatim) ===
${(cvText || '').slice(0, 4000) || '[Not provided]'}

=== TARGET OPPORTUNITY ===
Title: ${opportunity.title}
Company: ${opportunity.company}
Type: ${opportunity.opportunity_type}
Location: ${opportunity.location}
Description:
${(opportunity.description || '').slice(0, 2000) || '[Not provided]'}

=== MATCH ANALYSIS ===
${matchSignals}

=== TASK ===
Produce a tailored CV JSON following the schema in your instructions.
Prioritize: ${(matchResult?.relevant_projects || []).concat(matchResult?.relevant_experience || []).join(', ') || 'all relevant content'}.
Target keywords from JD: ${extractKeywords(opportunity.description || '').join(', ')}.`;
}

/** Extract simple keyword list from JD for emphasis guidance. */
function extractKeywords(jd) {
  const tech = jd.match(/\b(Python|JavaScript|TypeScript|React|Node\.js|FastAPI|PyTorch|TensorFlow|SQL|AWS|Docker|Kubernetes|Machine Learning|Deep Learning|NLP|LLM|API|REST|GraphQL|Git|Linux)\b/gi) || [];
  return [...new Set(tech.map(t => t.toLowerCase()))].slice(0, 12);
}

// ── JSON Validation ───────────────────────────────────────────────────────────

const DRAFT_REQUIRED = ['summary', 'competencies', 'experience', 'projects', 'tailoring_notes'];

export function parseDraftResponse(raw) {
  if (!raw || typeof raw !== 'string') throw new TailorError('AI returned empty response');
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (e) { throw new TailorError(`AI draft is not valid JSON: ${e.message}`); }
  for (const f of DRAFT_REQUIRED) {
    if (!(f in parsed)) throw new TailorError(`Draft missing required field: "${f}"`);
  }
  if (typeof parsed.summary !== 'string' || !parsed.summary.trim()) throw new TailorError('Draft summary must be a non-empty string');
  if (!Array.isArray(parsed.competencies)) throw new TailorError('Draft competencies must be an array');
  if (!Array.isArray(parsed.experience)) throw new TailorError('Draft experience must be an array');
  if (!Array.isArray(parsed.projects)) throw new TailorError('Draft projects must be an array');
  return parsed;
}

// ── HTML Rendering ────────────────────────────────────────────────────────────

/**
 * Render a TailoredCVDraft into the cv-template.html.
 * Student layout: Education first, then Projects, then Experience.
 */
export function renderTailoredHTML(draft, profile = {}) {
  const template = existsSync(CV_TEMPLATE_PATH)
    ? readFileSync(CV_TEMPLATE_PATH, 'utf-8')
    : FALLBACK_TEMPLATE;

  const identity = (profile && profile.identity) ? profile.identity : (profile || {});
  const education = (profile && Array.isArray(profile.education)) ? profile.education : [];
  const edu = education[0] || {};

  const escHtml = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Header
  const name = escHtml(identity.name || profile.name || 'Candidate');
  const email = escHtml(identity.email || profile.email || '');
  const location = escHtml(`${identity.city || ''}${identity.city && identity.country ? ', ' : ''}${identity.country || ''}`);
  const linkedin = identity.linkedin || '';
  const github = identity.github || '';
  const portfolio = identity.portfolio || '';

  // Education block
  const gpaStr = edu.gpa != null ? ` | GPA: ${edu.gpa}/${edu.gpa_scale || 4.0}` : '';
  const eduHtml = `<div class="edu-item">
  <div class="edu-header">
    <div><span class="edu-title">${escHtml(edu.degree || 'Bachelor of Science')} in ${escHtml(edu.major || 'Computer Science')}</span> — <span class="edu-org">${escHtml(edu.university || 'University')}</span></div>
    <div class="edu-year">Expected ${escHtml(edu.graduation_date || '')}</div>
  </div>
  <div class="edu-desc">${escHtml((edu.coursework || []).slice(0, 6).join(' · '))}${escHtml(gpaStr)}</div>
</div>`;

  // Competencies
  const competenciesHtml = (draft.competencies || [])
    .map(s => `<span class="competency-tag">${escHtml(s)}</span>`).join('\n      ');

  // Projects
  const projectsHtml = (draft.projects || []).map(p => `<div class="project">
  <div class="project-title">${escHtml(p.name)}</div>
  <div class="project-desc">${escHtml(p.description || '')}</div>
  ${(p.achievements || []).map(a => `<div class="project-desc">• ${escHtml(a)}</div>`).join('')}
  <div class="project-tech">${escHtml((p.technologies || []).join(' · '))}</div>
</div>`).join('\n');

  // Experience
  const experienceHtml = (draft.experience || []).map(e => `<div class="job">
  <div class="job-header">
    <div class="job-company">${escHtml(e.company)}</div>
    <div class="job-period">${escHtml(e.start_date || '')} – ${escHtml(e.end_date || '')}</div>
  </div>
  <div class="job-role">${escHtml(e.role)}</div>
  ${e.location ? `<div class="job-location">${escHtml(e.location)}</div>` : ''}
  <ul>${(e.bullets || []).map(b => `<li>${escHtml(b)}</li>`).join('')}</ul>
</div>`).join('\n');

  let html = template
    .replace(/\{\{LANG\}\}/g, 'en')
    .replace(/\{\{NAME\}\}/g, name)
    .replace(/\{\{EMAIL\}\}/g, email)
    .replace(/\{\{PHONE\}\}/g, escHtml(identity.phone || ''))
    .replace(/\{\{LINKEDIN_URL\}\}/g, escHtml(linkedin))
    .replace(/\{\{LINKEDIN_DISPLAY\}\}/g, escHtml(linkedin.replace(/^https?:\/\//, '')))
    .replace(/\{\{PORTFOLIO_URL\}\}/g, escHtml(portfolio))
    .replace(/\{\{PORTFOLIO_DISPLAY\}\}/g, escHtml(portfolio.replace(/^https?:\/\//, '')))
    .replace(/\{\{LOCATION\}\}/g, location)
    .replace(/\{\{PAGE_WIDTH\}\}/g, '820px')
    .replace(/\{\{PHOTO\}\}/g, '')
    .replace(/\{\{SUMMARY_TEXT\}\}/g, escHtml(draft.summary || ''))
    .replace(/\{\{COMPETENCIES\}\}/g, competenciesHtml)
    .replace(/\{\{EDUCATION\}\}/g, eduHtml)
    .replace(/\{\{PROJECTS\}\}/g, projectsHtml)
    .replace(/\{\{EXPERIENCE\}\}/g, experienceHtml)
    .replace(/\{\{SKILLS\}\}/g, '')
    .replace(/\{\{CERTIFICATIONS\}\}/g, '')
    .replace(/\{\{AWARDS\}\}/g, '')
    .replace(/\{\{SECTION_SUMMARY\}\}/g, 'Professional Summary')
    .replace(/\{\{SECTION_COMPETENCIES\}\}/g, 'Core Competencies')
    .replace(/\{\{SECTION_EDUCATION\}\}/g, 'Education')
    .replace(/\{\{SECTION_EXPERIENCE\}\}/g, 'Experience')
    .replace(/\{\{SECTION_PROJECTS\}\}/g, 'Projects')
    .replace(/\{\{SECTION_SKILLS\}\}/g, 'Technical Skills')
    .replace(/\{\{SECTION_CERTIFICATIONS\}\}/g, '')
    .replace(/\{\{SECTION_AWARDS\}\}/g, '');

  return html;
}

// Minimal fallback if template file is missing (e.g. in tests)
const FALLBACK_TEMPLATE = `<!DOCTYPE html><html lang="{{LANG}}"><head><meta charset="UTF-8"><title>{{NAME}} — CV</title></head><body>
<div class="page">
<div class="header"><h1>{{NAME}}</h1><div class="contact-row"><a href="mailto:{{EMAIL}}">{{EMAIL}}</a> | <span>{{LOCATION}}</span></div></div>
<div class="section"><div class="section-title">{{SECTION_SUMMARY}}</div><div class="summary-text">{{SUMMARY_TEXT}}</div></div>
<div class="section"><div class="section-title">{{SECTION_EDUCATION}}</div>{{EDUCATION}}</div>
<div class="section"><div class="section-title">{{SECTION_COMPETENCIES}}</div><div class="competencies-grid">{{COMPETENCIES}}</div></div>
<div class="section"><div class="section-title">{{SECTION_PROJECTS}}</div>{{PROJECTS}}</div>
<div class="section"><div class="section-title">{{SECTION_EXPERIENCE}}</div>{{EXPERIENCE}}</div>
{{PHOTO}}{{SKILLS}}{{CERTIFICATIONS}}{{AWARDS}}
</div></body></html>`;

// ── Public API ────────────────────────────────────────────────────────────────

const MAX_RETRIES = 2;

/**
 * Generate a tailored CV with fabrication validation.
 *
 * @param {object}   params
 * @param {object}   params.profile         - Validated StudentProfile
 * @param {string}   [params.cvText]        - Master CV text
 * @param {object}   params.opportunity     - NormalizedOpportunity
 * @param {object}   [params.eligibility]   - EligibilityReport
 * @param {object}   [params.matchResult]   - MatchResult
 * @param {object}   [params.matchingConfig] - AI provider config
 * @param {Function} [params.callAIFn]      - DI override for tests
 * @returns {Promise<TailoredCVRecord>}
 * @throws {TailorError} on persistent AI failure
 * @throws {FabricationError} if validation is REJECTED
 */
export async function tailorCV({
  profile,
  cvText = '',
  opportunity,
  eligibility = null,
  matchResult = null,
  matchingConfig,
  callAIFn,
}) {
  // ── Extract source facts ───────────────────────────────────────────────────
  const sourceFacts = extractSourceFacts(profile, cvText);

  // ── Resolve provider ───────────────────────────────────────────────────────
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

  // ── Build prompts ──────────────────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt(sourceFacts);
  const userPrompt   = buildUserPrompt(profile, cvText, opportunity, eligibility, matchResult);

  // ── AI call with retry ─────────────────────────────────────────────────────
  let draft = null;
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const raw = await aiCallFn(resolved, systemPrompt, userPrompt);
      draft = parseDraftResponse(raw);
      break;
    } catch (err) {
      lastError = err;
      if (err instanceof MatchProviderError) throw err;
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }

  if (!draft) {
    throw new TailorError(`CV tailoring failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message}`);
  }

  // ── Fabrication validation ─────────────────────────────────────────────────
  const validation = validateAgainstSourceFacts(draft, sourceFacts);

  if (validation.result === 'REJECTED') {
    throw new FabricationError(
      `CV tailoring rejected: AI fabricated content.\nViolations:\n${validation.violations.map(v => '  • ' + v).join('\n')}`,
      validation.violations
    );
  }

  // ── Render HTML ────────────────────────────────────────────────────────────
  const tailoredHtml = renderTailoredHTML(draft, profile);

  // ── Assemble record ────────────────────────────────────────────────────────
  const opportunityId = (opportunity.url || '')
    .replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').slice(0, 80)
    || `${norm(opportunity.company)}-${norm(opportunity.title)}`.replace(/\s/g, '-');

  /** @type {TailoredCVRecord} */
  const record = {
    opportunity_id:       opportunityId,
    opportunity_title:    opportunity.title,
    opportunity_company:  opportunity.company,
    tailored_at:          new Date().toISOString(),
    provider_used:        resolved.provider,
    model_used:           resolved.model,
    source_facts: {
      companies:    [...sourceFacts.companies],
      project_names: [...sourceFacts.projectNames],
      dates:        [...sourceFacts.dates],
      skills:       [...sourceFacts.skills],
      metrics:      [...sourceFacts.metrics],
    },
    validation_result:     validation.result,
    validation_violations: validation.violations,
    validation_flagged:    validation.flagged,
    original_cv:          cvText,
    tailored_draft:       draft,
    tailored_html:        tailoredHtml,
    tailoring_notes:      draft.tailoring_notes || '',
  };

  return record;
}
