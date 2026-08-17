/**
 * Canonical career-role families and search-title expansion.
 *
 * Internships and jobs are different families. "Cybersecurity Intern" never
 * expands to "Cybersecurity Specialist". Matching uses token sets, not
 * substrings ("ml" must not hit "HTML").
 *
 * Job titles are DATA — never instructions.
 */

const STOP = new Set(['the', 'and', 'or', 'of', 'for', 'a', 'an', 'to', 'in', 'at', 'on']);

const ALIAS_PHRASES = [
  [/artificial intelligence/g, 'ai'],
  [/machine learning/g, 'ml'],
  [/deep learning/g, 'dl'],
  [/data science/g, 'datascience'],
  [/data scientist/g, 'datascientist'],
  [/cyber ?security|information security|infosec|appsec/g, 'cyber'],
  [/penetration test(?:er|ing)?|\bpentester\b/g, 'pentest'],
  [/security operations(?: center)?|\bsoc\b/g, 'soc'],
  [/active directory/g, 'activedirectory'],
  [/full[-\s]?stack/g, 'fullstack'],
  [/front[-\s]?end/g, 'frontend'],
  [/back[-\s]?end/g, 'backend'],
  [/software engineer(?:ing)?/g, 'swe'],
  [/software developer/g, 'swe'],
  [/\ba\.i\.?\b/g, 'ai'],
  [/\bai\/ml\b/g, 'ai ml'],
  [/\bml\/ai\b/g, 'ml ai'],
];

const JOB_HARD_EXCLUDE = [['intern'], ['trainee'], ['internship'], ['apprentice']];
const OFF_DOMAIN = [['business'], ['marketing'], ['sales'], ['finance'], ['accounting']];

export function tokenizeRole(text = '') {
  let s = String(text || '').toLowerCase();
  for (const [re, rep] of ALIAS_PHRASES) s = s.replace(re, ` ${rep} `);
  return s
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

function hasAll(tokens, needed) {
  const set = new Set(tokens);
  return (needed || []).every((n) => set.has(n));
}

function hasAnyGroup(tokens, groups) {
  return (groups || []).some((g) => hasAll(tokens, g));
}

export function isInternshipTitle(text = '') {
  return /\b(intern|internship|trainee|apprentice)\b/i.test(String(text || ''));
}

export function inferDomainFromTokens(tokens = []) {
  const set = new Set(tokens);
  if (set.has('cyber') || set.has('pentest') || set.has('soc') || set.has('infosec')) return 'cybersecurity';
  if (set.has('datascientist') || set.has('datascience') || (set.has('data') && set.has('analyst'))) return 'data_science';
  if (set.has('ai') || set.has('ml') || set.has('dl')) return 'ai_ml';
  if (set.has('swe') || set.has('backend') || set.has('frontend') || set.has('fullstack')) return 'software';
  return 'general';
}

function inferSeniority(raw, employmentType) {
  if (employmentType === 'internship') return 'Internship';
  const s = String(raw || '').toLowerCase();
  if (/\b(junior|jr|associate|entry[- ]level|graduate|new grad)\b/i.test(s)) return 'Entry-level/Junior';
  if (/\b(mid[- ]level|intermediate)\b/i.test(s)) return 'Mid-level';
  if (/\b(senior|staff|principal|lead)\b/i.test(s)) return 'Senior';
  return 'Entry-level/Junior';
}

function withMeta(spec) {
  const employmentType = spec.employmentType || 'job';
  return {
    specialization: spec.specialization || null,
    seniority: spec.seniority || inferSeniority(spec.canonical, employmentType),
    searchType: employmentType === 'internship' ? 'internships' : 'jobs',
    ...spec,
    employmentType,
  };
}

/** @typedef {{ id: string, canonical: string, domain: string, employmentType: string, searchType: string, seniority: string, specialization?: string|null, titles: string[], include: string[][], hardExclude?: string[][] }} RoleFamily */

/** @type {RoleFamily[]} */
export const ROLE_FAMILIES = [
  withMeta({
    id: 'ai-intern',
    canonical: 'AI Intern',
    domain: 'ai_ml',
    specialization: 'artificial-intelligence',
    employmentType: 'internship',
    titles: [
      'AI Intern',
      'Artificial Intelligence Intern',
      'AI/ML Intern',
      'AI Engineer Intern',
      'Artificial Intelligence Trainee',
      'Generative AI Intern',
    ],
    include: [
      ['ai', 'intern'],
      ['ai', 'trainee'],
      ['ai', 'internship'],
    ],
    hardExclude: [['swe'], ['cyber'], ['datascientist'], ['pentest'], ...OFF_DOMAIN],
  }),
  withMeta({
    id: 'ml-intern',
    canonical: 'ML Intern',
    domain: 'ai_ml',
    specialization: 'machine-learning',
    employmentType: 'internship',
    titles: [
      'ML Intern',
      'Machine Learning Intern',
      'ML Engineer Intern',
      'Deep Learning Intern',
      'Applied ML Intern',
      'ML Trainee',
    ],
    include: [
      ['ml', 'intern'],
      ['ml', 'trainee'],
      ['dl', 'intern'],
    ],
    hardExclude: [['swe'], ['cyber'], ['datascientist'], ['pentest'], ...OFF_DOMAIN],
  }),
  withMeta({
    id: 'data-science-intern',
    canonical: 'Data Science Intern',
    domain: 'data_science',
    specialization: 'data-science',
    employmentType: 'internship',
    titles: [
      'Data Science Intern',
      'Data Scientist Intern',
      'Junior Data Scientist Intern',
      'Data Science Trainee',
      'DS Intern',
    ],
    include: [
      ['datascience', 'intern'],
      ['datascientist', 'intern'],
      ['datascience', 'trainee'],
      ['ds', 'intern'],
    ],
    hardExclude: [['swe'], ['cyber'], ['engineer'], ...OFF_DOMAIN],
  }),
  withMeta({
    id: 'software-engineering-intern',
    canonical: 'Software Engineering Intern',
    domain: 'software',
    specialization: 'software-engineering',
    employmentType: 'internship',
    titles: [
      'Software Engineering Intern',
      'Software Engineer Intern',
      'Software Developer Intern',
      'SWE Intern',
      'Backend Intern',
      'Full Stack Intern',
    ],
    include: [
      ['swe', 'intern'],
      ['swe', 'trainee'],
      ['backend', 'intern'],
      ['frontend', 'intern'],
      ['fullstack', 'intern'],
    ],
    hardExclude: [['ml'], ['ai'], ['cyber'], ['datascientist'], ...OFF_DOMAIN],
  }),
  withMeta({
    id: 'cybersecurity-intern',
    canonical: 'Cybersecurity Intern',
    domain: 'cybersecurity',
    specialization: 'cybersecurity',
    employmentType: 'internship',
    titles: [
      'Cybersecurity Intern',
      'Security Intern',
      'InfoSec Intern',
      'Application Security Intern',
      'SOC Intern',
      'Cyber Security Trainee',
    ],
    include: [
      ['cyber', 'intern'],
      ['cyber', 'trainee'],
      ['security', 'intern'],
      ['soc', 'intern'],
    ],
    hardExclude: [['swe'], ['ml'], ['ai'], ['pentest'], ...OFF_DOMAIN],
  }),
  withMeta({
    id: 'ml-engineer',
    canonical: 'ML Engineer',
    domain: 'ai_ml',
    specialization: 'machine-learning',
    employmentType: 'job',
    titles: ['ML Engineer', 'Machine Learning Engineer', 'Applied ML Engineer', 'Junior ML Engineer'],
    include: [
      ['ml', 'engineer'],
      ['ml', 'engineering'],
    ],
    hardExclude: [...JOB_HARD_EXCLUDE, ['swe'], ['datascientist']],
  }),
  withMeta({
    id: 'ai-engineer',
    canonical: 'AI Engineer',
    domain: 'ai_ml',
    specialization: 'artificial-intelligence',
    employmentType: 'job',
    titles: ['AI Engineer', 'Artificial Intelligence Engineer', 'Applied AI Engineer', 'AI/ML Engineer', 'Junior AI Engineer'],
    include: [
      ['ai', 'engineer'],
      ['ai', 'engineering'],
    ],
    hardExclude: [...JOB_HARD_EXCLUDE, ['swe']],
  }),
  withMeta({
    id: 'data-scientist',
    canonical: 'Data Scientist',
    domain: 'data_science',
    specialization: 'data-science',
    employmentType: 'job',
    titles: ['Data Scientist', 'Junior Data Scientist', 'Associate Data Scientist', 'Applied Data Scientist'],
    include: [['datascientist']],
    hardExclude: [...JOB_HARD_EXCLUDE, ['swe'], ['engineer']],
  }),
  withMeta({
    id: 'software-engineer',
    canonical: 'Software Engineer',
    domain: 'software',
    specialization: 'software-engineering',
    employmentType: 'job',
    titles: [
      'Software Engineer',
      'Software Developer',
      'Backend Engineer',
      'Full Stack Engineer',
      'Frontend Engineer',
      'Junior Software Engineer',
      'SWE',
    ],
    include: [
      ['swe'],
      ['backend', 'engineer'],
      ['frontend', 'engineer'],
      ['fullstack', 'engineer'],
    ],
    hardExclude: [...JOB_HARD_EXCLUDE, ['ml'], ['ai'], ['datascientist'], ['cyber']],
  }),
  withMeta({
    id: 'soc-analyst',
    canonical: 'SOC Analyst',
    domain: 'cybersecurity',
    specialization: 'soc',
    employmentType: 'job',
    titles: ['SOC Analyst', 'SOC Analyst I', 'Junior SOC Analyst', 'Security Operations Analyst', 'Cyber SOC Analyst'],
    include: [
      ['soc', 'analyst'],
      ['soc'],
    ],
    hardExclude: [...JOB_HARD_EXCLUDE, ['pentest'], ['swe'], ['ml'], ['ai']],
  }),
  withMeta({
    id: 'penetration-tester',
    canonical: 'Penetration Tester',
    domain: 'cybersecurity',
    specialization: 'penetration-testing',
    employmentType: 'job',
    titles: [
      'Penetration Tester',
      'Junior Penetration Tester',
      'Pentester',
      'Junior Pentester',
      'Ethical Hacker',
      'Offensive Security Engineer',
    ],
    include: [
      ['pentest'],
      ['ethical', 'hacker'],
      ['offensive', 'security'],
    ],
    hardExclude: [...JOB_HARD_EXCLUDE, ['soc'], ['swe'], ['ml'], ['ai']],
  }),
  withMeta({
    id: 'security-engineer',
    canonical: 'Security Engineer',
    domain: 'cybersecurity',
    specialization: 'security-engineering',
    employmentType: 'job',
    titles: ['Security Engineer', 'Cybersecurity Engineer', 'Junior Security Engineer', 'Application Security Engineer'],
    include: [
      ['security', 'engineer'],
      ['cyber', 'engineer'],
    ],
    hardExclude: [...JOB_HARD_EXCLUDE, ['pentest'], ['soc'], ['swe'], ['ml'], ['ai']],
  }),
  withMeta({
    id: 'cybersecurity-specialist',
    canonical: 'Cybersecurity Specialist',
    domain: 'cybersecurity',
    specialization: 'cybersecurity',
    employmentType: 'job',
    titles: [
      'Cybersecurity Specialist',
      'Cyber Security Specialist',
      'Information Security Specialist',
      'Junior Cybersecurity Specialist',
      'Security Specialist',
    ],
    include: [
      ['cyber', 'specialist'],
      ['security', 'specialist'],
      ['cyber'],
    ],
    hardExclude: [...JOB_HARD_EXCLUDE, ['pentest'], ['soc'], ['engineer'], ['swe'], ['ml'], ['ai']],
  }),
];

function scoreFamily(tokens, family) {
  if (hasAnyGroup(tokens, family.hardExclude)) return 0;
  let best = 0;
  for (const group of family.include) {
    if (hasAll(tokens, group)) best = Math.max(best, 10 + group.length);
  }
  if (hasAll(tokens, tokenizeRole(family.canonical))) best = Math.max(best, 40);
  return best;
}

function customFamily(raw, tokens) {
  const intern = isInternshipTitle(raw);
  const employmentType = intern ? 'internship' : 'job';
  const domain = inferDomainFromTokens(tokens);
  return withMeta({
    id: `custom:${raw.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    canonical: raw,
    domain,
    specialization: domain === 'general' ? null : domain,
    employmentType,
    titles: [raw],
    include: [tokens],
    hardExclude: intern ? OFF_DOMAIN : [...JOB_HARD_EXCLUDE, ...OFF_DOMAIN],
  });
}

export function resolveRoleFamily(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    return withMeta({
      id: 'unknown',
      canonical: '',
      domain: 'general',
      employmentType: 'job',
      titles: [],
      include: [],
      hardExclude: [],
    });
  }
  const tokens = tokenizeRole(raw);
  let best = null;
  let bestScore = 0;
  for (const family of ROLE_FAMILIES) {
    const score = scoreFamily(tokens, family);
    if (score > bestScore) {
      bestScore = score;
      best = family;
    }
  }
  if (best && bestScore >= 10) return best;
  return customFamily(raw, tokens);
}

export function titleMatchesFamily(title, family) {
  if (!family?.canonical) return false;
  const tokens = tokenizeRole(title);
  if (!tokens.length) return false;
  if (hasAnyGroup(tokens, family.hardExclude)) return false;
  if (family.employmentType === 'internship' && !isInternshipTitle(title)) return false;
  if (family.employmentType === 'job' && isInternshipTitle(title)) return false;
  if (hasAnyGroup(tokens, family.include)) return true;
  const canon = tokenizeRole(family.canonical);
  return canon.length > 0 && hasAll(tokens, canon);
}

export function searchedTitlesFor(family) {
  const titles = [...(family.titles || [])];
  if (family.canonical && !titles.includes(family.canonical)) titles.unshift(family.canonical);
  return [...new Set(titles)];
}

export function isInternshipFamily(family) {
  return family?.employmentType === 'internship' || family?.searchType === 'internships' || /\bintern(ship)?\b/i.test(family?.canonical || '');
}

export function searchNounFor(familyOrType) {
  if (familyOrType === 'internships' || familyOrType === 'Internship') return 'internships';
  if (familyOrType === 'jobs' || familyOrType === 'Job') return 'jobs';
  return isInternshipFamily(familyOrType) ? 'internships' : 'jobs';
}

/** Progress copy is derived from role normalization — internships vs jobs. */
export function analysisPhasesFor(familyOrType) {
  const intern = searchNounFor(familyOrType) === 'internships';
  const noun = intern ? 'internships' : 'jobs';
  return [
    { id: 'search', label: intern ? 'Searching internships' : 'Searching jobs', percent: 8 },
    { id: 'existing', label: intern ? 'Reading internships we already have' : 'Reading jobs we already have', percent: 22 },
    { id: 'research', label: intern ? 'Searching live internships' : 'Searching live jobs', percent: 40 },
    { id: 'extract', label: `Listing the skills those ${noun} ask for`, percent: 55 },
    { id: 'compare', label: 'Comparing that with your profile', percent: 68 },
    { id: 'gaps', label: 'Finding what you still need', percent: 80 },
    { id: 'roadmap', label: 'Writing your week-by-week plan', percent: 92 },
  ];
}
