/**
 * student-profile.mjs — CareerOS Student Profile Loader & Validator
 *
 * Loads, validates, and normalises `config/student-profile.yml`.
 *
 * Design rules:
 *  - Never fabricate missing values. Optional fields are returned as null.
 *  - Required fields produce a hard ValidationError on missing/blank.
 *  - All validation errors are collected before throwing (fail-fast on load,
 *    but the caller sees ALL problems at once).
 *  - No side-effects: this module only reads and validates — it never writes.
 *  - Backwards-compatible: does not touch the legacy config/profile.yml.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import jsYaml from 'js-yaml';
const parseYaml = jsYaml.load;

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_PROFILE_PATH = resolve(REPO_ROOT, 'config', 'student-profile.yml');
export const EXAMPLE_PROFILE_PATH = resolve(REPO_ROOT, 'config', 'student-profile.example.yml');

const VALID_SEARCH_MODES = ['internships', 'jobs', 'both'];
const VALID_STIPEND_UNITS = ['hourly', 'monthly', 'annual'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const YYYYMM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const YYYYMMDD_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// ── Custom Error ─────────────────────────────────────────────────────────────

export class ValidationError extends Error {
  /**
   * @param {string[]} errors   Hard errors (invalid required fields, bad formats)
   * @param {string[]} warnings Soft warnings (missing optional-but-recommended fields)
   */
  constructor(errors, warnings = []) {
    const lines = [
      `Student profile validation failed with ${errors.length} error(s):`,
      ...errors.map((e) => `  ✖ ${e}`),
    ];
    if (warnings.length) {
      lines.push(`  (${warnings.length} warning(s): run validateStudentProfile() for details)`);
    }
    super(lines.join('\n'));
    this.name = 'ValidationError';
    this.errors = errors;
    this.warnings = warnings;
  }
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isNullOrUndefined(v) {
  return v === null || v === undefined;
}

function isPositiveInt(v) {
  return Number.isInteger(v) && v > 0;
}

function isFloat(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function normaliseStr(v) {
  return isNonEmptyString(v) ? v.trim() : null;
}

function normaliseStrArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(isNonEmptyString).map((s) => s.trim());
}

// ── Section Validators ────────────────────────────────────────────────────────

/**
 * Validates the `identity` section.
 * @param {unknown} raw
 * @param {string[]} errors
 * @param {string[]} warnings
 * @returns {object} Normalised identity object
 */
function validateIdentity(raw, errors, warnings) {
  if (!raw || typeof raw !== 'object') {
    errors.push('identity section is missing or not an object');
    return {};
  }

  const id = {};

  // Required fields
  if (!isNonEmptyString(raw.name)) {
    errors.push('identity.name is required and must be a non-empty string');
  } else {
    id.name = raw.name.trim();
  }

  if (!isNonEmptyString(raw.email)) {
    errors.push('identity.email is required');
  } else if (!EMAIL_RE.test(raw.email.trim())) {
    errors.push(`identity.email "${raw.email}" is not a valid email address`);
  } else {
    id.email = raw.email.trim().toLowerCase();
  }

  if (!isNonEmptyString(raw.country)) {
    errors.push('identity.country is required');
  } else {
    id.country = raw.country.trim();
  }

  if (!isNonEmptyString(raw.city)) {
    errors.push('identity.city is required');
  } else {
    id.city = raw.city.trim();
  }

  // Optional fields — never fabricated
  id.phone = normaliseStr(raw.phone);
  id.linkedin = normaliseStr(raw.linkedin);
  id.github = normaliseStr(raw.github);
  id.portfolio = normaliseStr(raw.portfolio);

  if (!id.linkedin) warnings.push('identity.linkedin is not set — recommended for internship applications');
  if (!id.github) warnings.push('identity.github is not set — helpful for technical roles');

  return id;
}

/**
 * Validates a single education entry.
 * @param {unknown} raw
 * @param {number} index
 * @param {string[]} errors
 * @param {string[]} warnings
 * @returns {object}
 */
function validateEducationEntry(raw, index, errors, warnings) {
  const prefix = `education[${index}]`;
  if (!raw || typeof raw !== 'object') {
    errors.push(`${prefix} must be an object`);
    return {};
  }

  const edu = {};

  if (!isNonEmptyString(raw.university)) {
    errors.push(`${prefix}.university is required`);
  } else {
    edu.university = raw.university.trim();
  }

  if (!isNonEmptyString(raw.degree)) {
    errors.push(`${prefix}.degree is required (e.g. "Bachelor of Science")`);
  } else {
    edu.degree = raw.degree.trim();
  }

  if (!isNonEmptyString(raw.major)) {
    errors.push(`${prefix}.major is required`);
  } else {
    edu.major = raw.major.trim();
  }

  if (!isNonEmptyString(raw.graduation_date)) {
    errors.push(`${prefix}.graduation_date is required (format: YYYY-MM)`);
  } else if (!YYYYMM_RE.test(raw.graduation_date.trim())) {
    errors.push(`${prefix}.graduation_date "${raw.graduation_date}" must be in YYYY-MM format`);
  } else {
    edu.graduation_date = raw.graduation_date.trim();
  }

  // Optional — GPA validation
  edu.gpa = null;
  edu.gpa_scale = null;
  if (!isNullOrUndefined(raw.gpa)) {
    if (!isFloat(raw.gpa) || raw.gpa < 0) {
      errors.push(`${prefix}.gpa must be a non-negative number`);
    } else {
      const scale = isFloat(raw.gpa_scale) && raw.gpa_scale > 0 ? raw.gpa_scale : 4.0;
      if (raw.gpa > scale) {
        errors.push(`${prefix}.gpa (${raw.gpa}) exceeds gpa_scale (${scale})`);
      } else {
        edu.gpa = raw.gpa;
        edu.gpa_scale = scale;
      }
    }
  }

  // Optional
  edu.minor = normaliseStr(raw.minor);
  edu.year = (Number.isInteger(raw.year) && raw.year >= 1 && raw.year <= 8) ? raw.year : null;
  edu.semester = normaliseStr(raw.semester);
  edu.coursework = normaliseStrArray(raw.coursework);

  return edu;
}

/**
 * Validates the `education` section.
 */
function validateEducation(raw, errors, warnings) {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push('education must be an array with at least one entry');
    return [];
  }
  return raw.map((entry, i) => validateEducationEntry(entry, i, errors, warnings));
}

/**
 * Validates the `skills` section. All fields are optional arrays of strings.
 */
function validateSkills(raw, warnings) {
  if (!raw || typeof raw !== 'object') {
    warnings.push('skills section is missing — recommended for accurate job matching');
    return {};
  }

  const SKILL_KEYS = [
    'programming_languages',
    'frameworks',
    'ai_ml',
    'databases',
    'cloud',
    'tools',
    'soft_skills',
  ];

  const skills = {};
  for (const key of SKILL_KEYS) {
    skills[key] = normaliseStrArray(raw[key]);
  }

  const totalSkills = SKILL_KEYS.reduce((s, k) => s + skills[k].length, 0);
  if (totalSkills === 0) {
    warnings.push('skills section has no entries — at least programming_languages is recommended');
  }

  return skills;
}

/**
 * Validates a single experience entry (internship, job, or volunteer).
 */
function validateExperienceEntry(raw, index, category, errors) {
  const prefix = `experience.${category}[${index}]`;
  if (!raw || typeof raw !== 'object') {
    errors.push(`${prefix} must be an object`);
    return {};
  }

  const entry = {};

  if (!isNonEmptyString(raw.company)) {
    errors.push(`${prefix}.company is required`);
  } else {
    entry.company = raw.company.trim();
  }

  if (!isNonEmptyString(raw.role)) {
    errors.push(`${prefix}.role is required`);
  } else {
    entry.role = raw.role.trim();
  }

  if (!isNonEmptyString(raw.start_date)) {
    errors.push(`${prefix}.start_date is required (YYYY-MM)`);
  } else if (!YYYYMM_RE.test(raw.start_date.trim())) {
    errors.push(`${prefix}.start_date "${raw.start_date}" must be YYYY-MM`);
  } else {
    entry.start_date = raw.start_date.trim();
  }

  if (!isNonEmptyString(raw.end_date)) {
    errors.push(`${prefix}.end_date is required (YYYY-MM or "Present")`);
  } else if (raw.end_date.trim() !== 'Present' && !YYYYMM_RE.test(raw.end_date.trim())) {
    errors.push(`${prefix}.end_date "${raw.end_date}" must be YYYY-MM or "Present"`);
  } else {
    entry.end_date = raw.end_date.trim();
  }

  // Sanity check: end must not precede start
  if (entry.start_date && entry.end_date && entry.end_date !== 'Present') {
    if (entry.end_date < entry.start_date) {
      errors.push(`${prefix}.end_date (${entry.end_date}) is before start_date (${entry.start_date})`);
    }
  }

  entry.location = normaliseStr(raw.location);
  entry.description = normaliseStr(raw.description);
  entry.achievements = normaliseStrArray(raw.achievements);

  return entry;
}

/**
 * Validates the `experience` section.
 */
function validateExperience(raw, errors, warnings) {
  if (!raw || typeof raw !== 'object') {
    return { internships: [], jobs: [], volunteer: [] };
  }

  return {
    internships: Array.isArray(raw.internships)
      ? raw.internships.map((e, i) => validateExperienceEntry(e, i, 'internships', errors))
      : [],
    jobs: Array.isArray(raw.jobs)
      ? raw.jobs.map((e, i) => validateExperienceEntry(e, i, 'jobs', errors))
      : [],
    volunteer: Array.isArray(raw.volunteer)
      ? raw.volunteer.map((e, i) => validateExperienceEntry(e, i, 'volunteer', errors))
      : [],
  };
}

/**
 * Validates a single project entry.
 */
function validateProjectEntry(raw, index, errors) {
  const prefix = `projects[${index}]`;
  if (!raw || typeof raw !== 'object') {
    errors.push(`${prefix} must be an object`);
    return {};
  }

  const proj = {};

  if (!isNonEmptyString(raw.name)) {
    errors.push(`${prefix}.name is required`);
  } else {
    proj.name = raw.name.trim();
  }

  proj.description = normaliseStr(raw.description);
  proj.technologies = normaliseStrArray(raw.technologies);
  proj.url = normaliseStr(raw.url);
  proj.repo = normaliseStr(raw.repo);
  proj.achievements = normaliseStrArray(raw.achievements);

  return proj;
}

/**
 * Validates the `projects` section.
 */
function validateProjects(raw, errors, warnings) {
  if (!Array.isArray(raw) || raw.length === 0) {
    warnings.push('projects section is empty — projects significantly improve internship match scores');
    return [];
  }
  return raw.map((p, i) => validateProjectEntry(p, i, errors));
}

/**
 * Validates the `preferences` section.
 */
function validatePreferences(raw, errors, warnings) {
  if (!raw || typeof raw !== 'object') {
    errors.push('preferences section is missing');
    return {};
  }

  const prefs = {};

  // search_mode — required
  if (!isNonEmptyString(raw.search_mode)) {
    errors.push(`preferences.search_mode is required (valid values: ${VALID_SEARCH_MODES.join(', ')})`);
  } else if (!VALID_SEARCH_MODES.includes(raw.search_mode.trim().toLowerCase())) {
    errors.push(`preferences.search_mode "${raw.search_mode}" is invalid. Must be: ${VALID_SEARCH_MODES.join(', ')}`);
  } else {
    prefs.search_mode = raw.search_mode.trim().toLowerCase();
  }

  // target_roles — required, at least one
  if (!Array.isArray(raw.target_roles) || raw.target_roles.filter(isNonEmptyString).length === 0) {
    errors.push('preferences.target_roles is required and must have at least one role');
  } else {
    prefs.target_roles = normaliseStrArray(raw.target_roles);
  }

  prefs.target_industries = normaliseStrArray(raw.target_industries);

  // locations
  const loc = raw.locations || {};
  prefs.locations = {
    preferred: normaliseStrArray(loc.preferred),
    remote: loc.remote === true,
    hybrid: loc.hybrid === true,
    on_site: loc.on_site === true,
    relocation: loc.relocation === true,
  };

  if (!prefs.locations.remote && !prefs.locations.hybrid && !prefs.locations.on_site) {
    warnings.push('preferences.locations: all work modes (remote/hybrid/on_site) are false — no positions will match');
  }

  // sponsorship
  const sp = raw.sponsorship || {};
  prefs.sponsorship = {
    needs_sponsorship: sp.needs_sponsorship === true,
    authorized_in: normaliseStrArray(sp.authorized_in),
    visa_status: normaliseStr(sp.visa_status),
    cpt_eligible: sp.cpt_eligible === true,
    opt_eligible: sp.opt_eligible === true,
  };

  // compensation
  const comp = raw.compensation || {};
  prefs.compensation = {};

  if (!isNullOrUndefined(comp.internship_stipend_min)) {
    if (!isFloat(comp.internship_stipend_min) || comp.internship_stipend_min < 0) {
      errors.push('preferences.compensation.internship_stipend_min must be a non-negative number');
    } else {
      prefs.compensation.internship_stipend_min = comp.internship_stipend_min;
    }
  } else {
    prefs.compensation.internship_stipend_min = null;
  }

  if (!isNullOrUndefined(comp.stipend_unit)) {
    if (!VALID_STIPEND_UNITS.includes(comp.stipend_unit)) {
      errors.push(`preferences.compensation.stipend_unit "${comp.stipend_unit}" must be: ${VALID_STIPEND_UNITS.join(', ')}`);
    } else {
      prefs.compensation.stipend_unit = comp.stipend_unit;
    }
  } else {
    prefs.compensation.stipend_unit = 'hourly';
  }

  prefs.compensation.stipend_currency = normaliseStr(comp.stipend_currency) ?? 'USD';

  if (!isNullOrUndefined(comp.salary_min)) {
    if (!isFloat(comp.salary_min) || comp.salary_min < 0) {
      errors.push('preferences.compensation.salary_min must be a non-negative number');
    } else {
      prefs.compensation.salary_min = comp.salary_min;
    }
  } else {
    prefs.compensation.salary_min = null;
  }

  prefs.compensation.salary_currency = normaliseStr(comp.salary_currency) ?? 'USD';

  // timing
  const timing = raw.timing || {};
  prefs.timing = {
    preferred_start: normaliseStr(timing.preferred_start),
    duration_months_min: (Number.isInteger(timing.duration_months_min) && timing.duration_months_min >= 1)
      ? timing.duration_months_min : null,
    duration_months_max: (Number.isInteger(timing.duration_months_max) && timing.duration_months_max >= 1)
      ? timing.duration_months_max : null,
    credit_bearing_ok: timing.credit_bearing_ok !== false,
    paid_only: timing.paid_only === true,
  };

  if (
    prefs.timing.duration_months_min !== null &&
    prefs.timing.duration_months_max !== null &&
    prefs.timing.duration_months_min > prefs.timing.duration_months_max
  ) {
    errors.push(
      `preferences.timing.duration_months_min (${prefs.timing.duration_months_min}) ` +
      `exceeds duration_months_max (${prefs.timing.duration_months_max})`
    );
  }

  // automation
  const auto = raw.automation || {};
  prefs.automation = {};

  const minScore = auto.min_match_score;
  if (isNullOrUndefined(minScore)) {
    errors.push('preferences.automation.min_match_score is required (1.0–5.0)');
  } else if (!isFloat(minScore) || minScore < 1.0 || minScore > 5.0) {
    errors.push(`preferences.automation.min_match_score must be between 1.0 and 5.0 (got ${minScore})`);
  } else {
    prefs.automation.min_match_score = minScore;
  }

  const maxApps = auto.max_applications_per_day;
  if (isNullOrUndefined(maxApps)) {
    errors.push('preferences.automation.max_applications_per_day is required (1–50)');
  } else if (!Number.isInteger(maxApps) || maxApps < 1 || maxApps > 50) {
    errors.push(`preferences.automation.max_applications_per_day must be an integer 1–50 (got ${maxApps})`);
  } else {
    prefs.automation.max_applications_per_day = maxApps;
  }

  const autoSubmit = auto.auto_submit;
  if (isNullOrUndefined(autoSubmit) || autoSubmit === false) {
    prefs.automation.auto_submit = false;
    prefs.automation.auto_submit_confirm = false;
  } else if (autoSubmit === true) {
    // Require explicit second confirmation flag
    if (auto.auto_submit_confirm !== true) {
      errors.push(
        'preferences.automation.auto_submit_confirm must be set to true when auto_submit is true. ' +
        'This is a required double-opt-in safety gate.'
      );
    }
    prefs.automation.auto_submit = true;
    prefs.automation.auto_submit_confirm = auto.auto_submit_confirm === true;
  } else {
    errors.push('preferences.automation.auto_submit must be true or false');
  }

  // Blackout days — optional, each must be YYYY-MM-DD
  if (Array.isArray(auto.blackout_days)) {
    const invalid = auto.blackout_days.filter(
      (d) => !isNonEmptyString(d) || !YYYYMMDD_RE.test(d.trim())
    );
    if (invalid.length > 0) {
      errors.push(`preferences.automation.blackout_days contains invalid dates: ${invalid.join(', ')} (must be YYYY-MM-DD)`);
    } else {
      prefs.automation.blackout_days = auto.blackout_days.map((d) => d.trim());
    }
  } else {
    prefs.automation.blackout_days = [];
  }

  return prefs;
}

/**
 * Validates the optional `matching:` block.
 * All fields are optional — the block itself is optional.
 * Returns a matching config object with defaults applied.
 */
function validateMatching(raw, errors, warnings) {
  // Entire block is optional
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') {
    errors.push('matching must be an object if provided');
    return null;
  }

  const matching = {};

  // ai_provider — optional, must be a known value if present
  const VALID_PROVIDERS = ['gemini', 'openai', 'ollama'];
  if (!isNullOrUndefined(raw.ai_provider)) {
    if (!isNonEmptyString(raw.ai_provider)) {
      errors.push('matching.ai_provider must be a non-empty string');
    } else if (!VALID_PROVIDERS.includes(raw.ai_provider.trim().toLowerCase())) {
      errors.push(
        `matching.ai_provider "${raw.ai_provider}" is invalid. Must be: ${VALID_PROVIDERS.join(', ')}`
      );
    } else {
      matching.ai_provider = raw.ai_provider.trim().toLowerCase();
    }
  }

  // model — optional string
  matching.model = normaliseStr(raw.model);

  // Ollama requires an explicit model
  if (matching.ai_provider === 'ollama' && !matching.model) {
    errors.push(
      'matching.model is required when matching.ai_provider is "ollama"'
    );
  }

  // temperature — optional, must be 0–2
  if (!isNullOrUndefined(raw.temperature)) {
    if (!isFloat(raw.temperature) || raw.temperature < 0 || raw.temperature > 2) {
      errors.push('matching.temperature must be a number between 0 and 2');
    } else {
      matching.temperature = raw.temperature;
    }
  }

  // ollama_url — optional string
  matching.ollama_url = normaliseStr(raw.ollama_url);

  // thresholds — optional sub-object
  if (!isNullOrUndefined(raw.thresholds)) {
    if (typeof raw.thresholds !== 'object') {
      errors.push('matching.thresholds must be an object');
    } else {
      const t = {};
      const THRESHOLD_KEYS = ['excellent', 'strong', 'good', 'weak'];
      for (const key of THRESHOLD_KEYS) {
        if (!isNullOrUndefined(raw.thresholds[key])) {
          if (!isFloat(raw.thresholds[key]) || raw.thresholds[key] < 0 || raw.thresholds[key] > 100) {
            errors.push(`matching.thresholds.${key} must be a number 0–100`);
          } else {
            t[key] = raw.thresholds[key];
          }
        }
      }
      matching.thresholds = t;
    }
  }

  return matching;
}


/**
 * Validates a raw (already-parsed) profile object.
 *
 * @param {unknown} raw - The raw parsed YAML object.
 * @returns {{ valid: boolean, errors: string[], warnings: string[], profile: object|null }}
 */
export function validateStudentProfile(raw) {
  const errors = [];
  const warnings = [];

  if (!raw || typeof raw !== 'object') {
    return {
      valid: false,
      errors: ['Profile must be a YAML object, got ' + (raw === null ? 'null' : typeof raw)],
      warnings: [],
      profile: null,
    };
  }

  const identity    = validateIdentity(raw.identity, errors, warnings);
  const education   = validateEducation(raw.education, errors, warnings);
  const skills      = validateSkills(raw.skills, warnings);
  const experience  = validateExperience(raw.experience, errors, warnings);
  const projects    = validateProjects(raw.projects, errors, warnings);
  const preferences = validatePreferences(raw.preferences, errors, warnings);
  const matching    = validateMatching(raw.matching, errors, warnings);

  if (errors.length > 0) {
    return { valid: false, errors, warnings, profile: null };
  }

  return {
    valid: true,
    errors: [],
    warnings,
    profile: { identity, education, skills, experience, projects, preferences, matching },
  };
}

/**
 * Loads and validates the student profile from a YAML file.
 *
 * @param {string} [profilePath] - Path to student-profile.yml (defaults to config/student-profile.yml)
 * @returns {object} Validated, normalised profile object
 * @throws {Error} If the file is missing
 * @throws {ValidationError} If validation fails
 */
export function loadStudentProfile(profilePath = DEFAULT_PROFILE_PATH) {
  const absPath = resolve(profilePath);

  if (!existsSync(absPath)) {
    throw new Error(
      `Student profile not found at: ${absPath}\n` +
      `Copy the example to get started:\n` +
      `  cp config/student-profile.example.yml config/student-profile.yml`
    );
  }

  const raw = parseYaml(readFileSync(absPath, 'utf8'));
  const result = validateStudentProfile(raw);

  if (!result.valid) {
    throw new ValidationError(result.errors, result.warnings);
  }

  return result.profile;
}

/**
 * Returns a summary string of the loaded profile — useful for agent prompts.
 *
 * @param {object} profile - A validated profile returned by loadStudentProfile()
 * @returns {string}
 */
export function profileSummary(profile) {
  const { identity, education, skills, preferences } = profile;
  const edu = education[0] ?? {};
  const allSkills = [
    ...(skills.programming_languages ?? []),
    ...(skills.frameworks ?? []),
    ...(skills.ai_ml ?? []),
  ].slice(0, 10);

  const lines = [
    `Name: ${identity.name}`,
    `Email: ${identity.email}`,
    `Location: ${identity.city}, ${identity.country}`,
  ];

  if (edu.university) {
    lines.push(`University: ${edu.university} — ${edu.degree} in ${edu.major}`);
    if (edu.gpa !== null) lines.push(`GPA: ${edu.gpa}/${edu.gpa_scale}`);
    if (edu.graduation_date) lines.push(`Expected graduation: ${edu.graduation_date}`);
  }

  if (allSkills.length > 0) lines.push(`Key skills: ${allSkills.join(', ')}`);

  lines.push(`Search mode: ${preferences.search_mode}`);
  lines.push(`Target roles: ${(preferences.target_roles ?? []).join(', ')}`);

  const workModes = [
    preferences.locations.remote && 'remote',
    preferences.locations.hybrid && 'hybrid',
    preferences.locations.on_site && 'on-site',
  ].filter(Boolean);
  if (workModes.length) lines.push(`Work modes: ${workModes.join(', ')}`);

  lines.push(`Min match score: ${preferences.automation.min_match_score}`);
  lines.push(`Max applications/day: ${preferences.automation.max_applications_per_day}`);
  lines.push(`Auto-submit: ${preferences.automation.auto_submit ? 'ENABLED' : 'disabled'}`);

  return lines.join('\n');
}
