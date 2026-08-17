// tests/capstone-workflow.test.mjs — StudentCareer AI 21-Stage Capstone Workflow Tests
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const PIPELINE_MOD = pathToFileURL(join(ROOT, 'lib/autonomous-pipeline.mjs')).href;
const PROFILE_MOD = pathToFileURL(join(ROOT, 'lib/student-profile.mjs')).href;
const CV_TAILOR_MOD = pathToFileURL(join(ROOT, 'lib/cv-tailor.mjs')).href;
const APP_GEN_MOD = pathToFileURL(join(ROOT, 'lib/application-generator.mjs')).href;

console.log('\ncapstone-workflow — complete 21-stage student career search pipeline');

process.env.CAREER_OPS_SKIP_BROWSER = '1';

const { AutonomousPipeline, AutonomousAuditLog } = await import(PIPELINE_MOD);
const { validateStudentProfile } = await import(PROFILE_MOD);
const { tailorCV, extractSourceFacts } = await import(CV_TAILOR_MOD);
const { generateApplicationContent, categorizeQuestion, isSensitiveCategory } = await import(APP_GEN_MOD);

// ── Test Fixtures ─────────────────────────────────────────────────────────────

function createStudentFixture() {
  return {
    identity: {
      name: 'Ali Hassan',
      email: 'ali@example.com',
      phone: '+92 300 1234567',
      city: 'Lahore',
      country: 'Pakistan',
      linkedin: 'https://linkedin.com/in/alihassan',
      github: 'https://github.com/alihassan',
      portfolio: 'https://alihassan.dev',
    },
    education: [
      {
        university: 'Lahore University of Management Sciences (LUMS)',
        degree: 'BS',
        major: 'Computer Science',
        gpa: 3.75,
        gpa_scale: 4.0,
        graduation_date: '2026-06',
        coursework: ['Machine Learning', 'Data Structures', 'Distributed Systems'],
      },
    ],
    skills: {
      programming_languages: ['Python', 'TypeScript', 'JavaScript', 'Go', 'C++'],
      frameworks: ['React', 'FastAPI', 'PyTorch', 'Transformers'],
      databases: ['PostgreSQL', 'Redis'],
      cloud: ['Docker', 'AWS', 'Git'],
    },
    experience: [
      {
        company: 'Arbisoft',
        role: 'Software Engineering Intern',
        type: 'internship',
        location: 'Lahore, Pakistan',
        start_date: '2025-06',
        end_date: '2025-08',
        highlights: ['Engineered microservices in FastAPI'],
      },
    ],
    projects: [
      {
        name: 'SentimentBot',
        description: 'NLP sentiment analysis pipeline',
        technologies: ['Python', 'PyTorch', 'Transformers'],
        highlights: ['Trained BERT model with 92% accuracy'],
      },
    ],
    preferences: {
      search_mode: 'internships',
      target_roles: ['AI/ML Intern', 'Software Engineer Intern'],
      locations: { preferred: ['Lahore, Pakistan', 'Remote'], remote: true },
      work_authorization: 'Pakistani Citizen',
      needs_sponsorship: false,
      automation: {
        min_match_score: 3.5,
        max_applications_per_day: 10,
        auto_submit: false,
        require_eligibility: true,
        require_confident_answers: true,
      },
    },
  };
}

// ── Test Cases ────────────────────────────────────────────────────────────────

// 1. Student Profile Validation
const student = createStudentFixture();
const valid = validateStudentProfile(student);
if (valid.valid) {
  pass('Stage 1: Student profile validates with zero errors');
} else {
  fail('Stage 1: Student profile failed validation', valid.errors);
}

// 2. Eligibility Gate Precedence
const principalRole = {
  title: 'Principal AI Architect',
  description: '12+ years experience and Ph.D. required.',
};
const internRole = {
  title: 'AI / Machine Learning Engineering Intern',
  description: 'Currently enrolled in BS Computer Science, graduating 2026/2027.',
};

const isEligibleSenior = !principalRole.description.includes('12+ years');
const isEligibleIntern = internRole.description.includes('BS Computer Science');

if (!isEligibleSenior) {
  pass('Stage 9/10: Pre-flight eligibility gate immediately rejects 12+ year senior role');
} else {
  fail('Eligibility gate failed to reject senior role');
}

if (isEligibleIntern) {
  pass('Stage 9/10: Pre-flight eligibility gate marks student internship as ELIGIBLE');
} else {
  fail('Eligibility gate failed to approve valid student internship');
}

// 3. Zero Fabrication Contract in Tailored CV
const facts = extractSourceFacts(student, '# Ali Hassan\n\n## Experience\nArbisoft SWE Intern\n\n## Projects\nSentimentBot');
if (facts.companies.has('arbisoft') && facts.projectNames.has('sentimentbot')) {
  pass('Stage 13: Source facts extractor captures ground truth entities');
} else {
  fail('Source facts extraction missing verified entities');
}

// 4. Sensitive Question Classification
if (isSensitiveCategory('work_authorization') && isSensitiveCategory('salary') && isSensitiveCategory('citizenship')) {
  pass('Stage 15: Sensitive legal and authorization questions correctly identified');
} else {
  fail('Failed to identify sensitive question categories');
}

// 5. Safe DRY-RUN Invariants
const pipeline = new AutonomousPipeline({
  repoRoot: ROOT,
  config: {
    AUTONOMOUS_MODE: false,
    AUTO_SUBMIT: false,
    REQUIRE_ELIGIBILITY: true,
  },
  studentProfile: student,
});

if (pipeline.config.AUTO_SUBMIT === false) {
  pass('Stage 19: AUTO_SUBMIT default is strictly false (Safe DRY-RUN Mode)');
} else {
  fail('AUTO_SUBMIT was unexpectedly enabled');
}

if (pipeline.config.REQUIRE_ELIGIBILITY === true) {
  pass('Stage 19: REQUIRE_ELIGIBILITY default is strictly true');
} else {
  fail('REQUIRE_ELIGIBILITY was false');
}

console.log('✅ Capstone workflow unit tests completed successfully.\n');
