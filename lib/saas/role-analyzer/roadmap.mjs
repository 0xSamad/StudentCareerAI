/**
 * Personalized career-readiness report from an existing analysis + attested profile.
 * Algorithm owns FACTS and the week schedule. AI may only rewrite wording.
 */

import { collectProfileSkills } from './profile-skills.mjs';
import { enrichSkillGaps, highestImpactGaps } from './enrich-gaps.mjs';
import { selectProjects } from './projects.mjs';
import { parseDurationMonths, planWeeks, weekCountFor } from './scheduler.mjs';
import { jobTargets } from './job-targets.mjs';
import { projectReadiness } from './projections.mjs';
import { buildEvidencePack } from './evidence.mjs';
import { applyAiNarrative } from './ai-narrative.mjs';
import { buildCoachReport } from './diagnosis.mjs';
import { STATUS } from './gap-model.mjs';
import { resolveRoleFamily } from './role-families.mjs';

function coverageSummary(enriched) {
  return (enriched || []).slice(0, 12).map((g) => ({
    skill: g.skill,
    status: g.status,
    marketPercent: g.marketPercent,
    importance: g.importance,
    kind: g.kind || 'FACT',
  }));
}

function marketSummary(analysis) {
  return {
    kind: 'FACT',
    postingCount: analysis.metadata?.postingCount || 0,
    pakistanCount: analysis.metadata?.pakistanCount || 0,
    internationalCount: analysis.metadata?.internationalCount || 0,
    sampleQuality: analysis.metadata?.sampleQuality || null,
    topRequirements: (analysis.skillDemand || [])
      .filter((s) => s.percent != null)
      .slice(0, 8)
      .map((s) => ({
        skill: s.skill,
        percent: s.percent,
        count: s.count,
        total: s.total,
      })),
  };
}

function interviewPlan(weeks, phases, family, coach) {
  const prep = coach?.intelligence?.interviewPrep;
  if (prep?.sections?.length) {
    return {
      kind: 'RECOMMENDATION',
      role: prep.role,
      note: prep.note,
      sections: prep.sections,
      fromGaps: prep.fromGaps || [],
      weekCount: (weeks || []).filter((w) => w.phase === 'interview').length,
      phases: prep.sections.map((s, i) => ({
        phase: s.title,
        when: i === 0 ? 'Throughout the plan' : 'After you have a project artifact',
        focus: (s.items || []).slice(0, 2).join(' · '),
      })),
    };
  }
  const interviewWeeks = (weeks || []).filter((w) => w.phase === 'interview' || /mock|deep-dive|interview questions/i.test(w.objective));
  const domain = family?.domain || '';
  const out = (phases || [])
    .filter((p) => p.id === 'foundation' || p.id === 'build' || p.id === 'deploy' || p.id === 'interview')
    .map((p) => ({
      phase: p.name,
      when: `Weeks ${p.start}–${p.end}`,
      focus:
        p.id === 'foundation'
          ? 'Technical fundamentals tied to this week’s artifact — not a generic question bank.'
          : p.id === 'build'
            ? domain === 'cybersecurity'
              ? 'Lab questions: what you found, how you verified it, what you would retest.'
              : 'Project questions: why this approach, what failed, what you would do next.'
            : p.id === 'deploy'
              ? domain === 'cybersecurity'
                ? 'How you would walk a reviewer through the report in 8 minutes.'
                : 'How you would demo the running project in 8 minutes.'
              : 'Mock interviews, behavioral STAR from attested work, targeted applications.',
    }));
  return { kind: 'RECOMMENDATION', phases: out, weekCount: interviewWeeks.length };
}

export async function buildRoleRoadmap({
  analysis,
  profile,
  cvText = '',
  knowledgeText = '',
  durationMonths,
  matchingConfig = null,
  useAi = false,
  callAIFn = null,
}) {
  if (!analysis?.role) throw new Error('Run a role analysis before building a roadmap.');
  const months = Number(durationMonths);
  if (!Number.isFinite(months) || months < 1 || months > 18) {
    throw new Error('durationMonths must be between 1 and 18.');
  }

  const family = resolveRoleFamily(analysis.rawRole || analysis.role);
  const collected = collectProfileSkills(profile, cvText, knowledgeText);
  const enrichedGaps = enrichSkillGaps(analysis.skillGaps || [], analysis);
  const maxProjects = months <= 2 ? 2 : months <= 4 ? 2 : 3;
  const projects = selectProjects({
    family,
    skillDemand: analysis.skillDemand || [],
    enrichedGaps,
    collected,
    maxProjects,
  });
  const planned = planWeeks({ months, enrichedGaps, collected, projects, family });
  const targets = jobTargets({
    family,
    readinessScore: analysis.readinessScore,
    months,
    enrichedGaps,
    collected,
  });
  const coach = buildCoachReport({
    analysis,
    family,
    collected,
    enrichedGaps,
    projects,
    weeks: planned.weeks,
    phases: planned.phases,
    readiness: analysis.readinessScore,
    jobTargets: targets,
  });
  const evidence = buildEvidencePack({
    analysis,
    enrichedGaps,
    collected,
    profile,
    months,
    marketScope: analysis.metadata?.marketScope,
    coach,
  });

  let weeks = planned.weeks;
  let aiSummary = null;
  let aiMeta = { used: false, error: null };
  let coachOut = coach;
  if (useAi) {
    const overlay = await applyAiNarrative({
      evidence,
      weeks,
      matchingConfig: matchingConfig || profile?.matching,
      callAIFn,
      enabled: true,
      coach,
    });
    weeks = overlay.weeks;
    aiSummary = overlay.summary;
    coachOut = overlay.coach || coach;
    aiMeta = { used: overlay.used, error: overlay.error };
  }

  const current = analysis.readinessScore?.score ?? null;
  const projections = projectReadiness({
    currentScore: current,
    months,
    weekCount: planned.weekCount,
    gapCount: enrichedGaps.filter((g) => g.status === STATUS.MISSING || g.status === STATUS.PARTIAL).length,
    alreadyHaveCount: enrichedGaps.filter((g) => g.status === STATUS.ALREADY_HAVE).length,
    phases: planned.phases,
    projects,
  });

  const resources = [];
  const seen = new Set();
  for (const w of weeks) {
    for (const r of w.resources || []) {
      const key = r.url || r.title;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      resources.push({ ...r, week: w.week, skill: (w.skills || [])[0] });
    }
  }

  return {
    role: analysis.role,
    durationMonths: months,
    weekCount: planned.weekCount,
    weeklyHours: planned.weeklyHours,
    marketSummary: marketSummary(analysis),
    skillDemand: analysis.skillDemand,
    profileCoverage: coverageSummary(enrichedGaps),
    skillGaps: enrichedGaps,
    priorities: {
      critical: enrichedGaps.filter((g) => (g.priorityLabel || g.priority) === 'CRITICAL').map((g) => g.skill),
      high: enrichedGaps.filter((g) => (g.priorityLabel || g.priority) === 'HIGH').map((g) => g.skill),
      medium: enrichedGaps.filter((g) => (g.priorityLabel || g.priority) === 'MEDIUM').map((g) => g.skill),
      maintain: enrichedGaps.filter((g) => g.priorityLabel === 'MAINTAIN').map((g) => g.skill),
      highestImpact: highestImpactGaps(enrichedGaps, 5),
    },
    projects,
    roadmaps: {
      weeks,
      phases: planned.phases,
      interviewStartsWeek: planned.interviewStartsWeek,
    },
    readiness: {
      current,
      explanation: analysis.readinessScore?.explanation || null,
      constraint: analysis.readinessScore?.constraint || null,
      advantage: analysis.readinessScore?.advantage || null,
      components: analysis.readinessScore?.components || {},
      breakdown: analysis.readinessScore?.breakdown || [],
      projections,
    },
    jobTargets: targets,
    resources: resources.slice(0, 16),
    interviewPlan: interviewPlan(weeks, planned.phases, family, coachOut),
    dataQuality: analysis.metadata?.sampleQuality || null,
    coach: coachOut,
    narrative: {
      kind: 'RECOMMENDATION',
      summary: aiSummary || coachOut?.executiveSummary?.headline || null,
      ai: aiMeta,
    },
    evidenceRules: evidence.rules,
  };
}

export function buildReadinessView({ analysis, durationMonths = 6 }) {
  if (!analysis?.role) throw new Error('Run a role analysis before requesting readiness.');
  const months = Number(durationMonths);
  if (!Number.isFinite(months) || months < 1 || months > 18) {
    throw new Error('durationMonths must be between 1 and 18.');
  }
  const enrichedGaps = enrichSkillGaps(analysis.skillGaps || [], analysis);
  const current = analysis.readinessScore?.score ?? null;
  return {
    role: analysis.role,
    marketSummary: marketSummary(analysis),
    profileCoverage: coverageSummary(enrichedGaps),
    skillGaps: enrichedGaps,
    priorities: {
      highestImpact: highestImpactGaps(enrichedGaps, 5),
    },
    readiness: {
      current,
      explanation: analysis.readinessScore?.explanation || null,
      components: analysis.readinessScore?.components || {},
      breakdown: analysis.readinessScore?.breakdown || [],
      projections: projectReadiness({
        currentScore: current,
        months,
        weekCount: weekCountFor(months),
        gapCount: enrichedGaps.filter((g) => g.status === STATUS.MISSING || g.status === STATUS.PARTIAL).length,
        alreadyHaveCount: enrichedGaps.filter((g) => g.status === STATUS.ALREADY_HAVE).length,
      }),
    },
    jobTargets: jobTargets({
      family: resolveRoleFamily(analysis.rawRole || analysis.role),
      readinessScore: analysis.readinessScore,
      months,
      enrichedGaps,
    }),
    dataQuality: analysis.metadata?.sampleQuality || null,
  };
}

export { parseDurationMonths, weekCountFor };
