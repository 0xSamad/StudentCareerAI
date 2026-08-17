/**
 * Coach-style diagnosis from FACTS. AI may rewrite wording later.
 * Never invents skills, percentages, or student experience.
 */

import { STATUS } from './gap-model.mjs';
import { baselineFor, IMPORTANCE } from './role-baseline.mjs';
import { gapCards } from './enrich-gaps.mjs';
import { isInternshipFamily } from './role-families.mjs';
import { buildIntelligenceReport, buildPositionNarrative } from './report-model.mjs';

function unique(list) {
  return [...new Set((list || []).filter(Boolean))];
}

function joinAnd(items = []) {
  const list = items.filter(Boolean);
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

export function buildCurrentPosition(enrichedGaps, collected, family = null) {
  const alreadyHave = [];
  const partial = [];
  const missing = [];
  const academic = [...(collected.academic || collected.coursework || [])].filter(
    (s) => s !== 'Communication' && s !== 'Teamwork' && s !== 'Problem Solving'
  );
  const relevant = (enrichedGaps || []).filter(
    (g) =>
      g.importance === IMPORTANCE.CORE ||
      g.importance === IMPORTANCE.HIGH_VALUE ||
      g.importance === IMPORTANCE.COMMON
  );

  for (const g of relevant) {
    if (g.status === STATUS.ALREADY_HAVE) alreadyHave.push(g.skill);
    else if (g.status === STATUS.PARTIAL) partial.push(g.skill);
    else if (g.status === STATUS.MISSING || g.status === STATUS.UNKNOWN) missing.push(g.skill);
  }

  const academicOnly = academic.filter((s) => !alreadyHave.includes(s));
  const theoryHeavy = academicOnly.length >= 2 && (collected.projectCount || 0) < 2;
  const internWord = isInternshipFamily(family) ? 'intern' : 'junior';
  if (theoryHeavy) {
    return {
      alreadyHave: unique(alreadyHave).slice(0, 12),
      partial: unique(partial).slice(0, 10),
      missing: unique(missing).slice(0, 12),
      academic: unique(academic).slice(0, 12),
      theoryHeavy,
      summary: `You already have classroom exposure in ${joinAnd(unique(academic).slice(0, 3)) || 'your degree'}. Convert that into ${internWord}-ready project evidence — that is the main gap.`,
    };
  }

  return {
    alreadyHave: unique(alreadyHave).slice(0, 12),
    partial: unique(partial).slice(0, 10),
    missing: unique(missing).slice(0, 12),
    academic: unique(academic).slice(0, 12),
    theoryHeavy,
    summary: buildPositionNarrative(
      { alreadyHave: unique(alreadyHave), partial: unique(partial), missing: unique(missing), summary: '' },
      family
    ),
  };
}

export function buildMarketExpects(enrichedGaps) {
  const rank = { CORE: 4, 'HIGH-VALUE': 3, COMMON: 2, OPTIONAL: 1 };
  const rows = [...(enrichedGaps || [])]
    .sort((a, b) => (rank[b.importance] || 0) - (rank[a.importance] || 0) || (b.frequencyPercent || 0) - (a.frequencyPercent || 0))
    .slice(0, 12)
    .map((g) => ({
      skill: g.skill,
      importance: g.importance || IMPORTANCE.OPTIONAL,
      demand: g.marketPercent,
      pakistan: g.pakistanPercent,
      international: g.internationalPercent,
      status: g.status,
      kind: g.kind,
    }));
  return {
    core: rows.filter((r) => r.importance === IMPORTANCE.CORE),
    common: rows.filter((r) => r.importance === IMPORTANCE.COMMON),
    highValue: rows.filter((r) => r.importance === IMPORTANCE.HIGH_VALUE),
    optional: rows.filter((r) => r.importance === IMPORTANCE.OPTIONAL).slice(0, 4),
    top: rows,
  };
}

export function buildActionPlan(position, cards, projects, family) {
  const remember = [];
  const firstGap = cards[0];
  const intern = isInternshipFamily(family);
  const cyber = family?.domain === 'cybersecurity';
  const second = cards[1];
  const project = projects[0];
  const deploy = projects.find((p) => p.id === 'deploy-api');
  if (firstGap) remember.push(`Learn and apply ${firstGap.skill} — ${firstGap.evidenceRequired}`);
  if (project) remember.push(`Build: ${project.title}`);
  if (deploy && !cyber) remember.push('Add FastAPI + Docker around that project.');
  if (cyber && project) remember.push('Finish a lab write-up with evidence — not a tool list.');
  if (!cyber && cards.some((c) => c.skill === 'SQL')) remember.push('Strengthen practical SQL on a real dataset.');
  remember.push(
    intern
      ? 'Start applying to internships once the first strong project is on GitHub — do not wait until you feel 100% ready.'
      : 'Start applying to junior postings once the first strong project is on GitHub — do not wait until you feel 100% ready.'
  );
  if (!cyber && (position.alreadyHave.includes('Python') || position.partial.includes('Python'))) {
    remember.unshift('Do not spend the next two months on beginner Python.');
  }
  if (cyber && (position.alreadyHave.includes('Linux') || position.partial.includes('Linux'))) {
    remember.unshift('Do not spend the next two months on beginner Linux tutorials if you already use it.');
  }
  return unique(remember).slice(0, 5);
}

export function buildNextActions(weeks, projects) {
  const w1 = weeks[0];
  const w2 = weeks[1];
  const month1 = weeks.filter((w) => w.week <= 4);
  return {
    today: [
      w1 ? `Start week 1: ${w1.objective}` : 'Open your profile and list every project you can honestly claim.',
      projects[0] ? `Create an empty GitHub repo titled after: ${projects[0].title}` : 'Create a GitHub repo for this plan.',
    ],
    thisWeek: [
      w1?.deliverables?.[0] || w1?.deliverable?.[0] || w1?.successCriteria || 'Finish the week 1 artifact.',
      w2 ? `Preview week 2: ${w2.objective}` : 'Plan the first project slice.',
    ],
    month1: [
      month1[month1.length - 1]?.successCriteria || 'A recruiter can see one real artifact on GitHub.',
      projects[0] ? `Project underway: ${projects[0].title}` : 'One documented project slice.',
    ],
  };
}

export function buildExecutiveSummary({ analysis, family, position, cards, readiness, collected }) {
  const base = baselineFor(family);
  const postingCount = analysis.metadata?.postingCount || 0;
  const first = cards[0];
  const biggestProblem = position.theoryHeavy
    ? 'academic knowledge without intern-ready project evidence'
    : first
      ? `${first.skill} (${first.status})`
      : 'thin profile evidence';
  const strongest = position.alreadyHave[0]
    ? position.alreadyHave.slice(0, 3).join(', ')
    : position.academic.length
      ? `coursework in ${position.academic.slice(0, 3).join(', ')}`
      : 'your Software Engineering degree in progress';
  const nextStep = first?.whatToBuild || 'Ship one small GitHub artifact this week.';
  return {
    readiness: readiness?.score ?? analysis.readinessScore?.score ?? null,
    target: base.target,
    market: {
      postingCount,
      pakistanCount: analysis.metadata?.pakistanCount || 0,
      internationalCount: analysis.metadata?.internationalCount || 0,
      sampleQuality: analysis.metadata?.sampleQuality || null,
    },
    diagnosis: position.summary,
    biggestProblem,
    strongestAdvantage: strongest,
    nextStep,
    headline: `Your biggest problem is ${biggestProblem}. Your strongest advantage is ${strongest}. Your highest-impact next step is ${nextStep}`,
    education: collected.education || null,
  };
}

export function buildCoachReport({
  analysis,
  family,
  collected,
  enrichedGaps,
  projects,
  weeks,
  phases,
  readiness,
  jobTargets,
}) {
  const position = buildCurrentPosition(enrichedGaps, collected, family);
  const marketExpects = buildMarketExpects(enrichedGaps);
  const cards = gapCards(enrichedGaps, 6);
  const actionPlan = buildActionPlan(position, cards, projects, family);
  const nextAction = buildNextActions(weeks, projects);
  const base = baselineFor(family);
  const coachBase = {
    kind: 'RECOMMENDATION',
    actionPlan,
    executiveSummary: buildExecutiveSummary({ analysis, family, position, cards, readiness, collected }),
    currentPosition: position,
    marketExpects,
    biggestGaps: cards,
    strategy: {
      steps: base.strategy,
      why: position.theoryHeavy
        ? 'You already have classroom exposure. Sequence: close practical gaps, then one serious project, then evidence, then interviews.'
        : 'Learn only what this role actually needs, in the order a hiring manager can see on GitHub.',
    },
    jobReady: base.jobReady,
    applicationStrategy: {
      now: jobTargets.applyNow || jobTargets.now,
      afterPhase2: jobTargets.applyAfterPhase2 || jobTargets.after2Months,
      afterPhase3: jobTargets.applyAfterPhase3 || jobTargets.afterRoadmap,
      why: jobTargets.why,
      note: jobTargets.note,
    },
    nextAction,
    phases,
  };
  const intelligence = buildIntelligenceReport({
    family,
    analysis,
    enrichedGaps,
    collected,
    projects,
    weeks,
    jobTargets,
    readiness,
  });
  return { ...coachBase, intelligence };
}
