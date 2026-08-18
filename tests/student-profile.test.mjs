// tests/student-profile.test.mjs — StudentCareer AI student profile loader & validator.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const MOD = pathToFileURL(join(ROOT, 'lib/student-profile.mjs')).href;

console.log('\nstudent-profile — loader & validator');

const { validateStudentProfile, loadStudentProfile, profileSummary, ValidationError } =
  await import(MOD);

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Returns a deeply-cloned minimal valid profile raw object. */
function minimal() {
  return {
    identity: {
      name: 'Test User',
      email: 'test@example.com',
      country: 'United States',
      city: 'Boston',
    },
    education: [
      {
        university: 'MIT',
        degree: 'Bachelor of Science',
        major: 'Computer Science',
        graduation_date: '2027-05',
      },
    ],
    skills: {},
    experience: {},
    projects: [],
    preferences: {
      search_mode: 'internships',
      target_roles: ['Software Engineering Intern'],
      locations: { remote: true, hybrid: false, on_site: false },
      automation: {
        min_match_score: 3.5,
        max_applications_per_day: 5,
        auto_submit: false,
      },
    },
  };
}

/** Deep clone */
function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

// ── Helper ───────────────────────────────────────────────────────────────────

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function expectValid(label, raw) {
  const r = validateStudentProfile(raw);
  if (r.valid) pass(label);
  else fail(`${label} — expected valid but got errors: ${r.errors.join('; ')}`);
  return r;
}

function expectInvalid(label, raw, fragment) {
  const r = validateStudentProfile(raw);
  if (!r.valid) {
    if (fragment) {
      const found = r.errors.some((e) => e.toLowerCase().includes(fragment.toLowerCase()));
      if (found) pass(`${label} (error mentions "${fragment}")`);
      else fail(`${label} — invalid as expected but error didn't mention "${fragment}": ${r.errors.join('; ')}`);
    } else {
      pass(label);
    }
  } else {
    fail(`${label} — expected invalid but passed`);
  }
  return r;
}

// ── Identity ─────────────────────────────────────────────────────────────────

console.log('\n  identity');

expectValid('minimal valid profile passes', minimal());

{
  const r = clone(minimal());
  delete r.identity.name;
  expectInvalid('missing name is an error', r, 'name');
}

{
  const r = clone(minimal());
  r.identity.email = 'not-an-email';
  expectInvalid('invalid email format is an error', r, 'email');
}

{
  const r = clone(minimal());
  delete r.identity.country;
  expectInvalid('missing country is an error', r, 'country');
}

{
  const r = clone(minimal());
  delete r.identity.city;
  expectInvalid('missing city is an error', r, 'city');
}

{
  const r = clone(minimal());
  r.identity.email = '  TEST@Example.COM  ';
  const res = expectValid('email is normalised to lowercase', r);
  if (res.valid) check('email lowercased', res.profile.identity.email, 'test@example.com');
}

{
  const r = clone(minimal());
  r.identity.phone = null;
  r.identity.linkedin = null;
  r.identity.github = null;
  r.identity.portfolio = null;
  const res = expectValid('optional identity fields may be null', r);
  if (res.valid) {
    check('phone null', res.profile.identity.phone, null);
    check('linkedin null', res.profile.identity.linkedin, null);
  }
}

{
  const res = validateStudentProfile(minimal());
  if (res.valid) {
    const hasLinkedinWarning = res.warnings.some((w) => w.includes('linkedin'));
    if (hasLinkedinWarning) pass('warns when linkedin is missing');
    else fail('expected warning for missing linkedin');
  }
}

// ── Education ────────────────────────────────────────────────────────────────

console.log('\n  education');

{
  const r = clone(minimal());
  delete r.education;
  expectInvalid('missing education section is an error', r, 'education');
}

{
  const r = clone(minimal());
  r.education = [];
  expectInvalid('empty education array is an error', r, 'education');
}

{
  const r = clone(minimal());
  delete r.education[0].university;
  expectInvalid('missing university is an error', r, 'university');
}

{
  const r = clone(minimal());
  delete r.education[0].major;
  expectInvalid('missing major is an error', r, 'major');
}

{
  const r = clone(minimal());
  r.education[0].graduation_date = '05-2027';
  expectInvalid('wrong graduation_date format is an error', r, 'graduation_date');
}

{
  const r = clone(minimal());
  r.education[0].gpa = 4.2;
  r.education[0].gpa_scale = 4.0;
  expectInvalid('GPA exceeding scale is an error', r, 'gpa');
}

{
  const r = clone(minimal());
  r.education[0].gpa = 3.8;
  r.education[0].gpa_scale = 4.0;
  const res = expectValid('valid GPA is accepted', r);
  if (res.valid) {
    check('gpa stored', res.profile.education[0].gpa, 3.8);
    check('gpa_scale stored', res.profile.education[0].gpa_scale, 4.0);
  }
}

{
  const r = clone(minimal());
  r.education[0].gpa = null;
  const res = expectValid('null GPA is accepted (not required)', r);
  if (res.valid) check('gpa is null', res.profile.education[0].gpa, null);
}

{
  const r = clone(minimal());
  r.education[0].gpa = -0.5;
  expectInvalid('negative GPA is an error', r, 'gpa');
}

{
  const r = clone(minimal());
  r.education[0].year = 3;
  r.education[0].semester = 'Fall 2026';
  r.education[0].coursework = ['Machine Learning', 'Algorithms'];
  const res = expectValid('optional education fields accepted', r);
  if (res.valid) {
    check('year stored', res.profile.education[0].year, 3);
    check('coursework length', res.profile.education[0].coursework.length, 2);
  }
}

// ── Skills ───────────────────────────────────────────────────────────────────

console.log('\n  skills');

{
  const r = clone(minimal());
  delete r.skills;
  const res = validateStudentProfile(r);
  // Missing skills is a WARNING not an error
  if (res.valid) {
    const hasWarn = res.warnings.some((w) => w.toLowerCase().includes('skill'));
    if (hasWarn) pass('missing skills section produces warning, not error');
    else fail('expected warning for missing skills section');
  } else {
    fail('missing skills should be a warning, not an error');
  }
}

{
  const r = clone(minimal());
  r.skills = {
    programming_languages: ['Python', 'JavaScript'],
    frameworks: ['React'],
    ai_ml: [],
    databases: null,
    cloud: undefined,
    tools: ['Git'],
    soft_skills: ['Communication'],
  };
  const res = expectValid('skills with mixed nulls/arrays accepted', r);
  if (res.valid) {
    check('python in langs', res.profile.skills.programming_languages.includes('Python'), true);
    check('null databases → empty array', Array.isArray(res.profile.skills.databases), true);
    check('null databases → length 0', res.profile.skills.databases.length, 0);
  }
}

// ── Experience ───────────────────────────────────────────────────────────────

console.log('\n  experience');

{
  const r = clone(minimal());
  r.experience = {
    internships: [
      { company: 'Acme', role: 'Intern', start_date: '2025-06', end_date: '2025-08' },
    ],
  };
  expectValid('valid internship experience accepted', r);
}

{
  const r = clone(minimal());
  r.experience = {
    internships: [
      { company: 'Acme', role: 'Intern', start_date: '2025-06', end_date: '2025-05' },
    ],
  };
  expectInvalid('end_date before start_date is an error', r, 'end_date');
}

{
  const r = clone(minimal());
  r.experience = {
    internships: [
      { company: 'Acme', role: 'Intern', start_date: '2025-06', end_date: 'Present' },
    ],
  };
  expectValid('"Present" end_date is valid', r);
}

{
  const r = clone(minimal());
  r.experience = {
    internships: [
      { role: 'Intern', start_date: '2025-06', end_date: '2025-08' },
    ],
  };
  expectInvalid('missing company in experience is an error', r, 'company');
}

{
  const r = clone(minimal());
  r.experience = {
    internships: [
      { company: 'Acme', role: 'Intern', start_date: '06-2025', end_date: '2025-08' },
    ],
  };
  expectInvalid('bad start_date format in experience is an error', r, 'start_date');
}

// ── Projects ─────────────────────────────────────────────────────────────────

console.log('\n  projects');

{
  const r = clone(minimal());
  r.projects = [
    {
      name: 'MyApp',
      description: 'A cool app.',
      technologies: ['Python', 'React'],
      url: 'https://myapp.dev',
      repo: 'https://github.com/user/myapp',
      achievements: ['10K users'],
    },
  ];
  const res = expectValid('valid project accepted', r);
  if (res.valid) {
    check('project name', res.profile.projects[0].name, 'MyApp');
    check('technologies length', res.profile.projects[0].technologies.length, 2);
  }
}

{
  const r = clone(minimal());
  r.projects = [{ description: 'No name here' }];
  expectInvalid('project missing name is an error', r, 'name');
}

{
  const r = clone(minimal());
  r.projects = [];
  const res = validateStudentProfile(r);
  if (res.valid) {
    const hasWarn = res.warnings.some((w) => w.toLowerCase().includes('project'));
    if (hasWarn) pass('empty projects produces warning not error');
    else fail('expected projects warning');
  } else {
    fail('empty projects should warn, not error');
  }
}

{
  const r = clone(minimal());
  r.projects = [{ name: 'MinimalProj' }];
  const res = expectValid('project with only name passes (all other fields optional)', r);
  if (res.valid) {
    check('url is null', res.profile.projects[0].url, null);
    check('repo is null', res.profile.projects[0].repo, null);
  }
}

// ── Preferences ──────────────────────────────────────────────────────────────

console.log('\n  preferences');

{
  const r = clone(minimal());
  r.preferences.search_mode = 'jobs';
  expectValid('"jobs" search_mode is valid', r);
}

{
  const r = clone(minimal());
  r.preferences.search_mode = 'both';
  expectValid('"both" search_mode is valid', r);
}

{
  const r = clone(minimal());
  r.preferences.search_mode = 'INTERNSHIPS';
  const res = expectValid('uppercase search_mode is normalised (case-insensitive)', r);
  if (res.valid) check('normalised to lowercase', res.profile.preferences.search_mode, 'internships');
}

{
  const r = clone(minimal());
  r.preferences.search_mode = 'part-time';
  expectInvalid('unknown search_mode is an error', r, 'search_mode');
}

{
  const r = clone(minimal());
  r.preferences.target_roles = [];
  expectInvalid('empty target_roles is an error', r, 'target_roles');
}

{
  const r = clone(minimal());
  r.preferences.locations = { remote: false, hybrid: false, on_site: false };
  const res = validateStudentProfile(r);
  if (res.valid) {
    const hasWarn = res.warnings.some((w) => w.toLowerCase().includes('work mode'));
    if (hasWarn) pass('all work modes false produces a warning');
    else fail('expected work modes warning');
  }
}

// Automation
console.log('\n  preferences.automation');

{
  const r = clone(minimal());
  r.preferences.automation.min_match_score = 0.5;
  expectInvalid('min_match_score below 1.0 is an error', r, 'min_match_score');
}

{
  const r = clone(minimal());
  r.preferences.automation.min_match_score = 5.5;
  expectInvalid('min_match_score above 5.0 is an error', r, 'min_match_score');
}

{
  const r = clone(minimal());
  r.preferences.automation.min_match_score = 4.5;
  expectValid('min_match_score of 4.5 is valid', r);
}

{
  const r = clone(minimal());
  r.preferences.automation.max_applications_per_day = 0;
  expectInvalid('max_applications_per_day of 0 is an error', r, 'max_applications_per_day');
}

{
  const r = clone(minimal());
  r.preferences.automation.max_applications_per_day = 51;
  expectInvalid('max_applications_per_day > 50 is an error', r, 'max_applications_per_day');
}

{
  const r = clone(minimal());
  r.preferences.automation.max_applications_per_day = 3.5;
  expectInvalid('fractional max_applications_per_day is an error', r, 'max_applications_per_day');
}

{
  // auto_submit true WITHOUT auto_submit_confirm should be an error
  const r = clone(minimal());
  r.preferences.automation.auto_submit = true;
  expectInvalid('auto_submit=true without auto_submit_confirm is an error', r, 'auto_submit_confirm');
}

{
  // auto_submit true WITH auto_submit_confirm=true is valid
  const r = clone(minimal());
  r.preferences.automation.auto_submit = true;
  r.preferences.automation.auto_submit_confirm = true;
  const res = expectValid('auto_submit=true with confirmation is valid', r);
  if (res.valid) {
    check('auto_submit stored', res.profile.preferences.automation.auto_submit, true);
    check('auto_submit_confirm stored', res.profile.preferences.automation.auto_submit_confirm, true);
  }
}

{
  const r = clone(minimal());
  r.preferences.automation.blackout_days = ['2026-12-25', '2027-01-01'];
  expectValid('valid blackout_days accepted', r);
}

{
  const r = clone(minimal());
  r.preferences.automation.blackout_days = ['25-12-2026'];
  expectInvalid('bad blackout_days format is an error', r, 'blackout_days');
}

// Compensation
console.log('\n  preferences.compensation');

{
  const r = clone(minimal());
  r.preferences.compensation = { internship_stipend_min: 20, stipend_unit: 'hourly' };
  expectValid('valid compensation accepted', r);
}

{
  const r = clone(minimal());
  r.preferences.compensation = { internship_stipend_min: -5 };
  expectInvalid('negative stipend_min is an error', r, 'stipend_min');
}

{
  const r = clone(minimal());
  r.preferences.compensation = { stipend_unit: 'weekly' };
  expectInvalid('invalid stipend_unit is an error', r, 'stipend_unit');
}

{
  const r = clone(minimal());
  r.preferences.compensation = { internship_stipend_min: null };
  const res = expectValid('null stipend_min is accepted (no floor)', r);
  if (res.valid) check('stipend_min null', res.profile.preferences.compensation.internship_stipend_min, null);
}

// Timing
console.log('\n  preferences.timing');

{
  const r = clone(minimal());
  r.preferences.timing = { duration_months_min: 6, duration_months_max: 3 };
  expectInvalid('duration_min > duration_max is an error', r, 'duration_months_min');
}

{
  const r = clone(minimal());
  r.preferences.timing = { duration_months_min: 3, duration_months_max: 6 };
  expectValid('valid duration range accepted', r);
}

// ── Error accumulation ────────────────────────────────────────────────────────

console.log('\n  error accumulation');

{
  // Multiple required fields missing should ALL appear in errors
  const r = {
    identity: { email: 'bad-email', city: 'X' },
    education: [],
    preferences: {},
  };
  const res = validateStudentProfile(r);
  if (!res.valid && res.errors.length >= 4) {
    pass(`collects all errors before returning (${res.errors.length} errors found)`);
  } else if (!res.valid) {
    fail(`expected ≥4 errors for severely invalid profile, got ${res.errors.length}: ${res.errors.join('; ')}`);
  } else {
    fail('severely invalid profile should not pass');
  }
}

// ── profileSummary ────────────────────────────────────────────────────────────

console.log('\n  profileSummary');

{
  const res = validateStudentProfile(minimal());
  if (res.valid) {
    try {
      const s = profileSummary(res.profile);
      if (typeof s === 'string' && s.includes('Test User')) pass('profileSummary returns name');
      else fail('profileSummary output missing name');
    } catch (e) {
      fail(`profileSummary threw: ${e.message}`);
    }
  }
}

{
  const r = clone(minimal());
  r.identity.name = 'Jane Doe';
  r.preferences.automation.min_match_score = 4.0;
  const res = validateStudentProfile(r);
  if (res.valid) {
    const s = profileSummary(res.profile);
    if (s.includes('4')) pass('profileSummary includes min_match_score');
    else fail('profileSummary missing min_match_score');
    if (s.includes('internships')) pass('profileSummary includes search_mode');
    else fail('profileSummary missing search_mode');
  }
}

// ── loadStudentProfile — file not found ───────────────────────────────────────

console.log('\n  loadStudentProfile — file handling');

{
  try {
    loadStudentProfile('/nonexistent/path/student-profile.yml');
    fail('should throw when file not found');
  } catch (e) {
    if (e.message.includes('not found')) pass('throws with "not found" when file missing');
    else fail(`threw unexpected message: ${e.message}`);
  }
}

// ── ValidationError class ────────────────────────────────────────────────────

console.log('\n  ValidationError');

{
  const r = clone(minimal());
  delete r.identity.name;
  const res = validateStudentProfile(r);
  if (!res.valid) {
    const err = new ValidationError(res.errors, res.warnings);
    check('ValidationError.name', err.name, 'ValidationError');
    if (Array.isArray(err.errors) && err.errors.length > 0) pass('ValidationError.errors is populated');
    else fail('ValidationError.errors should be non-empty');
    if (err.message.includes('✖')) pass('ValidationError message contains error symbols');
    else fail('ValidationError message format unexpected');
  }
}

// ── No fabrication ───────────────────────────────────────────────────────────

console.log('\n  no fabrication (optional fields → null)');

{
  const r = clone(minimal());
  // Deliberately omit all optional fields
  const res = expectValid('profile with only required fields is valid', r);
  if (res.valid) {
    const id = res.profile.identity;
    check('phone is null (not invented)', id.phone, null);
    check('linkedin is null (not invented)', id.linkedin, null);
    check('github is null (not invented)', id.github, null);
    check('portfolio is null (not invented)', id.portfolio, null);

    const edu = res.profile.education[0];
    check('gpa is null (not invented)', edu.gpa, null);
    check('minor is null (not invented)', edu.minor, null);
    check('year is null (not invented)', edu.year, null);

    check('internships empty (not invented)', res.profile.experience.internships.length, 0);
    check('jobs empty (not invented)', res.profile.experience.jobs.length, 0);
    check('projects empty (not invented)', res.profile.projects.length, 0);

    const comp = res.profile.preferences.compensation;
    check('stipend_min null (not invented)', comp.internship_stipend_min, null);
    check('salary_min null (not invented)', comp.salary_min, null);
  }
}

// ── Done ──────────────────────────────────────────────────────────────────────
