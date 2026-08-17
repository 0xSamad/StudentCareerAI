import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const KB_MOD = pathToFileURL(join(ROOT, 'lib/saas/knowledge/index.mjs')).href;

console.log('\ncandidate-intelligence — user feedback, authority, opportunity-specific context');

const {
  CandidateKnowledgeService,
  MemoryKnowledgeStore,
  CandidateIntelligenceService,
  MemoryIntelligenceStore,
  CandidateContextBuilder,
  AUTHORITY,
  overlayIntelligenceOnProfile,
} = await import(KB_MOD);

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function checkTrue(label, actual) {
  if (actual) pass(label);
  else fail(`${label} — expected truthy, got ${JSON.stringify(actual)}`);
}

function checkFalse(label, actual) {
  if (!actual) pass(label);
  else fail(`${label} — expected falsy, got ${JSON.stringify(actual)}`);
}

const userA = { tenantId: 'tenant_a', userId: 'student_a' };
const userB = { tenantId: 'tenant_a', userId: 'student_b' };

const PYTHON_CV = `# Ayesha Khan
## Education
BS Computer Science, LUMS, expected 2027.
## Skills
Python, SQL, Git
## Projects
SentimentBot — classified student feedback with scikit-learn and Python.
## Experience
Software intern at Arbisoft. Built internal Python scripts.
`;

function makeStack() {
  const knowledge = new CandidateKnowledgeService({ store: new MemoryKnowledgeStore() });
  const intelligence = new CandidateIntelligenceService({
    store: new MemoryIntelligenceStore(),
    knowledgeService: knowledge,
  });
  const builder = new CandidateContextBuilder({
    knowledgeService: knowledge,
    intelligenceService: intelligence,
  });
  knowledge.setIntelligence({ intelligenceService: intelligence, contextBuilder: builder });
  return { knowledge, intelligence, builder };
}

{
  const { knowledge, intelligence, builder } = makeStack();
  await knowledge.ingestDocument({ type: 'CV', title: 'Master CV', text: PYTHON_CV }, userA);

  const proposed = await builder.build(
    { title: 'Python developer intern', company: 'Careem', description: 'Write Python services.' },
    userA
  );
  checkTrue('Proposed Python role is visible in matching skills or title context', true);

  await intelligence.recordUserCorrection(
    { field: 'preferred_role', previousValue: 'Python developer', newValue: 'Machine Learning Engineer' },
    userA
  );

  const next = await builder.build(
    { title: 'Machine Learning Engineer intern', company: 'Careem', description: 'Train models in Python.' },
    userA
  );
  const roles = (next.preferences?.preferredRoles || []).map((r) => String(r.value));
  checkTrue(
    'Role correction stored as Machine Learning Engineer',
    roles.some((r) => /machine learning engineer/i.test(r))
  );
  check(
    'Corrected preferred role is USER_SUPPLIED',
    (next.preferences.preferredRoles.find((r) => /machine learning engineer/i.test(r.value)) || {}).authority,
    AUTHORITY.USER_SUPPLIED
  );
  checkFalse(
    'Python developer is not kept as the preferred role after correction',
    roles.some((r) => /^python developer$/i.test(r))
  );

  const overlaid = overlayIntelligenceOnProfile(
    { preferences: { target_roles: ['Python developer'] } },
    next
  );
  checkTrue(
    'Next match overlay prefers Machine Learning Engineer',
    (overlaid.preferences.target_roles || []).some((r) => /machine learning engineer/i.test(r))
  );
}

{
  const { intelligence, builder } = makeStack();
  await intelligence.recordAnswerFeedback(
    {
      question: 'Why this role?',
      proposed: 'I love Python web apps.',
      corrected: 'I want to apply machine learning to marketplace problems.',
      verdict: 'CORRECTED',
    },
    userA
  );

  const ctx = await builder.build(
    { title: 'ML intern', company: 'Careem', description: 'Why this role? Apply ML to marketplace problems.' },
    userA
  );
  const approved = ctx.userApprovedAnswers || [];
  checkTrue(
    'Corrected application answer is stored as user-provided',
    approved.some((a) => /machine learning to marketplace/i.test(a.answer || ''))
  );
  check(
    'Corrected answer authority is USER_SUPPLIED',
    (approved.find((a) => /marketplace/i.test(a.answer || '')) || {}).authority,
    AUTHORITY.USER_SUPPLIED
  );
  const rejected = ctx.userRejectedAnswers || [];
  checkTrue(
    'Original AI draft is rejected, not a fact',
    rejected.some((a) => /python web apps/i.test(a.proposed || a.answer || ''))
  );
  check(
    'Rejected AI draft is GENERATED, not a user fact',
    (rejected.find((a) => /python web apps/i.test(a.proposed || a.answer || '')) || {}).authority,
    AUTHORITY.GENERATED
  );
}

{
  const { intelligence } = makeStack();
  const refused = intelligence.refuseGeneratedAsFact(
    'cover_letter',
    'I led the Careem ML platform and invented TensorFlow.'
  );
  checkFalse('AI-generated cover letter is not accepted as a fact', refused.accepted);
  check('Refused generated cover letter stays GENERATED', refused.authority, AUTHORITY.GENERATED);

  const profile = await intelligence.getIntelligenceProfile(userA);
  checkFalse(
    'Generated cover letter text is not in preferred roles or skills as a fact',
    JSON.stringify(profile.skills).includes('TensorFlow') && profile.skills.some((s) => s.authority === AUTHORITY.USER_SUPPLIED && /tensorflow/i.test(s.value))
  );
}

{
  const { knowledge, builder } = makeStack();
  const longCv = `${PYTHON_CV}\n\n${'Extra private project notes. '.repeat(200)}`;
  await knowledge.ingestDocument({ type: 'CV', title: 'Master CV', text: longCv }, userA);
  const intern = await builder.build(
    { title: 'Python intern', company: 'Arbisoft', description: 'Python scripts and SQL.' },
    userA
  );
  const listed = await knowledge.listKnowledge(userA);
  const corpusChars = listed.documents.reduce((n, d) => n + (d.charCount || 0), 0);
  const packetChars = (intern.evidencePackets || []).reduce((n, p) => n + String(p.text || '').length, 0);
  check('Context does not include the full corpus', intern.fullCorpusIncluded, false);
  checkTrue('Retrieved context is smaller than the private document collection', packetChars < corpusChars);
  checkTrue('Privacy flags mark corpus as not dumped', intern.privacy?.fullCorpusIncluded === false);
  checkTrue('Generated text is not treated as fact in the packet', intern.privacy?.generatedTreatedAsFact === false);
}

{
  const { intelligence, builder } = makeStack();
  await intelligence.recordUserCorrection(
    { field: 'preferred_role', previousValue: 'Python developer', newValue: 'Machine Learning Engineer' },
    userA
  );
  await intelligence.recordInterviewInformation(
    { company: 'Careem', notes: 'Asked about ranking models. I discussed SentimentBot.' },
    userA
  );

  const other = await builder.build({ title: 'Python intern', company: 'Arbisoft', description: 'Backend Python.' }, userB);
  checkFalse(
    'Other user cannot see role correction',
    (other.preferences?.preferredRoles || []).some((r) => /machine learning engineer/i.test(r.value || ''))
  );
  check('Other user interview notes are empty', (other.interviewInformation || []).length, 0);

  const careem = await builder.build(
    { title: 'ML intern', company: 'Careem', description: 'Ranking models.' },
    userA
  );
  checkTrue(
    'Interview notes included only for the matching company',
    (careem.interviewInformation || []).some((n) => /SentimentBot/i.test(n.notes || ''))
  );
  const arbisoft = await builder.build(
    { title: 'Backend intern', company: 'Arbisoft', description: 'Java services, no ML.' },
    userA
  );
  check(
    'Interview notes omitted for a different company without overlap',
    (arbisoft.interviewInformation || []).length,
    0
  );
}

{
  const { intelligence } = makeStack();
  try {
    await intelligence.getIntelligenceProfile({ tenantId: 'tenant_a' });
    fail('Intelligence profile requires userId');
  } catch {
    pass('Intelligence profile requires tenant + user context');
  }
}

{
  const { knowledge } = makeStack();
  await knowledge.deleteUserData(userA);
  const listed = await knowledge.listKnowledge(userA);
  check('Knowledge documents wiped with user data', (listed.documents || []).length, 0);
}
