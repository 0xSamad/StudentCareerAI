/**
 * Enrich skill gaps with Pakistan/International frequencies, why, what to learn,
 * what to build, and evidence. Frequencies are copied from analyzed demand only.
 * Null percent means ROLE_BASELINE — never a fake 33%.
 */

import { impliedParents } from './skill-taxonomy.mjs';
import { STATUS, PRIORITY } from './gap-model.mjs';
import { topicsFor, practiceFor } from './learning-units.mjs';

const EFFORT_HOURS = {
  [`${STATUS.MISSING}|${PRIORITY.CRITICAL}`]: { min: 18, max: 28 },
  [`${STATUS.MISSING}|${PRIORITY.HIGH}`]: { min: 12, max: 20 },
  [`${STATUS.MISSING}|${PRIORITY.MEDIUM}`]: { min: 8, max: 14 },
  [`${STATUS.MISSING}|${PRIORITY.LOW}`]: { min: 4, max: 8 },
  [`${STATUS.PARTIAL}|${PRIORITY.CRITICAL}`]: { min: 10, max: 16 },
  [`${STATUS.PARTIAL}|${PRIORITY.HIGH}`]: { min: 8, max: 12 },
  [`${STATUS.PARTIAL}|${PRIORITY.MEDIUM}`]: { min: 5, max: 8 },
  [`${STATUS.PARTIAL}|${PRIORITY.LOW}`]: { min: 3, max: 6 },
  [`${STATUS.UNKNOWN}|${PRIORITY.CRITICAL}`]: { min: 12, max: 20 },
  [`${STATUS.UNKNOWN}|${PRIORITY.HIGH}`]: { min: 8, max: 14 },
};

function demandMap(rows = []) {
  return Object.fromEntries((rows || []).map((r) => [r.skill, r]));
}

function pctOrNull(row, marketTotal) {
  if (!marketTotal || !row || row.percent == null) return null;
  return row.percent;
}

export function effortFor(status, priority) {
  if (status === STATUS.ALREADY_HAVE) return { min: 2, max: 4, label: '2–4 hours (keep sharp — do not relearn)' };
  const hit = EFFORT_HOURS[`${status}|${priority}`];
  const band = hit || { min: 6, max: 10 };
  return { ...band, label: `${band.min}–${band.max} hours` };
}

function demandPhrase(gap) {
  if (gap.frequencyPercent == null || !gap.postingTotal) {
    if ((gap.postingTotal || 0) >= 10) {
      return `Established ${String(gap.importance || 'role').toLowerCase()} requirement. It was not common enough in this ${gap.postingTotal}-ad sample to quote a percentage.`;
    }
    return `Established ${String(gap.importance || 'role').toLowerCase()} requirement for this role — not a percentage from a tiny sample.`;
  }
  if (gap.postingTotal < 10) {
    return `Appeared in ${gap.postingCount} of ${gap.postingTotal} ads. That sample is too small to treat ${gap.frequencyPercent}% as a market law.`;
  }
  return `Asked in ${gap.frequencyPercent}% of analyzed postings (${gap.postingCount}/${gap.postingTotal}).`;
}

export function priorityReason(gap, { pakistan, international } = {}) {
  const bits = [];
  if (gap.status === STATUS.ALREADY_HAVE) {
    bits.push(`On your profile (${gap.evidence || 'named skill'}).`);
    bits.push(demandPhrase(gap));
    bits.push('Keep it sharp with a recent example. Do not start from zero.');
    return { label: 'MAINTAIN', text: bits.join(' ') };
  }
  if (gap.importance) bits.push(`${gap.importance} for this role.`);
  bits.push(demandPhrase(gap));
  if ((gap.mandatoryCount || 0) > 0) bits.push(`Marked required in ${gap.mandatoryCount} posting${gap.mandatoryCount === 1 ? '' : 's'}.`);
  if (pakistan?.percent != null) bits.push(`Pakistan sample ${pakistan.percent}%.`);
  if (international?.percent != null) bits.push(`International sample ${international.percent}%.`);
  if (gap.evidence === 'coursework') {
    bits.push('Covered through coursework — you still need a practical project that proves it.');
  } else if (gap.status === STATUS.MISSING) {
    bits.push('No evidence on your profile, CV, or projects.');
  } else if (gap.status === STATUS.PARTIAL) {
    bits.push(`Partial evidence only (${gap.evidence}).`);
  }
  return { label: gap.priority, text: bits.join(' ') };
}

function evidenceRequired(gap) {
  if (gap.status === STATUS.ALREADY_HAVE) {
    return `Keep a recent GitHub example that uses ${gap.skill}.`;
  }
  if (gap.skill === 'PyTorch' || gap.skill === 'TensorFlow' || gap.skill === 'Deep Learning') {
    return 'One complete training project on GitHub (code, README, metrics).';
  }
  if (gap.skill === 'Docker' || gap.skill === 'FastAPI') {
    return 'Deploy one trained model behind an API and containerize it.';
  }
  if (gap.skill === 'SQL') {
    return 'A query folder or analytics notebook with JOINs and a short write-up.';
  }
  if (gap.skill === 'Statistics' || gap.skill === 'Probability') {
    return 'Use statistics inside a real dataset project (metrics, not a textbook recap).';
  }
  return `A small GitHub artifact that uses ${gap.skill} the way intern ads describe it.`;
}

function whatToBuild(gap) {
  if (gap.skill === 'PyTorch' || gap.skill === 'Deep Learning') return 'A PyTorch image or tabular model with a documented training loop.';
  if (gap.skill === 'Docker' || gap.skill === 'FastAPI') return 'POST /predict around a saved model, plus a Dockerfile.';
  if (gap.skill === 'SQL') return 'Eight business questions answered with SQL on a real-ish dataset.';
  if (gap.skill === 'scikit-learn' || gap.skill === 'Machine Learning') return 'A leakage-safe sklearn baseline with precision/recall/F1.';
  if (gap.skill === 'Statistics') return 'Interpret metrics and splits inside your ML project — not a separate stats course if you already took the class.';
  return practiceFor(gap.skill, gap.status);
}

export function enrichSkillGaps(skillGaps = [], analysis) {
  const pkMap = demandMap(analysis?.pakistan?.skillDemand);
  const intMap = demandMap(analysis?.international?.skillDemand);
  const pkTotal = analysis?.pakistan?.postingCount || 0;
  const intTotal = analysis?.international?.postingCount || 0;

  return (skillGaps || []).map((gap) => {
    const pk = pkMap[gap.skill];
    const intl = intMap[gap.skill];
    const why = priorityReason(gap, { pakistan: pk, international: intl });
    const effort = effortFor(gap.status, gap.priority);
    const statusForTopics = gap.evidence === 'coursework' || gap.status === STATUS.PARTIAL || gap.status === STATUS.ALREADY_HAVE
      ? 'PARTIAL'
      : gap.status;
    return {
      ...gap,
      marketPercent: gap.frequencyPercent,
      pakistanPercent: pctOrNull(pk, pkTotal),
      pakistanCount: pk ? pk.count : null,
      pakistanTotal: pkTotal || null,
      internationalPercent: pctOrNull(intl, intTotal),
      internationalCount: intl ? intl.count : null,
      internationalTotal: intTotal || null,
      prerequisites: impliedParents(gap.skill),
      estimatedEffort: effort,
      priorityLabel: why.label,
      reason: why.text,
      whatToLearn: topicsFor(gap.skill, statusForTopics),
      whatToPractice: practiceFor(gap.skill, statusForTopics),
      whatToBuild: whatToBuild(gap),
      evidenceRequired: evidenceRequired(gap),
      kind: gap.kind || (gap.frequencyPercent == null ? 'ROLE_BASELINE' : 'FACT'),
    };
  });
}

export function highestImpactGaps(enriched = [], limit = 5) {
  return gapCards(enriched, limit).map((g) => g.skill);
}

export function gapCards(enriched = [], limit = 6) {
  const rank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, MAINTAIN: 0 };
  const imp = { CORE: 4, 'HIGH-VALUE': 3, COMMON: 2, OPTIONAL: 1 };
  return [...enriched]
    .filter((g) => g.status !== STATUS.ALREADY_HAVE)
    .sort((a, b) => {
      const pr = (rank[a.priorityLabel] || rank[a.priority] || 0) - (rank[b.priorityLabel] || rank[b.priority] || 0);
      if (pr) return pr > 0 ? -1 : 1;
      const ia = imp[a.importance] || 0;
      const ib = imp[b.importance] || 0;
      if (ib !== ia) return ib - ia;
      return (b.frequencyPercent || 0) - (a.frequencyPercent || 0);
    })
    .slice(0, limit)
    .map((g) => ({
      skill: g.skill,
      priority: g.priorityLabel || g.priority,
      importance: g.importance,
      status: g.status,
      why: g.reason,
      whatToLearn: g.whatToLearn,
      whatToBuild: g.whatToBuild,
      evidenceRequired: g.evidenceRequired,
      marketPercent: g.marketPercent,
      kind: g.kind,
    }));
}
