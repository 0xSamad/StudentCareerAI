/**
 * Weighted profile coverage against a market's demand rows.
 * Returns null when that market has no analyzed postings/skills — never a fake 0.
 */

export function coverageAgainstDemand(demand = [], gaps = []) {
  if (!demand.length) return { percent: null, have: 0, total: 0 };
  const statusBy = Object.fromEntries((gaps || []).map((g) => [g.skill, g.status]));
  let weight = 0;
  let earned = 0;
  for (const row of demand) {
    const w = Number(row.percent) || 0;
    if (w <= 0) continue;
    weight += w;
    const status = statusBy[row.skill];
    if (status === 'ALREADY HAVE') earned += w;
    else if (status === 'PARTIAL') earned += w * 0.45;
  }
  if (!weight) return { percent: null, have: 0, total: demand.length };
  return {
    percent: Math.round((earned / weight) * 100),
    have: (gaps || []).filter((g) => g.status === 'ALREADY HAVE').length,
    total: demand.length,
    kind: 'FACT',
  };
}
