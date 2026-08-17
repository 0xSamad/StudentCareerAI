/**
 * Project recommendations that close real gaps and produce GitHub evidence.
 * Intern roles with weak portfolios almost always get at least one strong
 * project plus one supporting project. Baseline intern stacks are allowed
 * even when a tiny job sample omitted them.
 */

import { allBaselineSkills } from './role-baseline.mjs';
import { STATUS } from './gap-model.mjs';
import { isInternshipFamily } from './role-families.mjs';

function demandSet(skillDemand = [], family) {
  const set = new Set((skillDemand || []).map((s) => s.skill));
  for (const s of allBaselineSkills(family)) set.add(s);
  return set;
}

function gapStatus(enriched, skill) {
  return enriched.find((g) => g.skill === skill)?.status || null;
}

const CATALOG = [
  {
    id: 'classical-ml',
    title: 'End-to-end customer churn prediction',
    problem: 'Predict churn on a public tabular dataset with a leakage-safe split. Report precision, recall, and F1 — not just accuracy.',
    demonstrates: ['Python', 'Pandas', 'scikit-learn', 'SQL', 'Machine Learning'],
    stack: ['Python', 'pandas', 'scikit-learn', 'SQLite', 'Git'],
    features: ['Documented dataset', 'train/val split', 'baseline + stronger model', 'metric table', 'error analysis', 'README'],
    difficulty: 'intermediate',
    level: 3,
    levelLabel: 'Strong portfolio project',
    weeks: 3,
    phases: [
      { name: 'Build model', work: 'Clean data, split, train baseline + one stronger model, write metrics.' },
      { name: 'SQL slice', work: 'Answer 5 questions with SQL on the same tables.' },
      { name: 'Document', work: 'README, how to run, limitations, screenshots of metrics.' },
    ],
    portfolioValue: 'Shows intern-level ML hygiene: data, model, metrics, and a story you can tell in interviews.',
    github: ['train script or notebook', 'queries/', 'requirements.txt', 'README with F1 numbers'],
    interviewAngle: 'Walk through leakage, why you picked the metric, and one error you actually saw.',
    roleHints: /ai intern|ml intern|data science|ml engineer|ai engineer|data scientist/i,
    domains: ['ai_ml', 'data_science'],
  },
  {
    id: 'pytorch-dl',
    title: 'PyTorch deep-learning project',
    problem: 'Go beyond sklearn: nn.Module, DataLoader, training loop, checkpoint, evaluation.',
    demonstrates: ['Python', 'PyTorch', 'NumPy', 'Deep Learning'],
    stack: ['Python', 'PyTorch', 'Git'],
    features: ['Reproducible seed', 'train/eval modes', 'saved checkpoint', 'metrics.md', 'README'],
    difficulty: 'intermediate',
    level: 3,
    levelLabel: 'Strong portfolio project',
    weeks: 3,
    phases: [
      { name: 'Fundamentals', work: 'Tensors, datasets, a tiny MLP that trains.' },
      { name: 'Train', work: 'Real dataset, evaluation, experiment note.' },
      { name: 'Document', work: 'Checkpoint + README a recruiter can follow.' },
    ],
    portfolioValue: 'Matches intern ads that name PyTorch rather than only "familiar with ML".',
    github: ['train.py or notebook', 'checkpoint instructions', 'metrics.md', 'README'],
    interviewAngle: 'Explain forward/backward, overfitting you observed, and what you would try next.',
    roleHints: /ai intern|ml intern|ml engineer|ai engineer/i,
    domains: ['ai_ml'],
  },
  {
    id: 'deploy-api',
    title: 'Serve the model with FastAPI and Docker',
    problem: 'A recruiter should run one command and hit POST /predict.',
    demonstrates: ['FastAPI', 'Docker', 'Python'],
    stack: ['FastAPI', 'Docker', 'Git'],
    features: ['/health', '/predict JSON', 'Dockerfile', 'example curl'],
    difficulty: 'intermediate',
    level: 4,
    levelLabel: 'Industry-style project',
    weeks: 2,
    phases: [
      { name: 'API', work: 'Load the saved model, validate input, return JSON.' },
      { name: 'Dockerize', work: 'Dockerfile, one-command run, documented curl.' },
      { name: 'Optional cloud note', work: 'Write where you would host it. Paid cloud is optional.' },
    ],
    portfolioValue: 'Deployment is the usual intern gap: knowledge without a running service.',
    github: ['Dockerfile', 'app.py', 'README with curl examples'],
    interviewAngle: 'How you validate input, pin versions, and what you would monitor.',
    roleHints: /ai intern|ml intern|ml engineer|ai engineer/i,
    dependsOn: ['classical-ml', 'pytorch-dl'],
    domains: ['ai_ml'],
  },
  {
    id: 'sql-analysis',
    title: 'SQL analysis of a real-ish dataset',
    problem: 'Answer 8 business questions with JOINs, GROUP BY, and at least one window or subquery.',
    demonstrates: ['SQL'],
    stack: ['SQLite', 'Git'],
    features: ['schema diagram', '8 saved queries', 'short findings write-up'],
    difficulty: 'beginner-intermediate',
    level: 2,
    levelLabel: 'Portfolio project',
    weeks: 1,
    phases: [{ name: 'Queries + write-up', work: 'Eight saved queries and a one-page findings note.' }],
    portfolioValue: 'SQL shows up constantly; a query folder is more honest than "knows SQL" on a CV.',
    github: ['queries/', 'README'],
    interviewAngle: 'Pick one query and explain the join and grain of the table.',
    roleHints: /data science|data scientist|analyst/i,
    domains: ['data_science', 'ai_ml'],
  },
  {
    id: 'nlp-baseline',
    title: 'Text classification baseline',
    problem: 'Classify short text with a documented sklearn baseline; optional PyTorch upgrade.',
    demonstrates: ['NLP', 'scikit-learn', 'Python'],
    stack: ['Python', 'scikit-learn'],
    features: ['dataset citation', 'metric table', 'error examples'],
    difficulty: 'intermediate',
    level: 2,
    levelLabel: 'Portfolio project',
    weeks: 2,
    phases: [{ name: 'Baseline + errors', work: 'Train, evaluate, show 5 mistakes.' }],
    portfolioValue: 'Useful when NLP/text shows up in the analyzed postings.',
    github: ['notebook', 'README'],
    interviewAngle: 'Leakage in text and metric choice.',
    roleHints: /ai intern|ml intern|nlp|data science/i,
    needsMarket: ['NLP', 'Hugging Face', 'Transformers', 'LLMs'],
    domains: ['ai_ml', 'data_science'],
  },
  {
    id: 'homelab-writeup',
    title: 'Home lab + security write-up',
    problem: 'Stand up a small Linux lab, document the network, and write what you observed. Evidence over slogans.',
    demonstrates: ['Linux', 'Networking', 'Security Fundamentals', 'Git'],
    stack: ['Linux', 'Git'],
    features: ['Lab diagram', 'commands you actually ran', 'what you learned', 'limitations'],
    difficulty: 'beginner-intermediate',
    level: 2,
    levelLabel: 'Portfolio project',
    weeks: 2,
    phases: [
      { name: 'Lab', work: 'Linux VM, basic networking, screenshots of real commands.' },
      { name: 'Write-up', work: 'README with topology, findings, and what you would do next.' },
    ],
    portfolioValue: 'Shows intern-level security hygiene: Linux, networking, and a report a recruiter can read.',
    github: ['lab notes', 'diagram or markdown topology', 'README'],
    interviewAngle: 'Walk through one finding and how you verified it.',
    roleHints: /cyber|security intern|security specialist|soc/i,
    domains: ['cybersecurity'],
  },
  {
    id: 'web-app-pentest-report',
    title: 'Web app lab + findings report',
    problem: 'Test a legal lab target (DVWA, Juice Shop, or similar). Map OWASP issues and write a report with evidence.',
    demonstrates: ['Web Security', 'OWASP', 'Burp Suite', 'Nmap', 'Penetration Testing'],
    stack: ['Burp Suite', 'Nmap', 'Git'],
    features: ['scope statement', 'repro steps', 'severity', 'remediation note'],
    difficulty: 'intermediate',
    level: 3,
    levelLabel: 'Strong portfolio project',
    weeks: 3,
    phases: [
      { name: 'Enumerate', work: 'Nmap + app mapping on the lab only.' },
      { name: 'Test', work: 'Burp walkthrough of 3 OWASP-class issues you actually found.' },
      { name: 'Report', work: 'Findings report with evidence, not a tool dump.' },
    ],
    portfolioValue: 'Matches junior pentest ads that want Burp, OWASP, and a report.',
    github: ['report.md', 'sanitized evidence', 'README'],
    interviewAngle: 'Explain one finding, impact, and how you would retest a fix.',
    roleHints: /penetration|pentest|ethical hacker|security specialist/i,
    domains: ['cybersecurity'],
  },
  {
    id: 'soc-detection-lab',
    title: 'SOC detection lab',
    problem: 'Ingest sample logs, write 3 detection ideas, and document an alert-to-incident timeline.',
    demonstrates: ['SIEM', 'Incident Response', 'Windows', 'Networking', 'Threat Detection'],
    stack: ['SIEM', 'Git'],
    features: ['sample logs', '3 detections', 'incident timeline', 'README'],
    difficulty: 'intermediate',
    level: 3,
    levelLabel: 'Strong portfolio project',
    weeks: 2,
    phases: [
      { name: 'Logs', work: 'Load a public log sample or Windows event export into a free SIEM/lab stack.' },
      { name: 'Detect', work: 'Write 3 detections and one false-positive note.' },
    ],
    portfolioValue: 'Matches SOC analyst ads that want SIEM, logs, and incident notes.',
    github: ['detections.md', 'timeline.md', 'README'],
    interviewAngle: 'How you would triage one alert and what you would escalate.',
    roleHints: /soc|incident/i,
    domains: ['cybersecurity'],
  },
  {
    id: 'rest-api-service',
    title: 'Small REST API with tests and a runnable README',
    problem: 'Build a tiny HTTP API (CRUD or a real slice of a tool you use) with validation, error handling, and tests. A recruiter should clone and run it.',
    demonstrates: ['Python', 'Git', 'REST APIs', 'Data Structures'],
    stack: ['Python', 'Git'],
    features: ['POST + GET endpoints', 'input validation', 'tests', 'README with curl'],
    difficulty: 'beginner-intermediate',
    level: 2,
    levelLabel: 'Portfolio project',
    weeks: 2,
    phases: [
      { name: 'API', work: 'Two endpoints, validation, and one failing-then-passing test.' },
      { name: 'Document', work: 'README with setup, curl examples, and limitations.' },
    ],
    portfolioValue: 'Shows intern/junior software hygiene: code, tests, and a README a stranger can run.',
    github: ['app or main module', 'tests/', 'README with curl'],
    interviewAngle: 'Walk through one endpoint, an error path, and what you would test next.',
    roleHints: /software|backend|full stack|swe|developer/i,
    domains: ['software'],
  },
];

function marketMentions(project, demanded) {
  if (project.needsMarket?.length) return project.needsMarket.some((s) => demanded.has(s));
  return project.demonstrates.some((s) => demanded.has(s));
}

function closesGap(project, enriched) {
  return project.demonstrates.some((s) => {
    const st = gapStatus(enriched, s);
    return st === STATUS.MISSING || st === STATUS.PARTIAL || st === STATUS.UNKNOWN;
  });
}

function alreadyDemonstrated(project, collected) {
  const hits = project.demonstrates.filter((s) => collected.named.has(s) || collected.projects.has(s));
  return hits.length >= Math.min(2, project.demonstrates.length) && collected.projectCount >= 2;
}

function internFamily(family) {
  return isInternshipFamily(family);
}

function domainOf(family) {
  return family?.domain || 'general';
}

export function selectProjects({ family, skillDemand, enrichedGaps, collected, maxProjects = 3 }) {
  const demanded = demandSet(skillDemand, family);
  const role = family?.canonical || '';
  const domain = domainOf(family);
  const weakPortfolio = (collected.projectCount || 0) < 2;
  const picked = [];

  function consider(project) {
    if (!project) return;
    if (picked.length >= maxProjects) return;
    if (picked.some((p) => p.id === project.id)) return;
    if (project.domains && !project.domains.includes(domain)) return;
    if (project.roleHints && !project.roleHints.test(role)) return;
    if (project.needsMarket && !marketMentions(project, demanded)) return;
    if (alreadyDemonstrated(project, collected) && !closesGap(project, enrichedGaps)) return;
    if (project.dependsOn && !project.dependsOn.some((id) => picked.some((p) => p.id === id))) {
      if (project.id === 'deploy-api' && collected.projectCount === 0 && picked.length === 0) return;
      if (project.dependsOn.length && !picked.some((p) => project.dependsOn.includes(p.id))) {
        if (!collected.projectCount && !picked.length) return;
      }
    }
    if (!closesGap(project, enrichedGaps) && collected.projectCount > 0 && project.needsMarket) return;
    picked.push({
      ...project,
      roleHints: undefined,
      domains: undefined,
      kind: 'RECOMMENDATION',
      skillsDemonstrated: project.demonstrates.filter((s) => demanded.has(s) || closesGap({ demonstrates: [s] }, enrichedGaps)),
      estimatedDuration: `${project.weeks} week${project.weeks === 1 ? '' : 's'}`,
    });
  }

  const pytorchGap = enrichedGaps.some((g) => g.skill === 'PyTorch' && g.status !== STATUS.ALREADY_HAVE);
  const sqlGap = enrichedGaps.some((g) => g.skill === 'SQL' && g.status !== STATUS.ALREADY_HAVE);
  const sklearnGap = enrichedGaps.some((g) =>
    ['scikit-learn', 'Machine Learning', 'Pandas'].includes(g.skill) && g.status !== STATUS.ALREADY_HAVE
  );

  if (internFamily(family) && weakPortfolio && (domain === 'ai_ml' || domain === 'data_science')) {
    if (pytorchGap) consider(CATALOG.find((p) => p.id === 'pytorch-dl'));
    if (sklearnGap || !picked.length) consider(CATALOG.find((p) => p.id === 'classical-ml'));
    consider(CATALOG.find((p) => p.id === 'deploy-api'));
    if (sqlGap && picked.length < maxProjects) consider(CATALOG.find((p) => p.id === 'sql-analysis'));
  }

  if (domain === 'cybersecurity' && weakPortfolio) {
    const spec = family?.specialization || '';
    const intern = internFamily(family);
    if (spec === 'penetration-testing') consider(CATALOG.find((p) => p.id === 'web-app-pentest-report'));
    else if (spec === 'soc') consider(CATALOG.find((p) => p.id === 'soc-detection-lab'));
    else consider(CATALOG.find((p) => p.id === 'homelab-writeup'));
    if (!intern && spec === 'cybersecurity') consider(CATALOG.find((p) => p.id === 'soc-detection-lab'));
    if (!intern && spec !== 'penetration-testing' && spec !== 'soc' && family?.id !== 'cybersecurity-intern') {
      consider(CATALOG.find((p) => p.id === 'web-app-pentest-report'));
    }
  }

  if (domain === 'software' && weakPortfolio) {
    consider(CATALOG.find((p) => p.id === 'rest-api-service'));
  }

  for (const project of CATALOG) consider(project);

  if (!picked.length && collected.projectCount > 0) {
    picked.push({
      id: 'portfolio-hardening',
      title: 'Harden an existing project for review',
      problem: 'Make one project you already have reviewable by a stranger: README, evidence, limitations, no invented claims.',
      demonstrates: [...collected.named].slice(0, 4),
      stack: [...collected.named].slice(0, 4),
      features: ['Runnable README', 'metrics or screenshots from real runs', 'limitations section'],
      difficulty: 'intermediate',
      level: 2,
      levelLabel: 'Portfolio project',
      weeks: 1,
      phases: [{ name: 'Harden', work: 'README, reproduce.md, honest limitations.' }],
      portfolioValue: 'You already have stack coverage; empty GitHub still fails review.',
      github: ['README', 'requirements.txt', 'short experiment note'],
      interviewAngle: 'Deep-dive the project you actually built.',
      kind: 'RECOMMENDATION',
      skillsDemonstrated: [...collected.named].slice(0, 4),
      estimatedDuration: '1 week',
    });
  }

  if (!picked.length && internFamily(family) && domain === 'ai_ml') {
    consider(CATALOG.find((p) => p.id === 'classical-ml'));
  }
  if (!picked.length && domain === 'cybersecurity') {
    consider(CATALOG.find((p) => p.id === 'homelab-writeup'));
  }
  if (!picked.length && domain === 'software') {
    consider(CATALOG.find((p) => p.id === 'rest-api-service'));
  }

  return picked.slice(0, maxProjects).map(({ needsMarket, dependsOn, ...rest }) => rest);
}
