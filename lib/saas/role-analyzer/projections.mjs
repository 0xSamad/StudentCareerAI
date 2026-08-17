/**
 * Projected readiness if weekly milestones are completed.
 * Explicitly a PROJECTION, with a "because" list per checkpoint.
 */

export function projectReadiness({
  currentScore,
  months,
  weekCount,
  gapCount,
  alreadyHaveCount,
  phases = [],
  projects = [],
}) {
  if (currentScore == null) {
    return {
      kind: 'PROJECTION',
      current: null,
      checkpoints: [],
      disclaimer: 'No current readiness score, so no projection is shown.',
    };
  }

  const remaining = Math.max(0, 90 - currentScore);
  const pace = Math.min(1, (Number(months) || 2) / 6);
  const gapFactor = Math.min(1.1, 0.55 + Math.min(gapCount || 0, 8) * 0.05);
  const haveFactor = Math.max(0.7, 1 - Math.min(alreadyHaveCount || 0, 10) * 0.02);
  const totalLift = remaining * 0.55 * pace * gapFactor * haveFactor;

  function atFrac(frac) {
    const lift = totalLift * (0.35 * frac + 0.65 * frac * frac);
    return Math.min(92, Math.round(currentScore + lift));
  }

  const projectNames = (projects || []).map((p) => p.title).filter(Boolean);
  const becauseFor = (label) => {
    if (/phase 1|foundation/i.test(label)) {
      return ['Core gaps get a practical artifact', 'Coursework is converted into GitHub evidence'];
    }
    if (/phase 2|build/i.test(label)) {
      return projectNames.slice(0, 1).map((t) => `Portfolio project underway: ${t}`).concat(['GitHub README a recruiter can follow']);
    }
    if (/phase 3|deploy/i.test(label)) {
      return ['API or one-command run', 'Docker or packaging if that was a gap', 'Interview answers from the project'];
    }
    return ['Weekly milestones completed', 'No invented job offers'];
  };

  const checkpoints = [];
  if (phases.length) {
    const lastWeek = weekCount || 8;
    for (const phase of phases) {
      const frac = Math.min(1, (phase.end || 1) / lastWeek);
      checkpoints.push({
        afterPhase: phase.name,
        afterMonths: Math.max(1, Math.round(((phase.end || 1) / 4) * 10) / 10),
        score: atFrac(frac),
        label: `Projected readiness if roadmap milestones are completed (${phase.name}).`,
        because: becauseFor(phase.name),
      });
    }
  } else {
    for (const m of [2, 4, 6]) {
      if (m <= months) {
        checkpoints.push({
          afterMonths: m,
          score: atFrac(m / months),
          label: `Projected readiness if roadmap milestones are completed (${m} month${m === 1 ? '' : 's'}).`,
          because: ['Weekly milestones completed'],
        });
      }
    }
  }

  return {
    kind: 'PROJECTION',
    current: currentScore,
    checkpoints,
    weekCount,
    disclaimer:
      'Projected readiness if you finish the weekly plan. Not a guarantee of interviews or a job.',
  };
}
