import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const CL_MOD = pathToFileURL(join(ROOT, 'lib/saas/cover-letter/index.mjs')).href;

console.log('\ncover-letter-decision-engine — generate only when needed, never generic');

const {
  CoverLetterDecisionEngine,
  MemoryCoverLetterVersionStore,
  analyzeCoverLetterRequirement,
  COVER_LETTER_REQUIREMENT,
  isGenericCoverLetter,
} = await import(CL_MOD);

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function checkTrue(label, actual) {
  if (actual) pass(label);
  else fail(`${label} — expected truthy, got ${JSON.stringify(actual)}`);
}

const CTX = { tenantId: 'tenant_cl', userId: 'student_cl' };

const PROFILE = {
  identity: { name: 'Ali Hassan', email: 'ali@example.com' },
  education: [{ university: 'LUMS', degree: 'Bachelor of Science', major: 'Computer Science', graduation_date: '2027-05' }],
  skills: { programming_languages: ['Python'], ai_ml: ['PyTorch'] },
  experience: {
    internships: [{
      company: 'Arbisoft',
      role: 'ML Intern',
      start_date: '2026-06',
      end_date: '2026-08',
      description: 'Built NLP pipeline.',
    }],
  },
  projects: [
    { name: 'SentimentBot', description: 'Twitter sentiment with DistilBERT.', technologies: ['Python', 'PyTorch'] },
  ],
  preferences: { target_roles: ['Machine Learning Intern'] },
};

const CV_TEXT = `# Ali Hassan
## Experience
ML Intern at Arbisoft. Built NLP pipeline.
## Projects
SentimentBot — Twitter sentiment with DistilBERT and PyTorch.
`;

function personalizedLetter() {
  return {
    subject_line: 'Application for Machine Learning Intern at Careem',
    body: `Dear Careem ML team,\n\nAt Arbisoft I built an NLP pipeline as an ML Intern, and SentimentBot is the project I would lead with for this internship because it uses Python and PyTorch on real text classification.\n\nI am targeting machine learning internships and this role matches that goal.\n\nSincerely,\nAli Hassan`,
    word_count: 70,
    confidence: 0.9,
    generated_at: new Date().toISOString(),
  };
}

{
  const required = analyzeCoverLetterRequirement({
    opportunity: {
      title: 'ML Intern',
      company: 'Careem',
      description: 'Join the ML team. A cover letter is required with your application.',
    },
    profile: PROFILE,
  });
  check('Required posting is REQUIRED', required.requirement, COVER_LETTER_REQUIREMENT.REQUIRED);
  check('Required posting should generate', required.shouldGenerate, true);
}

{
  const recommended = analyzeCoverLetterRequirement({
    opportunity: {
      title: 'ML Intern',
      company: 'Careem',
      description: 'Cover letters are encouraged but not mandatory.',
    },
    profile: PROFILE,
  });
  check('Encouraged posting is RECOMMENDED', recommended.requirement, COVER_LETTER_REQUIREMENT.RECOMMENDED);
  check('Recommended posting should generate', recommended.shouldGenerate, true);
}

{
  const optional = analyzeCoverLetterRequirement({
    opportunity: {
      title: 'General Intern',
      company: 'Acme',
      description: 'A cover letter is optional.',
    },
    profile: { identity: { name: 'Ali' }, skills: {}, experience: {}, projects: [], preferences: {} },
  });
  check('Optional with no attested angle is OPTIONAL', optional.requirement, COVER_LETTER_REQUIREMENT.OPTIONAL);
  check('Optional without benefit does not generate', optional.shouldGenerate, false);
}

{
  const none = analyzeCoverLetterRequirement({
    opportunity: {
      title: 'ML Intern',
      company: 'Careem',
      description: 'Python and PyTorch internship. Resume only.',
    },
    profile: PROFILE,
  });
  check('No mention is NOT_NEEDED', none.requirement, COVER_LETTER_REQUIREMENT.NOT_NEEDED);
  check('No mention does not generate', none.shouldGenerate, false);
}

{
  const forbidden = analyzeCoverLetterRequirement({
    opportunity: {
      title: 'Intern',
      company: 'Acme',
      description: 'Please do not send a cover letter. We do not accept cover letters.',
      cover_letter_required: true,
    },
    profile: PROFILE,
  });
  check('Explicit do-not-send wins over required flag', forbidden.requirement, COVER_LETTER_REQUIREMENT.NOT_NEEDED);
  check('Do-not-send does not generate', forbidden.shouldGenerate, false);
}

{
  const formRequired = analyzeCoverLetterRequirement({
    opportunity: {
      title: 'Intern',
      company: 'Acme',
      description: 'Apply below.',
      fields: [{ name: 'cover_letter', label: 'Cover letter', required: true }],
    },
    profile: PROFILE,
  });
  check('Required form field is REQUIRED', formRequired.requirement, COVER_LETTER_REQUIREMENT.REQUIRED);
}

{
  const generic = isGenericCoverLetter(
    'Dear Hiring Manager, I am excited to apply for ML Intern at Careem. I believe I would be a great fit. Thank you for your consideration.',
    { opportunity: { company: 'Careem', title: 'ML Intern' }, attestedTokens: ['SentimentBot', 'Arbisoft'] }
  );
  check('Template letter is generic', generic.generic, true);

  const personal = isGenericCoverLetter(personalizedLetter().body, {
    opportunity: { company: 'Careem', title: 'Machine Learning Intern' },
    attestedTokens: ['SentimentBot', 'Arbisoft'],
  });
  check('Letter citing attested work is not generic', personal.generic, false);
}

{
  let generateCalls = 0;
  const engine = new CoverLetterDecisionEngine({
    versionStore: new MemoryCoverLetterVersionStore(),
    generateFn: async () => {
      generateCalls += 1;
      throw new Error('generateCoverLetter should not run when not needed');
    },
  });
  const decision = await engine.decideAndPrepare({
    profile: PROFILE,
    cvText: CV_TEXT,
    opportunity: {
      id: 'job_none',
      title: 'ML Intern',
      company: 'Careem',
      description: 'Python internship. Submit your resume.',
    },
    context: CTX,
  });
  check('Not-needed path does not call generator', generateCalls, 0);
  check('Not-needed skipped', decision.skipped, true);
  check('Not-needed generated flag', decision.generated, false);
  check('Stored coverLetter is null', decision.record.coverLetter, null);
  checkTrue('Stores jobId', decision.record.jobId === 'job_none');
  checkTrue('Stores generatedAt', Boolean(decision.record.generatedAt));
  checkTrue('Stores version', typeof decision.record.version === 'number');
  const versions = await engine.listVersions(CTX, { jobId: 'job_none' });
  checkTrue('Stores SKIPPED version', versions.some((v) => v.kind === 'SKIPPED'));
}

{
  let generateCalls = 0;
  const engine = new CoverLetterDecisionEngine({
    versionStore: new MemoryCoverLetterVersionStore(),
    generateFn: async (args) => {
      generateCalls += 1;
      checkTrue('Prompt includes attested projects', (args.relevantProjects || []).includes('SentimentBot') || (args.relevantExperience || []).some((e) => /Arbisoft|SentimentBot/i.test(e)));
      return personalizedLetter();
    },
  });
  const decision = await engine.decideAndPrepare({
    profile: PROFILE,
    cvText: CV_TEXT,
    opportunity: {
      id: 'job_req',
      title: 'Machine Learning Intern',
      company: 'Careem',
      description: 'Python and PyTorch. A cover letter is required.',
    },
    matchResult: { match_score: 88, relevant_projects: ['SentimentBot'], relevant_experience: ['ML Intern at Arbisoft'] },
    context: CTX,
    applicationId: 'app_req',
  });
  check('Required path calls generator once', generateCalls, 1);
  check('Required path generated', decision.generated, true);
  checkTrue('Record body is personalized', /SentimentBot/.test(decision.record.body));
  checkTrue('sourceEvidence is stored', Array.isArray(decision.record.sourceEvidence));
  checkTrue('jobId stored on generated letter', decision.record.jobId === 'job_req');
  const versions = await engine.listVersions(CTX, { applicationId: 'app_req' });
  checkTrue('Stores GENERATED version', versions.some((v) => v.kind === 'GENERATED'));
}

{
  const engine = new CoverLetterDecisionEngine({
    versionStore: new MemoryCoverLetterVersionStore(),
    generateFn: async () => ({
      subject_line: 'Application',
      body: 'Dear Hiring Manager, I am excited to apply for Machine Learning Intern at Careem. I believe I would be a great fit. Thank you for your consideration.',
      word_count: 28,
      confidence: 0.4,
    }),
  });
  const decision = await engine.decideAndPrepare({
    profile: PROFILE,
    cvText: CV_TEXT,
    opportunity: {
      id: 'job_generic',
      title: 'Machine Learning Intern',
      company: 'Careem',
      description: 'Cover letter required.',
    },
    context: CTX,
    applicationId: 'app_generic',
  });
  check('Generic letter is not accepted', decision.generated, false);
  check('Generic letter rejected', decision.rejected, true);
  check('Generic letter coverLetter kept null', decision.record.coverLetter, null);
  const versions = await engine.listVersions(CTX, { applicationId: 'app_generic' });
  checkTrue('Stores REJECTED generic version', versions.some((v) => v.kind === 'REJECTED'));
}

{
  const engine = new CoverLetterDecisionEngine({
    versionStore: new MemoryCoverLetterVersionStore(),
    generateFn: async () => ({
      subject_line: 'Application',
      body: 'At Google in 2019 I increased revenue by 80% while leading SentimentBot.',
      word_count: 20,
      confidence: 0.9,
    }),
  });
  const decision = await engine.decideAndPrepare({
    profile: PROFILE,
    cvText: CV_TEXT,
    opportunity: {
      id: 'job_fab',
      title: 'Machine Learning Intern',
      company: 'Careem',
      description: 'Cover letter is required.',
    },
    context: CTX,
    applicationId: 'app_fab',
  });
  check('Fabricated letter is not accepted', decision.generated, false);
  checkTrue('Fabrication is rejected or generic-rejected', decision.rejected === true);
}

{
  const engine = new CoverLetterDecisionEngine({
    versionStore: new MemoryCoverLetterVersionStore(),
    generateFn: async () => personalizedLetter(),
  });
  await engine.decideAndPrepare({
    profile: PROFILE,
    cvText: CV_TEXT,
    opportunity: { id: 'job_edit', title: 'ML Intern', company: 'Careem', description: 'Cover letter required. Python.' },
    context: CTX,
    applicationId: 'app_edit',
  });
  const edited = await engine.saveEdit({
    body: 'At Arbisoft I built the NLP pipeline behind SentimentBot. I want this Careem ML intern role.',
    opportunity: { id: 'job_edit' },
    applicationId: 'app_edit',
    context: CTX,
  });
  checkTrue('Edit stores a new version', edited.record.version >= 2);
  check('Edit marked edited', edited.record.edited, true);
  const versions = await engine.listVersions(CTX, { applicationId: 'app_edit' });
  checkTrue('Stores EDITED version', versions.some((v) => v.kind === 'EDITED'));
}
