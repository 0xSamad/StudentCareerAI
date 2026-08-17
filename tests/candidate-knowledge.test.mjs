import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const KB_MOD = pathToFileURL(join(ROOT, 'lib/saas/knowledge/index.mjs')).href;
const GEN_MOD = pathToFileURL(join(ROOT, 'lib/application-generator.mjs')).href;

console.log('\ncandidate-knowledge — grounded evidence retrieval, no fabrication');

const {
  CandidateKnowledgeService,
  MemoryKnowledgeStore,
  classifyDocument,
  chunkText,
  extractCandidateFacts,
  EVIDENCE_STATUS,
} = await import(KB_MOD);

const { generateApplicationContent } = await import(GEN_MOD);

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function checkTrue(label, actual) {
  if (actual) pass(label);
  else fail(`${label} — expected truthy, got ${JSON.stringify(actual)}`);
}

const userA = { tenantId: 'tenant_a', userId: 'student_a' };
const userB = { tenantId: 'tenant_a', userId: 'student_b' };

const PYTHON_CV = `# Ayesha Khan
## Education
BS Computer Science, LUMS, expected 2027. GPA 3.6/4.0
## Skills
Python, SQL, Git
## Projects
SentimentBot — classified student feedback with scikit-learn and Python (machine learning).
## Experience
Software intern at Arbisoft (2025-06 to 2025-08). Built internal Python scripts.
`;

{
  const classified = classifyDocument({ filename: 'lums-transcript.pdf', text: 'Semester GPA 3.4' });
  check('Transcript filename classifies as TRANSCRIPT', classified.type, 'TRANSCRIPT');
  check('User hint wins over filename', classifyDocument({ filename: 'resume.pdf', hintedType: 'CERTIFICATE' }).type, 'CERTIFICATE');
}

{
  const chunks = chunkText(`${'alpha '.repeat(80)}\n\n${'beta '.repeat(80)}`);
  checkTrue('Chunker splits long text', chunks.length >= 2);
  checkTrue('Chunks stay bounded', chunks.every((c) => c.text.length <= 700));
}

{
  const facts = extractCandidateFacts({ text: PYTHON_CV, docType: 'CV' });
  checkTrue('Extracts Python skill from CV', facts.some((f) => f.factType === 'skill' && /python/i.test(f.value)));
  checkTrue('Does not invent Rust', !facts.some((f) => /rust/i.test(f.value)));
}

{
  const svc = new CandidateKnowledgeService({ store: new MemoryKnowledgeStore() });
  const ingested = await svc.ingestDocument({ type: 'CV', title: 'Master CV', text: PYTHON_CV }, userA);
  check('Ingest succeeds', ingested.ok, true);
  checkTrue('Ingest creates chunks', ingested.chunkCount >= 1);
  checkTrue('Ingest creates facts', ingested.factCount >= 1);

  const python = await svc.retrieveRelevantEvidence('What evidence do we have that this student knows Python?', userA);
  check('Python evidence is GROUNDED', python.status, EVIDENCE_STATUS.GROUNDED);
  checkTrue('Python evidence includes a snippet', (python.facts?.length || python.evidence?.length) > 0);

  const rust = await svc.retrieveRelevantEvidence('What evidence do we have that this student knows Rust?', userA);
  check('Missing Rust skill is UNKNOWN', rust.status, EVIDENCE_STATUS.UNKNOWN);
  check('UNKNOWN reason is explicit', rust.reason.includes('UNKNOWN'), true);

  const ml = await svc.retrieveRelevantEvidence('What projects demonstrate machine learning?', userA);
  check('ML project retrieval is GROUNDED', ml.status, EVIDENCE_STATUS.GROUNDED);
  checkTrue('ML retrieval mentions SentimentBot or scikit', JSON.stringify(ml).toLowerCase().includes('sentiment') || JSON.stringify(ml).toLowerCase().includes('scikit'));

  const techs = await svc.listKnowledge(userA);
  checkTrue('Technologies include Python', techs.technologies.some((t) => /python/i.test(t)));
  checkTrue('Technologies do not include Rust', !techs.technologies.some((t) => /rust/i.test(t)));

  const isolated = await svc.retrieveRelevantEvidence('Python', userB);
  check('Other user cannot see Python evidence', isolated.status, EVIDENCE_STATUS.UNKNOWN);
}

{
  const svc = new CandidateKnowledgeService({ store: new MemoryKnowledgeStore() });
  await svc.ingestDocument({ type: 'CV', title: 'CV', text: PYTHON_CV }, userA);

  const internship = {
    title: 'Machine Learning Intern',
    company: 'Careem',
    description: 'Required: Python, PyTorch, and a Bachelor of Science in Computer Science. Master preferred.',
    required_skills: ['Python', 'PyTorch'],
  };
  const ctx = await svc.getCandidateContextForOpportunity(internship, userA);
  check('Context does not dump full corpus', ctx.fullCorpusIncluded, false);
  checkTrue('Python is matching/grounded', ctx.matchingSkills.some((s) => /python/i.test(s.skill) && s.status === EVIDENCE_STATUS.GROUNDED));
  checkTrue('PyTorch is UNKNOWN without evidence', ctx.missingSkills.some((s) => /pytorch/i.test(s.skill) && s.status === EVIDENCE_STATUS.UNKNOWN));
  checkTrue('Bachelor requirement can be grounded', ctx.education.satisfied.some((e) => e.requirement === 'bachelor') || ctx.education.facts.some((f) => /bachelor|bs|computer/i.test(f.value)));
  checkTrue('Master requirement is UNKNOWN', ctx.education.unknown.some((e) => e.requirement === 'master' && e.status === EVIDENCE_STATUS.UNKNOWN));
  checkTrue('Retrieved packet count is bounded', ctx.retrievedChunkCount <= 6);
}

{
  const svc = new CandidateKnowledgeService({ store: new MemoryKnowledgeStore() });
  const uniqueA = 'UNIQUE_CORPUS_TOKEN_ALPHA_ONLY';
  const uniqueB = 'UNIQUE_CORPUS_TOKEN_BRAVO_ONLY';
  await svc.ingestDocument({
    type: 'PERSONAL_STATEMENT',
    title: 'Unrelated essay',
    text: `${uniqueA}\n${'gardening volunteer hours community baking '.repeat(40)}`,
  }, userA);
  await svc.ingestDocument({ type: 'CV', title: 'CV', text: PYTHON_CV }, userA);
  await svc.ingestDocument({
    type: 'EXTRACURRICULAR',
    title: 'Choir notes',
    text: `${uniqueB}\n${'soprano rehearsal sheet music concert '.repeat(40)}`,
  }, userA);

  const ctx = await svc.getCandidateContextForOpportunity({
    title: 'Python intern',
    description: 'Need a student who has used Python for scripting.',
  }, userA);
  const packetText = (ctx.evidencePackets || []).map((p) => p.text).join('\n');
  check('Opportunity context is not a concatenation of every document', ctx.fullCorpusIncluded, false);
  checkTrue('Unrelated choir token is not forced into the prompt packet', !packetText.includes(uniqueB) || packetText.length < 4000);
  const listed = await svc.listKnowledge(userA);
  const corpusChars = listed.documents.reduce((n, d) => n + (d.charCount || 0), 0);
  checkTrue('Retrieved packets are smaller than the full corpus', packetText.length < corpusChars);
}

{
  const svc = new CandidateKnowledgeService({ store: new MemoryKnowledgeStore() });
  await svc.ingestDocument({ type: 'CV', title: 'CV', text: PYTHON_CV }, userA);

  const rustClaim = await svc.validateGeneratedClaim('The student is an expert in Rust and deployed Kubernetes clusters.', userA);
  check('Invented skill claim is UNKNOWN', rustClaim.status, EVIDENCE_STATUS.UNKNOWN);
  check('Invented skill is not valid', rustClaim.valid, false);
  checkTrue('Rust listed as unknown claim', rustClaim.unknownClaims.some((c) => /rust/i.test(c.skill)));

  const companyClaim = await svc.validateGeneratedClaim({
    experience: [{ company: 'Google', role: 'Intern', start_date: '2024-06', bullets: ['Built ads'] }],
    projects: [],
    competencies: [],
  }, userA);
  check('Fabricated company is REJECTED', companyClaim.status, EVIDENCE_STATUS.REJECTED);
  checkTrue('Google violation recorded', companyClaim.violations.some((v) => /google/i.test(v)));

  const metricClaim = await svc.validateGeneratedClaim('Increased revenue by 400% for 2 million users.', userA);
  check('Fabricated metric is REJECTED', metricClaim.status, EVIDENCE_STATUS.REJECTED);

  const grounded = await svc.validateGeneratedClaim('Ayesha used Python on SentimentBot at Arbisoft.', userA);
  check('Attested Python/project claim is GROUNDED', grounded.status, EVIDENCE_STATUS.GROUNDED);
  check('Attested claim is valid', grounded.valid, true);
}

{
  const svc = new CandidateKnowledgeService({ store: new MemoryKnowledgeStore() });
  const empty = await svc.ingestDocument({ type: 'CV', title: 'empty', text: '   ' }, userA);
  check('Empty document ingest is UNKNOWN', empty.status, EVIDENCE_STATUS.UNKNOWN);
  check('Empty ingest is not ok', empty.ok, false);

  const listed = await svc.listKnowledge(userA);
  checkTrue('Missing skills stay UNKNOWN with no documents', listed.missingInformation.some((m) => m.field === 'skills' && m.status === EVIDENCE_STATUS.UNKNOWN));
}

{
  const svc = new CandidateKnowledgeService({ store: new MemoryKnowledgeStore() });
  await svc.ingestDocument({ type: 'SKILLS', title: 'Skills', text: 'Skills: Java, SQL' }, userA);
  const record = await generateApplicationContent({
    profile: {
      identity: { name: 'Ayesha Khan', email: 'a@test.com' },
      education: [{ university: 'LUMS', degree: 'BS', major: 'Computer Science' }],
      skills: { programming_languages: ['Java', 'SQL'] },
      experience: { internships: [] },
      projects: [],
    },
    opportunity: { title: 'Intern', company: 'Careem', description: 'Java intern' },
    questions: [],
    matchingConfig: { ai_provider: 'gemini', model: 'test' },
    candidateKnowledgeService: svc,
    authContext: userA,
    callAIFn: async (_p, sys) => {
      if (/cover letter/i.test(sys)) {
        return JSON.stringify({
          subject_line: 'Application',
          body: 'I am an expert in Rust and led Kubernetes at Google.',
          word_count: 12,
          confidence: 0.9,
        });
      }
      return JSON.stringify({
        summary: 'Student',
        competencies: ['Java'],
        experience: [],
        projects: [],
      });
    },
  });
  checkTrue('Generated cover letter with invented skills is flagged', record.cover_letter?.grounding?.status === EVIDENCE_STATUS.UNKNOWN || record.cover_letter?.grounding?.status === EVIDENCE_STATUS.REJECTED);
  checkTrue('Generation errors mention cover letter', record.generation_errors.some((e) => /cover_letter/i.test(e)));
}
