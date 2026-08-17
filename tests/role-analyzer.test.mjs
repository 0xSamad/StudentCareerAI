// tests/role-analyzer.test.mjs — Role Readiness Analyzer (market demand vs attested profile)
import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const RA = pathToFileURL(join(ROOT, 'lib/saas/role-analyzer/index.mjs')).href;
const STORE = pathToFileURL(join(ROOT, 'lib/saas/opportunity-store/index.mjs')).href;

console.log('\nrole-analyzer — families, frequency, gaps, readiness, cache');

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function checkTrue(label, actual) {
  if (actual) pass(label);
  else fail(`${label} — expected truthy, got ${JSON.stringify(actual)}`);
}

const {
  resolveRoleFamily,
  titleMatchesFamily,
  extractAnalyzerSkills,
  classifyMarket,
  computeSkillDemand,
  buildSkillGaps,
  STATUS,
  EVIDENCE_LEVEL,
  analyzeRoleReadiness,
  buildAnalysisResult,
  collectProfileSkills,
  computeReadiness,
  normalizeRole,
  baselineFor,
  selectProjects,
  analysisPhasesFor,
  searchNounFor,
  searchedTitlesFor,
} = await import(RA);
const { MemoryOpportunityStore } = await import(STORE);

{
  const ai = resolveRoleFamily('AI Intern');
  check('AI Intern canonical', ai.canonical, 'AI Intern');
  check('AI Intern does not expand to ML Intern search title', ai.titles.includes('ML Intern'), false);
  checkTrue('AI Intern matches Artificial Intelligence Intern', titleMatchesFamily('Artificial Intelligence Intern', ai));
  check('AI Intern does not match Machine Learning Intern', titleMatchesFamily('Machine Learning Intern', ai), false);
  check('AI Intern does not match Software Engineer', titleMatchesFamily('Software Engineer', ai), false);
  check('AI Intern does not match Data Scientist', titleMatchesFamily('Data Scientist', ai), false);
  check('AI Intern does not match HTML Developer Intern', titleMatchesFamily('HTML Developer Intern', ai), false);
}

{
  const ds = resolveRoleFamily('Data Scientist');
  check('Data Scientist canonical', ds.canonical, 'Data Scientist');
  check('Data Scientist does not swallow Software Engineer', titleMatchesFamily('Software Engineer', ds), false);
  check('Data Scientist does not match Backend Engineer', titleMatchesFamily('Backend Engineer', ds), false);
  checkTrue('Data Scientist matches Junior Data Scientist', titleMatchesFamily('Junior Data Scientist', ds));
}

{
  const ml = resolveRoleFamily('ML Intern');
  check('ML Intern canonical', ml.canonical, 'ML Intern');
  checkTrue('ML Intern matches Machine Learning Intern', titleMatchesFamily('Machine Learning Intern', ml));
  check('ML Intern does not match Software Engineer Intern', titleMatchesFamily('Software Engineer Intern', ml), false);
}

{
  const mle = resolveRoleFamily('ML Engineer');
  check('ML Engineer canonical', mle.canonical, 'ML Engineer');
  checkTrue('ML Engineer matches Machine Learning Engineer', titleMatchesFamily('Machine Learning Engineer', mle));
  check('ML Engineer does not match ML Intern', titleMatchesFamily('Machine Learning Intern', mle), false);
}

{
  const dsi = resolveRoleFamily('Data Science Intern');
  check('Data Science Intern canonical', dsi.canonical, 'Data Science Intern');
  checkTrue('matches Data Scientist Intern', titleMatchesFamily('Data Scientist Intern', dsi));
  check('does not merge Software Engineer Intern', titleMatchesFamily('Software Engineer Intern', dsi), false);
}

{
  const skills = extractAnalyzerSkills('Python programming, Python 3, PyTorch framework, Postgres, Git, get going');
  checkTrue('Python programming → Python', skills.has('Python'));
  checkTrue('PyTorch framework → PyTorch', skills.has('PyTorch'));
  checkTrue('Postgres → PostgreSQL', skills.has('PostgreSQL'));
  checkTrue('Git extracted', skills.has('Git'));
  check('prose "get" is not Git', [...skills].includes('get'), false);
}

{
  check('Karachi is PAKISTAN', classifyMarket({ location: 'Karachi, Pakistan', country: 'Pakistan' }), 'PAKISTAN');
  check('London is INTERNATIONAL', classifyMarket({ location: 'London, UK', country: 'United Kingdom' }), 'INTERNATIONAL');
  check('missing location is UNKNOWN', classifyMarket({ title: 'AI Intern', company: 'Acme' }), 'UNKNOWN');
}

{
  const pythonJobs = Array.from({ length: 39 }, (_, i) => ({ skills: ['Python', i % 2 ? 'SQL' : 'Docker'] }));
  const rest = Array.from({ length: 11 }, () => ({ skills: ['SQL'] }));
  const demand = computeSkillDemand([...pythonJobs, ...rest]);
  check('frequency uses real counts', demand.total, 50);
  const python = demand.skills.find((s) => s.skill === 'Python');
  check('Python 39/50 → 78%', python.percent, 78);
  check('Python count is 39', python.count, 39);
}

{
  const empty = computeSkillDemand([]);
  check('empty market has total 0', empty.total, 0);
  check('empty market invents no skill rows', empty.skills.length, 0);
}

{
  const collected = {
    named: new Set(['Python', 'Git']),
    prose: new Set(['Python']),
    coursework: new Set(['SQL']),
    projects: new Set(['Pandas']),
    experience: new Set(),
    hasNamedSkills: true,
    hasAnyEvidence: true,
    projectCount: 1,
    experienceCount: 0,
    educationCount: 1,
  };
  const gaps = buildSkillGaps(
    [
      { skill: 'Python', category: 'Programming Languages', percent: 82, count: 41, total: 50, mandatoryCount: 20 },
      { skill: 'SQL', category: 'Programming Languages', percent: 61, count: 30, total: 50, mandatoryCount: 5 },
      { skill: 'PyTorch', category: 'Deep Learning', percent: 52, count: 26, total: 50, mandatoryCount: 8 },
      { skill: 'Git', category: 'Version Control', percent: 49, count: 24, total: 50, mandatoryCount: 2 },
      { skill: 'Docker', category: 'DevOps', percent: 20, count: 10, total: 50, mandatoryCount: 0 },
    ],
    collected
  );
  check('Python ALREADY HAVE', gaps.find((g) => g.skill === 'Python').status, STATUS.ALREADY_HAVE);
  check('SQL PARTIAL from coursework', gaps.find((g) => g.skill === 'SQL').status, STATUS.PARTIAL);
  check('PyTorch MISSING', gaps.find((g) => g.skill === 'PyTorch').status, STATUS.MISSING);
  check('Git ALREADY HAVE', gaps.find((g) => g.skill === 'Git').status, STATUS.ALREADY_HAVE);
  check('Docker MISSING', gaps.find((g) => g.skill === 'Docker').status, STATUS.MISSING);
  checkTrue('PyTorch missing at 52% is CRITICAL or HIGH', ['CRITICAL', 'HIGH'].includes(gaps.find((g) => g.skill === 'PyTorch').priority));
}

{
  const collected = collectProfileSkills({
    skills: { programming_languages: [], frameworks: [], ai_ml: [], databases: [], cloud: [], tools: [] },
    education: [{ degree: 'BS SE', coursework: ['Database Systems', 'AI', 'Probability'] }],
    projects: [],
    experience: { internships: [] },
  });
  checkTrue('Database Systems implies academic SQL', collected.coursework.has('SQL') || collected.academic.has('SQL'));
  checkTrue('AI coursework implies academic Machine Learning', collected.coursework.has('Machine Learning') || collected.academic.has('Machine Learning'));
  checkTrue('Probability coursework implies Statistics foundation', collected.coursework.has('Statistics') || collected.academic.has('Statistics') || collected.coursework.has('Probability'));
}

{
  const collected = collectProfileSkills({
    identity: { github: 'https://github.com/0xSamad' },
    skills: { programming_languages: [], frameworks: [], ai_ml: [], databases: [], cloud: [], tools: [] },
    education: [{ degree: 'BS SE', coursework: ['Programming', 'Database Systems', 'AI', 'Information and communication Technology'] }],
    projects: [],
    experience: { internships: [] },
  });
  checkTrue('Programming coursework implies academic Python', collected.coursework.has('Python') || collected.academic.has('Python'));
  checkTrue('GitHub URL is Git evidence, not a named expert skill', collected.prose.has('Git') && !collected.named.has('Git'));
  const gaps = buildSkillGaps(
    [
      { skill: 'Python', category: 'Programming Languages', percent: 80, count: 40, total: 50 },
      { skill: 'Git', category: 'Version Control', percent: 50, count: 25, total: 50 },
      { skill: 'SQL', category: 'Programming Languages', percent: 60, count: 30, total: 50 },
    ],
    collected
  );
  check('Python from Programming course is not MISSING', gaps.find((g) => g.skill === 'Python').status, STATUS.PARTIAL);
  check('Git from GitHub URL is not MISSING', gaps.find((g) => g.skill === 'Git').status, STATUS.PARTIAL);
  check('SQL from Database Systems is not MISSING', gaps.find((g) => g.skill === 'SQL').status, STATUS.PARTIAL);
  check('ICT course is not Communication skill', collected.academic.has('Communication'), false);
}

{
  check('AI Intern does not match Business Intern', titleMatchesFamily('Business Intern - AI', resolveRoleFamily('AI Intern')), false);
}

async function seedStore() {
  const store = new MemoryOpportunityStore();
  const rows = [
    {
      title: 'AI Intern',
      company: 'Careem',
      url: 'https://boards.greenhouse.io/careem/jobs/ai-1',
      location: 'Lahore, Pakistan',
      description: 'Required: Python, SQL, Git. Machine learning with Pandas.',
      source_name: 'greenhouse',
      source_id: 'ai-1',
    },
    {
      title: 'Machine Learning Intern',
      company: '10Pearls',
      url: 'https://jobs.lever.co/10pearls/ml-1',
      location: 'Karachi, Pakistan',
      description: 'Must have Python and scikit-learn. Git required.',
      source_name: 'lever',
      source_id: 'ml-1',
    },
    {
      title: 'Artificial Intelligence Intern',
      company: 'Systems Limited',
      url: 'https://example.com/jobs/ai-pk',
      location: 'Islamabad, Pakistan',
      description: 'Python, SQL, Git, Pandas.',
      source_name: 'careers-page',
      source_id: 'ai-pk',
    },
    {
      title: 'AI Intern',
      company: 'Stripe',
      url: 'https://boards.greenhouse.io/stripe/jobs/ai-us',
      location: 'San Francisco, United States',
      country: 'United States',
      description: 'Required: Python, PyTorch, Docker, Git. SQL a plus.',
      source_name: 'greenhouse',
      source_id: 'ai-us',
    },
    {
      title: 'Artificial Intelligence Intern',
      company: 'DeepMind',
      url: 'https://boards.greenhouse.io/deepmind/jobs/ai-int-2',
      location: 'London, United Kingdom',
      country: 'United Kingdom',
      description: 'Python, Git, Machine Learning, SQL, LLMs.',
      source_name: 'greenhouse',
      source_id: 'ai-int-2',
    },
    {
      title: 'ML Intern',
      company: 'OpenAI',
      url: 'https://jobs.ashbyhq.com/openai/ml-int',
      location: 'London, United Kingdom',
      country: 'United Kingdom',
      description: 'Python, PyTorch, Machine Learning, SQL, Docker.',
      source_name: 'ashby',
      source_id: 'ml-int',
    },
    {
      title: 'Software Engineer',
      company: 'Acme',
      url: 'https://boards.greenhouse.io/acme/jobs/swe',
      location: 'Remote, United States',
      country: 'United States',
      description: 'JavaScript, React, Node.js. Unrelated to this analysis.',
      source_name: 'greenhouse',
      source_id: 'swe-1',
    },
    {
      title: 'Data Science Intern',
      company: 'Netsol',
      url: 'https://example.com/jobs/ds-int',
      location: 'Lahore, Pakistan',
      description: 'Python, SQL, Statistics, Pandas, Tableau.',
      source_name: 'careers-page',
      source_id: 'ds-1',
    },
    {
      title: 'Machine Learning Engineer',
      company: 'NVIDIA',
      url: 'https://nvidia.wd5.myworkdayjobs.com/ml-eng',
      location: 'Santa Clara, United States',
      country: 'United States',
      description: 'Required: Python, PyTorch, Docker, Kubernetes, SQL.',
      source_name: 'workday',
      source_id: 'mle-1',
    },
  ];
  for (const r of rows) await store.upsert(r);
  return store;
}

const profile = {
  identity: { name: 'Test Student', city: 'Peshawar', country: 'Pakistan' },
  skills: {
    programming_languages: ['Python', 'JavaScript'],
    frameworks: [],
    ai_ml: [],
    databases: [],
    cloud: [],
    tools: ['Git'],
  },
  education: [{ degree: 'BS Software Engineering', major: 'Software Engineering', coursework: ['Database Systems'] }],
  experience: { internships: [], jobs: [] },
  projects: [{ name: 'Classifier', description: 'Pandas notebook', technologies: ['Python', 'Pandas'] }],
};

{
  const store = await seedStore();
  const { result } = await analyzeRoleReadiness({
    role: 'AI Intern',
    marketScope: 'ALL',
    profile,
    cvText: 'Python, Git, Pandas. Peshawar, Pakistan.',
    opportunityStore: store,
    allowNetwork: false,
    forceRefresh: true,
  });
  checkTrue('AI Intern analysis has postings', result.metadata.postingCount >= 4);
  check('Software Engineer posting excluded from AI Intern', result.analyzedJobs.some((j) => /software engineer/i.test(j.jobTitle)), false);
  checkTrue('Pakistan split present', result.pakistan.postingCount >= 1);
  checkTrue('International split present', result.international.postingCount >= 1);
  const py = result.skillDemand.find((s) => s.skill === 'Python');
  checkTrue('Python demand is from analyzed jobs', Boolean(py) && py.count <= result.metadata.postingCount);
  checkTrue('sample quality names the posting count', /Analysis is based on \d+ posting/.test(result.metadata.sampleQuality.message));
  checkTrue('readiness is 0–100', result.readinessScore.score >= 0 && result.readinessScore.score <= 100);
  checkTrue('readiness explains it is not match score', /not the per-job match score/i.test(result.readinessScore.explanation));
  check('Python already have', result.skillGaps.find((g) => g.skill === 'Python')?.status, 'ALREADY HAVE');
  checkTrue('Pakistan match is measured or null, not invented empty-market 0', result.pakistanMatch.percent == null || result.pakistanMatch.percent >= 0);
  checkTrue('International match present when international jobs exist', result.internationalMatch.percent != null);
}

{
  const store = await seedStore();
  const { result } = await analyzeRoleReadiness({
    role: 'ML Intern',
    marketScope: 'ALL',
    profile,
    opportunityStore: store,
    allowNetwork: false,
    forceRefresh: true,
  });
  checkTrue('ML Intern uses ML-family titles', result.analyzedJobs.every((j) => /ml|machine learning/i.test(j.jobTitle)));
}

{
  const store = await seedStore();
  const { result } = await analyzeRoleReadiness({
    role: 'Data Science Intern',
    marketScope: 'PAKISTAN',
    profile,
    opportunityStore: store,
    allowNetwork: false,
    forceRefresh: true,
  });
  checkTrue('DS Intern found the Pakistan DS posting', result.analyzedJobs.some((j) => /data science/i.test(j.jobTitle)));
  check('DS Intern does not include Software Engineer', result.analyzedJobs.some((j) => /software engineer/i.test(j.jobTitle)), false);
}

{
  const store = await seedStore();
  const { result } = await analyzeRoleReadiness({
    role: 'ML Engineer',
    marketScope: 'ALL',
    profile,
    opportunityStore: store,
    allowNetwork: false,
    forceRefresh: true,
  });
  checkTrue('ML Engineer found NVIDIA posting', result.analyzedJobs.some((j) => /machine learning engineer/i.test(j.jobTitle)));
  check('ML Engineer does not include ML Intern', result.analyzedJobs.some((j) => /intern/i.test(j.jobTitle)), false);
}

{
  const family = resolveRoleFamily('AI Intern');
  const result = buildAnalysisResult({
    family,
    rawRole: 'AI Intern',
    marketScope: 'ALL',
    snapshot: {
      searchedTitles: family.titles,
      postings: [
        { jobTitle: 'AI Intern', company: 'A', market: 'PAKISTAN', url: 'https://a.example/1', skills: ['Python'], source: 'greenhouse' },
        { jobTitle: 'AI Intern', company: 'B', market: 'PAKISTAN', url: 'https://b.example/2', skills: ['Python'], source: 'lever' },
        { jobTitle: 'AI Intern', company: 'C', market: 'INTERNATIONAL', url: 'https://c.example/3', skills: ['Python'], source: 'ashby' },
      ],
      pakistanCount: 2,
      internationalCount: 1,
      unknownCount: 0,
      postingCount: 3,
      researchedAt: new Date().toISOString(),
      sources: ['greenhouse'],
      unavailableSources: [],
    },
    profile,
    cvText: 'Python',
  });
  checkTrue('low sample sets a warning', result.metadata.sampleQuality.warning === true);
  checkTrue('low sample does not claim industry-wide', !/industry-wide/i.test(result.metadata.sampleQuality.message));
}

{
  const family = resolveRoleFamily('AI Intern');
  const result = buildAnalysisResult({
    family,
    rawRole: 'AI Intern',
    marketScope: 'ALL',
    snapshot: {
      searchedTitles: family.titles,
      postings: [],
      pakistanCount: 0,
      internationalCount: 0,
      unknownCount: 0,
      postingCount: 0,
      researchedAt: new Date().toISOString(),
      sources: [],
      unavailableSources: [{ source: 'adzuna', reason: 'not configured' }],
    },
    profile,
  });
  checkTrue('no postings still scores against the role baseline', result.readinessScore.score != null && result.readinessScore.score >= 0 && result.readinessScore.score <= 100);
  checkTrue('records unavailable sources', result.metadata.unavailableSources.length >= 1);
}

{
  const family = { canonical: 'AI Intern' };
  const inflated = computeReadiness({
    family,
    postingCount: 83,
    collected: {
      projectCount: 8,
      experienceCount: 1,
      named: new Set(['Python', 'Pandas', 'NumPy', 'Git', 'SQL']),
      projects: new Set(['Python', 'Pandas']),
      experience: new Set(),
    },
    gaps: [
      { skill: 'Python', status: STATUS.ALREADY_HAVE, importance: 'CORE' },
      { skill: 'Machine Learning', status: STATUS.PARTIAL, importance: 'CORE' },
      { skill: 'Pandas', status: STATUS.ALREADY_HAVE, importance: 'CORE' },
      { skill: 'NumPy', status: STATUS.ALREADY_HAVE, importance: 'CORE' },
      { skill: 'Git', status: STATUS.ALREADY_HAVE, importance: 'CORE' },
      { skill: 'Deep Learning', status: STATUS.PARTIAL, importance: 'HIGH-VALUE' },
      { skill: 'Docker', status: STATUS.MISSING, importance: 'HIGH-VALUE' },
      { skill: 'FastAPI', status: STATUS.MISSING, importance: 'HIGH-VALUE' },
      { skill: 'PyTorch', status: STATUS.MISSING, importance: 'HIGH-VALUE' },
      { skill: 'TensorFlow', status: STATUS.MISSING, importance: 'HIGH-VALUE' },
      { skill: 'AWS', status: STATUS.MISSING, importance: 'HIGH-VALUE' },
      { skill: 'Statistics', status: STATUS.PARTIAL, importance: 'COMMON' },
      { skill: 'scikit-learn', status: STATUS.MISSING, importance: 'COMMON' },
      { skill: 'SQL', status: STATUS.ALREADY_HAVE, importance: 'COMMON' },
    ],
  });
  checkTrue('partial ML + no deploy does not score intern-ready (was ~73)', inflated.score <= 54);
  checkTrue('portfolio is not 100 from listing 8 projects', (inflated.components.portfolio?.percent || 0) < 80);
  checkTrue('experience is not 80 for unrelated work', (inflated.components.experience?.percent || 0) < 50);
}

{
  const mixed = [
    { skills: ['Linux', 'Nmap'] },
    { skills: ['Linux'] },
    { skills: [] },
  ];
  const demand = computeSkillDemand(mixed);
  check('frequency denominator is all analyzed postings', demand.total, 3);
  check('Linux 2/3 even when one posting has no skills', demand.skills.find((s) => s.skill === 'Linux').count, 2);
  check('Linux percent is 66.7 of 3', demand.skills.find((s) => s.skill === 'Linux').percent, 66.7);
}

{
  const roles = [
    ['AI Intern', 'ai-intern', 'ai_ml', 'internship', 'internships'],
    ['ML Intern', 'ml-intern', 'ai_ml', 'internship', 'internships'],
    ['Data Science Intern', 'data-science-intern', 'data_science', 'internship', 'internships'],
    ['Cybersecurity Intern', 'cybersecurity-intern', 'cybersecurity', 'internship', 'internships'],
    ['Cybersecurity Specialist', 'cybersecurity-specialist', 'cybersecurity', 'job', 'jobs'],
    ['SOC Analyst', 'soc-analyst', 'cybersecurity', 'job', 'jobs'],
    ['Junior Penetration Tester', 'penetration-tester', 'cybersecurity', 'job', 'jobs'],
    ['AI Engineer', 'ai-engineer', 'ai_ml', 'job', 'jobs'],
    ['ML Engineer', 'ml-engineer', 'ai_ml', 'job', 'jobs'],
    ['Data Scientist', 'data-scientist', 'data_science', 'job', 'jobs'],
    ['Software Engineering Intern', 'software-engineering-intern', 'software', 'internship', 'internships'],
    ['Software Engineer', 'software-engineer', 'software', 'job', 'jobs'],
  ];
  for (const [query, id, domain, emp, search] of roles) {
    const n = normalizeRole(query);
    check(`${query} family id`, n.family_id, id);
    check(`${query} domain`, n.domain, domain);
    check(`${query} employment_type`, n.employment_type, emp === 'internship' ? 'Internship' : 'Job');
    check(`${query} search_type`, n.search_type, search);
  }
}

{
  const internBase = baselineFor(resolveRoleFamily('AI Intern'));
  const mlInternBase = baselineFor(resolveRoleFamily('ML Intern'));
  const aiEng = baselineFor(resolveRoleFamily('AI Engineer'));
  const mlEng = baselineFor(resolveRoleFamily('ML Engineer'));
  const dsIntern = baselineFor(resolveRoleFamily('Data Science Intern'));
  const ds = baselineFor(resolveRoleFamily('Data Scientist'));
  check('AI Intern baseline is not ML Intern copy', internBase.core.join('|') === mlInternBase.core.join('|'), false);
  check('AI Engineer baseline is not ML Engineer copy', aiEng.core.join('|') === mlEng.core.join('|'), false);
  check('DS Intern baseline is not Data Scientist copy', dsIntern.common.join('|') === ds.common.join('|') && dsIntern.highValue.join('|') === ds.highValue.join('|'), false);
  checkTrue('ML Intern core includes scikit-learn', mlInternBase.core.includes('scikit-learn'));
  checkTrue('AI Engineer core includes FastAPI', aiEng.core.includes('FastAPI'));
}

{
  const family = resolveRoleFamily('AI Intern');
  const gaps = [
    { skill: 'Python', status: STATUS.ALREADY_HAVE, importance: 'CORE' },
    { skill: 'Machine Learning', status: STATUS.ALREADY_HAVE, importance: 'CORE' },
    { skill: 'Pandas', status: STATUS.ALREADY_HAVE, importance: 'CORE' },
    { skill: 'Git', status: STATUS.ALREADY_HAVE, importance: 'CORE' },
    { skill: 'SQL', status: STATUS.MISSING, importance: 'COMMON' },
  ];
  const { computeSkillReadiness } = await import(pathToFileURL(join(ROOT, 'lib/saas/role-analyzer/readiness-score.mjs')).href);
  const ready = computeSkillReadiness({ gaps, family });
  check('4 of 5 core+foundation skills full → 80% skill readiness', ready.score, 80);
  check('skill readiness uses count/total', `${ready.have}/${ready.total}`, '4/5');
}

{
  const intern = resolveRoleFamily('Cybersecurity Intern');
  const spec = resolveRoleFamily('Cybersecurity Specialist');
  const soc = resolveRoleFamily('SOC Analyst');
  const pentest = resolveRoleFamily('Junior Penetration Tester');
  check('intern is not specialist', intern.id === spec.id, false);
  check('SOC is not pentest', soc.id === pentest.id, false);
  check('intern title does not match specialist family', titleMatchesFamily('Cybersecurity Intern', spec), false);
  check('specialist title does not match intern family', titleMatchesFamily('Cybersecurity Specialist', intern), false);
  check('SOC intern is not a SOC Analyst job', titleMatchesFamily('SOC Intern', soc), false);
  checkTrue('SOC Analyst matches SOC Analyst', titleMatchesFamily('Junior SOC Analyst', soc));
  checkTrue('Junior Pentester matches pentest family', titleMatchesFamily('Junior Penetration Tester', pentest));
}

{
  const cyberBase = baselineFor(resolveRoleFamily('Cybersecurity Intern'));
  const specBase = baselineFor(resolveRoleFamily('Cybersecurity Specialist'));
  const aiBase = baselineFor(resolveRoleFamily('AI Intern'));
  check('cyber intern baseline is not AI/ML', cyberBase.core.includes('PyTorch') || cyberBase.core.includes('Machine Learning'), false);
  checkTrue('cyber intern core includes Linux', cyberBase.core.includes('Linux'));
  checkTrue('cyber intern core includes Networking', cyberBase.core.includes('Networking'));
  checkTrue('AI intern core includes Machine Learning', aiBase.core.includes('Machine Learning'));
  checkTrue('specialist core includes Security Fundamentals', specBase.core.includes('Security Fundamentals'));
  check('specialist is not intern baseline copy', specBase.target === cyberBase.target, false);
}

{
  const socCore = baselineFor(resolveRoleFamily('SOC Analyst')).core;
  const pentestCore = baselineFor(resolveRoleFamily('Penetration Tester')).core;
  checkTrue('SOC core includes SIEM', socCore.includes('SIEM'));
  checkTrue('pentest core includes Burp or Web Security', pentestCore.includes('Web Security') || pentestCore.includes('Burp Suite'));
  check('SOC core is not pentest core', socCore.join('|') === pentestCore.join('|'), false);
}

{
  const skills = extractAnalyzerSkills('Required: Linux, Nmap, Wireshark, Burp Suite, SIEM, OWASP, incident response, Active Directory');
  checkTrue('Nmap extracted', skills.has('Nmap'));
  checkTrue('Burp Suite extracted', skills.has('Burp Suite'));
  checkTrue('SIEM extracted', skills.has('SIEM'));
  checkTrue('Incident Response extracted', skills.has('Incident Response'));
  checkTrue('Active Directory extracted', skills.has('Active Directory'));
}

{
  const family = resolveRoleFamily('Cybersecurity Specialist');
  const result = buildAnalysisResult({
    family,
    rawRole: 'Cybersecurity Specialist',
    marketScope: 'ALL',
    snapshot: {
      searchedTitles: family.titles,
      postings: [
        { jobTitle: 'Cybersecurity Specialist', company: 'A', market: 'PAKISTAN', url: 'https://a.example/c1', skills: ['Linux', 'SIEM'], source: 'greenhouse' },
        { jobTitle: 'Cybersecurity Specialist', company: 'B', market: 'INTERNATIONAL', url: 'https://b.example/c2', skills: ['Linux', 'Networking'], source: 'lever' },
      ],
      pakistanCount: 1,
      internationalCount: 1,
      unknownCount: 0,
      postingCount: 2,
      researchedAt: new Date().toISOString(),
      sources: ['greenhouse'],
      unavailableSources: [],
    },
    profile,
    cvText: 'Python, Git',
  });
  check('specialist search_type is jobs', result.search_type, 'jobs');
  check('specialist domain is cybersecurity', result.domain, 'cybersecurity');
  check('specialist total_postings matches analyzed jobs', result.total_postings, 2);
  check('Pakistan postings not mixed into international count', result.international_postings, 1);
  const ml = (result.skillDemand || []).filter((s) => ['PyTorch', 'Machine Learning', 'scikit-learn', 'Pandas'].includes(s.skill) && s.source === 'ROLE_BASELINE');
  check('specialist baseline does not inject ML stack', ml.length, 0);
  checkTrue('Linux frequency uses posting denominator', result.skillDemand.find((s) => s.skill === 'Linux')?.total === 2);
  checkTrue('three scores present', Boolean(result.readiness_score && result.market_match_score && result.job_competitiveness_score));
  const linuxGap = result.skillGaps.find((g) => g.skill === 'Linux');
  check('Linux not in profile is NO EVIDENCE', linuxGap?.evidenceLevel, EVIDENCE_LEVEL.NONE);
  check('missing skill note', linuxGap?.evidenceNote, 'Not found in profile');
}

{
  const internFamily = resolveRoleFamily('Cybersecurity Intern');
  const specFamily = resolveRoleFamily('Cybersecurity Specialist');
  const emptyCollected = {
    named: new Set(),
    projects: new Set(),
    coursework: new Set(),
    projectCount: 0,
    experienceCount: 0,
  };
  const internProjects = selectProjects({
    family: internFamily,
    skillDemand: [{ skill: 'Linux' }],
    enrichedGaps: [
      { skill: 'Linux', status: STATUS.MISSING, importance: 'CORE' },
      { skill: 'Networking', status: STATUS.MISSING, importance: 'CORE' },
    ],
    collected: emptyCollected,
  });
  const specProjects = selectProjects({
    family: specFamily,
    skillDemand: [{ skill: 'Linux' }, { skill: 'SIEM' }],
    enrichedGaps: [
      { skill: 'Linux', status: STATUS.MISSING, importance: 'CORE' },
      { skill: 'SIEM', status: STATUS.MISSING, importance: 'COMMON' },
    ],
    collected: emptyCollected,
  });
  check('cyber intern does not get churn ML project', internProjects.some((p) => /churn|pytorch|sklearn|predict/i.test(p.title + p.id)), false);
  check('cyber specialist does not get ML project', specProjects.some((p) => /churn|pytorch|sklearn|predict/i.test(p.title + p.id)), false);
  checkTrue('cyber intern gets a lab/write-up', internProjects.some((p) => /lab|write-up|writeup|linux/i.test(p.id + p.title)));
}

{
  const store = await seedStore();
  await store.upsert({
    title: 'Cybersecurity Intern',
    company: 'Truely',
    url: 'https://example.com/jobs/cyber-intern',
    location: 'Karachi, Pakistan',
    description: 'Linux, networking, Git. Basic security concepts. Wireshark a plus.',
    source_name: 'careers-page',
    source_id: 'cyber-int-1',
  });
  await store.upsert({
    title: 'Cybersecurity Specialist',
    company: 'Systems Limited',
    url: 'https://example.com/jobs/cyber-spec',
    location: 'Lahore, Pakistan',
    description: 'SIEM, incident response, Linux, vulnerability assessment, cloud security.',
    source_name: 'careers-page',
    source_id: 'cyber-spec-1',
  });
  const intern = await analyzeRoleReadiness({
    role: 'Cybersecurity Intern',
    marketScope: 'ALL',
    profile,
    opportunityStore: store,
    allowNetwork: false,
    forceRefresh: true,
  });
  const spec = await analyzeRoleReadiness({
    role: 'Cybersecurity Specialist',
    marketScope: 'ALL',
    profile,
    opportunityStore: store,
    allowNetwork: false,
    forceRefresh: true,
  });
  check('intern analysis does not include specialist jobs', intern.result.analyzedJobs.some((j) => /specialist/i.test(j.jobTitle)), false);
  check('specialist analysis does not include intern jobs', spec.result.analyzedJobs.some((j) => /intern/i.test(j.jobTitle)), false);
  checkTrue('intern found intern posting', intern.result.analyzedJobs.some((j) => /intern/i.test(j.jobTitle)));
  checkTrue('specialist found specialist posting', spec.result.analyzedJobs.some((j) => /specialist/i.test(j.jobTitle)));
}

{
  const internPhases = analysisPhasesFor(resolveRoleFamily('Cybersecurity Intern'));
  const jobPhases = analysisPhasesFor(resolveRoleFamily('Cybersecurity Specialist'));
  checkTrue('intern pipeline says Searching internships', internPhases[0].label === 'Searching internships');
  checkTrue('specialist pipeline says Searching jobs', jobPhases[0].label === 'Searching jobs');
  check('AI Intern search noun', searchNounFor(resolveRoleFamily('AI Intern')), 'internships');
  check('AI Engineer search noun', searchNounFor(resolveRoleFamily('AI Engineer')), 'jobs');
}

{
  const twelve = [
    'Cybersecurity Intern',
    'Cybersecurity Specialist',
    'SOC Analyst',
    'Junior Penetration Tester',
    'AI Intern',
    'AI Engineer',
    'ML Intern',
    'ML Engineer',
    'Data Science Intern',
    'Data Scientist',
    'Software Engineering Intern',
    'Software Engineer',
  ];
  const fingerprints = twelve.map((query) => {
    const family = resolveRoleFamily(query);
    const base = baselineFor(family);
    const projects = selectProjects({
      family,
      skillDemand: base.core.map((skill) => ({ skill })),
      enrichedGaps: [...base.core, ...base.common].map((skill) => ({ skill, status: STATUS.MISSING, importance: 'CORE' })),
      collected: { named: new Set(), projects: new Set(), coursework: new Set(), projectCount: 0, experienceCount: 0 },
    });
    return {
      query,
      id: family.id,
      search: family.searchType,
      titles: searchedTitlesFor(family).join('|'),
      core: base.core.join('|'),
      projects: projects.map((p) => p.id).join('|'),
    };
  });
  check('12 roles resolve to 12 family ids', new Set(fingerprints.map((f) => f.id)).size, 12);
  const intern = fingerprints.find((f) => f.query === 'Cybersecurity Intern');
  const spec = fingerprints.find((f) => f.query === 'Cybersecurity Specialist');
  const aiI = fingerprints.find((f) => f.query === 'AI Intern');
  const aiE = fingerprints.find((f) => f.query === 'AI Engineer');
  const mlI = fingerprints.find((f) => f.query === 'ML Intern');
  const mlE = fingerprints.find((f) => f.query === 'ML Engineer');
  const dsI = fingerprints.find((f) => f.query === 'Data Science Intern');
  const ds = fingerprints.find((f) => f.query === 'Data Scientist');
  check('cyber intern search ≠ specialist search', intern.titles === spec.titles, false);
  check('AI intern search ≠ AI engineer search', aiI.titles === aiE.titles, false);
  check('ML intern search ≠ ML engineer search', mlI.titles === mlE.titles, false);
  check('DS intern search ≠ data scientist search', dsI.titles === ds.titles, false);
  check('AI intern search ≠ ML intern search', aiI.titles === mlI.titles, false);
  check('cyber intern core ≠ specialist core', intern.core === spec.core, false);
  check('cyber intern common path is internships', intern.search, 'internships');
  check('cyber specialist search is jobs', spec.search, 'jobs');
  check('AI intern core ≠ AI engineer core', aiI.core === aiE.core, false);
  check('ML intern core ≠ ML engineer core', mlI.core === mlE.core, false);
  check('cyber projects are not ML', /churn|pytorch|sklearn|predict|classical-ml/.test(intern.projects + spec.projects), false);
  check('AI projects are not Burp/SIEM', /burp|siem|homelab|pentest|soc-detection/.test(aiI.projects + aiE.projects), false);
  checkTrue('software intern gets a software project', fingerprints.find((f) => f.query === 'Software Engineering Intern').projects.includes('rest-api-service'));
}

{
  const family = resolveRoleFamily('Cybersecurity Specialist');
  const result = buildAnalysisResult({
    family,
    rawRole: 'Cybersecurity Specialist',
    marketScope: 'ALL',
    snapshot: {
      searchedTitles: family.titles,
      postings: [
        { jobTitle: 'Cybersecurity Specialist', company: 'A', market: 'PAKISTAN', url: 'javascript:alert(1)', skills: ['Linux', 'PyTorch', 'SIEM'], source: 'greenhouse' },
        { jobTitle: 'Cybersecurity Specialist', company: 'B', market: 'INTERNATIONAL', url: 'https://b.example/c2', skills: ['Linux', 'Networking'], source: 'lever' },
        { jobTitle: 'Cybersecurity Specialist', company: 'C', market: 'UNKNOWN', url: 'https://c.example/c3', skills: ['Linux'], source: 'ashby' },
      ],
      pakistanCount: 99,
      internationalCount: 99,
      unknownCount: 99,
      postingCount: 99,
      researchedAt: new Date().toISOString(),
      sources: ['greenhouse'],
      unavailableSources: [],
    },
    profile,
    cvText: 'Python, Git',
  });
  check('posting count equals unique analyzed jobs', result.total_postings, 3);
  check('analyzedJobs length matches total', result.analyzedJobs.length, 3);
  check('pk + intl + unknown = total', result.pakistan_postings + result.international_postings + result.unknown_postings, 3);
  check('stale snapshot counts are not used', result.pakistan_postings, 1);
  check('PyTorch does not leak into cyber demand', (result.skillDemand || []).some((s) => s.skill === 'PyTorch'), false);
  const linux = result.skillDemand.find((s) => s.skill === 'Linux');
  check('Linux 3/3 = 100%', linux?.percent, 100);
  check('Linux count/total displayed', linux?.count === 3 && linux?.total === 3, true);
}


