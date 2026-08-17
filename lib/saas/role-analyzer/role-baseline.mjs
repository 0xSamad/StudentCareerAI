/**
 * Established role requirements. Used when the live sample is thin so one
 * posting cannot dictate the plan. These are ROLE_BASELINE, never invented
 * market percentages. Domain fallbacks must NEVER leak AI/ML into security.
 */

export const MIN_CONFIDENT_POSTINGS = 20;
export const LIMITED_SAMPLE_POSTINGS = 10;
export const TARGET_POSTING_RANGE = { min: 20, max: 50 };

export const IMPORTANCE = {
  CORE: 'CORE',
  COMMON: 'COMMON',
  HIGH_VALUE: 'HIGH-VALUE',
  OPTIONAL: 'OPTIONAL',
};

/** Skills that belong to security roadmaps — never inject into AI/ML/software. */
export const CYBER_STACK = new Set([
  'SIEM',
  'SOC',
  'Burp Suite',
  'Nmap',
  'Metasploit',
  'Active Directory',
  'Incident Response',
  'Penetration Testing',
  'Threat Detection',
  'Splunk',
  'OWASP',
  'Wireshark',
  'Privilege Escalation',
  'Vulnerability Assessment',
  'Web Security',
  'Security Fundamentals',
  'Cloud Security',
  'Security Reporting',
]);
export const AI_ML_STACK = new Set([
  'Machine Learning',
  'Deep Learning',
  'PyTorch',
  'TensorFlow',
  'Keras',
  'scikit-learn',
  'Pandas',
  'NumPy',
  'NLP',
  'LLMs',
  'RAG',
  'Hugging Face',
  'LangChain',
  'LlamaIndex',
  'MLflow',
  'MLOps',
  'Computer Vision',
  'OpenCV',
  'XGBoost',
  'Transformers',
  'Fine-tuning',
  'Prompt Engineering',
]);

const AI_INTERN = {
  target: 'Competitive AI internship candidate',
  strategy: ['Foundation', 'Applied AI', 'Portfolio', 'Ship a demo', 'Interview', 'Apply'],
  jobReady: [
    'Write intern-quality Python for data and AI work',
    'Build and evaluate a supervised ML baseline',
    'Explain ML fundamentals in an interview',
    'Query data with SQL',
    'Ship one end-to-end AI project on GitHub',
    'Walk through your projects in interviews',
    'Keep a professional GitHub portfolio',
    'Have a targeted CV with attested facts only',
  ],
  core: ['Python', 'Machine Learning', 'Pandas', 'Git'],
  common: ['SQL', 'NumPy', 'scikit-learn'],
  highValue: ['LLMs', 'FastAPI', 'Docker'],
  optional: ['PyTorch', 'Hugging Face', 'RAG'],
};

const ML_INTERN = {
  target: 'Competitive ML internship candidate',
  strategy: ['Foundation', 'Training loops', 'Portfolio', 'Evaluation', 'Interview', 'Apply'],
  jobReady: [
    'Write intern-quality Python for ML work',
    'Train and evaluate models with a leakage-safe split',
    'Use scikit-learn pipelines honestly',
    'Complete a PyTorch training loop on a small dataset',
    'Report precision, recall, and F1 — not only accuracy',
    'Ship one ML project on GitHub with metrics.md',
  ],
  core: ['Python', 'Machine Learning', 'scikit-learn', 'Pandas', 'Git'],
  common: ['NumPy', 'SQL', 'Statistics'],
  highValue: ['PyTorch', 'Deep Learning', 'Docker'],
  optional: ['TensorFlow', 'FastAPI'],
};

const AI_ENGINEER = {
  target: 'Competitive AI Engineer (junior) candidate',
  strategy: ['Foundation', 'Applied AI', 'Portfolio', 'Deployment', 'Interview', 'Apply'],
  jobReady: [
    'Ship an AI feature behind an API a reviewer can hit',
    'Evaluate a model with a metric that matches the problem',
    'Document limitations — no invented benchmarks',
    'Explain RAG vs fine-tuning at a junior level if the market asks',
  ],
  core: ['Python', 'Machine Learning', 'Git', 'FastAPI'],
  common: ['SQL', 'Docker', 'Pandas'],
  highValue: ['LLMs', 'RAG', 'PyTorch'],
  optional: ['Kubernetes', 'Hugging Face'],
};

const ML_ENGINEER = {
  target: 'Competitive ML Engineer (junior) candidate',
  strategy: ['Foundation', 'Training loops', 'Portfolio', 'Deployment', 'Interview', 'Apply'],
  jobReady: [
    'Train, evaluate, and checkpoint a model',
    'Serve it with an API and a Dockerfile',
    'Explain leakage, metrics, and what you would monitor',
  ],
  core: ['Python', 'PyTorch', 'Machine Learning', 'Git', 'Docker'],
  common: ['SQL', 'FastAPI', 'scikit-learn'],
  highValue: ['Deep Learning', 'MLOps', 'AWS'],
  optional: ['Kubernetes', 'TensorFlow'],
};

const DS_INTERN = {
  target: 'Competitive Data Science internship candidate',
  strategy: ['Foundation', 'SQL + Statistics', 'Portfolio', 'Presentation', 'Interview', 'Apply'],
  jobReady: [
    'Write intern-quality Python for analysis',
    'Clean and join datasets',
    'Write SQL with joins and aggregations',
    'Explain basic statistics in interviews',
    'Build a documented analysis or ML baseline',
    'Put the work on GitHub with a README',
    'Walk through findings without inventing metrics',
  ],
  core: ['Python', 'SQL', 'Pandas', 'Statistics', 'Git'],
  common: ['NumPy', 'Excel'],
  highValue: ['scikit-learn', 'Tableau'],
  optional: ['Power BI', 'Docker'],
};

const DATA_SCIENTIST = {
  target: 'Competitive Data Scientist (junior) candidate',
  strategy: ['Foundation', 'Modeling + SQL', 'Portfolio', 'Presentation', 'Interview', 'Apply'],
  jobReady: [
    'Deliver an analysis with a clear question, method, and limitation',
    'Use SQL in anger (joins, grain, aggregations)',
    'Train a documented ML baseline when the problem needs one',
    'Present findings without inventing metrics',
  ],
  core: ['Python', 'SQL', 'Statistics', 'Pandas', 'Git'],
  common: ['scikit-learn', 'NumPy'],
  highValue: ['Tableau', 'Machine Learning', 'Docker'],
  optional: ['Spark', 'Power BI'],
};

const SWE_INTERN = {
  target: 'Competitive software engineering internship candidate',
  strategy: ['Foundation', 'Build', 'Ship', 'Interview', 'Apply'],
  jobReady: [
    'Write intern-quality code in the stack the market asks for',
    'Use Git professionally',
    'Ship a small full project with a README',
    'Explain your code in interviews',
  ],
  core: ['Python', 'Git', 'Data Structures'],
  common: ['SQL', 'JavaScript'],
  highValue: ['Docker', 'REST APIs', 'Linux'],
  optional: ['AWS', 'React'],
};

const SWE = {
  target: 'Competitive junior software engineer candidate',
  strategy: ['Foundation', 'Build', 'Ship', 'Interview', 'Apply'],
  jobReady: [
    'Write production-shaped code in the stack the market asks for',
    'Use Git professionally',
    'Ship a small full project with a README',
    'Explain your code in interviews',
  ],
  core: ['Python', 'Git', 'SQL'],
  common: ['JavaScript', 'GitHub'],
  highValue: ['Docker', 'FastAPI', 'React'],
  optional: ['Kubernetes', 'AWS'],
};

const CYBER_INTERN = {
  target: 'Competitive cybersecurity internship candidate',
  strategy: ['Fundamentals', 'Labs', 'Write-ups', 'Interview', 'Apply'],
  jobReady: [
    'Explain core security concepts and the CIA triad',
    'Describe basic networking (TCP/IP, DNS, ports)',
    'Use Linux for simple admin and log inspection',
    'Document a lab or CTF write-up on GitHub',
    'Use Git',
  ],
  core: ['Security Fundamentals', 'Networking', 'Linux'],
  common: ['Python', 'Bash', 'Git'],
  highValue: ['Wireshark', 'Nmap', 'OWASP'],
  optional: ['SIEM', 'Cloud Security', 'Windows'],
};

const CYBER_SPECIALIST = {
  target: 'Competitive cybersecurity specialist (entry/junior) candidate',
  strategy: ['Fundamentals', 'Defensive + tooling from the market', 'Labs', 'Interview', 'Apply'],
  jobReady: [
    'Explain security fundamentals with examples',
    'Read logs and describe an incident at a high level',
    'Use Linux and basic networking in a lab',
    'Produce a short security write-up from a real lab',
  ],
  core: ['Security Fundamentals', 'Networking', 'Linux', 'Incident Response'],
  common: ['Vulnerability Assessment', 'Python', 'Windows'],
  highValue: ['SIEM', 'Cloud Security', 'OWASP', 'Windows'],
  optional: ['Penetration Testing', 'Active Directory', 'Bash'],
};

const SOC_ANALYST = {
  target: 'Competitive junior SOC analyst candidate',
  strategy: ['Networking + Windows', 'SIEM labs', 'Incident notes', 'Interview', 'Apply'],
  jobReady: [
    'Triage alerts with a documented process',
    'Use a SIEM or log platform in a lab',
    'Explain Windows/AD basics and common log sources',
    'Write a short incident timeline',
  ],
  core: ['SIEM', 'Incident Response', 'Networking', 'Windows'],
  common: ['Linux', 'Threat Detection', 'Security Fundamentals', 'Active Directory'],
  highValue: ['Python', 'Splunk', 'Security Reporting'],
  optional: ['Cloud Security', 'Wireshark'],
};

const PENTEST = {
  target: 'Competitive junior penetration tester candidate',
  strategy: ['Networking + Linux', 'Web security labs', 'Report writing', 'Interview', 'Apply'],
  jobReady: [
    'Enumerate a lab target with Nmap',
    'Test a web app with Burp Suite and OWASP thinking',
    'Explain a privilege-escalation path you actually tried',
    'Write a findings report with evidence, not slogans',
  ],
  core: ['Networking', 'Linux', 'Web Security', 'Penetration Testing'],
  common: ['Nmap', 'Burp Suite', 'OWASP', 'Privilege Escalation'],
  highValue: ['Active Directory', 'Metasploit', 'Python'],
  optional: ['Cloud Security', 'Bash', 'PowerShell'],
};

const SECURITY_ENGINEER = {
  target: 'Competitive junior security engineer candidate',
  strategy: ['Fundamentals', 'Cloud + identity', 'Detection or hardening lab', 'Interview', 'Apply'],
  jobReady: [
    'Explain IAM and network segmentation at a junior level',
    'Harden a small cloud or Linux lab and document it',
    'Describe how you would detect a basic incident',
  ],
  core: ['Security Fundamentals', 'Networking', 'Linux', 'Cloud Security'],
  common: ['IAM', 'Python', 'Incident Response'],
  highValue: ['SIEM', 'AWS', 'Azure'],
  optional: ['Kubernetes', 'Terraform'],
};

const EMPTY_GENERIC = {
  target: 'Competitive candidate for this role',
  strategy: ['Confirm the role from real postings', 'Close skills those postings actually ask', 'Portfolio evidence', 'Interview', 'Apply'],
  jobReady: [
    'Close the core skills this role asks for in real postings',
    'Ship one GitHub artifact a recruiter can review',
    'Explain that artifact in interviews',
  ],
  core: [],
  common: [],
  highValue: [],
  optional: [],
};

const BY_FAMILY = {
  'ai-intern': AI_INTERN,
  'ml-intern': ML_INTERN,
  'ai-engineer': AI_ENGINEER,
  'ml-engineer': ML_ENGINEER,
  'data-science-intern': DS_INTERN,
  'data-scientist': DATA_SCIENTIST,
  'software-engineering-intern': SWE_INTERN,
  'software-engineer': SWE,
  'cybersecurity-intern': CYBER_INTERN,
  'cybersecurity-specialist': CYBER_SPECIALIST,
  'soc-analyst': SOC_ANALYST,
  'penetration-tester': PENTEST,
  'security-engineer': SECURITY_ENGINEER,
};

const BY_DOMAIN = {
  cybersecurity: CYBER_SPECIALIST,
  ai_ml: AI_INTERN,
  data_science: DS_INTERN,
  software: SWE,
};

export function baselineFor(family) {
  const id = family?.id || '';
  if (BY_FAMILY[id]) return { ...BY_FAMILY[id], target: BY_FAMILY[id].target };
  const domain = family?.domain;
  if (domain && BY_DOMAIN[domain]) {
    const base = BY_DOMAIN[domain];
    return {
      ...base,
      target: `Competitive ${family?.canonical || 'target role'} candidate`,
    };
  }
  return {
    ...EMPTY_GENERIC,
    target: `Competitive ${family?.canonical || 'target role'} candidate`,
  };
}

export function importanceOf(skill, family) {
  const b = baselineFor(family);
  if (b.core.includes(skill)) return IMPORTANCE.CORE;
  if (b.highValue.includes(skill)) return IMPORTANCE.HIGH_VALUE;
  if (b.common.includes(skill)) return IMPORTANCE.COMMON;
  if (b.optional.includes(skill)) return IMPORTANCE.OPTIONAL;
  return null;
}

export function allBaselineSkills(family) {
  const b = baselineFor(family);
  return [...new Set([...b.core, ...b.common, ...b.highValue])];
}

export function skillAllowedForDomain(skill, family) {
  const domain = family?.domain || '';
  if (domain === 'cybersecurity') return !AI_ML_STACK.has(skill);
  if (domain === 'ai_ml' || domain === 'data_science') return !CYBER_STACK.has(skill);
  if (domain === 'software') return !AI_ML_STACK.has(skill) && !CYBER_STACK.has(skill);
  return true;
}

export function mergeDemandWithBaseline(marketSkills = [], family, postingCount = 0) {
  const bySkill = new Map();
  for (const row of marketSkills || []) {
    if (!skillAllowedForDomain(row.skill, family)) continue;
    bySkill.set(row.skill, {
      ...row,
      importance: importanceOf(row.skill, family) || IMPORTANCE.OPTIONAL,
      source: 'MARKET',
      kind: 'FACT',
    });
  }
  const b = baselineFor(family);
  const add = (skill, importance) => {
    if (!skillAllowedForDomain(skill, family)) return;
    if (bySkill.has(skill)) {
      const existing = bySkill.get(skill);
      existing.importance = existing.importance === IMPORTANCE.OPTIONAL ? importance : existing.importance;
      return;
    }
    bySkill.set(skill, {
      skill,
      category: null,
      count: 0,
      total: postingCount,
      percent: null,
      mandatoryCount: 0,
      importance,
      source: 'ROLE_BASELINE',
      kind: 'ROLE_BASELINE',
      label: `${skill} — established ${importance.toLowerCase()} requirement for ${family?.canonical || 'this role'}`,
    });
  };
  for (const s of b.core) add(s, IMPORTANCE.CORE);
  for (const s of b.common) add(s, IMPORTANCE.COMMON);
  for (const s of b.highValue) add(s, IMPORTANCE.HIGH_VALUE);
  return [...bySkill.values()].sort((a, b2) => {
    const rank = { [IMPORTANCE.CORE]: 4, [IMPORTANCE.HIGH_VALUE]: 3, [IMPORTANCE.COMMON]: 2, [IMPORTANCE.OPTIONAL]: 1 };
    const ra = rank[a.importance] || 0;
    const rb = rank[b2.importance] || 0;
    if (rb !== ra) return rb - ra;
    return (b2.percent || 0) - (a.percent || 0);
  });
}

export function sampleQuality(n, { usedBaseline = false, researchedExtra = false, postingsWithSkills = null } = {}) {
  const countPhrase =
    n === 0
      ? '0 relevant postings found. Analysis is based on 0 postings.'
      : `${n} relevant posting${n === 1 ? '' : 's'} found. Analysis is based on ${n} posting${n === 1 ? '' : 's'}.`;
  const denomNote =
    postingsWithSkills != null && n > 0 && postingsWithSkills < n
      ? ` Skill frequencies use all ${n} analyzed postings as the denominator. ${postingsWithSkills} posting${postingsWithSkills === 1 ? '' : 's'} had extractable skill text.`
      : n > 0
        ? ` Skill frequencies use all ${n} analyzed postings as the denominator.`
        : '';

  if (!n) {
    return {
      level: 'empty',
      warning: true,
      usedBaseline: true,
      message: `${countPhrase} Market percentages are not shown. The plan uses established role requirements plus your profile — not invented statistics.`,
    };
  }
  if (n < LIMITED_SAMPLE_POSTINGS) {
    return {
      level: 'very-low',
      warning: true,
      usedBaseline: true,
      message: `${countPhrase} That sample is too small to treat as market-wide.${denomNote}`,
    };
  }
  if (n < MIN_CONFIDENT_POSTINGS) {
    return {
      level: 'low',
      warning: true,
      usedBaseline: true,
      message: `${countPhrase} Target is ${MIN_CONFIDENT_POSTINGS}–${TARGET_POSTING_RANGE.max} unique relevant postings.${denomNote}`,
    };
  }
  return {
    level: 'ok',
    warning: false,
    usedBaseline,
    researchedExtra,
    message: `${countPhrase}${denomNote}`,
  };
}
