/**
 * Structured career-intelligence payload for the Role Analyzer report.
 * All numbers come from analyzed postings + attested profile. Never invented %.
 */

import { STATUS, EVIDENCE_LEVEL } from './gap-model.mjs';
import { IMPORTANCE } from './role-baseline.mjs';
import { isInternshipFamily } from './role-families.mjs';
import { practiceFor } from './learning-units.mjs';

function joinAnd(items = []) {
  const list = items.filter(Boolean);
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

const IMPORTANCE_W = { CORE: 1, 'HIGH-VALUE': 0.78, COMMON: 0.55, OPTIONAL: 0.28 };

export function evidenceStrengthPercent(gap = {}) {
  if (gap.status === STATUS.ALREADY_HAVE || gap.evidenceLevel === EVIDENCE_LEVEL.STRONG) return 85;
  if (gap.evidence === 'project') return 55;
  if (gap.evidence === 'experience') return 50;
  if (gap.status === STATUS.PARTIAL) return 35;
  if (gap.evidenceLevel === EVIDENCE_LEVEL.WEAK || gap.evidence === 'coursework' || gap.evidence === 'cv-prose') return 22;
  return 0;
}

export function evidenceLabel(gap = {}) {
  if (gap.evidenceLevel === EVIDENCE_LEVEL.STRONG || gap.status === STATUS.ALREADY_HAVE) {
    return gap.evidence === 'named' ? 'Named on your profile' : 'Strong evidence on your profile';
  }
  if (gap.evidence === 'project') return 'Partial — appears in a project';
  if (gap.evidence === 'experience') return 'Partial — appears in experience';
  if (gap.evidence === 'coursework') return 'Weak — coursework only';
  if (gap.evidence === 'cv-prose') return 'Weak — mentioned in CV prose';
  return 'No evidence found';
}

export function gapImpactScore(gap = {}) {
  const demand = typeof gap.frequencyPercent === 'number' ? gap.frequencyPercent / 100 : gap.importance === IMPORTANCE.CORE ? 0.45 : 0.2;
  const importance = IMPORTANCE_W[gap.importance] || 0.3;
  const weakness =
    gap.status === STATUS.MISSING || gap.status === STATUS.UNKNOWN ? 1 : gap.status === STATUS.PARTIAL ? 0.55 : 0.08;
  return Math.round(demand * importance * weakness * 1000) / 1000;
}

export function whyItMatters(gap = {}, family = null) {
  const domain = family?.domain || '';
  const intern = isInternshipFamily(family);
  const roleWord = intern ? 'internships' : 'roles';
  if (gap.frequencyPercent != null && gap.postingTotal) {
    return `Asked in ${gap.frequencyPercent}% of analyzed postings (${gap.postingCount || 0}/${gap.postingTotal}).`;
  }
  if (gap.importance === IMPORTANCE.CORE) {
    return `Core requirement for ${family?.canonical || 'this role'} ${roleWord}.`;
  }
  if (domain === 'cybersecurity' && /SIEM|SOC|Incident/i.test(gap.skill)) {
    return 'Required by many SOC and defensive security roles.';
  }
  if (domain === 'cybersecurity' && /Burp|OWASP|Pentest|Web Security/i.test(gap.skill)) {
    return 'Expected for junior offensive / web-security work.';
  }
  return `Established ${String(gap.importance || 'role').toLowerCase()} requirement for this target.`;
}

export function howToClose(gap = {}, family = null) {
  if (gap.whatToBuild) return gap.whatToBuild;
  const skill = gap.skill || 'this skill';
  if (family?.domain === 'cybersecurity') return `Build a short lab or write-up that uses ${skill}.`;
  if (family?.domain === 'ai_ml' || family?.domain === 'data_science') {
    return `Use ${skill} inside a documented GitHub project with a README a recruiter can run.`;
  }
  return `Ship one small GitHub artifact that uses ${skill}.`;
}

export function buildPositionNarrative(position = {}, family = null) {
  const have = (position.alreadyHave || []).slice(0, 4);
  const gaps = (position.missing || []).slice(0, 3);
  const partial = (position.partial || []).slice(0, 3);
  if (have.length && gaps.length) {
    return `You already have a strong foundation in ${joinAnd(have)}. Your biggest gaps are ${joinAnd(gaps)}.`;
  }
  if (have.length && partial.length) {
    return `You already have ${joinAnd(have)}. Raise ${joinAnd(partial)} from coursework or mentions into project evidence.`;
  }
  if (have.length) {
    return `You already have ${joinAnd(have)}. The plan turns that into a portfolio a ${isInternshipFamily(family) ? 'internship' : 'junior'} recruiter can review.`;
  }
  if (gaps.length) {
    return `Your profile does not yet show the core skills for ${family?.canonical || 'this role'}. Start with ${joinAnd(gaps)}.`;
  }
  return position.summary || 'Your profile lists little skill evidence yet. The plan starts with one portfolio artifact.';
}

export function recommendedPathway(family, jobTargets = {}) {
  const stretch = [...(jobTargets.stretch || []), ...(jobTargets.after2Months || [])]
    .filter((t) => t && t !== family?.canonical)
    .slice(0, 2);
  if (family?.id === 'cybersecurity-specialist') return 'Junior Security Analyst / Penetration Tester';
  if (family?.id === 'cybersecurity-intern') return 'SOC Intern / Security Intern';
  if (family?.id === 'soc-analyst') return 'SOC Analyst / Junior Security Analyst';
  if (family?.id === 'penetration-tester') return 'Junior Penetration Tester / AppSec Engineer';
  if (family?.id === 'ai-intern') return 'ML Intern / AI Engineer Intern';
  if (family?.id === 'ml-intern') return 'AI Intern / Junior ML Engineer internships';
  if (family?.id === 'ai-engineer') return 'Junior AI Engineer / Applied ML Engineer';
  if (family?.id === 'ml-engineer') return 'Junior ML Engineer / Applied ML Engineer';
  if (family?.id === 'data-scientist' || family?.id === 'data-science-intern') return 'Data Analyst / Junior Data Scientist';
  if (family?.id === 'software-engineer' || family?.id === 'software-engineering-intern') {
    return 'Junior Software Engineer / Backend Intern';
  }
  if (stretch.length) return stretch.join(' / ');
  return family?.canonical || 'Target role';
}

const DIMENSIONS = {
  cybersecurity: [
    { id: 'fundamentals', label: 'Cybersecurity Fundamentals', skills: ['Security Fundamentals', 'OWASP', 'Vulnerability Assessment'] },
    { id: 'networking', label: 'Networking', skills: ['Networking', 'TCP/IP', 'DNS', 'Firewalls', 'Wireshark'] },
    { id: 'systems', label: 'Linux/Windows', skills: ['Linux', 'Windows', 'Bash', 'PowerShell', 'Active Directory'] },
    { id: 'web', label: 'Web Security', skills: ['Web Security', 'OWASP', 'Burp Suite'] },
    { id: 'tools', label: 'Security Tools', skills: ['Nmap', 'Wireshark', 'Burp Suite', 'Metasploit', 'SIEM', 'Splunk'] },
    { id: 'defense', label: 'Offensive/Defensive Security', skills: ['SIEM', 'Incident Response', 'Penetration Testing', 'Threat Detection', 'SOC'] },
    { id: 'cloud', label: 'Cloud Security', skills: ['Cloud Security', 'AWS', 'Azure', 'IAM'] },
    { id: 'projects', label: 'Practical Projects', skills: [] },
  ],
  ai_ml: [
    { id: 'python', label: 'Python', skills: ['Python', 'Git'] },
    { id: 'ml', label: 'Machine Learning', skills: ['Machine Learning', 'scikit-learn', 'Pandas', 'NumPy'] },
    { id: 'dl', label: 'Deep Learning', skills: ['Deep Learning', 'PyTorch', 'TensorFlow'] },
    { id: 'data', label: 'Data / SQL', skills: ['SQL', 'Pandas', 'Statistics'] },
    { id: 'deploy', label: 'Deployment', skills: ['Docker', 'FastAPI', 'AWS'] },
    { id: 'projects', label: 'Practical Projects', skills: [] },
  ],
  data_science: [
    { id: 'python', label: 'Python', skills: ['Python'] },
    { id: 'sql', label: 'SQL', skills: ['SQL', 'PostgreSQL'] },
    { id: 'stats', label: 'Statistics', skills: ['Statistics', 'Probability'] },
    { id: 'analysis', label: 'Analysis stack', skills: ['Pandas', 'NumPy', 'scikit-learn'] },
    { id: 'viz', label: 'Presentation', skills: ['Tableau', 'Power BI', 'Excel'] },
    { id: 'projects', label: 'Practical Projects', skills: [] },
  ],
  software: [
    { id: 'lang', label: 'Programming', skills: ['Python', 'JavaScript', 'TypeScript'] },
    { id: 'git', label: 'Version control', skills: ['Git', 'GitHub'] },
    { id: 'data', label: 'Data stores', skills: ['SQL', 'PostgreSQL'] },
    { id: 'web', label: 'Web / APIs', skills: ['FastAPI', 'React', 'REST APIs', 'Node.js'] },
    { id: 'ship', label: 'Shipping', skills: ['Docker', 'CI/CD', 'Linux'] },
    { id: 'projects', label: 'Practical Projects', skills: [] },
  ],
};

function coveragePercent(gaps, names, collected) {
  if (names.length === 0) {
    const n = collected?.projectCount || 0;
    if (!n) return 12;
    if (n === 1) return 42;
    return Math.min(72, 28 + n * 12);
  }
  const rows = names.map((skill) => gaps.find((g) => g.skill === skill)).filter(Boolean);
  if (!rows.length) return null;
  const pts = rows.map((g) => evidenceStrengthPercent(g));
  return Math.round(pts.reduce((s, n) => s + n, 0) / pts.length);
}

export function dimensionScores(family, enrichedGaps = [], collected = {}) {
  const dims = DIMENSIONS[family?.domain] || DIMENSIONS.software;
  return dims
    .map((d) => {
      const percent = coveragePercent(enrichedGaps, d.skills, collected);
      return percent == null ? null : { id: d.id, label: d.label, percent, skills: d.skills };
    })
    .filter(Boolean)
    .slice(0, 8);
}

export function next7Days(weeks = [], projects = [], family = null) {
  const w1 = weeks[0] || {};
  const learn = (w1.learn || w1.topics || []).filter(Boolean);
  const practice = (w1.practice || w1.practicalTasks || []).filter(Boolean);
  const project = projects[0];
  const skill = (w1.skills || []).find(Boolean) || family?.canonical || 'this role';
  const intern = isInternshipFamily(family);
  const domain = family?.domain || '';
  const repo = (project?.title || `${family?.canonical || 'role'}-lab`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const measurable =
    domain === 'cybersecurity'
      ? intern
        ? 'Complete 3 Linux lab tasks (users, logs, one packet capture) and paste the commands into the README.'
        : practice[0] || 'Complete 5 PortSwigger or legal-lab tasks for the first gap skill and write the finding in one paragraph each.'
      : domain === 'software'
        ? practice[0] || `Solve 5 problems that use ${skill} and commit the solutions with a 10-line note of what you learned.`
        : practice[0] || practiceFor(skill, 'MISSING');
  return [
    { day: 1, title: 'Set the board', work: `Create GitHub repo \`${repo}\`. Write a 5-line README: target role (${family?.canonical || 'this role'}), week-1 skill (${skill}), and “no invented metrics”.` },
    { day: 2, title: 'Learn', work: learn[0] ? `Study “${learn[0]}” for 90 minutes. Write 8 bullets you could explain without notes.` : `Read official docs for ${skill} for 90 minutes. Write 8 bullets of what you actually understood.` },
    { day: 3, title: 'Learn + tiny practice', work: learn[1] ? `Study “${learn[1]}”. Then spend 45 minutes producing one screenshot or command log.` : `Continue ${skill} with one small exercise you can screenshot.` },
    { day: 4, title: 'Practice (measurable)', work: measurable },
    { day: 5, title: 'Start the artifact', work: w1.build || w1.projectWork || (project ? `Scaffold ${project.title}: empty folders + README headings from the project brief.` : 'Start the week 1 GitHub artifact with a runnable placeholder.') },
    { day: 6, title: 'Push evidence', work: (w1.deliverable || w1.deliverables)?.[0] || 'Commit README + the Day 4 artifact. Include a Limitations section. Do not invent metrics.' },
    { day: 7, title: 'Interview + review', work: (w1.interview || w1.interviewPreparation)?.[0] ? `Record a 4-minute answer: ${(w1.interview || w1.interviewPreparation)[0]}. Check the week 1 milestone: ${w1.successCriteria || w1.milestone || 'artifact exists'}.` : `Explain ${skill} out loud for 4 minutes using only what you built this week.` },
  ];
}

const INTERVIEW_BANKS = {
  cybersecurity: [
    { id: 'networking', title: 'Networking questions', items: ['What happens when you type a URL?', 'TCP vs UDP in one minute', 'How DNS resolution works', 'How you would read a packet capture'] },
    { id: 'linux', title: 'Linux questions', items: ['How you inspect logs on Linux', 'Permissions vs ownership', 'What you would do after a suspicious process', 'How you stay inside a lab scope'] },
    { id: 'web', title: 'Web security questions', items: ['Authentication vs authorization', 'XSS vs injection', 'How you would test a login form in a legal lab', 'How you would retest a fix'] },
    { id: 'tools', title: 'Security tooling questions', items: ['When you use Nmap vs a web proxy', 'What Burp Repeater is for', 'How you write findings, not a tool dump', 'A false positive you would expect'] },
    { id: 'ir', title: 'Incident response', items: ['First 15 minutes of an alert', 'How you write a timeline', 'What you escalate vs close', 'Containment vs eradication'] },
    { id: 'projects', title: 'Project deep dives', items: ['Walk through one lab finding with evidence', 'What failed and what you tried next', 'How a stranger reproduces your write-up'] },
    { id: 'behavioral', title: 'Behavioral questions', items: ['A time you stayed in scope / followed rules', 'A disagreement about severity', 'How you learn a new tool without a course binge'] },
  ],
  ai_ml: [
    { id: 'python', title: 'Python questions', items: ['Debugging a data pipeline', 'When you vectorize vs loop', 'How you pin dependencies'] },
    { id: 'ml', title: 'ML questions', items: ['Train/test leakage', 'Why F1 not accuracy', 'A baseline before a fancy model'] },
    { id: 'dl', title: 'Deep learning questions', items: ['Forward vs backward', 'Why zero_grad', 'Overfitting you actually observed'] },
    { id: 'deploy', title: 'Deployment questions', items: ['How you would demo /predict in 8 minutes', 'Input validation', 'What you would monitor'] },
    { id: 'systems', title: 'System design (junior)', items: ['How you would retrain', 'Where the model artifact lives', 'What you would not build yet'] },
    { id: 'projects', title: 'Project questions', items: ['Why this metric', 'One error you saw', 'What you would try next'] },
    { id: 'behavioral', title: 'Behavioral questions', items: ['A time you were wrong about a result', 'Explaining a metric to a non-ML manager'] },
  ],
  data_science: [
    { id: 'sql', title: 'SQL questions', items: ['JOIN types', 'GROUP BY vs window', 'How you debug a slow query'] },
    { id: 'stats', title: 'Statistics questions', items: ['Bias vs variance in one minute', 'Why the metric matches the problem'] },
    { id: 'python', title: 'Python / pandas', items: ['groupby vs SQL GROUP BY', 'Leakage in a notebook'] },
    { id: 'projects', title: 'Project deep dives', items: ['Walk through findings without inventing numbers', 'A limitation of the dataset'] },
    { id: 'behavioral', title: 'Behavioral questions', items: ['A time the data disagreed with a stakeholder'] },
  ],
  software: [
    { id: 'dsa', title: 'DSA questions', items: ['Walk through an array/hash-map solution you wrote', 'Time vs space of a function in YOUR project', 'How you would test an edge case'] },
    { id: 'oop', title: 'OOP questions', items: ['A class you actually wrote and why', 'Encapsulation vs a dump of globals', 'Where you would put error handling'] },
    { id: 'db', title: 'Database questions', items: ['JOIN types', 'How you would model one table from YOUR API', 'SQL vs filtering in application code'] },
    { id: 'api', title: 'APIs', items: ['How you design a POST endpoint', 'Validation you actually wrote', 'What you would log'] },
    { id: 'systems', title: 'Junior system design', items: ['How you would split a tiny service', 'What you would not build yet', 'A failure mode you would handle first'] },
    { id: 'git', title: 'Git / collaboration', items: ['What goes in a commit message', 'How you would revert'] },
    { id: 'projects', title: 'Project deep dives', items: ['Walk through the README a stranger would follow', 'A bug you fixed'] },
    { id: 'behavioral', title: 'Behavioral questions', items: ['A time you simplified a design'] },
  ],
};

export function interviewPrep(family, enrichedGaps = [], projects = []) {
  const domain = family?.domain || 'software';
  const spec = family?.specialization || '';
  let bank = INTERVIEW_BANKS[domain] || INTERVIEW_BANKS.software;
  if (domain === 'cybersecurity') {
    if (family?.id === 'cybersecurity-intern') {
      bank = bank.filter((s) => ['networking', 'linux', 'web', 'projects', 'behavioral'].includes(s.id));
    } else if (spec === 'soc') {
      bank = bank.filter((s) => s.id !== 'web');
    } else if (spec === 'penetration-testing') {
      bank = bank.filter((s) => s.id !== 'ir');
    }
  }
  const project = projects[0];
  return {
    role: family?.canonical || '',
    domain,
    note: 'Practice from YOUR artifacts. These are question themes, not a guarantee of interview topics.',
    sections: bank.map((section) => {
      if (section.id === 'projects' && project) {
        return {
          ...section,
          items: [`Walk through ${project.title} in 8 minutes`, project.interviewAngle, ...section.items.slice(0, 2)].filter(Boolean),
        };
      }
      return section;
    }),
    fromGaps: enrichedGaps
      .filter((g) => g.status === STATUS.MISSING || g.status === STATUS.PARTIAL)
      .slice(0, 4)
      .map((g) => `Be ready to say what you practiced for ${g.skill} this month — no invented metrics.`),
  };
}

export function careerActionPlan({ cards = [], projects = [], family, weeks = [] } = {}) {
  const intern = isInternshipFamily(family);
  const steps = [];
  if (cards[0]) steps.push(`Close ${cards[0].skill} gap`);
  if (projects[0]) steps.push(`Build ${projects[0].title}`);
  if (cards[1]) steps.push(`Learn ${cards[1].skill}`);
  if (projects[1]) steps.push(`Build ${projects[1].title}`);
  else if (family?.domain === 'cybersecurity') steps.push('Complete 10 security labs on a legal target');
  else steps.push('Complete practice problems tied to week 1–4 skills');
  steps.push('Prepare technical interview answers from YOUR project');
  steps.push('Update CV and GitHub from attested facts only');
  steps.push(intern ? 'Start applying to internships' : 'Start applying to junior postings');
  const w1 = weeks[0];
  if (w1 && steps.length < 8) steps.unshift(`This week: ${w1.objective}`);
  return [...new Set(steps)].slice(0, 8);
}

export function strengthCards(enrichedGaps = [], family = null) {
  return enrichedGaps
    .filter((g) => g.status === STATUS.ALREADY_HAVE)
    .sort((a, b) => (b.frequencyPercent || 0) - (a.frequencyPercent || 0))
    .slice(0, 6)
    .map((g) => ({
      skill: g.skill,
      marketPercent: g.frequencyPercent ?? null,
      marketCount: g.postingCount || 0,
      marketTotal: g.postingTotal || 0,
      evidence: evidenceLabel(g),
      evidenceLevel: g.evidenceLevel || EVIDENCE_LEVEL.STRONG,
      why: whyItMatters(g, family),
    }));
}

export function rankedGapCards(enrichedGaps = [], family = null, limit = 6) {
  return [...enrichedGaps]
    .filter((g) => g.status !== STATUS.ALREADY_HAVE)
    .map((g) => ({ gap: g, impact: gapImpactScore(g) }))
    .sort((a, b) => b.impact - a.impact)
    .slice(0, limit)
    .map(({ gap, impact }, i) => ({
      rank: i + 1,
      skill: gap.skill,
      priority: gap.priorityLabel || gap.priority,
      importance: gap.importance,
      status: gap.status,
      demandPercent: gap.frequencyPercent ?? null,
      demandCount: gap.postingCount || 0,
      demandTotal: gap.postingTotal || 0,
      evidence: evidenceLabel(gap),
      evidenceLevel: gap.evidenceLevel || EVIDENCE_LEVEL.NONE,
      why: gap.reason || whyItMatters(gap, family),
      howToClose: howToClose(gap, family),
      whatToLearn: gap.whatToLearn || [],
      impact,
    }));
}

export function pakistanInternationalRows(enrichedGaps = [], pakistanCount = 0, internationalCount = 0) {
  const min = 5;
  if (pakistanCount < min || internationalCount < min) {
    return {
      ok: false,
      pakistanCount,
      internationalCount,
      message:
        pakistanCount < min
          ? 'Insufficient Pakistan postings to make a reliable comparison.'
          : 'Insufficient international postings to make a reliable comparison.',
      rows: [],
    };
  }
  const rows = enrichedGaps
    .filter((g) => g.pakistanPercent != null || g.internationalPercent != null)
    .filter((g) => g.pakistanPercent != null && g.internationalPercent != null)
    .sort((a, b) => (b.frequencyPercent || 0) - (a.frequencyPercent || 0))
    .slice(0, 10)
    .map((g) => ({
      skill: g.skill,
      pakistanPercent: g.pakistanPercent,
      pakistanCount: g.pakistanCount,
      pakistanTotal: g.pakistanTotal,
      internationalPercent: g.internationalPercent,
      internationalCount: g.internationalCount,
      internationalTotal: g.internationalTotal,
    }));
  return { ok: rows.length > 0, pakistanCount, internationalCount, message: null, rows };
}

export function youVsMarketRows(enrichedGaps = []) {
  return enrichedGaps
    .filter((g) => g.frequencyPercent != null || g.importance === IMPORTANCE.CORE)
    .sort((a, b) => (b.frequencyPercent || 0) - (a.frequencyPercent || 0))
    .slice(0, 10)
    .map((g) => ({
      skill: g.skill,
      marketPercent: g.frequencyPercent ?? null,
      marketCount: g.postingCount || 0,
      marketTotal: g.postingTotal || 0,
      youPercent: evidenceStrengthPercent(g),
      youLabel: evidenceLabel(g),
      status: g.status,
    }));
}

export function buildIntelligenceReport({
  family,
  analysis,
  enrichedGaps,
  collected,
  projects,
  weeks,
  jobTargets,
  readiness,
}) {
  const position = {
    alreadyHave: (enrichedGaps || []).filter((g) => g.status === STATUS.ALREADY_HAVE).map((g) => g.skill),
    partial: (enrichedGaps || []).filter((g) => g.status === STATUS.PARTIAL).map((g) => g.skill),
    missing: (enrichedGaps || []).filter((g) => g.status === STATUS.MISSING || g.status === STATUS.UNKNOWN).map((g) => g.skill),
  };
  return {
    recommendedPathway: recommendedPathway(family, jobTargets),
    positionNarrative: buildPositionNarrative(
      {
        alreadyHave: position.alreadyHave,
        partial: position.partial,
        missing: position.missing,
        summary: '',
      },
      family
    ),
    strengths: strengthCards(enrichedGaps, family),
    rankedGaps: rankedGapCards(enrichedGaps, family, 6),
    youVsMarket: youVsMarketRows(enrichedGaps),
    pakistanInternational: pakistanInternationalRows(
      enrichedGaps,
      analysis?.metadata?.pakistanCount || analysis?.pakistan_postings || 0,
      analysis?.metadata?.internationalCount || analysis?.international_postings || 0
    ),
    dimensions: dimensionScores(family, enrichedGaps, collected),
    next7Days: next7Days(weeks, projects, family),
    interviewPrep: interviewPrep(family, enrichedGaps, projects),
    careerActionPlan: careerActionPlan({ cards: rankedGapCards(enrichedGaps, family, 4), projects, family, weeks }),
    scores: {
      skillReadiness: analysis?.readiness_score || readiness?.skillReadiness || null,
      marketMatch: analysis?.market_match_score || readiness?.marketMatch || null,
      jobCompetitiveness: analysis?.job_competitiveness_score || readiness?.jobCompetitiveness || {
        score: readiness?.score ?? null,
        explanation: readiness?.explanation || '',
      },
    },
  };
}
