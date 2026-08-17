/**
 * Attested skills from the existing profile + CV. Never invents.
 * Named skills list = strongest evidence. Coursework = academic foundation
 * (not "missing" just because the CV omitted the word).
 */

import { extractAnalyzerSkills, canonicalizeAnalyzerSkill } from './skill-taxonomy.mjs';

function list(value) {
  return Array.isArray(value) ? value : [];
}

function skillBuckets(skills = {}) {
  return [
    ...list(skills.programming_languages),
    ...list(skills.frameworks),
    ...list(skills.ai_ml),
    ...list(skills.databases),
    ...list(skills.cloud),
    ...list(skills.tools),
    ...list(skills.soft_skills),
  ];
}

const COURSEWORK_MAP = [
  [/database/i, ['SQL']],
  [/\bmachine learning\b/i, ['Machine Learning', 'scikit-learn', 'Statistics', 'Probability']],
  [/\bdeep learning\b/i, ['Deep Learning', 'Machine Learning', 'Statistics']],
  [/\bartificial intelligence\b/i, ['Machine Learning', 'Statistics', 'Probability']],
  [/^\s*ai\s*$/i, ['Machine Learning', 'Statistics']],
  [/\bprobability\b/i, ['Probability', 'Statistics']],
  [/\bstatistics\b/i, ['Statistics', 'Probability']],
  [/\blinear algebra\b/i, ['Linear Algebra']],
  [/\bcalculus\b/i, ['Calculus']],
  [/\bprogramming\b/i, ['Python']],
  [/\b(?:information|network|cyber)\s*security\b/i, ['Security Fundamentals']],
  [/\bcomputer networks?\b/i, ['Networking']],
  [/\boperating systems?\b/i, ['Linux']],
];

const SOFT_SKILLS = new Set(['Communication', 'Problem Solving', 'Teamwork']);

function skillsFromCourseNames(names = []) {
  const academic = new Set();
  for (const raw of names) {
    const name = String(raw || '').trim();
    if (!name) continue;
    for (const s of extractAnalyzerSkills(name)) {
      if (!SOFT_SKILLS.has(s)) academic.add(s);
    }
    for (const [re, skills] of COURSEWORK_MAP) {
      if (re.test(name)) skills.forEach((s) => academic.add(s));
    }
  }
  return academic;
}

export function collectProfileSkills(profile = {}, cvText = '', knowledgeText = '') {
  const named = new Set();
  for (const raw of skillBuckets(profile.skills)) {
    const text = String(raw || '').trim();
    if (!text) continue;
    named.add(canonicalizeAnalyzerSkill(text));
    for (const s of extractAnalyzerSkills(text)) named.add(s);
  }

  const education = list(profile.education);
  const courseNames = education.flatMap((e) => list(e.coursework));
  const courseworkText = courseNames.join('\n');
  const degreeText = education.map((e) => [e.degree, e.major, e.university].filter(Boolean).join(' ')).join('\n');

  const projects = list(profile.projects);
  const projectText = projects
    .map((p) => [p.name, p.description, ...(list(p.technologies) || [])].filter(Boolean).join(' '))
    .join('\n');

  const exp = profile.experience;
  const expRows = Array.isArray(exp)
    ? exp
    : [...list(exp?.jobs), ...list(exp?.internships)];
  const expText = expRows.map((e) => [e.role, e.title, e.company, e.description].filter(Boolean).join(' ')).join('\n');

  const certs = list(profile.certifications);
  const certText = certs.map((c) => (typeof c === 'string' ? c : c?.name)).filter(Boolean).join('\n');

  const prose = extractAnalyzerSkills(`${cvText || ''}\n${knowledgeText || ''}\n${certText}`);
  if (profile.identity?.github) prose.add('Git');
  if (profile.identity?.portfolio) {
    for (const s of extractAnalyzerSkills(String(profile.identity.portfolio))) named.add(s);
  }
  const fromDegreeWords = [...extractAnalyzerSkills(`${courseworkText}\n${degreeText}`)].filter((s) => !SOFT_SKILLS.has(s));
  const fromCourseMap = skillsFromCourseNames(courseNames);
  const coursework = new Set([...fromDegreeWords, ...fromCourseMap]);
  const fromProjects = extractAnalyzerSkills(projectText);
  const fromExperience = extractAnalyzerSkills(expText);

  const firstEdu = education[0] || {};
  return {
    named,
    prose,
    coursework,
    projects: fromProjects,
    experience: fromExperience,
    academic: coursework,
    hasNamedSkills: named.size > 0,
    hasAnyEvidence: named.size + prose.size + coursework.size + fromProjects.size + fromExperience.size > 0,
    projectCount: projects.length,
    experienceCount: expRows.length,
    educationCount: education.length,
    education: {
      degree: firstEdu.degree || null,
      major: firstEdu.major || null,
      university: firstEdu.university || null,
      graduationDate: firstEdu.graduation_date || firstEdu.graduationDate || null,
      gpa: firstEdu.gpa ?? null,
      coursework: courseNames,
    },
    github: profile.identity?.github || null,
    portfolio: profile.identity?.portfolio || null,
  };
}

export function evidenceFor(skill, collected) {
  if (collected.named.has(skill)) return 'named';
  if (collected.projects.has(skill)) return 'project';
  if (collected.experience.has(skill)) return 'experience';
  if (collected.coursework.has(skill) || collected.academic?.has(skill)) return 'coursework';
  if (collected.prose.has(skill)) return 'cv-prose';
  return null;
}

export function isAcademicOnly(skill, collected) {
  const ev = evidenceFor(skill, collected);
  return ev === 'coursework';
}
