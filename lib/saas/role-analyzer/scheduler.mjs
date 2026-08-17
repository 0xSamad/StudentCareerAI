/**
 * Phase-based weekly planner. One algorithm for 2 / 4 / 6 / custom months.
 * Interview prep is a late phase — it never fills the whole calendar.
 */

import { STATUS } from './gap-model.mjs';
import { prereqsFor, topicsFor, practiceFor, resourcesFor, interviewFor } from './learning-units.mjs';
import { IMPORTANCE, skillAllowedForDomain } from './role-baseline.mjs';

export function parseDurationMonths(body = {}) {
  if (body.durationMonths != null && body.durationMonths !== '') {
    const n = Number(body.durationMonths);
    if (Number.isFinite(n) && n >= 1 && n <= 18) return Math.round(n * 10) / 10;
    throw new Error('durationMonths must be between 1 and 18.');
  }
  const raw = String(body.duration || body.preset || body.months || '').trim().toLowerCase();
  const preset = raw.match(/^(\d+(?:\.\d+)?)\s*(month|months|m)?$/);
  if (preset) {
    const n = Number(preset[1]);
    if (n >= 1 && n <= 18) return n;
    throw new Error('durationMonths must be between 1 and 18.');
  }
  if (raw === '2' || raw === '2-month' || raw === '2 months') return 2;
  if (raw === '4' || raw === '4-month' || raw === '4 months') return 4;
  if (raw === '6' || raw === '6-month' || raw === '6 months') return 6;
  return 2;
}

export function weekCountFor(months) {
  return Math.max(4, Math.round(Number(months) * 4));
}

export function weeklyHoursFor(months) {
  if (months <= 2) return { min: 10, max: 12, label: '10–12 hours' };
  if (months <= 4) return { min: 8, max: 10, label: '8–10 hours' };
  if (months <= 6) return { min: 7, max: 9, label: '7–9 hours' };
  return { min: 6, max: 8, label: '6–8 hours' };
}

const PR_RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, MAINTAIN: 0 };

export function phasePlan(months, weeksN, domain = 'general') {
  const n = weeksN;
  const deployGoal =
    domain === 'cybersecurity'
      ? 'Package the lab: report, evidence, README.'
      : domain === 'software'
        ? 'Make the project runnable (README + tests; Docker if that is a gap).'
        : 'Make the project runnable (API + Docker if that is a gap).';
  if (n <= 8) {
    const fEnd = Math.max(2, Math.min(3, n - 2));
    const bEnd = Math.max(fEnd + 1, n - 2);
    const dEnd = Math.max(bEnd, n - 1);
    return [
      { id: 'foundation', name: 'Foundation', goal: 'Close critical technical gaps with practice, not tutorials-only.', start: 1, end: fEnd },
      { id: 'build', name: 'Build', goal: 'Turn learning into a portfolio project.', start: fEnd + 1, end: bEnd },
      { id: 'deploy', name: 'Ship', goal: deployGoal, start: bEnd + 1, end: dEnd },
      { id: 'interview', name: 'Interview + apply', goal: 'Practice from YOUR projects, then apply.', start: dEnd + 1, end: n },
    ];
  }
  const fEnd = Math.max(3, Math.round(n * 0.28));
  const bEnd = Math.max(fEnd + 2, Math.round(n * 0.62));
  const dEnd = Math.max(bEnd + 1, Math.round(n * 0.78));
  return [
    { id: 'foundation', name: 'Foundation', goal: months <= 4 ? 'Close critical and intermediate gaps.' : 'Close remaining gaps and start specialization.', start: 1, end: fEnd },
    { id: 'build', name: 'Build', goal: 'Build portfolio evidence.', start: fEnd + 1, end: bEnd },
    { id: 'deploy', name: 'Ship', goal: deployGoal, start: bEnd + 1, end: dEnd },
    { id: 'interview', name: 'Interview + apply', goal: months >= 6 ? 'Advanced interview prep + portfolio polish + applications.' : 'Become application-ready from your own work.', start: dEnd + 1, end: n },
  ];
}

function phaseForWeek(week, phases) {
  return phases.find((p) => week >= p.start && week <= p.end) || phases[phases.length - 1];
}

function covered(skill, collected, planned) {
  if (collected.named.has(skill)) return true;
  return planned.has(skill);
}

function shouldLearn(g, months = 6, family = null) {
  if (g.status === STATUS.ALREADY_HAVE) return false;
  if (family && !skillAllowedForDomain(g.skill, family)) return false;
  const p = g.priorityLabel || g.priority;
  if (months <= 2) return p === 'CRITICAL' || g.importance === IMPORTANCE.CORE;
  if (months <= 4) return p === 'CRITICAL' || p === 'HIGH' || g.importance === IMPORTANCE.CORE || g.importance === IMPORTANCE.HIGH_VALUE;
  if ([IMPORTANCE.CORE, IMPORTANCE.HIGH_VALUE, IMPORTANCE.COMMON].includes(g.importance)) return true;
  if (typeof g.frequencyPercent === 'number' && (g.postingTotal || 0) >= 10 && g.frequencyPercent >= 25) return true;
  return false;
}

function topoSkills(enriched, collected, family, months = 6) {
  const learnable = enriched.filter((g) => shouldLearn(g, months, family));
  const bySkill = Object.fromEntries(learnable.map((g) => [g.skill, g]));
  const ordered = [];
  const seen = new Set();
  const domain = family?.domain || '';

  function visit(skill) {
    if (seen.has(skill)) return;
    seen.add(skill);
    const extras =
      domain === 'ai_ml' && (skill === 'Docker' || skill === 'FastAPI' || skill === 'MLOps')
        ? ['scikit-learn', 'PyTorch', 'Machine Learning'].filter((s) => bySkill[s] && !covered(s, collected, seen))
        : [];
    for (const pre of [...prereqsFor(skill), ...extras]) {
      if (covered(pre, collected, seen)) continue;
      if (bySkill[pre]) visit(pre);
    }
    if (bySkill[skill]) ordered.push(bySkill[skill]);
  }

  const ranked = [...learnable].sort((a, b) => {
    const ra = PR_RANK[a.priorityLabel] || PR_RANK[a.priority] || 0;
    const rb = PR_RANK[b.priorityLabel] || PR_RANK[b.priority] || 0;
    if (rb !== ra) return rb - ra;
    return (b.frequencyPercent || 0) - (a.frequencyPercent || 0);
  });
  for (const g of ranked) visit(g.skill);
  return ordered;
}

function makeWeek(n, phase, fields) {
  const learn = fields.learn || fields.topics || [];
  const practice = fields.practice || fields.practicalTasks || [];
  const deliverable = fields.deliverable || fields.deliverables || [];
  const success = fields.successCriteria || fields.milestone;
  return {
    week: n,
    phase: phase?.id,
    phaseName: phase?.name,
    phaseGoal: phase?.goal,
    objective: fields.objective,
    skills: fields.skills || [],
    learn,
    topics: learn,
    practice,
    practicalTasks: practice,
    build: fields.build || fields.projectWork || null,
    projectWork: fields.build || fields.projectWork || null,
    resources: fields.resources || [],
    interview: fields.interview || fields.interviewPreparation || [],
    interviewPreparation: fields.interview || fields.interviewPreparation || [],
    deliverable,
    deliverables: deliverable,
    estimatedHours: fields.estimatedHours,
    successCriteria: success,
    milestone: success,
    kind: 'RECOMMENDATION',
  };
}

function lightInterview(skill) {
  return interviewFor(skill).slice(0, 1);
}

function pickBuildProject(projects, offset, spanLen) {
  const pool = (projects || []).filter((p) => p && p.id !== "deploy-api");
  const list = pool.length ? pool : projects || [];
  if (!list.length) return null;
  if (list.length === 1) {
    return { project: list[0], localOffset: offset, last: offset >= spanLen - 1 };
  }
  const firstShare = Math.min(spanLen - (list.length > 1 ? 1 : 0), Math.max(1, Math.ceil(spanLen * 0.6)));
  if (offset < firstShare) {
    return { project: list[0], localOffset: offset, last: offset === firstShare - 1 };
  }
  const restOff = offset - firstShare;
  const restLen = Math.max(1, spanLen - firstShare);
  const later = list.slice(1);
  const idx = Math.min(later.length - 1, Math.floor(restOff / Math.max(1, Math.ceil(restLen / later.length))));
  return {
    project: later[idx] || list[list.length - 1],
    localOffset: restOff,
    last: offset >= spanLen - 1,
  };
}

function buildWeekObjective(project, localOffset, last) {
  const steps = project.phases || [];
  const step = steps[Math.min(localOffset, Math.max(0, steps.length - 1))];
  const stepBit = step?.name ? ` — ${step.name}` : "";
  if (localOffset <= 0) return `Start: ${project.title}${stepBit}`;
  if (last) return `Finish: ${project.title}${stepBit}`;
  if (step?.name) return `${project.title}: ${step.name}`;
  return `Build: ${project.title}`;
}

export function planWeeks({ months, enrichedGaps, collected, projects, family }) {
  const weeksN = weekCountFor(months);
  const hours = weeklyHoursFor(months);
  const domain = family?.domain || 'general';
  const phases = phasePlan(months, weeksN, domain);
  const ordered = topoSkills(enrichedGaps, collected, family, months);
  const hoursLabel = `${hours.min}–${hours.max}`;

  const weeks = [];
  let skillCursor = 0;

  function nextGap() {
    if (skillCursor >= ordered.length) return null;
    const g = ordered[skillCursor];
    skillCursor += 1;
    return g;
  }

  const foundation = phases.find((p) => p.id === 'foundation');
  const build = phases.find((p) => p.id === 'build');
  const deploy = phases.find((p) => p.id === 'deploy');
  const interview = phases.find((p) => p.id === 'interview');

  const strong = (collected.named?.size || 0) >= 4;
  for (let n = 1; n <= weeksN; n += 1) {
    const phase = phaseForWeek(n, phases);

    if (n === 1 && strong && phase.id === 'foundation') {
      const names = [...collected.named].slice(0, 4);
      weeks.push(
        makeWeek(n, phase, {
          objective: `Industry-level assessment of attested skills (${names.join(', ')}) — no beginner recap.`,
          skills: names,
          learn: names.flatMap((s) => topicsFor(s, 'ALREADY HAVE')).slice(0, 6),
          practice: [`Time-box a task that uses ${names[0]} the way intern ads describe it.`],
          build: 'A 1-page skills audit in Git',
          resources: names.flatMap((s) => resourcesFor(s, 1)).slice(0, 3),
          interview: [`Explain ${names[0]} from a project you already have.`],
          deliverable: ['1-page skills audit committed to Git'],
          estimatedHours: hoursLabel,
          successCriteria: `You can describe your current ${names[0]} level with an example, without a beginner tutorial.`,
        })
      );
      continue;
    }

    if (phase.id === 'foundation') {
      const gap = nextGap();
      if (gap) {
        const academic = gap.evidence === 'coursework';
        const advanced = academic || gap.status === STATUS.PARTIAL || gap.status === STATUS.ALREADY_HAVE;
        const status = advanced ? 'PARTIAL' : gap.status;
        weeks.push(
          makeWeek(n, phase, {
            objective: academic
              ? `Turn your ${gap.skill} coursework into a practical artifact`
              : `Close the ${gap.skill} gap`,
            skills: [gap.skill],
            learn: topicsFor(gap.skill, status),
            practice: [practiceFor(gap.skill, status)],
            build: `Small ${gap.skill} exercise that will feed next week's project.`,
            resources: resourcesFor(gap.skill, 2),
            interview: lightInterview(gap.skill),
            deliverable: [`Runnable ${gap.skill} notes + artifact in Git`],
            estimatedHours: hoursLabel,
            successCriteria: academic
              ? `You can show ${gap.skill} on a dataset, not only from class notes.`
              : `A reviewer can run or query your ${gap.skill} artifact.`,
          })
        );
        continue;
      }
    }

    if (phase.id === 'build' || (phase.id === 'foundation' && !ordered[skillCursor])) {
      const spanStart = build?.start || n;
      const spanEnd = build?.end || n;
      const spanLen = Math.max(1, spanEnd - spanStart + 1);
      const offset = n - spanStart;
      const chosen = pickBuildProject(projects, offset, spanLen);
      const project = chosen?.project;
      if (project) {
        const steps = project.phases || [];
        const step = steps[Math.min(chosen.localOffset, Math.max(0, steps.length - 1))];
        weeks.push(
          makeWeek(n, phase, {
            objective: buildWeekObjective(project, chosen.localOffset, chosen.last),
            skills: project.demonstrates || project.skillsDemonstrated || [],
            learn: step ? [step.work] : (project.features || []).slice(0, 5),
            practice: [project.problem],
            build: step?.work || project.title,
            resources: [],
            interview: [project.interviewAngle],
            deliverable: project.github || [],
            estimatedHours: hoursLabel,
            successCriteria: chosen.last
              ? `${project.title} is on GitHub with a README a recruiter can follow.`
              : `Working slice of ${project.title} committed (${step?.name || "in progress"}).`,
          })
        );
        continue;
      }
    }

    if (phase.id === 'deploy') {
      const cyber = domain === 'cybersecurity';
      const software = domain === 'software';
      const deployProj =
        projects.find((p) =>
          cyber
            ? /lab|writeup|pentest|soc|homelab/i.test(p.id)
            : software
              ? /rest-api|api/i.test(p.id)
              : p.id === 'deploy-api'
        ) || projects[0];
      const ship = cyber
        ? {
            objective: 'Package the lab: report, evidence, and a README a reviewer can follow',
            skills: deployProj?.demonstrates || ['Linux', 'Git', 'Security Reporting'],
            learn: ['Turn notes into a findings report', 'Sanitized evidence', 'README a recruiter can follow'],
            practice: ['Export one screenshot + command log into the report'],
            build: deployProj?.phases?.find((p) => /write|report|document/i.test(p.name))?.work || 'Finish the lab write-up',
            resources: resourcesFor('Linux', 1).concat(resourcesFor('Git', 1)).slice(0, 2),
            deliverable: ['Findings or lab README', 'Evidence folder', 'Limitations section'],
            successCriteria: 'Someone else can read the report and reproduce one finding without asking you.',
          }
        : software
          ? {
              objective: 'Ship: README, tests, and a one-command run a stranger can follow',
              skills: deployProj?.demonstrates || ['Git', 'REST APIs'],
              learn: ['Pin dependencies', 'Write a README with curl or run steps', 'One automated test that fails then passes'],
              practice: ['Clone into a clean folder and follow only the README'],
              build: deployProj?.phases?.find((p) => /document|readme|test/i.test(p.name))?.work || 'Finish README + tests',
              resources: resourcesFor('Git', 1).concat(resourcesFor('Python', 1)).slice(0, 2),
              deliverable: ['Runnable README', 'tests/', 'example request or screenshot'],
              successCriteria: 'Someone else can clone, run, and hit an endpoint without asking you.',
            }
          : {
              objective: 'Deploy: FastAPI + Docker so a stranger can hit /predict',
              skills: deployProj?.demonstrates || ['Git', 'Docker', 'FastAPI'],
              learn: ['Load a saved model behind POST /predict', 'Dockerfile and one-command run', 'README a recruiter can follow'],
              practice: ['Run the API from a clean folder and call /predict'],
              build: deployProj?.phases?.find((p) => /docker|api|deploy/i.test(p.name))?.work || 'Dockerfile + /predict if you have a model',
              resources: resourcesFor('Docker', 1).concat(resourcesFor('FastAPI', 1)).slice(0, 2),
              deliverable: ['Running README', 'requirements.txt or Dockerfile', 'example curl'],
              successCriteria: 'Someone else can clone, run, and see a /predict result without asking you.',
            };
      weeks.push(
        makeWeek(n, phase, {
          ...ship,
          interview: ['How would you demo this in 8 minutes?'],
          estimatedHours: hoursLabel,
        })
      );
      continue;
    }

    const mix = ordered.slice(0, 4).map((g) => g.skill);
    const have = enrichedGaps.filter((g) => g.status === STATUS.ALREADY_HAVE).slice(0, 3).map((g) => g.skill);
    const skills = [...new Set([...mix, ...have])].slice(0, 4);
    const lateFrac = interview ? (n - interview.start) / Math.max(1, interview.end - interview.start + 1) : 1;
    const interviewFocus =
      lateFrac < 0.34
        ? domain === 'cybersecurity'
          ? 'Security concepts and YOUR lab write-up'
          : domain === 'software'
            ? 'DSA, OOP, and YOUR project'
            : domain === 'data_science'
              ? 'SQL/statistics questions drawn from YOUR analysis'
              : 'Python/ML questions drawn from YOUR project'
        : lateFrac < 0.7
          ? 'Project deep-dive: what you did, what failed, next steps'
          : months >= 6
            ? 'Timed mock + portfolio polish + targeted applications'
            : 'Timed mock + CV bullets from attested facts only';
    weeks.push(
      makeWeek(n, phase, {
        objective: `Interview — ${interviewFocus}`,
        skills,
        learn: skills.flatMap((s) => interviewFor(s)).slice(0, 5),
        practice: lateFrac >= 0.7
          ? ['One 45-minute mock (record yourself)', 'Revise CV bullets from attested projects only']
          : [`Write 8 answers using ${skills[0] || 'your project'} — no invented metrics`],
        build: 'Update README if a gap showed up while practicing',
        interview: [interviewFocus],
        deliverable: lateFrac >= 0.7
          ? ['Updated CV (attested facts only)', 'GitHub README complete', 'Mock notes']
          : ['Interview answer bank from your own work'],
        estimatedHours: hoursLabel,
        successCriteria: lateFrac >= 0.7
          ? 'You can walk through one portfolio project in 8 minutes with metrics.'
          : `Answer bank covers ${skills.join(', ') || 'your project'}.`,
      })
    );
  }

  const allowed = new Set([
    ...enrichedGaps.filter((g) => skillAllowedForDomain(g.skill, family)).map((g) => g.skill),
    ...(collected.named || []),
    ...(collected.coursework || []),
  ]);
  for (const w of weeks) {
    w.skills = (w.skills || []).filter((s) => allowed.has(s));
  }

  return {
    weeks,
    phases,
    weeklyHours: hours,
    weekCount: weeksN,
    interviewStartsWeek: interview?.start || weeksN,
  };
}
