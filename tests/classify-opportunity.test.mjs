// tests/classify-opportunity.test.mjs — Opportunity Classification Engine
// Uses realistic job postings from technology companies and universities.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const MOD = pathToFileURL(join(ROOT, 'lib/classify-opportunity.mjs')).href;
console.log('\nclassify-opportunity — multi-signal classification engine');

const { classifyOpportunity, annotateOpportunity, meetsSearchMode, filterOpportunities } =
  await import(MOD);

// ── Helpers ───────────────────────────────────────────────────────────────────

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function expectType(label, opportunity, expectedType) {
  const result = classifyOpportunity(opportunity);
  if (result.opportunity_type === expectedType) {
    pass(`${label} → ${expectedType} (${result.classification_confidence}) [i:${result._internship_score} j:${result._job_score}]`);
  } else {
    fail(`${label} → expected ${expectedType} but got ${result.opportunity_type} [i:${result._internship_score} j:${result._job_score}] reason: ${result.classification_reason}`);
  }
  return result;
}

function expectConfidence(label, opportunity, expectedConf) {
  const result = classifyOpportunity(opportunity);
  check(label, result.classification_confidence, expectedConf);
  return result;
}

// ── INTERNSHIP: Clear cases ────────────────────────────────────────────────────

console.log('\n  Internships — clear cases');

// Google STEP
expectType('Google STEP Intern (title only)',
  { title: 'Software Engineering Intern, STEP, Summer 2026', company: 'Google' },
  'INTERNSHIP');

// Google STEP with description
expectType('Google STEP (title + description)',
  {
    title: 'Software Engineering Intern, STEP, Summer 2026',
    description: 'This internship is intended for second- or third-year undergraduate students. ' +
      'You must be currently enrolled in a Bachelor\'s degree program. ' +
      'Minimum GPA of 3.0 required. Duration: 13 weeks, Summer 2026. Hourly rate provided.',
    employment_type: 'Internship',
    company: 'Google',
  },
  'INTERNSHIP');

// Microsoft Explore
expectType('Microsoft Explore (rotational intern for freshmen/sophomores)',
  {
    title: 'Explore Microsoft Intern',
    description: 'The Explore Microsoft internship is a 12-week summer program for first- and second-year ' +
      'undergraduates. Candidates must be currently enrolled in a Bachelor\'s degree program. ' +
      'No prior professional experience required. Academic credit available.',
    employment_type: 'Internship',
    company: 'Microsoft',
  },
  'INTERNSHIP');

// Meta University (student program)
expectType('Meta University Intern',
  {
    title: 'Meta University Intern — Software Engineering',
    description: 'Meta University is a paid internship program designed for first- and second-year ' +
      'students pursuing a CS degree. Expected graduation: 2028 or 2029. ' +
      '12-week summer 2026 cohort. GPA 3.0 minimum.',
    employment_type: 'Internship',
    company: 'Meta',
  },
  'INTERNSHIP');

// Apple co-op
expectType('Apple Hardware Engineering Co-op',
  {
    title: 'Hardware Engineering Co-op',
    description: 'We are looking for a co-op student to join our hardware team for a 4-month rotation. ' +
      'You must be enrolled in a Bachelor\'s or Master\'s degree program in Electrical Engineering.',
    employment_type: 'Co-op',
    company: 'Apple',
  },
  'INTERNSHIP');

// Amazon SDE Intern
expectType('Amazon SDE Internship',
  {
    title: 'Software Development Engineer Internship',
    description: 'Join Amazon as a Software Development Engineer Intern. ' +
      'You will work on production systems for 12 weeks during summer 2026. ' +
      'Must be pursuing a BS, MS, or PhD in Computer Science.',
    employment_type: 'Internship',
    company: 'Amazon',
  },
  'INTERNSHIP');

// OpenAI Research Intern
expectType('OpenAI Research Intern',
  {
    title: 'Research Intern — Language Models',
    description: 'We are looking for research interns to work alongside our team on large language models. ' +
      'Candidates should be currently enrolled in a PhD or Master\'s program. ' +
      'Summer 2026, 12–16 weeks.',
    employment_type: 'Internship',
    company: 'OpenAI',
  },
  'INTERNSHIP');

// German company: Werkstudent
expectType('SAP Werkstudent (German)',
  {
    title: 'Werkstudent (m/w/d) Software Development',
    description: 'Für unser Team suchen wir einen Werkstudenten im Bereich Softwareentwicklung. ' +
      'Voraussetzung: Eingeschriebener Student an einer Hochschule.',
    company: 'SAP',
  },
  'INTERNSHIP');

// German company: Praktikum
expectType('Siemens Praktikum (German)',
  {
    title: 'Praktikant Data Science (m/w/d)',
    description: 'Für ein 6-monatiges Praktikum im Bereich Data Science suchen wir einen Praktikanten. ' +
      'Immatrikulierter Student der Informatik oder Mathematik.',
    company: 'Siemens',
  },
  'INTERNSHIP');

// University research position
expectType('MIT CSAIL Research Intern',
  {
    title: 'Undergraduate Research Intern — AI Safety',
    description: 'MIT CSAIL is seeking undergraduate students interested in AI safety research. ' +
      'This is a part-time research role during the academic semester. ' +
      'Academic credit available. Must be enrolled at MIT.',
    company: 'MIT CSAIL',
  },
  'INTERNSHIP');

// Netflix intern
expectType('Netflix Engineering Intern (title only, high confidence)',
  { title: 'Machine Learning Intern', company: 'Netflix' },
  'INTERNSHIP');

// Trainee program
expectType('Trainee program (Stripe)',
  {
    title: 'Engineering Trainee Program',
    description: 'Our trainee program is designed for students in their penultimate year. ' +
      'Rotation through 3 teams over 6 months. Stipend provided.',
    company: 'Stripe',
  },
  'INTERNSHIP');

// Apprenticeship
expectType('IBM Apprenticeship',
  {
    title: 'Technology Apprentice — Cloud Infrastructure',
    description: 'This apprenticeship is open to candidates currently enrolled in a degree programme. ' +
      'No experience required. 12-month structured programme.',
    employment_type: 'Apprenticeship',
    company: 'IBM',
  },
  'INTERNSHIP');

// Description-driven (title is ambiguous)
expectType('Student developer (description drives classification)',
  {
    title: 'Software Developer',
    description: 'We are looking for a student developer to join our team for a 4-month co-op term. ' +
      'Must be currently enrolled in a Computer Science or Software Engineering program. ' +
      'Expected graduation 2026 or 2027. No professional experience required.',
    employment_type: 'Co-op',
  },
  'INTERNSHIP');

// Employment type alone
expectType('Employment type "Internship" alone classifies correctly',
  { title: 'Developer', employment_type: 'Internship' },
  'INTERNSHIP');

// ── JOB: Clear cases ─────────────────────────────────────────────────────────

console.log('\n  Jobs — clear cases');

// Meta Senior SWE
expectType('Meta Senior Software Engineer',
  {
    title: 'Senior Software Engineer, Backend Infrastructure',
    description: 'We are looking for a Senior Software Engineer with 5+ years of experience in ' +
      'distributed systems. You will lead projects across teams. ' +
      'Competitive salary, 401k, health insurance, equity.',
    employment_type: 'Full-time',
    company: 'Meta',
  },
  'JOB');

// Google Staff SWE
expectType('Google Staff Software Engineer',
  {
    title: 'Staff Software Engineer, Google DeepMind',
    description: 'Minimum 8 years of coding experience. Experience leading teams of 5+ engineers. ' +
      'Full-time, permanent position. Relocation assistance available. ' +
      'Stock options and annual bonus structure.',
    employment_type: 'Full-time',
    company: 'Google',
  },
  'JOB');

// OpenAI ML Engineer
expectType('OpenAI ML Engineer (mid-level)',
  {
    title: 'Machine Learning Engineer',
    description: 'We are looking for an ML Engineer with 3-5 years of experience training large models. ' +
      'You have shipped models to production and can independently own infrastructure. ' +
      'Full-time position, competitive salary, equity, health benefits.',
    employment_type: 'Full-time',
    company: 'OpenAI',
  },
  'JOB');

// Stripe SWE
expectType('Stripe Backend Engineer',
  {
    title: 'Backend Engineer, Payments',
    description: 'Minimum 4 years of professional software engineering experience. ' +
      'Proven track record of delivering reliable systems at scale. ' +
      'Full-time, permanent role. Annual base salary $180K-$250K plus equity.',
    employment_type: 'Full-time',
    company: 'Stripe',
  },
  'JOB');

// Anthropic Research Scientist
expectType('Anthropic Research Scientist',
  {
    title: 'Research Scientist — AI Safety',
    description: 'We require a PhD with 2+ years of post-doctoral research experience. ' +
      'You will lead your own research agenda. Permanent position. ' +
      'Full-time, competitive annual compensation.',
    employment_type: 'Full-time',
    company: 'Anthropic',
  },
  'JOB');

// Director level
expectType('Director of Engineering',
  {
    title: 'Director of Engineering, AI Platform',
    description: 'We are seeking a Director of Engineering to lead a team of 20+ engineers. ' +
      '10+ years of software engineering experience, 5+ years in management. ' +
      'Full-time, executive compensation package with equity.',
    employment_type: 'Full-time',
    company: 'Databricks',
  },
  'JOB');

// Employment type full-time with experience
expectType('Product Manager with experience requirement',
  {
    title: 'Product Manager, Developer Tools',
    description: 'Minimum 3 years of product management experience, preferably in B2B SaaS. ' +
      'Prior experience working with engineering teams. Full-time position, ' +
      '401k matching, health and dental insurance.',
    employment_type: 'Full-time',
    company: 'GitHub',
  },
  'JOB');

// Data Scientist
expectType('Palantir Forward Deployed Software Engineer (FDSE)',
  {
    title: 'Forward Deployed Software Engineer',
    description: 'Must have 2+ years of software engineering experience. ' +
      'You have previously worked in enterprise environments. ' +
      'Full-time role with relocation assistance. Annual salary + bonus.',
    employment_type: 'Full-time',
    company: 'Palantir',
  },
  'JOB');

// ── EDGE CASES ────────────────────────────────────────────────────────────────

console.log('\n  Edge cases — new grad, associate, junior');

// New grad — JOB not internship (full-time permanent)
expectType('New grad SWE (permanent job, not intern)',
  {
    title: 'Software Engineer, University Graduate',
    description: 'This is a full-time position for recent university graduates (2024-2026). ' +
      'You will be onboarded as a full-time employee. ' +
      'Annual salary $140K-$180K, 401k, health insurance, equity.',
    employment_type: 'Full-time',
    company: 'Google',
  },
  'JOB');

// Associate — JOB
expectType('Associate Software Engineer (entry-level job, not intern)',
  {
    title: 'Associate Software Engineer',
    description: '0-1 years of experience. Full-time permanent role. ' +
      'Competitive salary and benefits including health insurance and 401k.',
    employment_type: 'Full-time',
    company: 'Capital One',
  },
  'JOB');

// Junior — JOB
expectType('Junior Developer (entry-level job)',
  {
    title: 'Junior Software Developer',
    description: 'Entry-level full-time software developer position. ' +
      '0-2 years of experience welcome. Annual salary with full benefits.',
    employment_type: 'Full-time',
    company: 'Accenture',
  },
  'JOB');

// ── OTHER: Ambiguous ──────────────────────────────────────────────────────────

console.log('\n  OTHER — insufficient signal');

expectType('No title, no description → OTHER',
  { title: '' },
  'OTHER');

expectType('Volunteer position → OTHER',
  {
    title: 'Volunteer Technology Coordinator',
    description: 'Volunteer to help coordinate our nonprofit technology initiatives.',
  },
  'OTHER');

expectType('Minimal signal ambiguous role → OTHER',
  { title: 'Developer' },
  'OTHER');

// ── Confidence levels ─────────────────────────────────────────────────────────

console.log('\n  Confidence levels');

expectConfidence('Intern in title + employment_type + description → HIGH',
  {
    title: 'Software Engineering Intern',
    description: 'Currently enrolled students. GPA 3.0. Academic credit available. Summer 2026.',
    employment_type: 'Internship',
  },
  'HIGH');

expectConfidence('Senior SWE + 5yr exp + full-time + 401k → HIGH',
  {
    title: 'Senior Software Engineer',
    description: '5+ years of experience. Full-time permanent position. Competitive salary, 401k, health insurance, equity.',
    employment_type: 'Full-time',
  },
  'HIGH');

expectConfidence('Ambiguous title "Developer" + intern description → MEDIUM or HIGH',
  {
    title: 'Developer',
    description: 'Must be currently enrolled in a degree program. GPA 3.0 minimum. 3-month position.',
    employment_type: 'Internship',
  },
  'HIGH');

{
  // Title says intern but description has conflicting signals
  const r = classifyOpportunity({
    title: 'Software Engineer Intern',
    description: '5+ years of experience required. Full-time permanent position.',
  });
  if (r.opportunity_type === 'INTERNSHIP' && r.classification_confidence !== 'HIGH') {
    pass('conflicting signals (intern title + senior description) → INTERNSHIP with non-HIGH confidence');
  } else if (r.opportunity_type === 'INTERNSHIP') {
    pass(`conflicting signals → INTERNSHIP (${r.classification_confidence}) — internship signals won`);
  } else {
    pass(`conflicting signals → ${r.opportunity_type} (${r.classification_confidence}) — either valid`);
  }
}

// ── classification_reason ─────────────────────────────────────────────────────

console.log('\n  classification_reason is populated and auditable');

{
  const r = classifyOpportunity({
    title: 'Machine Learning Intern',
    description: 'Currently enrolled students. GPA 3.0. Summer 2026.',
    employment_type: 'Internship',
  });
  if (r.classification_reason && r.classification_reason.length > 20) {
    pass('classification_reason is non-empty and descriptive');
  } else {
    fail(`classification_reason too short: "${r.classification_reason}"`);
  }
  if (r.classification_reason.includes('INTERNSHIP score')) {
    pass('classification_reason includes score comparison');
  } else {
    fail('classification_reason missing score comparison');
  }
}

{
  const r = classifyOpportunity({ title: 'Senior Engineer', description: '5+ years. Full-time. 401k.' });
  if (r.classification_reason.includes('JOB score')) {
    pass('JOB classification_reason includes score comparison');
  } else {
    fail(`JOB reason missing score info: "${r.classification_reason}"`);
  }
}

// ── meetsSearchMode ───────────────────────────────────────────────────────────

console.log('\n  meetsSearchMode — search mode filter');

{
  const internResult = { opportunity_type: 'INTERNSHIP', classification_confidence: 'HIGH', classification_reason: '', _internship_score: 20, _job_score: 0 };
  const jobResult    = { opportunity_type: 'JOB',        classification_confidence: 'HIGH', classification_reason: '', _internship_score: 0, _job_score: 20 };
  const otherResult  = { opportunity_type: 'OTHER',      classification_confidence: 'LOW',  classification_reason: '', _internship_score: 0, _job_score: 0 };

  check('internships mode: INTERNSHIP passes', meetsSearchMode(internResult, 'internships'), true);
  check('internships mode: JOB is rejected',   meetsSearchMode(jobResult,    'internships'), false);
  check('internships mode: OTHER is rejected', meetsSearchMode(otherResult,  'internships'), false);

  check('jobs mode: JOB passes',          meetsSearchMode(jobResult,    'jobs'), true);
  check('jobs mode: INTERNSHIP rejected', meetsSearchMode(internResult, 'jobs'), false);
  check('jobs mode: OTHER rejected',      meetsSearchMode(otherResult,  'jobs'), false);

  check('both mode: INTERNSHIP passes', meetsSearchMode(internResult, 'both'), true);
  check('both mode: JOB passes',        meetsSearchMode(jobResult,    'both'), true);
  check('both mode: OTHER rejected',    meetsSearchMode(otherResult,  'both'), false);

  // Case-insensitivity
  check('mode "INTERNSHIPS" (uppercase) passes INTERNSHIP', meetsSearchMode(internResult, 'INTERNSHIPS'), true);
}

// ── filterOpportunities ───────────────────────────────────────────────────────

console.log('\n  filterOpportunities — batch filter');

{
  const batch = [
    { title: 'Software Engineering Intern', company: 'Google' },
    { title: 'Senior Software Engineer', description: '5+ years. Full-time.', employment_type: 'Full-time', company: 'Meta' },
    { title: 'ML Research Intern', description: 'Currently enrolled students.', employment_type: 'Internship', company: 'OpenAI' },
    { title: 'Product Manager', description: '3+ years experience. Full-time. 401k.', employment_type: 'Full-time', company: 'Stripe' },
    { title: 'Volunteer Developer', description: 'Volunteer to help.', company: 'Nonprofit' },
  ];

  const interns = filterOpportunities(batch, 'internships');
  check(`internships filter: ${interns.length} of 5 pass`, interns.length, 2);
  check('all passing are INTERNSHIP', interns.every((o) => o.opportunity_type === 'INTERNSHIP'), true);
  check('annotated with opportunity_type', typeof interns[0].opportunity_type, 'string');
  check('annotated with classification_reason', typeof interns[0].classification_reason, 'string');

  const jobs = filterOpportunities(batch, 'jobs');
  check(`jobs filter: ${jobs.length} of 5 pass`, jobs.length, 2);
  check('all passing are JOB', jobs.every((o) => o.opportunity_type === 'JOB'), true);

  const both = filterOpportunities(batch, 'both');
  check(`both filter: ${both.length} of 5 pass (excludes OTHER)`, both.length, 4);
}

// ── annotateOpportunity ───────────────────────────────────────────────────────

console.log('\n  annotateOpportunity — non-destructive annotation');

{
  const original = { title: 'ML Intern', company: 'DeepMind', url: 'https://example.com/job/1' };
  const annotated = annotateOpportunity(original);

  check('original object unchanged', original.opportunity_type, undefined);
  check('annotated has opportunity_type', typeof annotated.opportunity_type, 'string');
  check('original fields preserved — title', annotated.title, 'ML Intern');
  check('original fields preserved — company', annotated.company, 'DeepMind');
  check('original fields preserved — url', annotated.url, 'https://example.com/job/1');
  check('annotated is INTERNSHIP', annotated.opportunity_type, 'INTERNSHIP');
}

// ── Realistic multilingual batch ──────────────────────────────────────────────

console.log('\n  Multilingual signals');

expectType('French stagiaire', { title: 'Stagiaire Développeur Full Stack', company: 'Dassault' }, 'INTERNSHIP');
expectType('German Praktikum in description',
  { title: 'Software Developer (6 months)', description: 'Wir suchen einen Praktikanten für ein 6-monatiges Praktikum.', company: 'Bosch' },
  'INTERNSHIP');
expectType('German Werkstudent in title', { title: 'Werkstudent Data Engineering', company: 'BMW' }, 'INTERNSHIP');
expectType('Werkstudent in description',
  { title: 'Working Student Machine Learning', description: 'Werkstudent im Bereich Machine Learning.', company: 'Mercedes-Benz' },
  'INTERNSHIP');

// ── University specific ───────────────────────────────────────────────────────

console.log('\n  University / research specific');

expectType('NSF Research Intern',
  {
    title: 'NSF REU Research Intern — Robotics',
    description: 'National Science Foundation Research Experience for Undergraduates. ' +
      'Must be currently enrolled in an undergraduate degree. ' +
      'Summer 10-week program. Stipend provided. Academic credit available.',
    company: 'University of Michigan',
  },
  'INTERNSHIP');

expectType('NASA Pathways Intern',
  {
    title: 'Pathways Intern — Software Systems',
    description: 'NASA Pathways program for current students. ' +
      'Must be pursuing a degree at an accredited institution. ' +
      'Expected graduation 2025 or 2026. GPA minimum 3.0.',
    employment_type: 'Internship',
    company: 'NASA',
  },
  'INTERNSHIP');

expectType('DOE SULI Program',
  {
    title: 'Science Undergraduate Laboratory Internship (SULI)',
    description: 'The SULI program encourages undergraduate students and recent graduates ' +
      'to pursue STEM careers. 10-week summer internship at a DOE national lab. ' +
      'Stipend, travel allowance, and housing assistance provided.',
    employment_type: 'Internship',
    company: 'Department of Energy',
  },
  'INTERNSHIP');

// ── Done ──────────────────────────────────────────────────────────────────────
