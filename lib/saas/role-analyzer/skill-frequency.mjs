/**
 * Skill frequency from analyzed postings only. Never invents percentages.
 * Denominator is ALL analyzed postings for that slice — not a skills-only subset.
 */

import { categoryFor } from './skill-taxonomy.mjs';

function roundPct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

export function computeSkillDemand(postings = []) {
  const total = postings.length;
  const postingsWithSkills = postings.filter((p) => (p.skills || []).length > 0).length;
  const counts = new Map();
  const mandatoryCounts = new Map();

  for (const posting of postings) {
    const skills = [...new Set(posting.skills || [])];
    const mandatory = new Set(posting.mandatorySkills || []);
    for (const skill of skills) {
      counts.set(skill, (counts.get(skill) || 0) + 1);
      if (mandatory.has(skill)) mandatoryCounts.set(skill, (mandatoryCounts.get(skill) || 0) + 1);
    }
  }

  const rows = [...counts.entries()]
    .map(([skill, count]) => ({
      skill,
      category: categoryFor(skill),
      count,
      total,
      percent: roundPct(count, total),
      mandatoryCount: mandatoryCounts.get(skill) || 0,
      label: total ? `${skill} — ${roundPct(count, total)}% (${count}/${total})` : `${skill} — n/a`,
    }))
    .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill));

  const byCategory = {};
  for (const row of rows) {
    if (!byCategory[row.category]) byCategory[row.category] = [];
    byCategory[row.category].push(row);
  }

  return { total, postingsWithSkills, skills: rows, byCategory };
}

export function splitDemandByMarket(postings = []) {
  const pakistan = postings.filter((p) => p.market === 'PAKISTAN');
  const international = postings.filter((p) => p.market === 'INTERNATIONAL');
  const unknown = postings.filter((p) => p.market === 'UNKNOWN');
  return {
    all: computeSkillDemand(postings),
    pakistan: computeSkillDemand(pakistan),
    international: computeSkillDemand(international),
    unknownCount: unknown.length,
  };
}
