import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const CV_MOD = pathToFileURL(join(ROOT, 'lib/saas/cv/index.mjs')).href;
const TAILOR_MOD = pathToFileURL(join(ROOT, 'lib/cv-tailor.mjs')).href;

console.log('\ncv-decision-engine — reuse master when suitable, validate before accept');

const {
  CvDecisionEngine,
  MemoryCvVersionStore,
  analyzeCvForOpportunity,
} = await import(CV_MOD);

const { FabricationError } = await import(TAILOR_MOD);

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function checkTrue(label, actual) {
  if (actual) pass(label);
  else fail(`${label} — expected truthy, got ${JSON.stringify(actual)}`);
}

const CTX = { tenantId: 'tenant_cv', userId: 'student_cv' };

const MASTER_CV = `# Ali Hassan
## Skills
Python, PyTorch, Git
## Experience
ML Intern at Arbisoft, 2026-06 to 2026-08. Built NLP pipeline.
## Projects
SentimentBot — Twitter sentiment with DistilBERT and PyTorch.
`;

function makeProfile(overrides = {}) {
  return {
    identity: { name: 'Ali Hassan', email: 'ali@example.com' },
    education: [{ university: 'LUMS', degree: 'Bachelor of Science', major: 'Computer Science', graduation_date: '2027-05' }],
    skills: {
      programming_languages: ['Python'],
      ai_ml: ['PyTorch'],
      tools: ['Git'],
    },
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
    ...overrides,
  };
}

function makeMlOpportunity() {
  return {
    id: 'opp_ml',
    title: 'Machine Learning Intern',
    company: 'Careem',
    description: 'Looking for a student with Python and PyTorch experience for an ML internship.',
  };
}

function makeGapOpportunity() {
  return {
    id: 'opp_platform',
    title: 'Platform Intern',
    company: 'Systems Limited',
    description: 'Python intern who can work with Docker and Kubernetes in production.',
    required_skills: ['Python', 'Docker', 'Kubernetes'],
  };
}

function knowledgeWithVerifiedInfra() {
  return {
    async getCandidateContextForOpportunity() {
      return {
        matchingSkills: [
          { skill: 'Docker', status: 'GROUNDED' },
          { skill: 'Kubernetes', status: 'GROUNDED' },
        ],
        technologiesUsed: [
          { value: 'Docker', status: 'GROUNDED', verificationStatus: 'VERIFIED' },
          { value: 'Kubernetes', status: 'GROUNDED', verificationStatus: 'VERIFIED' },
        ],
        matchingProjects: [
          { value: 'ClusterLab', factType: 'project', verificationStatus: 'VERIFIED', evidence: 'Course cluster on Kubernetes' },
        ],
        missingSkills: [],
      };
    },
    async validateGeneratedClaim() {
      return { status: 'CLEAN', unknownClaims: [], violations: [] };
    },
  };
}

{
  const analysis = analyzeCvForOpportunity({
    profile: makeProfile(),
    cvText: MASTER_CV,
    opportunity: makeMlOpportunity(),
  });
  check('Suitable ML CV is marked cvSuitable', analysis.cvSuitable, true);
  check('Suitable ML CV does not regenerate', analysis.shouldRegenerate, false);
  check('Suitable ML CV risk is LOW', analysis.riskLevel, 'LOW');
  checkTrue('Suitable ML CV reason says reuse', /already covers|already appropriate|No regeneration/i.test(analysis.reason + analysis.recommendedChanges.join(' ')));
}

{
  const analysis = analyzeCvForOpportunity({
    profile: makeProfile(),
    cvText: MASTER_CV,
    opportunity: makeGapOpportunity(),
    knowledgeContext: await knowledgeWithVerifiedInfra().getCandidateContextForOpportunity(),
  });
  checkTrue('Attested infra skills missing from CV are listed', analysis.knownButNotOnCv.length >= 2);
  check('Significant attested gap triggers regeneration', analysis.shouldRegenerate, true);
  checkTrue('Unknown skills do not include Docker', !analysis.unknownSkills.some((s) => /docker/i.test(s)));
}

{
  const analysis = analyzeCvForOpportunity({
    profile: makeProfile(),
    cvText: MASTER_CV,
    opportunity: {
      title: 'Rust Systems Intern',
      company: 'Example',
      description: 'Must know Rust, Zig, and WebAssembly.',
    },
  });
  checkTrue('Unattested JD skills stay UNKNOWN', analysis.unknownSkills.length >= 1);
  check('Weak overlap does not regenerate', analysis.shouldRegenerate, false);
  checkTrue('Recommendations forbid inventing skills', analysis.recommendedChanges.some((c) => /do not add|UNKNOWN skills/i.test(c)));
}

{
  let tailorCalls = 0;
  const engine = new CvDecisionEngine({
    versionStore: new MemoryCvVersionStore(),
    tailorFn: async () => {
      tailorCalls += 1;
      throw new Error('tailorCV should not run when the master CV is already appropriate');
    },
  });
  const decision = await engine.decideAndPrepare({
    profile: makeProfile(),
    cvText: MASTER_CV,
    opportunity: makeMlOpportunity(),
    context: CTX,
  });
  check('Suitable CV does not call tailor', tailorCalls, 0);
  check('Suitable CV reusedMaster', decision.reusedMaster, true);
  check('Suitable CV regenerated flag', decision.regenerated, false);
  check('Analysis cvSuitable true', decision.analysis.cvSuitable, true);
  check('Record reused_master', decision.record.reused_master, true);
  checkTrue('Original CV preserved', decision.originalCv.includes('SentimentBot'));
  const versions = await engine.listVersions(CTX, { opportunityId: 'opp_ml' });
  checkTrue('Stores MASTER snapshot', versions.some((v) => v.kind === 'MASTER'));
  checkTrue('Stores REUSED version', versions.some((v) => v.kind === 'REUSED'));
  check('Does not store TAILORED when reused', versions.some((v) => v.kind === 'TAILORED'), false);
}

{
  let tailorCalls = 0;
  const engine = new CvDecisionEngine({
    versionStore: new MemoryCvVersionStore(),
    candidateKnowledgeService: knowledgeWithVerifiedInfra(),
    tailorFn: async ({ profile }) => {
      tailorCalls += 1;
      const tools = profile.skills?.tools || [];
      checkTrue('Verified knowledge skills merged before tailor', tools.some((s) => /docker/i.test(s)));
      return {
        tailored_html: '<article>Python Docker Kubernetes ClusterLab</article>',
        tailored_draft: {
          summary: 'CS student emphasizing Python, Docker, and Kubernetes from attested work.',
          competencies: ['Python', 'Docker', 'Kubernetes'],
          experience: [{ company: 'Arbisoft', role: 'ML Intern', start_date: '2026-06', end_date: '2026-08', bullets: ['Built NLP pipeline.'] }],
          projects: [{ name: 'ClusterLab', description: 'Course cluster on Kubernetes', technologies: ['Python'] }],
          tailoring_notes: 'Led with attested Docker and Kubernetes skills.',
        },
        validation_result: 'CLEAN',
        tailoring_notes: 'Led with attested Docker and Kubernetes skills.',
      };
    },
  });
  const decision = await engine.decideAndPrepare({
    profile: makeProfile(),
    cvText: MASTER_CV,
    opportunity: makeGapOpportunity(),
    context: CTX,
    applicationId: 'app_gap',
  });
  check('Attested gap calls tailor once', tailorCalls, 1);
  check('Attested gap regenerated', decision.regenerated, true);
  check('Attested gap not reused', decision.reusedMaster, false);
  checkTrue('Changes list is non-empty', decision.changesMade.length > 0);
  checkTrue('Reason explains tailoring', /emphasizing attested|improve relevance/i.test(decision.reasonForChanges));
  const versions = await engine.listVersions(CTX, { applicationId: 'app_gap' });
  checkTrue('Stores MASTER with tailored run', versions.some((v) => v.kind === 'MASTER'));
  checkTrue('Stores TAILORED after validation', versions.some((v) => v.kind === 'TAILORED'));
}

{
  const engine = new CvDecisionEngine({
    versionStore: new MemoryCvVersionStore(),
    candidateKnowledgeService: knowledgeWithVerifiedInfra(),
    tailorFn: async () => {
      throw new FabricationError('invented Rust', ['Fabricated competency: "Rust" not in source skills']);
    },
  });
  const decision = await engine.decideAndPrepare({
    profile: makeProfile(),
    cvText: MASTER_CV,
    opportunity: makeGapOpportunity(),
    context: CTX,
    applicationId: 'app_fab',
  });
  check('Fabricated tailor is not accepted', decision.regenerated, false);
  check('Fabricated tailor keeps master', decision.reusedMaster, true);
  check('Fabricated tailor rejectedTailor', decision.rejectedTailor, true);
  checkTrue('Master CV text kept', decision.tailoredCv.includes('SentimentBot') || decision.originalCv === MASTER_CV);
  const versions = await engine.listVersions(CTX, { applicationId: 'app_fab' });
  checkTrue('Stores REJECTED version', versions.some((v) => v.kind === 'REJECTED'));
}

{
  const engine = new CvDecisionEngine({
    versionStore: new MemoryCvVersionStore(),
    candidateKnowledgeService: knowledgeWithVerifiedInfra(),
    tailorFn: async () => ({
      tailored_html: '<p>Rust expert at Google</p>',
      tailored_draft: {
        summary: 'Invented Rust at Google.',
        competencies: ['Rust'],
        experience: [{ company: 'Google', role: 'Intern', start_date: '2020-01', end_date: '2020-08', bullets: [] }],
        projects: [],
      },
      validation_result: 'CLEAN',
    }),
  });
  const decision = await engine.decideAndPrepare({
    profile: makeProfile(),
    cvText: MASTER_CV,
    opportunity: makeGapOpportunity(),
    context: CTX,
    applicationId: 'app_val',
  });
  check('Claim validation rejects dirty draft', decision.rejectedTailor, true);
  check('Dirty draft does not replace master', decision.regenerated, false);
  const versions = await engine.listVersions(CTX, { applicationId: 'app_val' });
  checkTrue('Dirty draft stored as REJECTED', versions.some((v) => v.kind === 'REJECTED'));
}

{
  const analysis = analyzeCvForOpportunity({
    profile: makeProfile(),
    cvText: MASTER_CV,
    opportunity: makeGapOpportunity(),
    knowledgeContext: {
      technologiesUsed: [{ value: 'Docker', status: 'UNCERTAIN', verificationStatus: 'UNCERTAIN' }],
      matchingSkills: [{ skill: 'Docker', status: 'UNCERTAIN' }],
      matchingProjects: [],
    },
  });
  check('Uncertain knowledge is not treated as attested', analysis.knownButNotOnCv.some((s) => /docker/i.test(s)), false);
}

{
  const analysis = analyzeCvForOpportunity({
    profile: makeProfile(),
    cvText: MASTER_CV,
    opportunity: makeMlOpportunity(),
    eligibility: { overall: 'NOT_ELIGIBLE' },
  });
  check('Ineligible candidate skips tailor', analysis.shouldRegenerate, false);
  check('Ineligible risk is HIGH', analysis.riskLevel, 'HIGH');
}
