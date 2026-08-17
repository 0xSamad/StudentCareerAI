/**
 * Three deterministic scores. The LLM may explain them; it must not invent them.
 *
 * Skill Readiness
 *   percent = round( (full + partial * 0.22) / n * 100 )
 *   over this role's CORE skills plus domain foundations present in `gaps`.
 *
 * Market Match
 *   percent = round( earnedWeight / demandWeight * 100 )
 *   where demandWeight is the sum of MARKET skill frequencies, full coverage
 *   earns the full weight, PARTIAL earns 0.45. Null if there are no postings.
 *
 * Job Competitiveness
 *   weighted mix, then capped:
 *     foundations 20% + coreIndustry 22% + portfolio 16%
 *     + experience 8% + deployment 18% + interview 16%
 *   honestyCap lowers the result when CORE skills are missing.
 */

import { STATUS, EVIDENCE_LEVEL } from './gap-model.mjs';
import { IMPORTANCE, baselineFor } from './role-baseline.mjs';
import { coverageAgainstDemand } from './market-coverage.mjs';
import { isInternshipFamily, resolveRoleFamily } from './role-families.mjs';

const WEIGHTS = {
  foundations: 0.2,
  coreIndustry: 0.22,
  portfolio: 0.16,
  experience: 0.08,
  deployment: 0.18,
  interview: 0.16,
};

const PARTIAL_WEIGHT = 0.22;

const DEPLOY_BY_DOMAIN = {
  ai_ml: new Set(['Docker', 'FastAPI', 'Kubernetes', 'AWS', 'GCP', 'Azure', 'CI/CD']),
  data_science: new Set(['Docker', 'SQL', 'Tableau', 'Power BI', 'Git']),
  software: new Set(['Docker', 'CI/CD', 'Git', 'AWS', 'Linux']),
  cybersecurity: new Set(['Linux', 'Git', 'Security Reporting', 'SIEM', 'Nmap']),
  general: new Set(['Git', 'Linux']),
};

const FOUNDATIONS_BY_DOMAIN = {
  ai_ml: new Set(['Python', 'Git', 'SQL', 'Statistics', 'Probability', 'Linear Algebra', 'NumPy', 'Pandas', 'Machine Learning']),
  data_science: new Set(['Python', 'Git', 'SQL', 'Statistics', 'Probability', 'Pandas', 'NumPy']),
  software: new Set(['Python', 'Git', 'SQL', 'JavaScript', 'Data Structures', 'Linux']),
  cybersecurity: new Set(['Security Fundamentals', 'Networking', 'Linux', 'Windows', 'Bash']),
  general: new Set(['Git']),
};

const EXP_SKILLS_BY_DOMAIN = {
  ai_ml: new Set(['Python', 'Machine Learning', 'Pandas', 'SQL', 'PyTorch', 'scikit-learn', 'Deep Learning', 'NumPy', 'FastAPI']),
  data_science: new Set(['Python', 'SQL', 'Pandas', 'Statistics', 'Tableau']),
  software: new Set(['Python', 'JavaScript', 'Git', 'SQL', 'Docker', 'React']),
  cybersecurity: new Set([
    'Linux',
    'Networking',
    'SIEM',
    'Nmap',
    'Burp Suite',
    'OWASP',
    'Incident Response',
    'Penetration Testing',
    'Python',
    'Wireshark',
  ]),
  general: new Set(['Git', 'Python']),
};

function hydrateFamily(family) {
  if (!family) return family;
  if (family.domain && family.employmentType) return family;
  if (family.canonical || family.id) {
    const resolved = resolveRoleFamily(family.canonical || family.id);
    return { ...resolved, ...family, domain: family.domain || resolved.domain, employmentType: family.employmentType || resolved.employmentType };
  }
  return family;
}

function domainOf(family) {
  return hydrateFamily(family)?.domain || 'general';
}

function coverage(gaps, predicate) {
  const rows = gaps.filter(predicate);
  if (!rows.length) return { percent: null, have: 0, total: 0, note: 'No skills in this bucket for this role.' };
  const full = rows.filter((g) => g.status === STATUS.ALREADY_HAVE).length;
  const partial = rows.filter((g) => g.status === STATUS.PARTIAL).length;
  const percent = Math.round(((full + partial * PARTIAL_WEIGHT) / rows.length) * 100);
  return {
    percent: Math.min(100, percent),
    have: full,
    partial,
    total: rows.length,
    note: `${full} solid, ${partial} partial, ${rows.length - full - partial} missing of ${rows.length}.`,
  };
}

function portfolioScore(collected, gaps, family) {
  const n = collected.projectCount || 0;
  const intern = isInternshipFamily(family);
  if (!n) {
    return {
      percent: intern ? 12 : 8,
      note: intern
        ? 'No projects on your profile. This is usually the main intern blocker.'
        : 'No projects on your profile. Junior jobs still expect a lab or GitHub artifact.',
    };
  }
  const demanded = gaps
    .filter((g) => g.importance === IMPORTANCE.CORE || (g.frequencyPercent || 0) >= 30)
    .map((g) => g.skill);
  const hits = demanded.filter((s) => collected.projects.has(s)).length;
  const volume = n === 1 ? 16 : n === 2 ? 24 : 32;
  const mapped = demanded.length ? Math.round((hits / demanded.length) * 36) : 8;
  const relevance = demanded.length && hits === 0 ? 0.4 : demanded.length && hits / demanded.length < 0.35 ? 0.65 : 1;
  const percent = Math.min(68, Math.round((volume + mapped) * relevance));
  const note =
    hits === 0
      ? `${n} project${n === 1 ? '' : 's'} listed, but none clearly show the skills this role asks for.`
      : n === 1
        ? 'One project — add a second that a recruiter can run.'
        : `${n} attested projects; score reflects overlap with this role, not the count.`;
  return { percent, note };
}

function experienceScore(collected, family) {
  const internRole = isInternshipFamily(family);
  const n = collected.experienceCount || 0;
  const expSkills = EXP_SKILLS_BY_DOMAIN[domainOf(family)] || EXP_SKILLS_BY_DOMAIN.general;
  const relevant = [...(collected.experience || [])].some((s) => expSkills.has(s));
  if (internRole) {
    if (n >= 1 && relevant) return { percent: 52, note: 'You have work evidence that overlaps this intern role — still not a finished intern portfolio.' };
    if (n >= 1) return { percent: 34, note: 'You have work experience, but it is not clearly this intern role. Internships still accept projects.' };
    return { percent: 28, note: 'No work experience yet — internships often still accept coursework plus projects.' };
  }
  if (n >= 2 && relevant) return { percent: 70, note: 'Multiple attested roles with overlapping skills.' };
  if (n >= 2) return { percent: 55, note: 'Multiple attested roles.' };
  if (n === 1 && relevant) return { percent: 48, note: 'One attested role that overlaps this job family.' };
  if (n === 1) return { percent: 36, note: 'One attested role.' };
  return { percent: 22, note: 'No attested professional experience.' };
}

function honestyCap(gaps, deploymentPercent) {
  const core = gaps.filter((g) => g.importance === IMPORTANCE.CORE);
  const missingCore = core.filter((g) => g.status === STATUS.MISSING).length;
  const partialCore = core.filter((g) => g.status === STATUS.PARTIAL).length;
  const missingCommon = gaps.filter((g) => g.importance === IMPORTANCE.COMMON && g.status === STATUS.MISSING).length;
  let cap = 86;
  if (missingCore >= 2) cap = Math.min(cap, 40);
  else if (missingCore >= 1) cap = Math.min(cap, 48);
  if (partialCore >= 1 && (deploymentPercent || 0) < 25) cap = Math.min(cap, 54);
  if ((deploymentPercent || 0) < 15 && missingCore + partialCore >= 1) cap = Math.min(cap, 52);
  if (missingCommon >= 2) cap = Math.min(cap, cap - 2);
  return cap;
}

function studentExplanation(score, parts, postingCount, label) {
  const weakest = [...parts].sort((a, b) => (a.percent ?? 100) - (b.percent ?? 100))[0];
  const strongest = [...parts].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))[0];
  const market = postingCount
    ? `from your profile plus ${postingCount} analyzed job ad${postingCount === 1 ? '' : 's'}`
    : 'from your profile plus established role requirements (too few ads to score the market alone)';
  return (
    `${score}/100 ${label} ${market}. ` +
    `Strongest area: ${strongest?.label || 'n/a'} (${strongest?.percent ?? 'n/a'}%). ` +
    `Biggest constraint: ${weakest?.label || 'n/a'} (${weakest?.percent ?? 'n/a'}%). ` +
    `This number is calculated in code. It is not a promise of a job, and it is not the per-job match score.`
  );
}

function weightedScore(labeled, weights = WEIGHTS) {
  const used = labeled
    .map((row) => [weights[row.key], row.percent, row])
    .filter(([, p]) => p != null);
  const weightSum = used.reduce((s, [w]) => s + w, 0) || 1;
  return Math.round(used.reduce((s, [w, p]) => s + (w / weightSum) * p, 0));
}

export function computeSkillReadiness({ gaps = [], family }) {
  const foundations = FOUNDATIONS_BY_DOMAIN[domainOf(family)] || FOUNDATIONS_BY_DOMAIN.general;
  const coreNames = new Set(baselineFor(family).core || []);
  const row = coverage(
    gaps,
    (g) => coreNames.has(g.skill) || foundations.has(g.skill) || g.importance === IMPORTANCE.CORE
  );
  return {
    score: row.percent ?? 0,
    have: row.have,
    partial: row.partial || 0,
    total: row.total,
    explanation: row.note,
    kind: 'DETERMINISTIC',
  };
}

export function computeMarketMatchScore({ gaps = [], marketSkills = [], postingCount = 0 }) {
  const marketRows = (marketSkills || []).filter((s) => s.source === 'MARKET' && s.percent != null);
  if (!postingCount || !marketRows.length) {
    return {
      score: null,
      have: 0,
      total: 0,
      postingCount,
      explanation: postingCount
        ? 'Postings were analyzed but no market skill frequencies were extracted.'
        : 'No analyzed postings — market match is not scored.',
      kind: 'FACT',
    };
  }
  const covered = coverageAgainstDemand(marketRows, gaps);
  return {
    score: covered.percent,
    have: covered.have,
    total: covered.total,
    postingCount,
    explanation:
      covered.percent == null
        ? 'Market match could not be scored from this sample.'
        : `${covered.percent}/100 of analyzed-market skill weight is covered. Denominator is the ${postingCount} posting${postingCount === 1 ? '' : 's'} in this analysis.`,
    kind: 'FACT',
  };
}

export function computeReadiness({ gaps = [], collected, family, postingCount = 0, marketSkills = [] }) {
  family = hydrateFamily(family);
  const domain = domainOf(family);
  const foundationsSet = FOUNDATIONS_BY_DOMAIN[domain] || FOUNDATIONS_BY_DOMAIN.general;
  const deploySet = DEPLOY_BY_DOMAIN[domain] || DEPLOY_BY_DOMAIN.general;
  const foundations = coverage(gaps, (g) => foundationsSet.has(g.skill) || (domain === 'ai_ml' && g.evidence === 'coursework'));
  const coreIndustry = coverage(gaps, (g) => g.importance === IMPORTANCE.CORE || g.importance === IMPORTANCE.COMMON);
  const deployment = coverage(gaps, (g) => deploySet.has(g.skill));
  const portfolio = portfolioScore(collected, gaps, family);
  const experience = experienceScore(collected, family);
  const interview = {
    percent: Math.max(
      8,
      Math.round(((portfolio.percent || 0) * 0.45 + (coreIndustry.percent || 0) * 0.35 + (experience.percent || 0) * 0.2) - 10),
    ),
    note: 'Proxy from skills + projects — not a mock-interview score.',
  };

  const labeled = [
    { key: 'foundations', label: 'Technical foundations', ...foundations },
    { key: 'coreIndustry', label: 'Core industry skills', ...coreIndustry },
    { key: 'portfolio', label: 'Portfolio evidence', ...portfolio },
    { key: 'experience', label: 'Practical experience', ...experience },
    { key: 'deployment', label: domain === 'cybersecurity' ? 'Labs / write-ups' : 'Deployment', ...deployment },
    { key: 'interview', label: 'Interview readiness', ...interview },
  ];

  const raw = weightedScore(labeled);
  const score = Math.max(6, Math.min(honestyCap(gaps, deployment.percent), raw));

  const components = {};
  for (const row of labeled) {
    components[row.key] = { percent: row.percent, note: row.note, have: row.have, total: row.total, label: row.label };
  }
  components.coreSkills = coreIndustry;
  components.highDemand = coreIndustry;
  components.projects = portfolio;
  components.tooling = deployment;

  const skillReadiness = computeSkillReadiness({ gaps, family });
  const marketMatch = computeMarketMatchScore({ gaps, marketSkills, postingCount });

  return {
    score,
    rawScore: raw,
    explanation: studentExplanation(score, labeled.filter((r) => r.percent != null), postingCount, 'job competitiveness'),
    constraint: labeled.filter((r) => r.percent != null).sort((a, b) => a.percent - b.percent)[0]?.label || null,
    advantage: labeled.filter((r) => r.percent != null).sort((a, b) => b.percent - a.percent)[0]?.label || null,
    components,
    breakdown: labeled.map((r) => ({ label: r.label, percent: r.percent, note: r.note })),
    weights: WEIGHTS,
    skillReadiness,
    marketMatch,
    jobCompetitiveness: {
      score,
      explanation: studentExplanation(score, labeled.filter((r) => r.percent != null), postingCount, 'job competitiveness'),
      kind: 'DETERMINISTIC',
    },
  };
}

export { EVIDENCE_LEVEL };
