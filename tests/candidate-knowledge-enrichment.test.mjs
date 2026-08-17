import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const KB_MOD = pathToFileURL(join(ROOT, 'lib/saas/knowledge/index.mjs')).href;

console.log('\ncandidate-knowledge-enrichment — authorized sources, attribution, no bypass');

const {
  CandidateKnowledgeService,
  MemoryKnowledgeStore,
  fetchGitHubEvidence,
  parseGitHubUsername,
  enrichLinkedIn,
  fetchWebsiteEvidence,
  assertSafePublicUrl,
  formatEvidenceSnippet,
  EVIDENCE_STATUS,
  VERIFICATION_STATUS,
} = await import(KB_MOD);

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function checkTrue(label, actual) {
  if (actual) pass(label);
  else fail(`${label} — expected truthy, got ${JSON.stringify(actual)}`);
}

function mockResponse(status, body) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    headers: { forEach() {} },
    arrayBuffer: async () => Buffer.from(raw),
  };
}

function mockGitHub({ rateLimit = false, missing = false } = {}) {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(String(url));
    if (rateLimit) return mockResponse(429, { message: 'API rate limit exceeded' });
    if (missing) return mockResponse(404, { message: 'Not Found' });
    const u = String(url);
    if (/\/users\/studentdev$/.test(u)) {
      return mockResponse(200, { login: 'studentdev', html_url: 'https://github.com/studentdev', bio: 'CS student' });
    }
    if (u.includes('/users/studentdev/repos')) {
      return mockResponse(200, [{
        name: 'student-ml-project',
        private: false,
        html_url: 'https://github.com/studentdev/student-ml-project',
        description: 'Machine Learning Prediction System',
      }]);
    }
    if (u.includes('/languages')) return mockResponse(200, { Python: 12000 });
    if (u.includes('/readme')) {
      return mockResponse(200, '# Machine Learning Prediction System\nUses scikit-learn and pandas.\nA blog quote mentions Rust.');
    }
    if (u.includes('/events/public')) return mockResponse(200, [{ type: 'PushEvent' }]);
    return mockResponse(404, { message: 'Not Found' });
  };
  fetchFn.calls = calls;
  return fetchFn;
}

const user = { tenantId: 'tenant_enr', userId: 'student_enr' };

{
  const facts = (await import(KB_MOD)).extractCandidateFacts({
    text: '# Ayesha\nSkills: Python\n',
    docType: 'CV',
  });
  const py = facts.find((f) => /python/i.test(f.value) && f.factType === 'skill');
  checkTrue('CV fact has source', Boolean(py?.source?.kind));
  checkTrue('CV fact has confidence', typeof py?.confidence === 'number');
  checkTrue('CV fact has timestamp', Boolean(py?.timestamp));
  checkTrue('CV fact has evidence', Boolean(py?.evidence));
  check('User document facts are VERIFIED', py.verificationStatus, VERIFICATION_STATUS.VERIFIED);
}

{
  const fetchFn = mockGitHub();
  const gh = await fetchGitHubEvidence({ url: 'https://github.com/studentdev', fetchFn });
  check('GitHub public import succeeds', gh.ok, true);
  const project = gh.facts.find((f) => f.factType === 'project');
  check('GitHub project name uses attested title', project.value, 'Machine Learning Prediction System');
  checkTrue('GitHub evidence includes repo URL', project.evidence.includes('https://github.com/studentdev/student-ml-project'));
  checkTrue('GitHub evidence includes Python', /python/i.test(project.evidence) || gh.facts.some((f) => f.factType === 'technology' && /python/i.test(f.value)));
  check('GitHub language is VERIFIED', gh.facts.find((f) => f.factType === 'technology' && /python/i.test(f.value)).verificationStatus, VERIFICATION_STATUS.VERIFIED);
  const rust = gh.facts.find((f) => /rust/i.test(f.value));
  checkTrue('README-only Rust is UNCERTAIN', rust && rust.verificationStatus === VERIFICATION_STATUS.UNCERTAIN);
  checkTrue('Every GitHub fact has source', gh.facts.every((f) => f.source && f.confidence != null && f.timestamp && f.evidence));
}

{
  const fetchFn = mockGitHub({ missing: true });
  const gh = await fetchGitHubEvidence({ username: 'studentdev', fetchFn });
  check('Private/missing GitHub is UNKNOWN', gh.status, EVIDENCE_STATUS.UNKNOWN);
  check('Missing GitHub does not invent facts', gh.facts.length, 0);
}

{
  const fetchFn = mockGitHub({ rateLimit: true });
  const gh = await fetchGitHubEvidence({ username: 'studentdev', fetchFn });
  check('Rate limit is UNKNOWN, not bypassed', gh.status, EVIDENCE_STATUS.UNKNOWN);
  checkTrue('Rate limit does not retry-storm', fetchFn.calls.length <= 2);
}

{
  check('Bare GitHub username parses', parseGitHubUsername('studentdev'), 'studentdev');
  check('Protocol-less GitHub URL parses', parseGitHubUsername('github.com/studentdev'), 'studentdev');
  check('GitHub repo URL uses the owner', parseGitHubUsername('https://github.com/studentdev/student-ml-project'), 'studentdev');
  check('Reserved GitHub path is rejected', parseGitHubUsername('github.com/settings'), null);
}

{
  const fetchFn = mockGitHub();
  const gh = await fetchGitHubEvidence({ url: 'github.com/studentdev', fetchFn });
  check('Protocol-less GitHub URL imports', gh.ok, true);
}

{
  const li = enrichLinkedIn({ url: 'https://www.linkedin.com/in/ayesha' });
  check('LinkedIn URL without paste is saved', li.ok, true);
  check('LinkedIn URL-only is GROUNDED (URL attested, not scraped)', li.status, EVIDENCE_STATUS.GROUNDED);
  check('LinkedIn URL-only does not fetch HTML', li.fetched, false);
  checkTrue('LinkedIn URL-only fact is UNCERTAIN or URL-verified', !li.facts.length || li.facts.every((f) => f.verificationStatus === VERIFICATION_STATUS.UNCERTAIN || (f.factType === 'url' && f.verificationStatus === VERIFICATION_STATUS.VERIFIED)));

  const protocolLess = enrichLinkedIn({ url: 'linkedin.com/in/ayesha' });
  check('Protocol-less LinkedIn URL is saved', protocolLess.ok, true);

  const pasted = enrichLinkedIn({
    url: 'https://www.linkedin.com/in/ayesha',
    text: 'Ayesha Khan\nExperience: Intern at Arbisoft\nSkills: Python, SQL',
  });
  check('User-provided LinkedIn text is GROUNDED', pasted.ok, true);
  checkTrue('Pasted LinkedIn extracts Python', pasted.facts.some((f) => /python/i.test(f.value)));
}

{
  let fetchedLinkedIn = false;
  const site = await fetchWebsiteEvidence({
    url: 'https://www.linkedin.com/in/ayesha',
    fetchFn: async () => {
      fetchedLinkedIn = true;
      return mockResponse(200, '<html>secret</html>');
    },
  });
  check('Website enricher refuses LinkedIn', site.status, EVIDENCE_STATUS.UNKNOWN);
  check('LinkedIn HTML was not fetched', fetchedLinkedIn, false);
}

{
  const blocked = assertSafePublicUrl('http://169.254.169.254/latest/meta-data/');
  check('Cloud metadata URL is blocked', blocked.ok, false);
  const loop = assertSafePublicUrl('http://127.0.0.1/admin');
  check('Loopback URL is blocked', loop.ok, false);
}

{
  const svc = new CandidateKnowledgeService({ store: new MemoryKnowledgeStore() });
  const fetchFn = mockGitHub();
  const imported = await svc.enrichFromExternalProfile({ source: 'github', url: 'https://github.com/studentdev', fetchFn }, user);
  check('Service persists GitHub evidence', imported.ok, true);

  const linkedinSaved = await svc.enrichFromExternalProfile({ source: 'linkedin', url: 'linkedin.com/in/ayesha' }, user);
  check('Service saves LinkedIn URL without scraping', linkedinSaved.ok, true);

  const python = await svc.validateGeneratedClaim('The student used Python on student-ml-project.', user);
  check('Verified GitHub Python grounds a claim', python.status, EVIDENCE_STATUS.GROUNDED);

  const rust = await svc.validateGeneratedClaim('The student is an expert in Rust.', user);
  check('Uncertain README skill is not treated as verified', rust.status, EVIDENCE_STATUS.UNCERTAIN);
  check('Uncertain claim is not valid', rust.valid, false);

  const ctx = await svc.getCandidateContextForOpportunity({
    title: 'ML Intern',
    description: 'Need Python and Rust',
    required_skills: ['Python', 'Rust'],
  }, user);
  checkTrue('Python matching skill is GROUNDED', ctx.matchingSkills.some((s) => /python/i.test(s.skill) && s.status === EVIDENCE_STATUS.GROUNDED));
  checkTrue('Rust is UNCERTAIN not GROUNDED', ctx.uncertainSkills.some((s) => /rust/i.test(s.skill)));
  checkTrue('Rust is not in verified matching skills', !ctx.matchingSkills.some((s) => /rust/i.test(s.skill)));
}

{
  const messy = 'VirtualBox, Kali Linux Programming &amp; Scripting: Python, Bash';
  const formatted = formatEvidenceSnippet(messy, { around: 'Python', max: 80 });
  checkTrue('Evidence snippet decodes HTML entities', formatted.includes('&') && !formatted.includes('&amp;'));
  checkTrue('Evidence snippet does not start mid-word', !/^rtualBox/i.test(formatted));
  const readme = '# Repo\n<div align="center">\n<img src="https://img.shields.io/badge/Python-Projects"/>\n</div>\nUses Python for automation.';
  const excerpt = formatEvidenceSnippet(readme, { around: 'Python', max: 120 });
  checkTrue('README excerpt strips HTML chrome', !excerpt.includes('<div') && !excerpt.includes('<img'));
  checkTrue('README excerpt keeps the attested skill', /python/i.test(excerpt));
}
