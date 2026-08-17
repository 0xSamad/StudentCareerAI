/**
 * cover-letter-requirement.mjs — Inspect the job/application for cover-letter need.
 * Returns REQUIRED | RECOMMENDED | OPTIONAL | NOT_NEEDED. Never invents a need.
 */

export const COVER_LETTER_REQUIREMENT = Object.freeze({
  REQUIRED: "REQUIRED",
  RECOMMENDED: "RECOMMENDED",
  OPTIONAL: "OPTIONAL",
  NOT_NEEDED: "NOT_NEEDED",
});

function internshipsOf(profile) {
  const exp = profile?.experience;
  if (Array.isArray(exp)) return exp;
  return [...(exp?.internships || []), ...(exp?.jobs || [])];
}

function unique(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const k = String(item || "").toLowerCase().trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function fieldLabel(field) {
  if (typeof field === "string") return field;
  if (!field || typeof field !== "object") return "";
  return String(field.label || field.name || field.question || field.id || field.type || "");
}

function fieldRequired(field) {
  if (!field || typeof field !== "object") return false;
  if (field.required === true || field.isRequired === true || field.optional === false) return true;
  const req = String(field.requirement || field.status || "").toLowerCase();
  return req === "required" || req === "mandatory";
}

function isCoverLetterField(label) {
  return /cover\s*letter|motivation\s*letter|letter\s+of\s+interest/i.test(label);
}

function collectSurfaces(opportunity = {}) {
  const questions = [];
  const rawQuestions = opportunity.questions || opportunity.application_questions || [];
  for (const q of rawQuestions) {
    if (typeof q === "string") questions.push({ text: q, required: /required/i.test(q) });
    else questions.push({ text: String(q.question || q.text || q.label || ""), required: fieldRequired(q) });
  }

  const fields = [
    ...(opportunity.form_fields || []),
    ...(opportunity.fields || []),
    ...(opportunity.application_form?.fields || []),
    ...(opportunity.applicationForm?.fields || []),
  ];

  const textParts = [
    opportunity.title || opportunity.role || "",
    opportunity.company || "",
    opportunity.description || opportunity.raw_text || "",
    opportunity.requirements || "",
    opportunity.application_instructions || opportunity.how_to_apply || "",
    opportunity.notes || "",
    ...(Array.isArray(opportunity.application_requirements) ? opportunity.application_requirements : []),
    ...questions.map((q) => q.text),
    ...fields.map((f) => fieldLabel(f)),
  ];

  return {
    text: textParts.filter(Boolean).join("\n"),
    questions,
    fields,
  };
}

function explicitRequirement(opportunity = {}) {
  const raw =
    opportunity.cover_letter_required ??
    opportunity.requires_cover_letter ??
    opportunity.coverLetterRequired ??
    opportunity.cover_letter ??
    opportunity.coverLetter;
  if (raw === true) return COVER_LETTER_REQUIREMENT.REQUIRED;
  if (raw === false) return COVER_LETTER_REQUIREMENT.NOT_NEEDED;
  const v = String(raw || "").trim().toLowerCase();
  if (["required", "mandatory", "must"].includes(v)) return COVER_LETTER_REQUIREMENT.REQUIRED;
  if (["recommended", "encouraged"].includes(v)) return COVER_LETTER_REQUIREMENT.RECOMMENDED;
  if (["optional"].includes(v)) return COVER_LETTER_REQUIREMENT.OPTIONAL;
  if (["not_needed", "not needed", "not_required", "not required", "none", "no"].includes(v)) {
    return COVER_LETTER_REQUIREMENT.NOT_NEEDED;
  }
  return null;
}

export function studentGoalsFromProfile(profile = {}, knowledgeContext = null) {
  const prefs = profile.preferences || {};
  const goals = [];
  if (Array.isArray(prefs.target_roles)) goals.push(...prefs.target_roles);
  if (Array.isArray(prefs.goals)) goals.push(...prefs.goals);
  if (typeof prefs.goals === "string" && prefs.goals.trim()) goals.push(prefs.goals);
  if (prefs.career_goal) goals.push(prefs.career_goal);
  if (prefs.narrative) goals.push(prefs.narrative);
  for (const role of knowledgeContext?.preferences?.preferredRoles || []) {
    if (role?.authority && role.authority !== "GENERATED" && role.value) goals.push(role.value);
  }
  for (const interest of knowledgeContext?.preferences?.careerInterests || []) {
    if (interest?.authority && interest.authority !== "GENERATED" && interest.value) goals.push(interest.value);
  }
  return unique(goals.map((g) => String(g).trim()).filter(Boolean));
}

export function attestedTokensFrom({ profile = {}, knowledgeContext = null, cvAnalysis = null } = {}) {
  const tokens = [];
  for (const p of profile.projects || []) if (p?.name) tokens.push(p.name);
  for (const e of internshipsOf(profile)) {
    if (e?.company) tokens.push(e.company);
    if (e?.role) tokens.push(e.role);
  }
  for (const p of knowledgeContext?.matchingProjects || []) {
    const name = p.value || p.name;
    if (name) tokens.push(name);
  }
  for (const e of knowledgeContext?.matchingExperience || []) {
    if (e.value) tokens.push(e.value);
  }
  for (const name of cvAnalysis?.projectsToEmphasize || []) tokens.push(name);
  for (const name of cvAnalysis?.experienceToEmphasize || []) tokens.push(name);
  return unique(tokens);
}

/**
 * @returns {{
 *   requirement: string,
 *   shouldGenerate: boolean,
 *   signals: string[],
 *   reason: string,
 *   benefit: boolean,
 *   relevantProjects: string[],
 *   relevantExperience: string[],
 *   goals: string[],
 * }}
 */
export function analyzeCoverLetterRequirement({
  opportunity = {},
  profile = {},
  knowledgeContext = null,
  cvAnalysis = null,
  matchResult = null,
} = {}) {
  const surfaces = collectSurfaces(opportunity);
  const blob = surfaces.text;
  const signals = [];
  const explicit = explicitRequirement(opportunity);

  const coverFields = surfaces.fields.filter((f) => isCoverLetterField(fieldLabel(f)));
  const requiredCoverField = coverFields.find((f) => fieldRequired(f));
  const coverQuestions = surfaces.questions.filter((q) => isCoverLetterField(q.text));
  const requiredCoverQuestion = coverQuestions.find((q) => q.required);

  const notNeeded =
    /\bno\s+cover\s*letters?\s*(needed|required|necessary|please)?\b/i.test(blob) ||
    /\bdo\s+not\s+(send|include|attach|submit|write)\b[\s\S]{0,40}\bcover\s*letters?\b/i.test(blob) ||
    /\bcover\s*letters?\s*(are|is)?\s*not\s+(required|accepted|needed|necessary|wanted)\b/i.test(blob) ||
    /\bwe\s+do\s+not\s+(accept|want|require|need)\s+cover\s*letters?\b/i.test(blob) ||
    /\bcover\s*letters?\s*(will\s+)?not\s+be\s+(reviewed|considered|accepted)\b/i.test(blob);

  const requiredText =
    /\bcover\s*letters?\s*(is|are)?\s*(required|mandatory)\b/i.test(blob) ||
    /\b(must|please)\s+(include|attach|upload|submit|provide|write)\b[\s\S]{0,48}\bcover\s*letters?\b/i.test(blob) ||
    /\ba\s+cover\s*letter\s+is\s+required\b/i.test(blob);

  const recommendedText =
    /\bcover\s*letters?\s*(is|are)?\s*(recommended|encouraged|preferred|strongly\s+suggested)\b/i.test(blob) ||
    /\b(optional\s+but\s+(recommended|encouraged)|strongly\s+(recommend|encourage)\b[\s\S]{0,40}cover\s*letter)/i.test(blob);

  const optionalText =
    /\bcover\s*letters?\s*(is|are)?\s*optional\b/i.test(blob) ||
    /\boptional\s+cover\s*letters?\b/i.test(blob) ||
    /\byou\s+may\s+(attach|include|upload|submit)\b[\s\S]{0,40}\bcover\s*letters?\b/i.test(blob);

  let requirement = COVER_LETTER_REQUIREMENT.NOT_NEEDED;
  if (notNeeded || explicit === COVER_LETTER_REQUIREMENT.NOT_NEEDED) {
    requirement = COVER_LETTER_REQUIREMENT.NOT_NEEDED;
    signals.push("Posting or application instructions say a cover letter is not needed.");
  } else if (explicit === COVER_LETTER_REQUIREMENT.REQUIRED || requiredText || requiredCoverField || requiredCoverQuestion) {
    requirement = COVER_LETTER_REQUIREMENT.REQUIRED;
    if (explicit === COVER_LETTER_REQUIREMENT.REQUIRED) signals.push("Application flag marks the cover letter as required.");
    if (requiredText) signals.push("Job text requires a cover letter.");
    if (requiredCoverField) signals.push(`Required form field: ${fieldLabel(requiredCoverField)}.`);
    if (requiredCoverQuestion) signals.push("A required application question asks for a cover letter.");
  } else if (explicit === COVER_LETTER_REQUIREMENT.RECOMMENDED || recommendedText) {
    requirement = COVER_LETTER_REQUIREMENT.RECOMMENDED;
    signals.push("The posting recommends or encourages a cover letter.");
  } else if (explicit === COVER_LETTER_REQUIREMENT.OPTIONAL || optionalText || coverFields.length || coverQuestions.length) {
    requirement = COVER_LETTER_REQUIREMENT.OPTIONAL;
    if (optionalText || explicit === COVER_LETTER_REQUIREMENT.OPTIONAL) {
      signals.push("A cover letter is listed as optional.");
    } else {
      signals.push("A cover letter field or question exists but is not required.");
    }
  } else {
    signals.push("No cover letter requirement was found in the job or application materials.");
  }

  const relevantProjects = unique([
    ...(cvAnalysis?.projectsToEmphasize || []),
    ...(knowledgeContext?.matchingProjects || []).map((p) => p.value || p.name).filter(Boolean),
    ...(matchResult?.relevant_projects || []),
  ]);
  const relevantExperience = unique([
    ...(cvAnalysis?.experienceToEmphasize || []),
    ...(matchResult?.relevant_experience || []),
  ]);
  const goals = studentGoalsFromProfile(profile, knowledgeContext);
  const attested = attestedTokensFrom({ profile, knowledgeContext, cvAnalysis });
  const benefit = attested.length >= 1 && (relevantProjects.length >= 1 || relevantExperience.length >= 1);

  const shouldGenerate =
    requirement === COVER_LETTER_REQUIREMENT.REQUIRED ||
    requirement === COVER_LETTER_REQUIREMENT.RECOMMENDED ||
    (requirement === COVER_LETTER_REQUIREMENT.OPTIONAL && benefit);

  let reason;
  if (requirement === COVER_LETTER_REQUIREMENT.REQUIRED) {
    reason = "A cover letter is required by the application. Generate a personalized letter from attested evidence only.";
  } else if (requirement === COVER_LETTER_REQUIREMENT.RECOMMENDED) {
    reason = "A cover letter is recommended. Generate a personalized letter from attested evidence only.";
  } else if (requirement === COVER_LETTER_REQUIREMENT.OPTIONAL && shouldGenerate) {
    reason = "A cover letter is optional, but attested projects/experience would add a specific angle, so one will be generated.";
  } else if (requirement === COVER_LETTER_REQUIREMENT.OPTIONAL) {
    reason = "A cover letter is optional and would not add attested, role-specific evidence. Skipping generation.";
  } else {
    reason = "The job does not require a cover letter and adding one provides no benefit. Skipping generation.";
  }

  return {
    requirement,
    shouldGenerate,
    signals,
    reason,
    benefit,
    relevantProjects,
    relevantExperience,
    goals,
    attestedTokens: attested,
  };
}
