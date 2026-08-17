/**
 * Skill gap vs attested profile.
 * Statuses: ALREADY HAVE | PARTIAL | MISSING | UNKNOWN
 * Importance: CORE | COMMON | HIGH-VALUE | OPTIONAL (role baseline + market)
 * Priority is NOT frequency alone — a 33% from 3 ads is not CRITICAL.
 */

import { evidenceFor, isAcademicOnly } from './profile-skills.mjs';
import { impliedParents, relatedSkills } from './skill-taxonomy.mjs';
import { importanceOf, IMPORTANCE, LIMITED_SAMPLE_POSTINGS } from './role-baseline.mjs';

export const STATUS = {
  ALREADY_HAVE: 'ALREADY HAVE',
  PARTIAL: 'PARTIAL',
  MISSING: 'MISSING',
  UNKNOWN: 'UNKNOWN',
};

export const PRIORITY = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
};

function hasSkillOrParent(skill, collected) {
  if (evidenceFor(skill, collected)) return true;
  for (const owned of collected.named) {
    if (impliedParents(owned).includes(skill)) return true;
  }
  for (const owned of collected.prose || []) {
    if (impliedParents(owned).includes(skill)) return true;
  }
  for (const owned of collected.projects) {
    if (impliedParents(owned).includes(skill)) return true;
  }
  for (const owned of collected.coursework || []) {
    if (impliedParents(owned).includes(skill)) return true;
  }
  return false;
}

export const EVIDENCE_LEVEL = {
  STRONG: 'STRONG EVIDENCE',
  PARTIAL: 'PARTIAL EVIDENCE',
  WEAK: 'WEAK EVIDENCE',
  NONE: 'NO EVIDENCE',
};

export function evidenceLevelFor(evidence) {
  if (evidence === 'named') return EVIDENCE_LEVEL.STRONG;
  if (evidence === 'project' || evidence === 'experience') return EVIDENCE_LEVEL.PARTIAL;
  if (evidence === 'coursework' || evidence === 'cv-prose') return EVIDENCE_LEVEL.WEAK;
  return EVIDENCE_LEVEL.NONE;
}

function coverageStatus(skill, collected) {
  if (!collected.hasAnyEvidence) return STATUS.UNKNOWN;
  const ev = evidenceFor(skill, collected);
  if (ev === 'named') return STATUS.ALREADY_HAVE;
  if (hasSkillOrParent(skill, collected) && ev === null) return STATUS.ALREADY_HAVE;
  if (ev === 'project' || ev === 'experience') return STATUS.PARTIAL;
  if (ev === 'coursework' || ev === 'cv-prose') return STATUS.PARTIAL;
  const related = relatedSkills(skill);
  if (related.some((r) => evidenceFor(r, collected) || collected.named.has(r))) return STATUS.PARTIAL;
  return STATUS.MISSING;
}

function importanceForRow(row, family) {
  return row.importance || importanceOf(row.skill, family) || IMPORTANCE.OPTIONAL;
}

/**
 * Priority uses importance, coverage, and a trustworthy market signal.
 * A rare-but-mandatory missing skill outranks a common skill the student already has.
 * Frequencies from <10 ads never become CRITICAL by themselves.
 */
export function assignPriority(row, status, { family = null, postingCount = 0 } = {}) {
  const freq = row.percent;
  const count = row.count || 0;
  const total = row.total || postingCount || 0;
  const weakSample = total > 0 && total < LIMITED_SAMPLE_POSTINGS;
  const trustworthyFreq = !weakSample && typeof freq === 'number' && count >= 3;
  const importance = importanceForRow(row, family);
  const missing = status === STATUS.MISSING || status === STATUS.UNKNOWN;
  const partial = status === STATUS.PARTIAL;
  const academic = row.evidence === 'coursework' || status === STATUS.PARTIAL && row.practicalNeeded;

  if (status === STATUS.ALREADY_HAVE) {
    return PRIORITY.LOW;
  }

  if (importance === IMPORTANCE.CORE && missing) return PRIORITY.CRITICAL;
  if (importance === IMPORTANCE.CORE && partial && academic) return PRIORITY.HIGH;
  if (importance === IMPORTANCE.CORE && partial) return PRIORITY.HIGH;
  if (importance === IMPORTANCE.HIGH_VALUE && missing) return PRIORITY.HIGH;
  if (importance === IMPORTANCE.COMMON && missing) return PRIORITY.HIGH;
  if (importance === IMPORTANCE.HIGH_VALUE && partial) return PRIORITY.MEDIUM;
  if (importance === IMPORTANCE.COMMON && partial) return PRIORITY.MEDIUM;

  if (trustworthyFreq) {
    const mandatoryRate = row.total ? (row.mandatoryCount || 0) / row.total : 0;
    if (mandatoryRate >= 0.35 && missing && freq >= 40) return PRIORITY.CRITICAL;
    if (freq >= 60 && missing) return PRIORITY.CRITICAL;
    if (freq >= 45 && missing) return PRIORITY.HIGH;
  }

  if (partial) return PRIORITY.MEDIUM;
  if (importance === IMPORTANCE.OPTIONAL && missing) return PRIORITY.LOW;
  return PRIORITY.LOW;
}

export function buildSkillGaps(demandSkills = [], collected, { family = null, postingCount = 0 } = {}) {
  return demandSkills.map((row) => {
    const status = coverageStatus(row.skill, collected);
    const evidence = evidenceFor(row.skill, collected);
    const academic = isAcademicOnly(row.skill, collected);
    const importance = importanceForRow(row, family);
    return {
      skill: row.skill,
      category: row.category,
      status,
      importance,
      source: row.source || (row.percent == null ? 'ROLE_BASELINE' : 'MARKET'),
      priority: assignPriority({ ...row, evidence }, status, { family, postingCount }),
      frequencyPercent: row.percent ?? null,
      postingCount: row.count || 0,
      postingTotal: row.total || postingCount || 0,
      mandatoryCount: row.mandatoryCount || 0,
      evidence: evidence || null,
      evidenceLevel: evidenceLevelFor(evidence),
      evidenceNote: evidence ? null : 'Not found in profile',
      practicalNeeded: academic || evidence === 'coursework' || (status === STATUS.PARTIAL && evidence !== 'project'),
      kind: row.percent == null ? 'ROLE_BASELINE' : 'FACT',
    };
  });
}
