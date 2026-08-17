/**
 * Role titles to target now vs after phases.
 * Never recommends senior/staff. Explains good fit / stretch / not yet.
 * Stretch titles stay inside the same domain — no ML titles for cyber.
 */

import { isInternshipFamily } from './role-families.mjs';

const SENIOR = /\b(senior|staff|principal|lead|director|head of|manager)\b/i;

export function jobTargets({ family, readinessScore, months, enrichedGaps, collected }) {
  const role = family?.canonical || 'Target role';
  const intern = isInternshipFamily(family);
  const domain = family?.domain || 'general';
  const score = readinessScore?.score;
  const missingCritical = (enrichedGaps || []).filter((g) => g.priorityLabel === 'CRITICAL' || g.priority === 'CRITICAL').length;
  const hasProject = (collected?.projectCount || 0) > 0;
  const hasDl = (collected?.named && (collected.named.has('PyTorch') || collected.named.has('TensorFlow'))) || false;

  const goodFit = [];
  const stretch = [];
  const notYet = [];

  if (intern) {
    goodFit.push(role);
    if (family?.id === 'ai-intern') goodFit.push('ML Intern');
    if (family?.id === 'ml-intern') goodFit.push('AI Intern');
    if (family?.id === 'data-science-intern') goodFit.push('Data Analyst Intern');
    if (family?.id === 'cybersecurity-intern') {
      stretch.push('SOC Intern');
      notYet.push('Cybersecurity Specialist', 'SOC Analyst', 'Penetration Tester');
    } else if (domain === 'software') {
      stretch.push('Junior Software Engineer internships');
      notYet.push('Software Engineer');
    } else if (domain === 'ai_ml' || domain === 'data_science') {
      if (!hasProject || missingCritical > 2) {
        stretch.push(family?.id === 'data-science-intern' ? 'Junior Data Scientist internships' : 'AI Engineer Intern');
        notYet.push('ML Engineer');
      } else {
        stretch.push('AI Engineer Intern');
        notYet.push('ML Engineer');
      }
      if (hasDl && hasProject && (score || 0) >= 70) {
        stretch.push('Junior ML Engineer internships');
      }
    }
  } else if (domain === 'cybersecurity') {
    goodFit.push(role);
    if (family?.id === 'cybersecurity-specialist') {
      stretch.push('Junior SOC Analyst');
      notYet.push('Senior Security Engineer', 'Lead Penetration Tester');
    } else if (family?.id === 'soc-analyst') {
      stretch.push('Cybersecurity Specialist');
      notYet.push('Penetration Tester');
    } else if (family?.id === 'penetration-tester') {
      stretch.push('Junior Application Security Engineer');
      notYet.push('Senior Penetration Tester');
    } else {
      stretch.push(`Junior ${role}`);
    }
  } else if (score != null && score >= 62) {
    goodFit.push(role);
    stretch.push(`Junior ${role}`);
  } else {
    goodFit.push(`${role} (intern / junior postings only)`);
    notYet.push(role);
  }

  const clean = (list) => [...new Set(list.filter((t) => t && !SENIOR.test(t)))];

  const why = {
    goodFit: intern
      ? 'These titles match your education stage. Apply to lower-barrier internships while you build the first strong project.'
      : 'Your current evidence is closest to these titles.',
    stretch: 'Apply after the first strong GitHub project exists — not after you feel 100% ready.',
    notYet: intern
      ? 'Full engineer / specialist titles usually want production evidence you do not have yet. Do not wait for them before applying to internships.'
      : 'More senior titles in this domain want evidence you do not have yet.',
  };

  const now = clean(goodFit);
  const after2 = intern ? clean([...now, ...stretch.slice(0, 1)]) : clean([...now, ...stretch.slice(0, 1)]);
  const after4 = clean([...after2, ...stretch]);
  const after6 = intern ? clean([...after4, ...notYet.slice(0, 2)]) : clean([...after4, ...notYet.filter((t) => !SENIOR.test(t)).slice(0, 1)]);

  return {
    kind: 'RECOMMENDATION',
    now,
    after2Months: after2,
    after4Months: after4,
    afterRoadmap: intern ? after4 : after6,
    after6Months: after6,
    goodFit: now,
    stretch: clean(stretch),
    notYet: clean(notYet),
    why,
    applyNow: now,
    applyAfterPhase2: after4,
    applyAfterPhase3: after6,
    note: 'Titles only — not a promise that any company will interview or hire you. Existing eligibility rules still apply to each listing.',
  };
}
