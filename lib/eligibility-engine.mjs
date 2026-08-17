/**
 * eligibility-engine.mjs -- CareerOS Eligibility Engine (Hard Gate)
 *
 * HARD GATE: assertEligible() MUST be called before CV tailoring or
 * application submission. If it throws, the pipeline must stop.
 *
 * Design rules:
 *   - Never invent qualifications or assume missing data is positive.
 *   - FAIL only on explicit mismatch with a mandatory requirement.
 *   - UNKNOWN when data is absent and a decision cannot be made.
 *   - Collect all checks before deciding overall verdict.
 */

// ── Result constants ─────────────────────────────────────────────────────────
export const PASS    = 'PASS';
export const FAIL    = 'FAIL';
export const UNKNOWN = 'UNKNOWN';

export const ELIGIBLE        = 'ELIGIBLE';
export const NOT_ELIGIBLE    = 'NOT_ELIGIBLE';
export const REQUIRES_REVIEW = 'REQUIRES_REVIEW';

// ── Error ────────────────────────────────────────────────────────────────────

export class EligibilityGateError extends Error {
  constructor(report) {
    const msg = report.overall === NOT_ELIGIBLE
      ? 'NOT_ELIGIBLE: ' + report.blocking_failures.join('; ')
      : 'REQUIRES_REVIEW: ' + report.unknowns.join('; ');
    super(msg);
    this.name = 'EligibilityGateError';
    this.report = report;
  }
}

// ── Internal helper ──────────────────────────────────────────────────────────

function r(result, detail) { return { result, detail }; }

// ── Degree ───────────────────────────────────────────────────────────────────

const DEG_LEVELS = {
  phd: 4, doctorate: 4, doctoral: 4,
  master: 3, ms: 3, msc: 3, mba: 3, meng: 3, mres: 3,
  bachelor: 2, bs: 2, bsc: 2, beng: 2, ba: 2, undergraduate: 2,
  associate: 1,
};
function inferDegreeLevel(s) {
  if (!s) return 0;
  const n = s.toLowerCase().replace(/[.\\/\s-]/g, '');
  for (const [k, v] of Object.entries(DEG_LEVELS)) if (n.includes(k)) return v;
  return 0;
}
const REQ_DEG = { phd: 4, master: 3, bachelor: 2, associate: 1 };

function checkDegree(edu, req) {
  if (!req) return r(PASS, 'No degree requirement specified.');
  const edu0 = edu[0];
  if (!edu0 || !edu0.degree) return r(UNKNOWN, 'No degree in profile; cannot verify requirement: ' + req + '.');
  const pl = inferDegreeLevel(edu0.degree);
  if (pl === 0) return r(UNKNOWN, 'Cannot determine degree level from: "' + edu0.degree + '".');
  const rl = REQ_DEG[req.toLowerCase()] || 0;
  return pl >= rl
    ? r(PASS,  'Degree "' + edu0.degree + '" meets requirement: ' + req + '.')
    : r(FAIL,  'Degree "' + edu0.degree + '" does not meet requirement: ' + req + '.');
}

// ── Major ────────────────────────────────────────────────────────────────────

function checkMajor(edu, kws) {
  if (!kws || !kws.length) return r(PASS, 'No major requirement specified.');
  const edu0 = edu[0];
  if (!edu0) return r(UNKNOWN, 'No education entry; cannot verify major.');
  const haystack = [edu0.major || '', ...(edu0.coursework || [])].join(' ').toLowerCase();
  const matched = kws.filter(k => haystack.includes(k.toLowerCase()));
  if (matched.length === kws.length) return r(PASS, 'Major/coursework matches all required fields: ' + matched.join(', ') + '.');
  if (matched.length > 0) return r(UNKNOWN, 'Partial major match (' + matched.join(', ') + '); manual review required.');
  return r(FAIL, 'Profile major "' + (edu0.major || '?') + '" does not match required: ' + kws.join(', ') + '.');
}

// ── Enrollment ───────────────────────────────────────────────────────────────

function checkEnrollment(edu, required) {
  if (!required) return r(PASS, 'Enrollment not required.');
  const edu0 = edu[0];
  if (!edu0 || !edu0.graduation_date) return r(UNKNOWN, 'Cannot verify enrollment: graduation_date not set in profile.');
  const grad = new Date(edu0.graduation_date + '-01');
  return grad > new Date()
    ? r(PASS, 'Graduation date ' + edu0.graduation_date + ' is in the future; enrollment inferred.')
    : r(UNKNOWN, 'Graduation date ' + edu0.graduation_date + ' is in the past; verify current enrollment status.');
}

// ── Graduation year ──────────────────────────────────────────────────────────

function checkGraduationYear(edu, yMin, yMax) {
  if (!yMin && !yMax) return r(PASS, 'No graduation year requirement.');
  const edu0 = edu[0];
  if (!edu0 || !edu0.graduation_date) return r(UNKNOWN, 'graduation_date not set in profile; cannot verify graduation year requirement.');
  const y = parseInt(edu0.graduation_date.slice(0, 4), 10);
  if (yMin && y < yMin) return r(FAIL, 'Graduation year ' + y + ' is earlier than required minimum ' + yMin + '.');
  if (yMax && y > yMax) return r(FAIL, 'Graduation year ' + y + ' exceeds required maximum ' + yMax + '.');
  return r(PASS, 'Graduation year ' + y + ' is within required range.');
}

// ── Academic year ────────────────────────────────────────────────────────────

function checkAcademicYear(edu, yMin, yMax) {
  if (!yMin && !yMax) return r(PASS, 'No academic year requirement.');
  const edu0 = edu[0];
  if (!edu0 || edu0.year == null) return r(UNKNOWN, 'Academic year not set in profile; cannot verify.');
  if (yMin && edu0.year < yMin) return r(FAIL, 'Academic year ' + edu0.year + ' is below required minimum ' + yMin + '.');
  if (yMax && edu0.year > yMax) return r(FAIL, 'Academic year ' + edu0.year + ' exceeds required maximum ' + yMax + '.');
  return r(PASS, 'Academic year ' + edu0.year + ' meets requirement.');
}

// ── Skills ───────────────────────────────────────────────────────────────────

function flatSkills(sk) {
  if (!sk) return [];
  return ['programming_languages', 'frameworks', 'ai_ml', 'databases', 'cloud', 'tools', 'soft_skills']
    .flatMap(k => Array.isArray(sk[k]) ? sk[k] : [])
    .map(s => s.toLowerCase());
}

function checkSkills(skills, required) {
  if (!required || !required.length) return r(PASS, 'No mandatory skills specified.');
  const have = flatSkills(skills);
  const missing = required.filter(req => !have.some(h => h.includes(req.toLowerCase()) || req.toLowerCase().includes(h)));
  if (!missing.length) return r(PASS, 'All required skills found: ' + required.join(', ') + '.');
  return r(FAIL, 'Missing required skills: ' + missing.join(', ') + '.');
}

// ── Experience ───────────────────────────────────────────────────────────────

function parseYM(s) {
  if (!s || s === 'Present') return null;
  const [y, m] = s.split('-').map(Number);
  return (y && m) ? new Date(y, m - 1, 1) : null;
}

function totalExpMonths(exp) {
  if (!exp) return 0;
  let t = 0;
  const now = new Date();
  for (const cat of ['internships', 'jobs']) {
    for (const e of (exp[cat] || [])) {
      const s = parseYM(e.start_date);
      const en = e.end_date === 'Present' ? now : parseYM(e.end_date);
      if (s && en && en >= s) t += (en.getFullYear() - s.getFullYear()) * 12 + (en.getMonth() - s.getMonth());
    }
  }
  return t;
}

function checkExperience(exp, minYrs, maxYrs) {
  if ((minYrs == null || minYrs === 0) && !maxYrs) return r(PASS, 'No minimum experience required.');
  const yrs = totalExpMonths(exp) / 12;
  if (minYrs != null && minYrs > 0 && yrs < minYrs) return r(FAIL, '~' + yrs.toFixed(1) + 'yr experience; requirement is ' + minYrs + '+ years.');
  if (maxYrs != null && yrs > maxYrs) return r(FAIL, '~' + yrs.toFixed(1) + 'yr experience exceeds maximum ' + maxYrs + 'yr (possibly overqualified).');
  return r(PASS, 'Experience (~' + yrs.toFixed(1) + 'yr) meets requirement.');
}

// ── GPA ──────────────────────────────────────────────────────────────────────

function checkGpa(edu, minGpa) {
  if (!minGpa) return r(PASS, 'No GPA requirement.');
  const edu0 = edu[0];
  if (!edu0 || edu0.gpa == null) return r(UNKNOWN, 'GPA not set in profile; cannot verify requirement of ' + minGpa + '+. Do not assume GPA.');
  return edu0.gpa >= minGpa
    ? r(PASS, 'GPA ' + edu0.gpa + ' meets minimum ' + minGpa + '.')
    : r(FAIL, 'GPA ' + edu0.gpa + ' is below required minimum ' + minGpa + '.');
}

// ── Work authorization ───────────────────────────────────────────────────────

function checkWorkAuth(sp, requiresAuth, offersSponsorship) {
  const needs = sp && sp.needs_sponsorship;
  if (offersSponsorship === false && needs === true) return r(FAIL, 'Job does not offer sponsorship; profile requires it.');
  if (requiresAuth === true) {
    if (needs === false) return r(PASS, 'Profile does not require sponsorship; work authorization confirmed.');
    if (needs === true)  return r(FAIL, 'Job requires existing work authorization; profile requires sponsorship.');
    return r(UNKNOWN, 'Work authorization required by job; sponsorship status not explicitly set in profile. Do not assume authorization.');
  }
  if (offersSponsorship === true && needs === true) return r(PASS, 'Job offers sponsorship and profile requires it.');
  if (needs === false) return r(PASS, 'Profile does not require sponsorship.');
  return r(UNKNOWN, 'Work authorization status unclear; sponsorship need not specified in profile.');
}

// ── Citizenship ──────────────────────────────────────────────────────────────

function checkCitizenship(sp, required) {
  if (!required) return r(PASS, 'No citizenship requirement.');
  const visa = (sp && sp.visa_status) ? sp.visa_status.toLowerCase() : '';
  const isCitizen = ['citizen', 'us citizen', 'national'].some(k => visa.includes(k));
  const isPR = ['permanent resident', 'green card'].some(k => visa.includes(k));
  if (isCitizen) return r(PASS, 'Profile indicates citizenship; meets requirement: ' + required + '.');
  if (required.toLowerCase().includes('permanent resident') && (isCitizen || isPR)) return r(PASS, 'Profile meets citizenship/PR requirement.');
  if (visa && !isCitizen && !isPR) return r(FAIL, 'Profile visa_status "' + sp.visa_status + '" does not meet requirement: ' + required + '.');
  return r(UNKNOWN, 'Citizenship required (' + required + ') but not specified in profile. Do not assume citizenship.');
}

// ── Age ──────────────────────────────────────────────────────────────────────

function checkAge(ageMin, ageMax) {
  if (!ageMin && !ageMax) return r(PASS, 'No age requirement.');
  return r(UNKNOWN, 'Age requirement (' + (ageMin || '?') + '–' + (ageMax || '?') + ') exists; age is not stored in profile for privacy. Manual verification required.');
}

// ── Duration ─────────────────────────────────────────────────────────────────

function checkDuration(timing, dMin, dMax) {
  if (!dMin && !dMax) return r(PASS, 'No duration requirement.');
  const pMin = timing && timing.duration_months_min;
  const pMax = timing && timing.duration_months_max;
  if (!pMin && !pMax) return r(UNKNOWN, 'Duration preference not set in profile; cannot verify against ' + dMin + '–' + dMax + ' month requirement.');
  if (dMax && pMin && dMax < pMin) return r(FAIL, 'Job max duration (' + dMax + 'mo) is less than profile minimum (' + pMin + 'mo).');
  if (dMin && pMax && dMin > pMax) return r(FAIL, 'Job min duration (' + dMin + 'mo) exceeds profile maximum (' + pMax + 'mo).');
  return r(PASS, 'Duration ranges are compatible.');
}

// ── Deadline ─────────────────────────────────────────────────────────────────

function checkDeadline(deadline, now) {
  if (!deadline) return r(PASS, 'No application deadline specified.');
  const dl = new Date(deadline);
  if (isNaN(dl.getTime())) return r(UNKNOWN, 'Deadline "' + deadline + '" could not be parsed.');
  const today = now || new Date();
  if (dl < today) return r(FAIL, 'Application deadline ' + deadline + ' has already passed.');
  const days = Math.ceil((dl - today) / 86400000);
  return r(PASS, 'Deadline ' + deadline + ' is ' + days + ' day(s) away.');
}

// ── Location ─────────────────────────────────────────────────────────────────

function checkLocation(prefs, remoteOk, jobLocs) {
  const loc = prefs && prefs.locations;
  if (!loc) return r(UNKNOWN, 'Location preferences not set in profile.');
  if (remoteOk === true && loc.remote) return r(PASS, 'Position is remote-eligible; profile accepts remote.');
  if (remoteOk === true) return r(PASS, 'Position is remote-eligible (profile remote preference not set).');
  if (remoteOk === false && !loc.on_site && !loc.hybrid) return r(FAIL, 'Position requires on-site presence; profile does not accept on-site or hybrid.');
  if (!jobLocs || !jobLocs.length) return r(UNKNOWN, 'No specific location stated; review manually.');
  const pref = (loc.preferred || []).map(l => l.toLowerCase());
  const hit = jobLocs.some(jl => pref.some(pl => pl.includes(jl.toLowerCase()) || jl.toLowerCase().includes(pl)));
  if (hit) return r(PASS, 'Job location matches profile preferred locations.');
  if (loc.relocation) return r(UNKNOWN, 'No location match but profile indicates relocation willingness; review.');
  return r(UNKNOWN, 'Job location(s) (' + jobLocs.join(', ') + ') not in profile preferred locations; review manually.');
}

// ── Main ─────────────────────────────────────────────────────────────────────

/**
 * Run all eligibility checks for a student profile against job requirements.
 *
 * @param {object} profile     - Validated student profile (from loadStudentProfile())
 * @param {object} requirements - Structured requirements extracted from JD
 * @param {object} [opts]      - { now: Date } for testability
 * @returns {object} EligibilityReport
 */
export function checkEligibility(profile, requirements, opts = {}) {
  const req  = requirements || {};
  const edu  = profile.education  || [];
  const sk   = profile.skills     || {};
  const exp  = profile.experience || {};
  const prefs= profile.preferences|| {};
  const sp   = prefs.sponsorship  || {};
  const now  = opts.now || new Date();

  const checks = {
    degree:             checkDegree(edu, req.degree_required),
    major:              checkMajor(edu, req.major_keywords),
    enrollment:         checkEnrollment(edu, req.enrollment_required),
    graduation_year:    checkGraduationYear(edu, req.graduation_year_min, req.graduation_year_max),
    academic_year:      checkAcademicYear(edu, req.academic_year_min, req.academic_year_max),
    skills:             checkSkills(sk, req.required_skills),
    experience:         checkExperience(exp, req.min_experience_years, req.max_experience_years),
    gpa:                checkGpa(edu, req.min_gpa),
    work_authorization: checkWorkAuth(sp, req.requires_work_auth, req.offers_sponsorship),
    citizenship:        checkCitizenship(sp, req.citizenship_required),
    age:                checkAge(req.age_min, req.age_max),
    duration:           checkDuration(prefs.timing || {}, req.duration_months_min, req.duration_months_max),
    deadline:           checkDeadline(req.deadline, now),
    location:           checkLocation(prefs, req.remote_ok, req.job_locations),
  };

  const blocking_failures = Object.entries(checks)
    .filter(([, v]) => v.result === FAIL)
    .map(([k, v]) => k.toUpperCase() + ': ' + v.detail);

  const unknowns = Object.entries(checks)
    .filter(([, v]) => v.result === UNKNOWN)
    .map(([k, v]) => k.toUpperCase() + ': ' + v.detail);

  const overall = blocking_failures.length ? NOT_ELIGIBLE
    : unknowns.length ? REQUIRES_REVIEW
    : ELIGIBLE;

  const lines = ['Eligibility Report', '=================='];
  for (const [k, v] of Object.entries(checks)) {
    lines.push(k + ': ' + v.result + ' — ' + v.detail);
  }
  lines.push('', 'Overall: ' + overall);
  if (blocking_failures.length) lines.push('Blocking failures:', ...blocking_failures.map(f => '  STOP: ' + f));
  if (unknowns.length)          lines.push('Requires review:',  ...unknowns.map(u => '  ? '   + u));

  return { overall, checks, blocking_failures, unknowns, report: lines.join('\n'), evaluated_at: now.toISOString() };
}

/**
 * Hard gate — throws EligibilityGateError if report is NOT_ELIGIBLE or REQUIRES_REVIEW.
 * The pipeline MUST call this before any CV tailoring or application submission.
 *
 * @param {object} report - EligibilityReport from checkEligibility()
 * @returns {true} when ELIGIBLE
 * @throws {EligibilityGateError}
 */
export function assertEligible(report) {
  if (report.overall === ELIGIBLE) return true;
  throw new EligibilityGateError(report);
}

/**
 * Best-effort regex extraction of structured requirements from raw JD text.
 * Use as input to checkEligibility(). Supplement with LLM parsing for accuracy.
 *
 * @param {string} jdText
 * @returns {object} requirements
 */
export function parseRequirements(jdText) {
  const t = jdText || '';
  const req = {};

  // Degree
  if (/\b(?:ph\.?d|doctorate|doctoral)\b/i.test(t))                     req.degree_required = 'phd';
  else if (/\b(?:master'?s?|m\.?s\.?|m\.?eng|mba)\b/i.test(t))          req.degree_required = 'master';
  else if (/\b(?:bachelor'?s?|b\.?s\.?|b\.?eng|undergraduate)\b/i.test(t)) req.degree_required = 'bachelor';

  // Enrollment
  if (/\b(?:currently enrolled|must be a (?:current |full.?time )?student|pursuing a degree)\b/i.test(t))
    req.enrollment_required = true;

  // Graduation year
  const gradContext = [...t.matchAll(/(?:graduating|graduation|class of|expected graduation)[^\n]*/gi)].map(m => m[0]).join(' ');
  const gy = [...gradContext.matchAll(/\b20(\d\d)\b/g)].map(m => parseInt('20' + m[1]));
  if (gy.length) { req.graduation_year_min = Math.min(...gy); req.graduation_year_max = Math.max(...gy); }

  // GPA
  const gpa = t.match(/(?:minimum |min\.? )?gpa[:\s]+(?:of\s+)?(\d\.\d)/i) || t.match(/(\d\.\d)\s*(?:gpa|grade point)/i);
  if (gpa) req.min_gpa = parseFloat(gpa[1]);

  // Work auth / sponsorship
  if (/\bno\s+(?:visa\s+)?sponsorship\b/i.test(t) || /\bwill\s+not\s+sponsor\b/i.test(t) || /\bmust\s+be\s+(?:legally\s+)?authorized\b/i.test(t)) {
    req.requires_work_auth = true;
    req.offers_sponsorship = false;
  } else if (/\b(?:visa\s+)?sponsorship\s+(?:is\s+)?(?:available|provided|offered)\b/i.test(t)) {
    req.offers_sponsorship = true;
  }

  // Citizenship
  const cm = t.match(/(?:must\s+be\s+a?\s+|requires?\s+)(u\.?s\.?\s+citizen(?:\s+or\s+permanent\s+resident)?)/i);
  if (cm) req.citizenship_required = cm[1].trim();

  // Experience
  const em = t.match(/(\d+)\+?\s*years?\s+(?:of\s+)?(?:professional\s+|relevant\s+)?experience/i);
  if (em) req.min_experience_years = parseInt(em[1]);
  if (/\bno\s+(?:prior\s+)?experience\s+required\b/i.test(t)) req.min_experience_years = 0;

  // Duration
  const wk = t.match(/(\d+)[- ]week/i);
  const mo = t.match(/(\d+)[- ](?:to[- ])?(\d+)?[- ]?month/i);
  if (wk) { const m = Math.round(parseInt(wk[1]) / 4); req.duration_months_min = m; req.duration_months_max = m + 1; }
  else if (mo) { req.duration_months_min = parseInt(mo[1]); req.duration_months_max = mo[2] ? parseInt(mo[2]) : parseInt(mo[1]); }

  // Remote
  if (/\bfully\s+remote\b|\bremote[- ]?first\b/i.test(t))         req.remote_ok = true;
  if (/\bon[- ]?site\s+(?:only|required)\b|\bno\s+remote\b/i.test(t)) req.remote_ok = false;

  // Deadline
  const dl = t.match(/(?:application\s+)?deadline[:\s]+(\d{4}-\d{2}-\d{2})/i);
  if (dl) req.deadline = dl[1];

  return req;
}
