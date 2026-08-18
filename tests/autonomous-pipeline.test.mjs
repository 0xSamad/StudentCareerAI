// tests/autonomous-pipeline.test.mjs — Autonomous Pipeline Safety & Execution Test Suite
import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

const MOD = pathToFileURL(join(ROOT, 'lib/autonomous-pipeline.mjs')).href;
console.log('\nautonomous-pipeline — background autonomous engine & safety rules');

process.env.GEMINI_API_KEY = 'mock_key_for_tests';
process.env.STUDENT_CAREER_AI_SKIP_BROWSER = '1';

const {
  AutonomousPipeline,
  AGENT_STATES,
  DEFAULT_CONFIG,
  AutonomousPipelineError,
} = await import(MOD);

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'auto-pipe-test-'));
}

function makeProfile() {
  return {
    identity: {
      name: 'Ali Hassan',
      email: 'ali@example.com',
      city: 'Lahore',
      country: 'Pakistan',
    },
    education: [{
      university: 'LUMS',
      degree: 'BS',
      major: 'Computer Science',
      graduation_date: '2026-06',
    }],
    skills: {
      languages: ['Python', 'JavaScript'],
    },
    experience: {
      internships: [{
        company: 'Arbisoft',
        role: 'Software Engineer Intern',
        start_date: '2025-06',
        end_date: '2025-08',
      }],
    },
    projects: [{
      name: 'SentimentBot',
      description: 'NLP Sentiment analysis bot',
      technologies: ['Python'],
    }],
  };
}

function makeMockAIFn(options = {}) {
  return async (resolvedProvider, systemPrompt, userPrompt) => {
    const sys = (systemPrompt || '').toLowerCase();
    const usr = (userPrompt || '').toLowerCase();

    if (options.throwError) {
      throw new Error('AI Provider failure');
    }

    if (options.fabricateCV && (sys.includes('cv') || usr.includes('cv'))) {
      return JSON.stringify({
        summary: 'Experienced developer at NASA and Google leading quantum AI.',
        competencies: ['Quantum Computing', 'Rocket Propulsion'],
        experience: [{
          company: 'NASA',
          role: 'Lead Rocket Scientist',
          start_date: '2020-01',
          end_date: '2024-01',
        }],
        projects: [{
          name: 'MarsRoverAI',
          description: 'Autonomous Mars Rover driving system generating $50M in value',
          technologies: ['QuantumJS'],
        }],
        tailoring_notes: 'Invented fake credentials.',
      });
    }

    if (sys.includes('cover letter') || usr.includes('cover letter')) {
      return JSON.stringify({
        subject_line: 'Application for Software Engineer Intern',
        body: 'Dear Hiring Manager,\n\nI am writing to apply for the Software Engineer Intern position...',
      });
    }

    if (sys.includes('question') || usr.includes('question') || usr.includes('why this company')) {
      return JSON.stringify({
        answer: 'I am passionate about building software applications.',
        confidence: options.unconfidentAnswers ? 0.3 : 0.95,
        category: 'why_company',
        rationale: 'Derived from student profile facts',
      });
    }

    return JSON.stringify({
      match_score: typeof options.matchScore === 'number' ? options.matchScore : 85,
      strengths: ['Python experience'],
      missing_skills: [],
      relevant_experience: ['Software Engineer Intern'],
      relevant_projects: ['SentimentBot'],
      concerns: [],
      recommendation: 'Strong candidate',
      dimension_scores: {
        skills_match: 90,
        education_fit: 90,
        project_relevance: 85,
        experience_relevance: 80,
        role_industry_fit: 80,
        location_logistics: 90,
      },
      summary: 'Computer Science student at LUMS with Python background.',
      competencies: ['Python', 'JavaScript'],
      experience: [{
        company: 'Arbisoft',
        role: 'Software Engineer Intern',
        start_date: '2025-06',
        end_date: '2025-08',
      }],
      projects: [{
        name: 'SentimentBot',
        description: 'NLP Sentiment analysis bot',
        technologies: ['Python'],
      }],
      tailoring_notes: 'Tailored for target role.',
    });
  };
}

// ═══════════════════════════════════════════════════════════════
// 1. Safe Defaults Verification
// ═══════════════════════════════════════════════════════════════
console.log('\n  1. Safe Defaults Verification');
{
  check('AUTONOMOUS_MODE is false by default', DEFAULT_CONFIG.AUTONOMOUS_MODE, false);
  check('AUTO_SUBMIT is false by default', DEFAULT_CONFIG.AUTO_SUBMIT, false);
  check('SKIP_BROWSER is false by default', DEFAULT_CONFIG.SKIP_BROWSER, false);
  check('MAX_APPLICATIONS_PER_DAY is 10 by default', DEFAULT_CONFIG.MAX_APPLICATIONS_PER_DAY, 10);
  check('MIN_MATCH_SCORE is 70 by default', DEFAULT_CONFIG.MIN_MATCH_SCORE, 70);
  check('REQUIRE_ELIGIBILITY is true by default', DEFAULT_CONFIG.REQUIRE_ELIGIBILITY, true);
  check('REQUIRE_CONFIDENT_ANSWERS is true by default', DEFAULT_CONFIG.REQUIRE_CONFIDENT_ANSWERS, true);
  check('PAUSE_ON_ERROR is true by default', DEFAULT_CONFIG.PAUSE_ON_ERROR, true);
  check('PAUSE_ON_CAPTCHA is true by default', DEFAULT_CONFIG.PAUSE_ON_CAPTCHA, true);
  check('PAUSE_ON_AUTH_FAILURE is true by default', DEFAULT_CONFIG.PAUSE_ON_AUTH_FAILURE, true);
  check('PAUSE_ON_UNEXPECTED_FORM is true by default', DEFAULT_CONFIG.PAUSE_ON_UNEXPECTED_FORM, true);
  check('PAUSE_ON_SENSITIVE_QUESTION is true by default', DEFAULT_CONFIG.PAUSE_ON_SENSITIVE_QUESTION, true);
}

// ═══════════════════════════════════════════════════════════════
// 2. Start Refusal when AUTONOMOUS_MODE is Disabled
// ═══════════════════════════════════════════════════════════════
console.log('\n  2. Start Refusal when AUTONOMOUS_MODE is Disabled');
{
  const tmp = makeTmpDir();
  try {
    const pipeline = new AutonomousPipeline({ dataDir: tmp });
    let threw = false;
    try {
      await pipeline.start();
    } catch (err) {
      threw = true;
      check('Error code is MODE_DISABLED', err.code, 'MODE_DISABLED');
    }
    check('Refused to start without AUTONOMOUS_MODE=true', threw, true);
    check('Pipeline state remains STOPPED', pipeline.state, AGENT_STATES.STOPPED);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════
// 3. State Machine & Controls (Start, Pause, Resume, Stop, Restart)
// ═══════════════════════════════════════════════════════════════
console.log('\n  3. State Machine & Controls');
{
  const tmp = makeTmpDir();
  try {
    const pipeline = new AutonomousPipeline({
      dataDir: tmp,
      config: { AUTONOMOUS_MODE: true },
    });

    const status1 = await pipeline.start();
    check('Start transitions to RUNNING', status1.state, AGENT_STATES.RUNNING);

    const status2 = await pipeline.pause('Testing manual pause');
    check('Pause transitions to PAUSED', status2.state, AGENT_STATES.PAUSED);
    check('Pause reason captured', status2.pauseReason, 'Testing manual pause');

    const status3 = await pipeline.resume();
    check('Resume transitions back to RUNNING', status3.state, AGENT_STATES.RUNNING);
    check('Pause reason cleared', status3.pauseReason, null);

    const status4 = await pipeline.stop();
    check('Stop transitions to STOPPED', status4.state, AGENT_STATES.STOPPED);

    const status5 = await pipeline.restart();
    check('Restart with AUTONOMOUS_MODE=true transitions to RUNNING', status5.state, AGENT_STATES.RUNNING);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════
// 4. Safety Rule: NEVER Apply to Ineligible Opportunities
// ═══════════════════════════════════════════════════════════════
console.log('\n  4. Safety Rule: NEVER Apply to Ineligible Opportunities');
{
  const tmp = makeTmpDir();
  try {
    const pipeline = new AutonomousPipeline({
      dataDir: tmp,
      config: { AUTONOMOUS_MODE: true, REQUIRE_ELIGIBILITY: true },
    });
    await pipeline.start();

    const ineligibleOpp = {
      title: 'Senior Manager',
      company: 'Careem',
      url: 'https://boards.greenhouse.io/careem/jobs/111',
      opportunity_type: 'FULL_TIME',
      eligibility_status: 'NOT_ELIGIBLE',
      description: 'Must be US Citizen only. No visa sponsorship.',
    };

    const profile = makeProfile();
    const res = await pipeline.processOpportunity({ rawOpportunity: ineligibleOpp, profile });

    check('Ineligible opportunity processing refused', res.processed, false);
    check('Reason is Ineligible opportunity', res.reason, 'Ineligible opportunity');

    const logs = await pipeline.auditLog.getLogs();
    check('Audit log recorded INELIGIBLE_SKIPPED', logs.some(l => l.type === 'INELIGIBLE_SKIPPED'), true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════
// 5. Safety Rule: NEVER Duplicate Applications
// ═══════════════════════════════════════════════════════════════
console.log('\n  5. Safety Rule: NEVER Duplicate Applications');
{
  const tmp = makeTmpDir();
  try {
    const pipeline = new AutonomousPipeline({
      dataDir: tmp,
      config: { AUTONOMOUS_MODE: true },
    });
    await pipeline.start();

    const opp = {
      title: 'Software Engineer Intern',
      company: 'Careem',
      url: 'https://boards.greenhouse.io/careem/jobs/222',
      opportunity_type: 'INTERNSHIP',
      eligibility_status: 'ELIGIBLE',
    };

    const profile = makeProfile();
    const addRes = await pipeline.manager.addToQueue(opp);
    await pipeline.manager.updateState(addRes.item.id, 'APPLIED');

    // Try processing duplicate
    const res = await pipeline.processOpportunity({ rawOpportunity: opp, profile });
    check('Duplicate opportunity processing refused', res.processed, false);
    check('Reason mentions duplicate', res.reason.includes('Duplicate'), true);

    const logs = await pipeline.auditLog.getLogs();
    check('Audit log recorded DUPLICATE_SKIPPED', logs.some(l => l.type === 'DUPLICATE_SKIPPED'), true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════
// 6. Safety Rule: NEVER Bypass CAPTCHA Challenges
// ═══════════════════════════════════════════════════════════════
console.log('\n  6. Safety Rule: NEVER Bypass CAPTCHA Challenges');
{
  const tmp = makeTmpDir();
  try {
    const pipeline = new AutonomousPipeline({
      dataDir: tmp,
      config: {
        AUTONOMOUS_MODE: true,
        PAUSE_ON_CAPTCHA: true,
        PAUSE_ON_UNEXPECTED_FORM: false,
        REQUIRE_CONFIDENT_ANSWERS: false,
        PAUSE_ON_SENSITIVE_QUESTION: false,
      },
    });
    await pipeline.start();

    const opp = {
      title: 'Software Engineer Intern',
      company: 'Careem',
      url: 'https://boards.greenhouse.io/careem/jobs/333',
      opportunity_type: 'INTERNSHIP',
      eligibility_status: 'ELIGIBLE',
    };

    const mockCaptchaPage = {
      content: async () => '<html><body><iframe src="https://recaptcha.net/check"></iframe>Please solve the recaptcha</body></html>',
      evaluate: async () => [],
    };

    const res = await pipeline.processOpportunity({
      rawOpportunity: opp,
      profile: makeProfile(),
      callAIFn: makeMockAIFn(),
      page: mockCaptchaPage,
    });

    check('Processing stopped on CAPTCHA', res.processed, false);
    check('Reason mentions CAPTCHA', res.reason.includes('CAPTCHA'), true);
    check('Pipeline transitioned to PAUSED', pipeline.state, AGENT_STATES.PAUSED);
    check('Pause reason includes CAPTCHA', pipeline.pauseReason.includes('CAPTCHA'), true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════
// 7. Safety Rule: NEVER Bypass Authentication Barriers
// ═══════════════════════════════════════════════════════════════
console.log('\n  7. Safety Rule: NEVER Bypass Authentication Barriers');
{
  const tmp = makeTmpDir();
  try {
    const pipeline = new AutonomousPipeline({
      dataDir: tmp,
      config: {
        AUTONOMOUS_MODE: true,
        PAUSE_ON_AUTH_FAILURE: true,
        PAUSE_ON_UNEXPECTED_FORM: false,
        REQUIRE_CONFIDENT_ANSWERS: false,
        PAUSE_ON_SENSITIVE_QUESTION: false,
      },
    });
    await pipeline.start();

    const opp = {
      title: 'Backend Intern',
      company: 'Careem',
      url: 'https://boards.greenhouse.io/careem/jobs/444',
      opportunity_type: 'INTERNSHIP',
      eligibility_status: 'ELIGIBLE',
    };

    const mockAuthPage = {
      content: async () => '<html><body><div>Please sign in to apply for this job. Authenticator app code required.</div></body></html>',
      evaluate: async () => [],
    };

    const res = await pipeline.processOpportunity({
      rawOpportunity: opp,
      profile: makeProfile(),
      callAIFn: makeMockAIFn(),
      page: mockAuthPage,
    });

    check('Processing stopped on Auth barrier', res.processed, false);
    check('Reason mentions Authentication', res.reason.includes('Authentication'), true);
    check('Pipeline transitioned to PAUSED', pipeline.state, AGENT_STATES.PAUSED);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════
// 8. Safety Rule: Pause on Sensitive Questions
// ═══════════════════════════════════════════════════════════════
console.log('\n  8. Safety Rule: Pause on Sensitive Questions');
{
  const tmp = makeTmpDir();
  try {
    const pipeline = new AutonomousPipeline({
      dataDir: tmp,
      config: { AUTONOMOUS_MODE: true, PAUSE_ON_SENSITIVE_QUESTION: true },
    });
    await pipeline.start();

    const opp = {
      title: 'Data Analyst Intern',
      company: 'Careem',
      url: 'https://boards.greenhouse.io/careem/jobs/555',
      opportunity_type: 'INTERNSHIP',
      eligibility_status: 'ELIGIBLE',
      questions: ['Will you require visa sponsorship in Pakistan?', 'What is your salary expectation?'],
    };

    const res = await pipeline.processOpportunity({
      rawOpportunity: opp,
      profile: makeProfile(),
      callAIFn: makeMockAIFn(),
    });

    check('Processing paused on sensitive question', res.processed, false);
    check('Reason mentions sensitive question', res.reason.includes('sensitive question'), true);
    check('Pipeline transitioned to PAUSED', pipeline.state, AGENT_STATES.PAUSED);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════
// 9. Safety Rule: NEVER Exceed Daily Application Limits
// ═══════════════════════════════════════════════════════════════
console.log('\n  9. Safety Rule: NEVER Exceed Daily Application Limits');
{
  const tmp = makeTmpDir();
  try {
    const pipeline = new AutonomousPipeline({
      dataDir: tmp,
      config: { AUTONOMOUS_MODE: true, MAX_APPLICATIONS_PER_DAY: 1 },
    });
    await pipeline.start();

    const opp1 = { title: 'Intern 1', company: 'Comp1', url: 'https://jobs.com/1', opportunity_type: 'INTERNSHIP', eligibility_status: 'ELIGIBLE' };
    const opp2 = { title: 'Intern 2', company: 'Comp2', url: 'https://jobs.com/2', opportunity_type: 'INTERNSHIP', eligibility_status: 'ELIGIBLE' };

    const res1 = await pipeline.processOpportunity({ rawOpportunity: opp1, profile: makeProfile(), callAIFn: makeMockAIFn() });
    check('1st application under limit processed', res1.processed, true);

    const res2 = await pipeline.processOpportunity({ rawOpportunity: opp2, profile: makeProfile(), callAIFn: makeMockAIFn() });
    check('2nd application over limit rejected', res2.processed, false);
    check('Reason states daily limit reached', res2.reason.includes('Daily limit'), true);

    const logs = await pipeline.auditLog.getLogs();
    check('Audit log recorded DAILY_LIMIT_REACHED', logs.some(l => l.type === 'DAILY_LIMIT_REACHED'), true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════
// 10. Safety Rule: NEVER Fabricate Information
// ═══════════════════════════════════════════════════════════════
console.log('\n  10. Safety Rule: NEVER Fabricate Information');
{
  const tmp = makeTmpDir();
  try {
    const pipeline = new AutonomousPipeline({
      dataDir: tmp,
      config: { AUTONOMOUS_MODE: true },
    });
    await pipeline.start();

    const opp = {
      title: 'AI Engineer Intern',
      company: 'TechCorp',
      url: 'https://boards.greenhouse.io/techcorp/jobs/777',
      opportunity_type: 'INTERNSHIP',
      eligibility_status: 'ELIGIBLE',
    };

    const res = await pipeline.processOpportunity({
      rawOpportunity: opp,
      profile: makeProfile(),
      callAIFn: makeMockAIFn({ fabricateCV: true }),
    });

    check('Fabricated CV rejected safely', res.processed, false);
    check('Reason indicates fabrication rejection', res.reason.includes('fabrication'), true);

    const logs = await pipeline.auditLog.getLogs();
    check('Audit log recorded FABRICATION_REJECTED', logs.some(l => l.type === 'FABRICATION_REJECTED'), true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════
// 11. Safety Rule: Pause on Unexpected Forms & Unconfident Answers
// ═══════════════════════════════════════════════════════════════
console.log('\n  11. Safety Rule: Pause on Unexpected Forms & Unconfident Answers');
{
  const tmp = makeTmpDir();
  try {
    const pipeline = new AutonomousPipeline({
      dataDir: tmp,
      config: {
        AUTONOMOUS_MODE: true,
        REQUIRE_CONFIDENT_ANSWERS: true,
        PAUSE_ON_UNEXPECTED_FORM: true,
      },
    });
    await pipeline.start();

    const opp = {
      title: 'Frontend Intern',
      company: 'DesignWorks',
      url: 'https://boards.greenhouse.io/designworks/jobs/888',
      opportunity_type: 'INTERNSHIP',
      eligibility_status: 'ELIGIBLE',
      questions: ['Explain quantum topological quantum computing'],
    };

    const res = await pipeline.processOpportunity({
      rawOpportunity: opp,
      profile: makeProfile(),
      callAIFn: makeMockAIFn({ unconfidentAnswers: true }),
    });

    check('Unconfident answer stopped from submitting', res.processed, false);
    check('Reason mentions user input required', res.reason.includes('user input'), true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════
// 12. Safety Rule: Pause on Error
// ═══════════════════════════════════════════════════════════════
console.log('\n  12. Safety Rule: Pause on Error');
{
  const tmp = makeTmpDir();
  try {
    const pipeline = new AutonomousPipeline({
      dataDir: tmp,
      config: {
        AUTONOMOUS_MODE: true,
        PAUSE_ON_ERROR: true,
      },
    });
    await pipeline.start();

    const opp = {
      title: 'Systems Intern',
      company: 'SysOps',
      url: 'https://boards.greenhouse.io/sysops/jobs/999',
      opportunity_type: 'INTERNSHIP',
      eligibility_status: 'ELIGIBLE',
    };

    const res = await pipeline.processOpportunity({
      rawOpportunity: opp,
      profile: makeProfile(),
      callAIFn: makeMockAIFn({ throwError: true }),
    });

    check('Error encountered resulted in failure', res.processed, false);
    check('Pipeline transitioned to ERROR/PAUSED', pipeline.state === AGENT_STATES.PAUSED || pipeline.state === AGENT_STATES.ERROR, true);
    check('Pause reason records error message', pipeline.pauseReason.includes('Error encountered') || pipeline.pauseReason.includes('AI Provider failure'), true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════
// 13. Auto Submit Flag Enforces DRY_RUN vs LIVE
// ═══════════════════════════════════════════════════════════════
console.log('\n  13. Auto Submit Flag Enforces DRY_RUN vs LIVE');
{
  const tmp = makeTmpDir();
  try {
    // With AUTO_SUBMIT=false (Default)
    const pipeDry = new AutonomousPipeline({
      dataDir: tmp,
      config: { AUTONOMOUS_MODE: true, AUTO_SUBMIT: false },
    });
    await pipeDry.start();

    const opp = {
      title: 'DevOps Intern',
      company: 'CloudNet',
      url: 'https://boards.greenhouse.io/cloudnet/jobs/1010',
      opportunity_type: 'INTERNSHIP',
      eligibility_status: 'ELIGIBLE',
    };

    const resDry = await pipeDry.processOpportunity({
      rawOpportunity: opp,
      profile: makeProfile(),
      callAIFn: makeMockAIFn(),
    });

    check('Dry run processed cleanly', resDry.processed, true);
    check('Dry run flag is true on result', resDry.dry_run, true);
    check('Dry run status is DRY_RUN not SUBMITTED', resDry.status, 'DRY_RUN');
    check('Dry run did not submit', resDry.submitted, false);

    const logs = await pipeDry.auditLog.getLogs();
    const appLog = logs.find(l => l.type === 'APPLICATION_PROCESSED');
    check('Audit log recorded dry_run: true', appLog.dry_run, true);
    check('Audit log recorded auto_submit: false', appLog.auto_submit, false);
    check('Audit log status is DRY_RUN', appLog.status, 'DRY_RUN');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════
// 14. Pause / Resume / Restart Recovery
// ═══════════════════════════════════════════════════════════════
console.log('\n  14. Pause / Resume / Restart Recovery');
{
  const tmp = makeTmpDir();
  try {
    // 1st instance: start & pause
    const pipe1 = new AutonomousPipeline({ dataDir: tmp, config: { AUTONOMOUS_MODE: true } });
    await pipe1.start();
    await pipe1.pause('Paused for maintenance');

    // 2nd instance: recover state on startup
    const pipe2 = new AutonomousPipeline({ dataDir: tmp });
    check('Restored state is PAUSED', pipe2.state, AGENT_STATES.PAUSED);
    check('Restored pause reason', pipe2.pauseReason, 'Paused for maintenance');

    // Resume from restored instance
    await pipe2.resume();
    check('Resumed state is RUNNING', pipe2.state, AGENT_STATES.RUNNING);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════
// 15. Continuous Discovery & 9-Stage Cycle Execution
// ═══════════════════════════════════════════════════════════════
console.log('\n  15. Continuous Discovery & 9-Stage Cycle Execution');
{
  const tmp = makeTmpDir();
  try {
    const pipePath = join(tmp, 'pipeline.md');
    writeFileSync(pipePath, `# Pipeline Inbox\n- [ ] https://boards.greenhouse.io/careem/jobs/991 | Careem | Software Intern | Karachi\n- [ ] https://boards.greenhouse.io/10pearls/jobs/992 | 10Pearls | QA Intern | Lahore\n`);

    const pipeline = new AutonomousPipeline({
      dataDir: tmp,
      pipelineMdPath: pipePath,
      config: { AUTONOMOUS_MODE: true, MAX_APPLICATIONS_PER_DAY: 5 },
    });
    await pipeline.start();

    const discRes = await pipeline.discoverOpportunities();
    check('Discovered opportunities from pipeline.md', discRes.total, 2);

    const cycleRes = await pipeline.runCycle({
      profile: makeProfile(),
      maxItems: 2,
      callAIFn: makeMockAIFn(),
    });

    check('Cycle executed successfully', cycleRes.cycleExecuted, true);
    check('Cycle processed items', cycleRes.itemsProcessed >= 1, true);

    const status = await pipeline.getStatus();
    check('Queue counts total is 2', status.queueCounts.total, 2);
    check('Queue counts dry_run prepared is 2', status.queueCounts.dry_run, 2);
    check('Queue counts submitted is 0 in dry-run mode', status.queueCounts.applied, 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

