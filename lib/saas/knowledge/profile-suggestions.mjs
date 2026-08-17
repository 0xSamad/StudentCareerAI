/**
 * Turn ingested evidence (CV paste, LinkedIn text, GitHub facts) into
 * profile fields the student can accept or reject.
 * Never writes the profile by itself.
 */

import { heuristicExtract, categorizeSkill } from "../../profile-parser.mjs";
import { isVerifiedFact } from "./fact-shape.mjs";

const SKILL_CATS = [
  "programming_languages",
  "frameworks",
  "ai_ml",
  "databases",
  "cloud",
  "tools",
];

function keyOf(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9+#./]+/g, "")
    .trim();
}

function existingSkillKeys(profile = {}) {
  const keys = new Set();
  for (const cat of SKILL_CATS) {
    for (const skill of profile.skills?.[cat] || []) keys.add(keyOf(skill));
  }
  return keys;
}

function existingEducationKeys(profile = {}) {
  return new Set(
    (profile.education || []).map((row) => `${keyOf(row.university)}::${keyOf(row.degree)}`)
  );
}

function existingExperienceKeys(profile = {}) {
  const rows = [...(profile.experience?.internships || []), ...(profile.experience?.jobs || [])];
  return new Set(rows.map((row) => `${keyOf(row.company)}::${keyOf(row.role)}`));
}

function existingProjectKeys(profile = {}) {
  return new Set((profile.projects || []).map((row) => keyOf(row.name)));
}

function pushUnique(list, item, keyFn) {
  const key = keyFn(item);
  if (!key || list.some((row) => keyFn(row) === key)) return;
  list.push(item);
}

function skillsFromParsed(parsed) {
  const out = [];
  for (const cat of SKILL_CATS) {
    for (const value of parsed.skills?.[cat] || []) {
      pushUnique(out, { category: cat, value, selected: true, uncertain: false }, (row) => keyOf(row.value));
    }
  }
  return out;
}

function skillsFromFacts(facts = []) {
  const out = [];
  for (const fact of facts) {
    if (fact.factType !== "skill" && fact.factType !== "technology") continue;
    const value = String(fact.value || "").trim();
    if (value.length < 2 || value.length > 40) continue;
    const uncertain = !isVerifiedFact(fact);
    pushUnique(
      out,
      {
        category: categorizeSkill(value),
        value,
        selected: !uncertain,
        uncertain,
      },
      (row) => keyOf(row.value)
    );
  }
  return out;
}

function educationFromParsed(parsed) {
  return (parsed.education || [])
    .filter((row) => row.university || row.degree)
    .map((row) => ({
      university: row.university || "",
      degree: row.degree || "",
      major: row.major || "",
      period: row.period || "",
      gpa: row.gpa ?? null,
      coursework: row.coursework || [],
      selected: true,
    }));
}

function educationFromFacts(facts = []) {
  const schools = facts.filter((f) => f.factType === "education").map((f) => String(f.value || "").trim());
  const degrees = facts.filter((f) => f.factType === "degree").map((f) => String(f.value || "").trim());
  if (!schools.length && !degrees.length) return [];
  if (schools.length && degrees.length) {
    return schools.slice(0, 4).map((university, i) => ({
      university,
      degree: degrees[i] || degrees[0] || "",
      major: "",
      period: "",
      gpa: null,
      coursework: [],
      selected: true,
    }));
  }
  return schools.slice(0, 4).map((university) => ({
    university,
    degree: "",
    major: "",
    period: "",
    gpa: null,
    coursework: [],
    selected: true,
  }));
}

function experienceFromParsed(parsed) {
  return (parsed.experience?.internships || [])
    .filter((row) => row.company || row.role)
    .map((row) => ({
      company: row.company || "",
      role: row.role || "",
      description: row.description || "",
      selected: true,
    }));
}

function experienceFromFacts(facts = []) {
  const roles = facts.filter((f) => f.factType === "role");
  const companies = facts.filter((f) => f.factType === "company");
  if (!roles.length && !companies.length) return [];
  const out = [];
  const max = Math.max(roles.length, companies.length);
  for (let i = 0; i < max && i < 8; i += 1) {
    out.push({
      company: companies[i]?.value || companies[0]?.value || "",
      role: roles[i]?.value || roles[0]?.value || "",
      description: roles[i]?.evidence || companies[i]?.evidence || "",
      selected: true,
    });
  }
  return out;
}

function projectsFromParsed(parsed) {
  return (parsed.projects || [])
    .filter((row) => row.name && !/^github\s+@/i.test(row.name))
    .map((row) => ({
      name: row.name,
      description: row.description || "",
      technologies: row.technologies || [],
      selected: true,
    }));
}

function projectsFromFacts(facts = []) {
  return facts
    .filter((f) => f.factType === "project" && isVerifiedFact(f))
    .map((f) => ({
      name: String(f.value || "").trim(),
      description: String(f.evidence || f.snippet || "").slice(0, 280),
      technologies: [],
      selected: true,
    }))
    .filter((row) => row.name && !/^github\s+@/i.test(row.name));
}

function hasSuggestionContent(suggestions) {
  return Boolean(
    suggestions.skills.length ||
      suggestions.education.length ||
      suggestions.experience.length ||
      suggestions.projects.length
  );
}

/**
 * @param {{ text?: string, facts?: object[], existingProfile?: object, source?: string }} input
 */
export function buildProfileSuggestions(input = {}) {
  const text = String(input.text || "").trim();
  const facts = Array.isArray(input.facts) ? input.facts : [];
  const existing = input.existingProfile && typeof input.existingProfile === "object" ? input.existingProfile : {};
  const parsed =
    text && input.source !== "github"
      ? heuristicExtract(text)
      : { skills: {}, education: [], experience: { internships: [] }, projects: [] };

  const haveSkills = existingSkillKeys(existing);
  const skills = [...skillsFromParsed(parsed), ...skillsFromFacts(facts)].filter((row) => !haveSkills.has(keyOf(row.value)));

  const haveEdu = existingEducationKeys(existing);
  const education = [...educationFromParsed(parsed), ...educationFromFacts(facts)].filter(
    (row) => !haveEdu.has(`${keyOf(row.university)}::${keyOf(row.degree)}`)
  );

  const haveExp = existingExperienceKeys(existing);
  const experience = [...experienceFromParsed(parsed), ...experienceFromFacts(facts)].filter(
    (row) => !haveExp.has(`${keyOf(row.company)}::${keyOf(row.role)}`)
  );

  const haveProj = existingProjectKeys(existing);
  let projects = [...projectsFromParsed(parsed), ...projectsFromFacts(facts)].filter((row) => !haveProj.has(keyOf(row.name)));
  const uniqueProjects = [];
  for (const row of projects) {
    pushUnique(uniqueProjects, row, (item) => keyOf(item.name));
  }
  projects = uniqueProjects.slice(0, 12).map((row, i) => ({ ...row, selected: i < 6 }));

  const uniqueSkills = [];
  for (const row of skills) pushUnique(uniqueSkills, row, (item) => keyOf(item.value));

  const uniqueEdu = [];
  for (const row of education) pushUnique(uniqueEdu, row, (item) => `${keyOf(item.university)}::${keyOf(item.degree)}`);

  const uniqueExp = [];
  for (const row of experience) pushUnique(uniqueExp, row, (item) => `${keyOf(item.company)}::${keyOf(item.role)}`);

  const suggestions = {
    source: input.source || "evidence",
    skills: uniqueSkills.slice(0, 40),
    education: uniqueEdu.slice(0, 8),
    experience: uniqueExp.slice(0, 8),
    projects,
  };
  suggestions.empty = !hasSuggestionContent(suggestions);
  suggestions.counts = {
    skills: suggestions.skills.length,
    education: suggestions.education.length,
    experience: suggestions.experience.length,
    projects: suggestions.projects.length,
  };
  return suggestions;
}

export function attachProfileSuggestions(result = {}, existingProfile = {}, source = "evidence") {
  const suggestions = buildProfileSuggestions({
    text: result.extractedText || result.text || "",
    facts: result.facts || [],
    existingProfile,
    source,
  });
  const { extractedText, ...rest } = result;
  return { ...rest, profileSuggestions: suggestions };
}

function unionStrings(existing = [], incoming = []) {
  const out = [...existing];
  for (const value of incoming) {
    const v = String(value || "").trim();
    if (!v) continue;
    if (!out.some((item) => keyOf(item) === keyOf(v))) out.push(v);
  }
  return out;
}

/**
 * Merge accepted suggestion rows onto the stored profile. Arrays are unioned, never wiped.
 */
export function applyProfileSuggestions(existing = {}, accepted = {}) {
  const skills = {
    programming_languages: [...(existing.skills?.programming_languages || [])],
    frameworks: [...(existing.skills?.frameworks || [])],
    ai_ml: [...(existing.skills?.ai_ml || [])],
    databases: [...(existing.skills?.databases || [])],
    cloud: [...(existing.skills?.cloud || [])],
    tools: [...(existing.skills?.tools || [])],
  };
  for (const row of accepted.skills || []) {
    if (row && row.selected === false) continue;
    const value = String(row.value || "").trim();
    if (!value) continue;
    const cat = SKILL_CATS.includes(row.category) ? row.category : categorizeSkill(value);
    skills[cat] = unionStrings(skills[cat], [value]);
  }

  const education = [...(existing.education || [])];
  const eduKeys = existingEducationKeys({ education });
  for (const row of accepted.education || []) {
    if (row && row.selected === false) continue;
    const next = {
      university: String(row.university || "").trim(),
      degree: String(row.degree || "").trim(),
      major: String(row.major || "").trim(),
      period: String(row.period || "").trim(),
      gpa: row.gpa ?? null,
      gpa_scale: row.gpa_scale || 4.0,
      coursework: Array.isArray(row.coursework) ? row.coursework : [],
    };
    const key = `${keyOf(next.university)}::${keyOf(next.degree)}`;
    if (!next.university && !next.degree) continue;
    if (eduKeys.has(key)) continue;
    eduKeys.add(key);
    education.push(next);
  }

  const internships = [...(existing.experience?.internships || [])];
  const expKeys = existingExperienceKeys({ experience: { internships } });
  for (const row of accepted.experience || []) {
    if (row && row.selected === false) continue;
    const next = {
      company: String(row.company || "").trim(),
      role: String(row.role || "").trim(),
      description: String(row.description || "").trim(),
      achievements: [],
    };
    const key = `${keyOf(next.company)}::${keyOf(next.role)}`;
    if (!next.company && !next.role) continue;
    if (expKeys.has(key)) continue;
    expKeys.add(key);
    internships.push(next);
  }

  const projects = [...(existing.projects || [])];
  const projKeys = existingProjectKeys({ projects });
  for (const row of accepted.projects || []) {
    if (row && row.selected === false) continue;
    const next = {
      name: String(row.name || "").trim(),
      description: String(row.description || "").trim(),
      technologies: Array.isArray(row.technologies) ? row.technologies : [],
      achievements: [],
    };
    if (!next.name || projKeys.has(keyOf(next.name))) continue;
    projKeys.add(keyOf(next.name));
    projects.push(next);
  }

  return {
    ...existing,
    skills,
    education,
    experience: { internships, jobs: existing.experience?.jobs || [] },
    projects,
  };
}
