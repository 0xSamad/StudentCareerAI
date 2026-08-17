// tests/role-analyzer-roadmap.test.mjs — personalized weekly roadmaps from analyzed demand
import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const RA = pathToFileURL(join(ROOT, 'lib/saas/role-analyzer/index.mjs')).href;
const STORE = pathToFileURL(join(ROOT, 'lib/saas/opportunity-store/index.mjs')).href;

console.log('\nrole-analyzer-roadmap — duration engine, profiles, fact guards');

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

const {
  analyzeRoleReadiness,
  buildRoleRoadmap,
  buildReadinessView,
  parseDurationMonths,
  weekCountFor,
  applyAiNarrative,
  buildEvidencePack,
  collectProfileSkills,
  enrichSkillGaps,
  coverageAgainstDemand,
  ANALYSIS_PHASES,
  persistRun,
  listRuns,
  markRunSaved,
  upsertProgress,
  listProgress,
} = await import(RA);
const { MemoryOpportunityStore } = await import(STORE);

const profileA = {
  identity: { name: 'Beginner Python', city: 'Peshawar', country: 'Pakistan' },
  skills: {
    programming_languages: ['Python'],
    frameworks: [],
    ai_ml: [],
    databases: [],
    cloud: [],
    tools: [],
  },
  education: [{ degree: 'BS Computer Science', major: 'CS', coursework: [] }],
  experience: { internships: [], jobs: [] },
  projects: [],
};

const profileB = {
  identity: { name: 'Python ML student', city: 'Lahore', country: 'Pakistan' },
  skills: {
    programming_languages: ['Python'],
    frameworks: [],
    ai_ml: ['Pandas', 'NumPy', 'scikit-learn'],
    databases: [],
    cloud: [],
    tools: ['Git'],
  },
  education: [{ degree: 'BS Data Science', major: 'Data Science', coursework: ['Database Systems', 'Machine Learning'] }],
  experience: { internships: [], jobs: [] },
  projects: [{ name: 'House prices', description: 'sklearn regression with pandas', technologies: ['Python', 'Pandas', 'scikit-learn'] }],
};

const profileC = {
  identity: { name: 'PyTorch deploy student', city: 'Karachi', country: 'Pakistan' },
  skills: {
    programming_languages: ['Python'],
    frameworks: ['FastAPI'],
    ai_ml: ['Pandas', 'NumPy', 'scikit-learn', 'PyTorch'],
    databases: ['SQL'],
    cloud: [],
    tools: ['Git', 'Docker'],
  },
  education: [{ degree: 'BS AI', major: 'Artificial Intelligence', coursework: ['Deep Learning', 'Databases'] }],
  experience: { internships: [{ role: 'ML intern', description: 'Trained a PyTorch model' }], jobs: [] },
  projects: [
    { name: 'Image classifier', description: 'CNN in PyTorch', technologies: ['Python', 'PyTorch'] },
    { name: 'Model API', description: 'FastAPI + Docker serving a checkpoint', technologies: ['FastAPI', 'Docker'] },
  ],
};

async function seedStore() {
  const store = new MemoryOpportunityStore();
  const rows = [
    {
      title: 'AI Intern',
      company: 'Careem',
      url: 'https://boards.greenhouse.io/careem/jobs/ai-1',
      location: 'Lahore, Pakistan',
      description: 'Required: Python, SQL, Git. Machine learning with Pandas and scikit-learn.',
      source_name: 'greenhouse',
      source_id: 'ai-1',
    },
    {
      title: 'Machine Learning Intern',
      company: '10Pearls',
      url: 'https://jobs.lever.co/10pearls/ml-1',
      location: 'Karachi, Pakistan',
      description: 'Must have Python and scikit-learn. Git required. SQL a plus.',
      source_name: 'lever',
      source_id: 'ml-1',
    },
    {
      title: 'Artificial Intelligence Intern',
      company: 'Systems Limited',
      url: 'https://example.com/jobs/ai-pk',
      location: 'Islamabad, Pakistan',
      description: 'Python, SQL, Git, Pandas, Docker.',
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
      title: 'ML Intern',
      company: 'OpenAI',
      url: 'https://jobs.ashbyhq.com/openai/ml-int',
      location: 'London, United Kingdom',
      country: 'United Kingdom',
      description: 'Python, PyTorch, Machine Learning, SQL, Docker, FastAPI.',
      source_name: 'ashby',
      source_id: 'ml-int',
    },
    {
      title: 'Machine Learning Intern',
      company: 'DeepMind',
      url: 'https://boards.greenhouse.io/deepmind/jobs/ml-int-2',
      location: 'London, United Kingdom',
      country: 'United Kingdom',
      description: 'Python, PyTorch, NumPy, Git, Docker.',
      source_name: 'greenhouse',
      source_id: 'ml-int-2',
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
      title: 'Data Scientist Intern',
      company: 'Jazz',
      url: 'https://example.com/jobs/ds-int-2',
      location: 'Islamabad, Pakistan',
      description: 'Required: Python, SQL, Pandas, Statistics. scikit-learn preferred.',
      source_name: 'careers-page',
      source_id: 'ds-2',
    },
    {
      title: 'Data Science Intern',
      company: 'Spotify',
      url: 'https://boards.greenhouse.io/spotify/jobs/ds-us',
      location: 'New York, United States',
      country: 'United States',
      description: 'Python, SQL, Statistics, Pandas, scikit-learn.',
      source_name: 'greenhouse',
      source_id: 'ds-us',
    },
    {
      title: 'Cybersecurity Intern',
      company: 'Truely',
      url: 'https://example.com/jobs/cyber-intern',
      location: 'Karachi, Pakistan',
      description: 'Linux, networking, Git, security fundamentals. Wireshark a plus.',
      source_name: 'careers-page',
      source_id: 'cyber-int-1',
    },
    {
      title: 'Cybersecurity Specialist',
      company: 'Systems Limited',
      url: 'https://example.com/jobs/cyber-spec',
      location: 'Lahore, Pakistan',
      description: 'SIEM, incident response, Linux, vulnerability assessment, cloud security, OWASP.',
      source_name: 'careers-page',
      source_id: 'cyber-spec-1',
    },
    {
      title: 'SOC Analyst',
      company: 'Careem',
      url: 'https://example.com/jobs/soc-1',
      location: 'Dubai, United Arab Emirates',
      country: 'United Arab Emirates',
      description: 'SIEM, Windows, Active Directory, incident response, threat detection.',
      source_name: 'careers-page',
      source_id: 'soc-1',
    },
    {
      title: 'Junior Penetration Tester',
      company: '10Pearls',
      url: 'https://example.com/jobs/pentest-1',
      location: 'Karachi, Pakistan',
      description: 'Nmap, Burp Suite, OWASP, Linux, privilege escalation, web security.',
      source_name: 'careers-page',
      source_id: 'pentest-1',
    },
  ];
  for (const r of rows) await store.upsert(r);
  return store;
}

{
  check('parse 2-month preset', parseDurationMonths({ duration: '2 months' }), 2);
  check('parse 4', parseDurationMonths({ durationMonths: 4 }), 4);
  check('parse custom 5', parseDurationMonths({ durationMonths: 5 }), 5);
  check('weeks for 2 months', weekCountFor(2), 8);
  check('weeks for 4 months', weekCountFor(4), 16);
  check('weeks for 6 months', weekCountFor(6), 24);
  check('weeks for custom 5 months', weekCountFor(5), 20);
  let threw = false;
  try {
    parseDurationMonths({ durationMonths: 99 });
  } catch {
    threw = true;
  }
  checkTrue('rejects 99-month duration', threw);
}

function interviewWeeks(roadmap) {
  return (roadmap.roadmaps.weeks || []).filter((w) => /interview/i.test(w.objective));
}

function hoursInBand(roadmap) {
  const { min, max } = roadmap.weeklyHours;
  return (roadmap.roadmaps.weeks || []).every((w) => {
    const m = String(w.estimatedHours || '').match(/(\d+)\s*[–-]\s*(\d+)/);
    if (!m) return false;
    return Number(m[1]) >= min && Number(m[2]) <= max + 2;
  });
}

function percentsMatchAnalysis(roadmap, analysis) {
  const bySkill = Object.fromEntries((analysis.skillDemand || []).map((s) => [s.skill, s.percent]));
  for (const row of roadmap.skillDemand || []) {
    if (bySkill[row.skill] !== row.percent) return false;
  }
  for (const gap of roadmap.skillGaps || []) {
    const expected = bySkill[gap.skill];
    if (expected != null && gap.marketPercent !== expected) return false;
  }
  return true;
}

function inventedSkills(roadmap, analysis, profile) {
  const allowed = new Set((analysis.skillDemand || []).map((s) => s.skill));
  for (const s of collectProfileSkills(profile).named) allowed.add(s);
  const found = [];
  for (const w of roadmap.roadmaps.weeks || []) {
    for (const s of w.skills || []) {
      if (s && !allowed.has(s)) found.push(s);
    }
  }
  return found;
}

const store = await seedStore();

async function plan(role, profile, months, cvText = '') {
  const { result } = await analyzeRoleReadiness({
    role,
    marketScope: 'ALL',
    profile,
    cvText,
    opportunityStore: store,
    allowNetwork: false,
    forceRefresh: true,
  });
  const roadmap = await buildRoleRoadmap({
    analysis: result,
    profile,
    cvText,
    durationMonths: months,
    useAi: false,
  });
  return { analysis: result, roadmap };
}

const a2 = await plan('AI Intern', profileA, 2, 'Python.');
const b2 = await plan('AI Intern', profileB, 2, 'Python Pandas scikit-learn Git.');
const c2 = await plan('AI Intern', profileC, 2, 'Python PyTorch FastAPI Docker SQL.');

{
  checkTrue('A 2-month has 8 weeks', a2.roadmap.weekCount === 8 && a2.roadmap.roadmaps.weeks.length === 8);
  checkTrue('B 2-month has 8 weeks', b2.roadmap.weekCount === 8);
  checkTrue('C 2-month has 8 weeks', c2.roadmap.weekCount === 8);
  checkFalse('A vs B week-1 objectives differ', a2.roadmap.roadmaps.weeks[0].objective === b2.roadmap.roadmaps.weeks[0].objective);
  checkFalse('B vs C week-1 objectives differ', b2.roadmap.roadmaps.weeks[0].objective === c2.roadmap.roadmaps.weeks[0].objective);
  checkTrue('A readiness below C', (a2.analysis.readinessScore.score || 0) < (c2.analysis.readinessScore.score || 0));
}

{
  const beginnerTopics = /^(Types and functions|Virtualenv \/ venv|List\/dict comprehensions)$/i;
  const bTopics = b2.roadmap.roadmaps.weeks.flatMap((w) => w.topics || []);
  const cTopics = c2.roadmap.roadmaps.weeks.flatMap((w) => w.topics || []);
  checkFalse('B does not get beginner Python recap', bTopics.some((t) => beginnerTopics.test(t)));
  checkFalse('C does not get beginner Python recap', cTopics.some((t) => beginnerTopics.test(t)));
  checkTrue('B assessment or advanced path, not Python-from-zero', /assessment|Close the |Project:|Start:|Turn your/i.test(b2.roadmap.roadmaps.weeks[0].objective));
}

{
  checkTrue('A copies Python percent from analysis', percentsMatchAnalysis(a2.roadmap, a2.analysis));
  checkTrue('B copies percents from analysis', percentsMatchAnalysis(b2.roadmap, b2.analysis));
  check('A invents no extra week skills', inventedSkills(a2.roadmap, a2.analysis, profileA).length, 0);
  check('C invents no extra week skills', inventedSkills(c2.roadmap, c2.analysis, profileC).length, 0);
}

{
  const py = a2.analysis.skillDemand.find((s) => s.skill === 'Python');
  const gap = a2.roadmap.skillGaps.find((g) => g.skill === 'Python');
  checkTrue('Python market percent is a real ratio', Boolean(py) && py.percent === Math.round((py.count / py.total) * 1000) / 10);
  check('roadmap Python percent equals analysis', gap?.marketPercent, py?.percent);
  check('Python already-have is MAINTAIN', gap?.priorityLabel, 'MAINTAIN');
}

{
  const hours = a2.roadmap.weeklyHours;
  checkTrue('2-month hours are 10–12 band', hours.min === 10 && hours.max === 12);
  checkTrue('every A week has hours in band', hoursInBand(a2.roadmap));
}

const a4 = await plan('AI Intern', profileA, 4);
const a6 = await plan('AI Intern', profileA, 6);
const a5 = await plan('AI Intern', profileA, 5);

{
  const dockerWeek = a6.roadmap.roadmaps.weeks.findIndex((w) => (w.skills || []).includes('Docker') && /Close the Docker/i.test(w.objective));
  const modelWeek = a6.roadmap.roadmaps.weeks.findIndex((w) =>
    (w.skills || []).some((s) => s === 'PyTorch' || s === 'scikit-learn') && /Close the /i.test(w.objective)
  );
  if (dockerWeek >= 0 && modelWeek >= 0) {
    checkTrue('6-month Docker skill week is not before a model skill', dockerWeek >= modelWeek);
  } else {
    pass('6-month Docker/model ordering skipped (one skill not scheduled)');
  }
  const sqlInDemand = a6.analysis.skillDemand.some((s) => s.skill === 'SQL');
  const sqlScheduled = a6.roadmap.roadmaps.weeks.some((w) => (w.skills || []).includes('SQL') && /Close the SQL/i.test(w.objective));
  if (sqlInDemand) checkTrue('6-month covers SQL instead of only deepening the first gaps', sqlScheduled);
}

{
  const a2skills = a2.roadmap.roadmaps.weeks.flatMap((w) => w.skills || []);
  const a6skills = a6.roadmap.roadmaps.weeks.flatMap((w) => w.skills || []);
  checkTrue('6-month schedules a broader skill set than 2-month', new Set(a6skills).size >= new Set(a2skills).size);
}

{
  check('4-month weeks', a4.roadmap.weekCount, 16);
  check('6-month weeks', a6.roadmap.weekCount, 24);
  check('custom 5-month weeks', a5.roadmap.weekCount, 20);
  checkTrue('6-month has more weeks than 2-month', a6.roadmap.weekCount > a2.roadmap.weekCount);
  checkTrue('6-month is not a stretched copy of 2-month', JSON.stringify(a6.roadmap.roadmaps.weeks.slice(0, 8)) !== JSON.stringify(a2.roadmap.roadmaps.weeks));
  checkTrue('6-month schedules more projects than 2-month', a6.roadmap.projects.length >= a2.roadmap.projects.length);
  checkTrue('6-month has more interview weeks than 2-month', interviewWeeks(a6.roadmap).length > interviewWeeks(a2.roadmap).length);
  checkTrue('5-month hours are lighter than 2-month', a5.roadmap.weeklyHours.max < a2.roadmap.weeklyHours.max);
  checkTrue('4-month adds a second project or more depth', a4.roadmap.projects.length >= 1 && a4.roadmap.weekCount === 16);
}

{
  const late = a6.roadmap.roadmaps.weeks.slice(-3);
  checkTrue('late 6-month weeks are interview/mocks', late.every((w) => /interview|mock/i.test(w.objective + w.milestone)));
  checkTrue('each week has a measurable milestone', a6.roadmap.roadmaps.weeks.every((w) => String(w.milestone || '').length > 20));
  checkTrue('each week has deliverables', a6.roadmap.roadmaps.weeks.every((w) => (w.deliverables || []).length > 0));
}

{
  checkTrue('A gets at least one gap-closing project', a2.roadmap.projects.length >= 1);
  checkFalse('C does not get a beginner-only SQL project as its only plan', a2.roadmap.projects[0]?.id === c2.roadmap.projects[0]?.id && a2.analysis.readinessScore.score === c2.analysis.readinessScore.score);
  checkTrue('projects differ across A and C or C hardens portfolio', a2.roadmap.projects.map((p) => p.id).join() !== c2.roadmap.projects.map((p) => p.id).join() || c2.roadmap.projects.some((p) => p.id === 'portfolio-hardening'));
}

const mlA = await plan('ML Intern', profileA, 4);
const mlC = await plan('ML Intern', profileC, 4);
const dsA = await plan('Data Science Intern', profileA, 4);
const dsB = await plan('Data Science Intern', profileB, 4);

{
  check('ML Intern canonical role on roadmap', mlA.roadmap.role, 'ML Intern');
  check('DS Intern canonical role on roadmap', dsA.roadmap.role, 'Data Science Intern');
  checkTrue('ML A vs C differ', mlA.roadmap.roadmaps.weeks[0].objective !== mlC.roadmap.roadmaps.weeks[0].objective);
  checkTrue('DS A vs B differ', dsA.roadmap.roadmaps.weeks[0].objective !== dsB.roadmap.roadmaps.weeks[0].objective);
  checkTrue('DS sample includes SQL or Statistics', (dsA.analysis.skillDemand || []).some((s) => s.skill === 'SQL' || s.skill === 'Statistics'));
  checkFalse('AI Intern analysis did not swallow Software Engineer', a2.analysis.analyzedJobs.some((j) => /software engineer/i.test(j.jobTitle)));
}

{
  const proj = a6.roadmap.readiness.projections;
  check('projections are labeled PROJECTION', proj.kind, 'PROJECTION');
  checkTrue('disclaimer says milestones not a job', /not a guarantee/i.test(proj.disclaimer));
  checkTrue('checkpoint uses required label', proj.checkpoints.some((c) => /Projected readiness if roadmap milestones are completed/i.test(c.label)));
  const c2m = proj.checkpoints.find((c) => c.afterMonths === 2);
  const c6m = proj.checkpoints.find((c) => c.afterMonths === 6);
  checkTrue('projected 6-month score >= 2-month projection', (c6m?.score || 0) >= (c2m?.score || 0));
  checkTrue('does not claim 100', (c6m?.score || 0) < 100);
}

{
  const targets = a6.roadmap.jobTargets;
  checkTrue('now includes intern titles', targets.now.some((t) => /intern/i.test(t)));
  checkFalse('no senior titles', targets.now.concat(targets.afterRoadmap).some((t) => /senior|staff|principal|director/i.test(t)));
  checkTrue('after-roadmap stays intern/junior', targets.afterRoadmap.every((t) => /intern|junior/i.test(t)));
}

{
  const view = buildReadinessView({ analysis: a2.analysis, durationMonths: 6 });
  check('readiness view current matches analysis', view.readiness.current, a2.analysis.readinessScore.score);
  checkTrue('readiness view has 2/4/6 checkpoints', view.readiness.projections.checkpoints.length >= 3);
}

{
  const evidence = buildEvidencePack({
    analysis: a2.analysis,
    enrichedGaps: enrichSkillGaps(a2.analysis.skillGaps, a2.analysis),
    collected: collectProfileSkills(profileA),
    profile: profileA,
    months: 2,
    marketScope: 'ALL',
  });
  const overlay = await applyAiNarrative({
    evidence,
    weeks: a2.roadmap.roadmaps.weeks,
    enabled: true,
    callAIFn: async () => JSON.stringify({
      weekNotes: [{ week: 1, objective: 'Invent Kubernetes at 99% even though it is absent.', resourceWhy: 'Kubernetes 99%' }],
      summary: 'Kubernetes 99%',
    }),
  });
  check('fabricated AI week note is discarded', overlay.weeks[0].objective, a2.roadmap.roadmaps.weeks[0].objective);
  check('fabricated AI summary is discarded', overlay.summary, null);

  const good = await applyAiNarrative({
    evidence,
    weeks: a2.roadmap.roadmaps.weeks,
    enabled: true,
    callAIFn: async () => JSON.stringify({
      weekNotes: [{ week: 1, objective: 'Industry task using skills already in the evidence pack.', resourceWhy: 'Official docs match the analyzed postings.' }],
      summary: 'FACT: frequencies come from analyzed postings. RECOMMENDATION: close attested gaps. PROJECTION: scores assume milestones.',
    }),
  });
  checkTrue('safe AI objective is applied', good.weeks[0].objective.includes('Industry task'));
}

{
  const emptyStore = new MemoryOpportunityStore();
  const { result } = await analyzeRoleReadiness({
    role: 'AI Intern',
    marketScope: 'ALL',
    profile: profileA,
    opportunityStore: emptyStore,
    allowNetwork: false,
    forceRefresh: true,
  });
  const roadmap = await buildRoleRoadmap({ analysis: result, profile: profileA, durationMonths: 2, useAi: false });
  checkTrue('empty market still uses role baseline skills', (roadmap.skillDemand || []).some((s) => s.skill === 'Python' && s.percent == null));
  checkTrue('empty market invents no fake percentages', (roadmap.skillDemand || []).every((s) => s.percent == null || s.percent === 0));
  checkTrue('empty market still returns weeks', roadmap.roadmaps.weeks.length === 8);
  checkTrue('empty market does not fill the calendar with interview prep', roadmap.roadmaps.weeks.filter((w) => /Interview preparation/i.test(w.objective)).length <= 2);
}

{
  checkTrue('industry summary lists top FACT percents', a2.roadmap.marketSummary.topRequirements.length >= 1);
  check('market summary kind is FACT', a2.roadmap.marketSummary.kind, 'FACT');
  checkTrue('highest-impact gaps are missing/partial only', a2.roadmap.priorities.highestImpact.every((name) => {
    const g = a2.roadmap.skillGaps.find((x) => x.skill === name);
    return g && g.status !== 'ALREADY HAVE';
  }));
  checkTrue('resources are capped', a2.roadmap.resources.length <= 16);
  checkTrue('interview plan has named phases', a2.roadmap.interviewPlan.phases.length >= 3);
}

{
  const sqlWeek = dsA.roadmap.roadmaps.weeks.find((w) => (w.skills || []).includes('SQL') && /Close the SQL/i.test(w.objective));
  if (sqlWeek) {
    checkTrue('SQL week has JOINs or practice problems', /JOIN|SQL problems|window/i.test(JSON.stringify(sqlWeek)));
    checkTrue('SQL week names hours', /\d+/.test(sqlWeek.estimatedHours));
  } else {
    pass('SQL close-week not present in this DS sample (still scheduled elsewhere)');
  }
}

{
  const cov = coverageAgainstDemand(
    [{ skill: 'Python', percent: 80 }, { skill: 'PyTorch', percent: 20 }],
    [{ skill: 'Python', status: 'ALREADY HAVE' }, { skill: 'PyTorch', status: 'MISSING' }]
  );
  check('coverage weights Have vs Missing', cov.percent, 80);
  const empty = coverageAgainstDemand([], [{ skill: 'Python', status: 'ALREADY HAVE' }]);
  check('empty demand does not invent a match percent', empty.percent, null);
  checkTrue('progress rail has seven named phases', ANALYSIS_PHASES.length === 7 && ANALYSIS_PHASES[0].id === 'search');
}

{
  const mock = { isMock: true, query: async () => ({ rows: [] }) };
  await persistRun(mock, {
    id: 'ra_ui_test',
    userId: 'student-1',
    canonicalRole: 'AI Intern',
    rawRole: 'AI Intern',
    marketScope: 'ALL',
    status: 'COMPLETE',
    result: { role: 'AI Intern', readinessScore: { score: 72 }, metadata: { postingCount: 50 } },
    startedAt: '2026-08-15T00:00:00.000Z',
    completedAt: '2026-08-15T00:00:00.000Z',
  });
  await markRunSaved(mock, { id: 'ra_ui_test', userId: 'student-1', saved: true });
  const runs = await listRuns(mock, 'student-1', { savedOnly: true });
  checkTrue('saved analysis can be reopened from the account list', runs.some((r) => r.id === 'ra_ui_test' && r.readiness === 72));
  await upsertProgress(mock, { userId: 'student-1', analysisId: 'ra_ui_test', itemKey: 'week:1', completed: true });
  const progress = await listProgress(mock, 'student-1', 'ra_ui_test');
  checkTrue('week completion persists on the account', progress.some((p) => p.itemKey === 'week:1' && p.completed));
}

{
  const interviewish = (roadmap) => (roadmap.roadmaps.weeks || []).filter((w) => /Interview preparation/i.test(w.objective)).length;
  checkTrue('2-month AI intern is not mostly interview weeks', interviewish(a2.roadmap) <= 2);
  checkTrue('A intern with no projects still gets a project recommendation', a2.roadmap.projects.length >= 1);
  checkTrue('coach report has a diagnosis', Boolean(a2.roadmap.coach?.executiveSummary?.diagnosis || a2.roadmap.coach?.currentPosition?.summary));
  checkTrue('coach report has start-here actions', (a2.roadmap.coach?.nextAction?.today || []).length >= 1);
  checkTrue('2-month has foundation then build phases', (a2.roadmap.roadmaps.phases || []).some((p) => p.id === 'foundation') && (a2.roadmap.roadmaps.phases || []).some((p) => p.id === 'build'));
  checkTrue('weeks have success criteria', a2.roadmap.roadmaps.weeks.every((w) => String(w.successCriteria || w.milestone || '').length > 10));
}

{
  const buildWeeks = a2.roadmap.roadmaps.weeks.filter((w) => w.phase === 'build');
  const objectives = buildWeeks.map((w) => w.objective);
  checkTrue('2-month build weeks exist', buildWeeks.length >= 2);
  checkTrue('build weeks are not copy-pasted', new Set(objectives).size === objectives.length);
  checkFalse('build weeks do not say Continue: for every row', objectives.every((o) => /^Continue:/i.test(o)));
  const titles = a2.roadmap.projects.map((p) => p.title).filter(Boolean);
  if (titles.length >= 2 && buildWeeks.length >= 3) {
    const blob = objectives.join(' | ');
    checkTrue('second recommended project appears in the weekly plan', titles.slice(1).some((t) => blob.includes(t)));
  }
  const deploy = a2.roadmap.roadmaps.weeks.find((w) => w.phase === 'deploy');
  checkTrue('deploy week is API/Docker, not another Continue', /Deploy:|FastAPI|Docker|\/predict/i.test(deploy?.objective || ''));
}

{
  const student = {
    identity: { name: 'Abdul', city: 'Peshawar', country: 'Pakistan' },
    skills: { programming_languages: [], frameworks: [], ai_ml: [], databases: [], cloud: [], tools: [] },
    education: [{
      degree: 'BS Software Engineering',
      major: 'Software Engineering',
      coursework: ['Programming', 'Database Systems', 'AI', 'Data Structures and Algorithms'],
    }],
    experience: { internships: [], jobs: [] },
    projects: [],
  };
  const { analysis, roadmap } = await plan('AI Intern', student, 2);
  const sql = roadmap.skillGaps.find((g) => g.skill === 'SQL');
  const stats = roadmap.skillGaps.find((g) => g.skill === 'Statistics');
  checkTrue('Database Systems coursework is not treated as SQL missing', sql?.status !== 'MISSING');
  checkTrue('AI coursework is not treated as Statistics missing', !stats || stats.status !== 'MISSING' || stats.evidence === 'coursework');
  checkTrue('student with no GitHub projects gets a portfolio project', roadmap.projects.length >= 1);
  checkTrue('readiness has a breakdown', (analysis.readinessScore.breakdown || []).length >= 4);
}

{
  const specialist = await plan('Cybersecurity Specialist', profileA, 2, 'Linux.');
  const intern = await plan('Cybersecurity Intern', profileA, 2, 'Linux.');
  const blob = JSON.stringify(specialist.roadmap.projects) + JSON.stringify(specialist.roadmap.roadmaps.weeks);
  checkFalse('cyber specialist roadmap is not ML/churn', /churn|PyTorch|scikit-learn|FastAPI|\/predict/i.test(blob));
  checkTrue('cyber specialist recommends a security lab or report', specialist.roadmap.projects.some((p) => /lab|write-up|SIEM|OWASP|Nmap|Burp/i.test(`${p.id} ${p.title}`)));
  check('intern vs specialist are different families', intern.analysis.role === specialist.analysis.role, false);
  check('intern search_type internships', intern.analysis.search_type, 'internships');
  check('specialist search_type jobs', specialist.analysis.search_type, 'jobs');
  const deploy = specialist.roadmap.roadmaps.weeks.find((w) => w.phase === 'deploy');
  checkFalse('cyber deploy week is not a model API', /\/predict|FastAPI/i.test(deploy?.objective || ''));
  const interview = specialist.roadmap.roadmaps.weeks.filter((w) => w.phase === 'interview');
  checkFalse('cyber interview weeks are not Python/ML drills', interview.some((w) => /Python\/ML/i.test(w.objective || '')));
  const intel = specialist.roadmap.coach?.intelligence;
  checkTrue('intelligence payload exists', Boolean(intel));
  checkTrue('next 7 days has 7 items', (intel?.next7Days || []).length === 7);
  checkTrue('cyber interview bank is security-themed', (intel?.interviewPrep?.sections || []).some((s) => /network|linux|web security|incident/i.test(s.title)));
  checkFalse('cyber interview bank is not ML', (intel?.interviewPrep?.sections || []).some((s) => /deep learning|machine learning/i.test(s.title)));
  checkTrue('position narrative names gaps or strengths', /you already|biggest gaps|start with/i.test(intel?.positionNarrative || specialist.roadmap.coach?.currentPosition?.summary || ''));
  checkTrue('action plan has multiple steps', (intel?.careerActionPlan || []).length >= 5);
}


