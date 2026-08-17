// tests/eligibility-engine.test.mjs — CareerOS Eligibility Engine Test Suite
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const MOD = pathToFileURL(join(ROOT, 'lib/eligibility-engine.mjs')).href;
console.log('\neligibility-engine — hard gate eligibility engine');

const {
  checkEligibility,
  assertEligible,
  parseRequirements,
  EligibilityGateError,
  PASS,
  FAIL,
  UNKNOWN,
  ELIGIBLE,
  NOT_ELIGIBLE,
  REQUIRES_REVIEW,
} = await import(MOD);

// ── Helpers ───────────────────────────────────────────────────────────────────

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function baseProfile() {
  return {
    identity: { name: 'Alice Student', email: 'alice@mit.edu', country: 'United States', city: 'Boston' },
    education: [
      {
        university: 'MIT',
        degree: 'Bachelor of Science',
        major: 'Computer Science',
        year: 3,
        semester: 'Fall 2026',
        graduation_date: '2027-05',
        gpa: 3.8,
        gpa_scale: 4.0,
        coursework: ['Algorithms', 'Machine Learning', 'Systems Programming'],
      },
    ],
    skills: {
      programming_languages: ['Python', 'Java', 'C++'],
      frameworks: ['PyTorch', 'React'],
      tools: ['Git', 'Docker'],
    },
    experience: {
      internships: [
        { company: 'Acme AI', role: 'ML Intern', start_date: '2025-06', end_date: '2025-08' },
      ],
    },
    projects: [
      { name: 'NeuralNet', technologies: ['Python', 'PyTorch'] },
    ],
    preferences: {
      search_mode: 'internships',
      target_roles: ['Software Engineering Intern'],
      locations: { remote: true, hybrid: true, on_site: false, preferred: ['Boston', 'New York'], relocation: true },
      sponsorship: { needs_sponsorship: false, visa_status: 'US Citizen' },
      timing: { duration_months_min: 3, duration_months_max: 6 },
      automation: { min_match_score: 3.5, max_applications_per_day: 5, auto_submit: false },
    },
  };
}

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

// ── 1. Perfect Match -> ELIGIBLE ──────────────────────────────────────────────

console.log('\n  1. Fully satisfied requirements -> ELIGIBLE');

{
  const prof = baseProfile();
  const reqs = {
    degree_required: 'bachelor',
    major_keywords: ['Computer Science'],
    enrollment_required: true,
    graduation_year_min: 2027,
    graduation_year_max: 2028,
    required_skills: ['Python'],
    min_experience_years: 0,
    min_gpa: 3.0,
    requires_work_auth: true,
    citizenship_required: 'US Citizen',
    duration_months_min: 3,
    duration_months_max: 4,
    remote_ok: true,
    deadline: '2026-12-31',
  };

  const report = checkEligibility(prof, reqs, { now: new Date('2026-08-10') });
  check('Overall verdict is ELIGIBLE', report.overall, ELIGIBLE);
  check('Blocking failures count is 0', report.blocking_failures.length, 0);
  check('Unknowns count is 0', report.unknowns.length, 0);
  check('Degree check PASS', report.checks.degree.result, PASS);
  check('Major check PASS', report.checks.major.result, PASS);
  check('GPA check PASS', report.checks.gpa.result, PASS);
  check('Work auth PASS', report.checks.work_authorization.result, PASS);
  check('assertEligible returns true when ELIGIBLE', assertEligible(report), true);
}

// ── 2. Explicit Mismatches -> NOT_ELIGIBLE (Hard Gate) ──────────────────────

console.log('\n  2. Hard Gate failures -> NOT_ELIGIBLE');

{
  // Degree failure: job requires PhD, student has BS
  const prof = baseProfile();
  const reqs = { degree_required: 'phd' };
  const report = checkEligibility(prof, reqs);
  check('Requires PhD when student has BS -> NOT_ELIGIBLE', report.overall, NOT_ELIGIBLE);
  check('Degree check FAIL', report.checks.degree.result, FAIL);
  check('Blocking failures has DEGREE', report.blocking_failures.some(f => f.includes('DEGREE')), true);

  try {
    assertEligible(report);
    fail('assertEligible should have thrown EligibilityGateError');
  } catch (e) {
    if (e instanceof EligibilityGateError && e.message.includes('NOT_ELIGIBLE')) {
      pass('assertEligible threw EligibilityGateError for NOT_ELIGIBLE');
    } else {
      fail(`Unexpected error thrown: ${e.message}`);
    }
  }
}

{
  // Major mismatch
  const prof = baseProfile();
  const reqs = { major_keywords: ['Mechanical Engineering'] };
  const report = checkEligibility(prof, reqs);
  check('Major mismatch -> NOT_ELIGIBLE', report.overall, NOT_ELIGIBLE);
  check('Major check FAIL', report.checks.major.result, FAIL);
}

{
  // Graduation year mismatch (already graduated before required min)
  const prof = baseProfile();
  const reqs = { graduation_year_min: 2028 };
  const report = checkEligibility(prof, reqs);
  check('Graduation year 2027 < min 2028 -> NOT_ELIGIBLE', report.overall, NOT_ELIGIBLE);
  check('Graduation year check FAIL', report.checks.graduation_year.result, FAIL);
}

{
  // Skill missing
  const prof = baseProfile();
  const reqs = { required_skills: ['Rust', 'Zig'] };
  const report = checkEligibility(prof, reqs);
  check('Missing required skill -> NOT_ELIGIBLE', report.overall, NOT_ELIGIBLE);
  check('Skills check FAIL', report.checks.skills.result, FAIL);
}

{
  // Experience required (e.g., 5+ years for senior role)
  const prof = baseProfile();
  const reqs = { min_experience_years: 5 };
  const report = checkEligibility(prof, reqs);
  check('Requires 5 yrs exp, student has <1 yr -> NOT_ELIGIBLE', report.overall, NOT_ELIGIBLE);
  check('Experience check FAIL', report.checks.experience.result, FAIL);
}

{
  // GPA below minimum
  const prof = baseProfile();
  prof.education[0].gpa = 2.8;
  const reqs = { min_gpa: 3.5 };
  const report = checkEligibility(prof, reqs);
  check('GPA 2.8 < min 3.5 -> NOT_ELIGIBLE', report.overall, NOT_ELIGIBLE);
  check('GPA check FAIL', report.checks.gpa.result, FAIL);
}

{
  // Sponsorship mismatch: candidate needs sponsorship, job will NOT sponsor
  const prof = baseProfile();
  prof.preferences.sponsorship = { needs_sponsorship: true, visa_status: 'F-1 CPT/OPT' };
  const reqs = { offers_sponsorship: false, requires_work_auth: true };
  const report = checkEligibility(prof, reqs);
  check('Candidate needs sponsorship but job offers none -> NOT_ELIGIBLE', report.overall, NOT_ELIGIBLE);
  check('Work auth check FAIL', report.checks.work_authorization.result, FAIL);
}

{
  // Deadline passed
  const prof = baseProfile();
  const reqs = { deadline: '2025-01-01' };
  const report = checkEligibility(prof, reqs, { now: new Date('2026-08-10') });
  check('Past deadline -> NOT_ELIGIBLE', report.overall, NOT_ELIGIBLE);
  check('Deadline check FAIL', report.checks.deadline.result, FAIL);
}

{
  // On-site required, candidate only remote
  const prof = baseProfile();
  prof.preferences.locations = { remote: true, hybrid: false, on_site: false };
  const reqs = { remote_ok: false };
  const report = checkEligibility(prof, reqs);
  check('On-site required but user declines on-site/hybrid -> NOT_ELIGIBLE', report.overall, NOT_ELIGIBLE);
  check('Location check FAIL', report.checks.location.result, FAIL);
}

// ── 3. Unknown Data -> REQUIRES_REVIEW (Never assume positive) ───────────────

console.log('\n  3. Missing profile info -> REQUIRES_REVIEW');

{
  // GPA not specified in profile, but job requires 3.5 GPA
  const prof = baseProfile();
  prof.education[0].gpa = null;
  const reqs = { min_gpa: 3.5 };
  const report = checkEligibility(prof, reqs);

  check('Missing GPA when required -> REQUIRES_REVIEW', report.overall, REQUIRES_REVIEW);
  check('GPA check UNKNOWN', report.checks.gpa.result, UNKNOWN);
  check('No blocking failures', report.blocking_failures.length, 0);
  check('Unknowns contains GPA', report.unknowns.some(u => u.includes('GPA')), true);

  try {
    assertEligible(report);
    fail('assertEligible should throw on REQUIRES_REVIEW');
  } catch (e) {
    if (e instanceof EligibilityGateError && e.message.includes('REQUIRES_REVIEW')) {
      pass('assertEligible threw EligibilityGateError for REQUIRES_REVIEW');
    } else {
      fail(`Unexpected error: ${e.message}`);
    }
  }
}

{
  // Citizenship required by job, but visa_status not specified in profile
  const prof = baseProfile();
  delete prof.preferences.sponsorship;
  const reqs = { citizenship_required: 'US Citizen' };
  const report = checkEligibility(prof, reqs);

  check('Missing citizenship info when required -> REQUIRES_REVIEW', report.overall, REQUIRES_REVIEW);
  check('Citizenship check UNKNOWN', report.checks.citizenship.result, UNKNOWN);
  check('Never assume citizenship', report.checks.citizenship.detail.includes('Never assume citizenship') || report.checks.citizenship.detail.includes('Do not assume'), true);
}

{
  // Age requirement exists (e.g. EU government program min age 18)
  const prof = baseProfile();
  const reqs = { age_min: 18 };
  const report = checkEligibility(prof, reqs);
  check('Age requirement -> UNKNOWN (privacy protection)', report.checks.age.result, UNKNOWN);
  check('Overall REQUIRES_REVIEW due to age', report.overall, REQUIRES_REVIEW);
}

{
  // Partial major match
  const prof = baseProfile();
  prof.education[0].major = 'Data Science';
  const reqs = { major_keywords: ['Data Science', 'Mathematics'] };
  const report = checkEligibility(prof, reqs);
  check('Partial major match -> UNKNOWN', report.checks.major.result, UNKNOWN);
}

// ── 4. Requirement Parser (parseRequirements) ─────────────────────────────

console.log('\n  4. Requirement Parser (parseRequirements)');

{
  const jd = `
    Software Engineering Intern - Summer 2027
    Requirements:
    - Must be currently enrolled in a Bachelor's degree program in Computer Science
    - Expected graduation: Class of 2027 or 2028
    - Minimum GPA of 3.2 required
    - Must be legally authorized to work in the US. No visa sponsorship provided.
    - Must be a US Citizen
    - 12-week summer internship
    - Fully remote position
    - Application deadline: 2026-11-30
  `;

  const reqs = parseRequirements(jd);
  check('Extracted degree: bachelor', reqs.degree_required, 'bachelor');
  check('Extracted enrollment: true', reqs.enrollment_required, true);
  check('Extracted min grad year: 2027', reqs.graduation_year_min, 2027);
  check('Extracted max grad year: 2028', reqs.graduation_year_max, 2028);
  check('Extracted min GPA: 3.2', reqs.min_gpa, 3.2);
  check('Extracted work auth required: true', reqs.requires_work_auth, true);
  check('Extracted offers sponsorship: false', reqs.offers_sponsorship, false);
  check('Extracted citizenship required', typeof reqs.citizenship_required, 'string');
  check('Extracted duration min: 3 months', reqs.duration_months_min, 3);
  check('Extracted remote_ok: true', reqs.remote_ok, true);
  check('Extracted deadline: 2026-11-30', reqs.deadline, '2026-11-30');
}

{
  // Check parsing against eligibility engine integration
  const jd = `
    Senior Backend Developer
    Requires 5+ years of experience. Must have Master's degree.
    On-site required. No sponsorship.
  `;
  const reqs = parseRequirements(jd);
  check('Extracted degree: master', reqs.degree_required, 'master');
  check('Extracted min exp: 5 years', reqs.min_experience_years, 5);
  check('Extracted remote_ok: false', reqs.remote_ok, false);

  const prof = baseProfile(); // Undergraduate student
  const report = checkEligibility(prof, reqs);
  check('Student evaluating senior role -> NOT_ELIGIBLE', report.overall, NOT_ELIGIBLE);
  check('Degree FAIL', report.checks.degree.result, FAIL);
  check('Experience FAIL', report.checks.experience.result, FAIL);
}

// ── 5. Detailed Report Format ────────────────────────────────────────────────

console.log('\n  5. Detailed Eligibility Report formatting');

{
  const prof = baseProfile();
  prof.education[0].gpa = null;
  const reqs = { degree_required: 'phd', min_gpa: 3.5 };
  const report = checkEligibility(prof, reqs);

  check('Report string is generated', typeof report.report, 'string');
  check('Report contains "Eligibility Report"', report.report.includes('Eligibility Report'), true);
  check('Report contains "Overall: NOT_ELIGIBLE"', report.report.includes('Overall: NOT_ELIGIBLE'), true);
  check('Report contains "Blocking failures:"', report.report.includes('Blocking failures:'), true);
  check('Report contains "Requires review:"', report.report.includes('Requires review:'), true);
}

// ── Done ──────────────────────────────────────────────────────────────────────
