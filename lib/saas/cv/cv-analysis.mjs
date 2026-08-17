/**
 * cv-analysis.mjs — Deterministic CV vs opportunity analysis.
 * Does not invent skills, projects, or experience.
 */

import { extractSkills } from "../../../skill-extract.mjs";
import { extractSourceFacts } from "../../cv-tailor.mjs";
import { isVerifiedFact } from "../knowledge/fact-shape.mjs";

export const RISK_LEVEL = Object.freeze({ LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" });

function norm(s) {
  return String(s || "").toLowerCase().trim();
}

function unique(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const k = norm(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(typeof item === "string" ? item : String(item));
  }
  return out;
}

function hasSkill(list, s) {
  const n = norm(s);
  return (list || []).some((x) => norm(x) === n);
}

function internshipsOf(profile) {
  const exp = profile?.experience;
  if (Array.isArray(exp)) return exp;
  return [...(exp?.internships || []), ...(exp?.jobs || [])];
}

function verifiedKnowledgeSkills(knowledgeContext) {
  const out = [];
  for (const t of knowledgeContext?.technologiesUsed || []) {
    const verified =
      t.verificationStatus === "VERIFIED" ||
      t.status === "GROUNDED";
    if (verified && t.value) out.push(t.value);
  }
  for (const s of knowledgeContext?.matchingSkills || []) {
    if (s.status === "GROUNDED" && s.skill) out.push(s.skill);
  }
  return unique(out);
}

/**
 * Analyze master CV + knowledge + JD + eligibility + match.
 * @returns {CvAnalysis}
 */
export function analyzeCvForOpportunity({
  profile = {},
  cvText = "",
  opportunity = {},
  eligibility = null,
  matchResult = null,
  knowledgeContext = null,
} = {}) {
  const jdText = [
    opportunity.title || opportunity.role || "",
    opportunity.description || opportunity.raw_text || "",
    ...(opportunity.required_skills || []),
    ...(opportunity.skills || []),
  ].join(" ");

  const jdSkills = unique([...extractSkills(jdText), ...(opportunity.required_skills || [])]);
  const sourceFacts = extractSourceFacts(profile, cvText);
  const cvSkills = unique([...(sourceFacts.skills || []), ...extractSkills(cvText || "")]);
  const knownSkills = unique([...cvSkills, ...verifiedKnowledgeSkills(knowledgeContext)]);

  const overlapping = jdSkills.filter((s) => hasSkill(cvSkills, s) || hasSkill(knownSkills, s));
  const missingOnCv = jdSkills.filter((s) => !hasSkill(cvSkills, s));
  const knownButNotOnCv = missingOnCv.filter((s) => hasSkill(knownSkills, s));
  const unknownSkills = missingOnCv.filter((s) => !hasSkill(knownSkills, s));

  const projects = Array.isArray(profile.projects) ? profile.projects : [];
  const knowledgeProjects = (knowledgeContext?.matchingProjects || [])
    .filter((p) => isVerifiedFact(p))
    .map((p) => p.value || p.name)
    .filter(Boolean);

  const relevantProjects = unique([
    ...projects
      .filter((p) => {
        const blob = `${p.name || ""} ${(p.technologies || []).join(" ")} ${p.description || ""}`.toLowerCase();
        return jdSkills.some((s) => blob.includes(norm(s))) || overlapping.some((s) => blob.includes(norm(s)));
      })
      .map((p) => p.name)
      .filter(Boolean),
    ...knowledgeProjects.filter((name) => {
      const n = norm(name);
      return jdSkills.some((s) => n.includes(norm(s))) || overlapping.some((s) => n.includes(norm(s)));
    }),
  ]);

  const relevantExperience = internshipsOf(profile)
    .filter((e) => {
      const blob = `${e.company || ""} ${e.role || ""} ${e.description || ""}`.toLowerCase();
      return jdSkills.some((s) => blob.includes(norm(s))) || /intern|engineer|developer|research/i.test(blob);
    })
    .map((e) => [e.role, e.company].filter(Boolean).join(" at "))
    .filter(Boolean);

  const relevantSections = [];
  if (overlapping.length) relevantSections.push("Skills");
  if (relevantProjects.length) relevantSections.push("Projects");
  if (relevantExperience.length) relevantSections.push("Experience");
  if (Array.isArray(profile.education) && profile.education.length) relevantSections.push("Education");

  const overlapRatio = jdSkills.length === 0 ? 1 : overlapping.length / jdSkills.length;
  const matchScore = typeof matchResult?.match_score === "number" ? matchResult.match_score : Math.round(overlapRatio * 100);
  const eligibilityBad = eligibility?.overall === "NOT_ELIGIBLE";

  let riskLevel = RISK_LEVEL.LOW;
  if (eligibilityBad || unknownSkills.length >= 3 || overlapRatio < 0.35) riskLevel = RISK_LEVEL.HIGH;
  else if (knownButNotOnCv.length >= 1 || overlapRatio < 0.7 || matchScore < 70) riskLevel = RISK_LEVEL.MEDIUM;

  const cvSuitable = !eligibilityBad && overlapRatio >= 0.55 && unknownSkills.length <= 2;
  const currentCvRelevant = cvSuitable;

  const significantGap =
    knownButNotOnCv.length >= 2 ||
    (relevantProjects.length >= 2 && overlapRatio < 0.8) ||
    (cvSuitable && overlapRatio < 0.7 && relevantExperience.length >= 1);

  const needsModification = !eligibilityBad && significantGap;
  const shouldRegenerate = needsModification && overlapRatio >= 0.25 && (knownButNotOnCv.length >= 1 || relevantProjects.length >= 1);

  const recommendedChanges = [];
  if (shouldRegenerate) {
    if (overlapping.length) recommendedChanges.push(`Emphasize attested skills: ${overlapping.slice(0, 8).join(", ")}.`);
    if (knownButNotOnCv.length) {
      recommendedChanges.push(
        `Surface knowledge-attested skills that are not prominent on the master CV: ${knownButNotOnCv.slice(0, 8).join(", ")}.`
      );
    }
    if (relevantProjects.length) recommendedChanges.push(`Lead with projects: ${relevantProjects.slice(0, 5).join(", ")}.`);
    if (relevantExperience.length) recommendedChanges.push(`Lead with experience: ${relevantExperience.slice(0, 5).join(", ")}.`);
    recommendedChanges.push("Reorder and rewrite existing content only. Do not invent facts, dates, metrics, employers, or education.");
  } else if (cvSuitable) {
    recommendedChanges.push("No regeneration needed. The master CV is already appropriate for this role.");
  } else if (eligibilityBad) {
    recommendedChanges.push("Do not tailor to conceal ineligibility. Eligibility must stay UNKNOWN/FAIL as reported.");
  } else {
    recommendedChanges.push("Overlap is too weak to justify a new CV version. Keep the master CV. Do not invent missing skills.");
  }
  if (unknownSkills.length) {
    recommendedChanges.push(
      `UNKNOWN skills requested by the job (do not add): ${unknownSkills.slice(0, 8).join(", ")}.`
    );
  }

  let reason;
  if (shouldRegenerate) {
    reason = "Tailoring would significantly improve relevance by emphasizing attested skills, projects, and experience already in the candidate record.";
  } else if (cvSuitable) {
    reason = "Master CV already covers the role. Regenerating would not significantly improve relevance.";
  } else if (eligibilityBad) {
    reason = "Candidate is not eligible; CV regeneration is skipped.";
  } else {
    reason = "Insufficient attested overlap to justify a tailored CV. Missing requirements stay UNKNOWN.";
  }

  return {
    cvSuitable,
    currentCvRelevant,
    relevantSections,
    skillsToEmphasize: overlapping,
    projectsToEmphasize: relevantProjects,
    experienceToEmphasize: unique(relevantExperience),
    needsModification,
    shouldRegenerate,
    recommendedChanges,
    riskLevel,
    overlapRatio: Number(overlapRatio.toFixed(3)),
    matchScore,
    unknownSkills,
    knownButNotOnCv,
    reason,
  };
}

export function mergeVerifiedKnowledgeIntoProfile(profile = {}, knowledgeContext = null) {
  const extra = verifiedKnowledgeSkills(knowledgeContext);
  const knowledgeProjects = knowledgeContext?.matchingProjects || [];
  if (!extra.length && !knowledgeProjects.length) return profile;
  const skills = { ...(profile.skills || {}) };
  const tools = unique([...(skills.tools || []), ...extra]);
  const projects = Array.isArray(profile.projects) ? [...profile.projects] : [];
  for (const p of knowledgeContext?.matchingProjects || []) {
    const name = p.value || p.name;
    if (!name) continue;
    if (!isVerifiedFact(p) && p.status !== "GROUNDED") continue;
    if (projects.some((x) => norm(x.name) === norm(name))) continue;
    projects.push({
      name,
      description: p.evidence || p.snippet || "",
      technologies: [],
      achievements: [],
    });
  }
  return { ...profile, skills: { ...skills, tools }, projects };
}

export function wrapMasterCvHtml(cvText = "", profile = {}) {
  const name = profile?.identity?.name || "Candidate";
  const escaped = String(cvText || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<article class="master-cv"><h1>${name.replace(/</g, "")}</h1><pre style="white-space:pre-wrap;font-family:inherit">${escaped}</pre></article>`;
}
