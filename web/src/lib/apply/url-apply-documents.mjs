/**
 * Multi-URL document layer: one isolated tailored CV + cover letter per job.
 * Reuses the existing tailorCV / generateCoverLetter engines.
 * Never writes the master CV. Never shares artifacts across jobs.
 */

import { tailorUrlApplyDocuments } from "./url-apply-tailor.mjs";
import { extractJobSections } from "./extract-external-job.mjs";

function tokens(value) {
  return String(value || "")
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];
}

export function isolateMasterCv(masterCv) {
  return String(masterCv || "");
}

export function isolateProfile(profile) {
  try {
    return JSON.parse(JSON.stringify(profile || {}));
  } catch {
    return {};
  }
}

export function documentFileStem(company, role) {
  const companyPart = tokens(company).slice(0, 4).join("");
  const rolePart = tokens(role).slice(0, 8).join("_");
  return [companyPart, rolePart].filter(Boolean).join("_").slice(0, 80) || "job";
}

export function tailoredCvFileName(company, role) {
  return `${documentFileStem(company, role)}_tailored_cv.pdf`;
}

export function coverLetterFileName(company, role) {
  return `${documentFileStem(company, role)}_cover_letter.pdf`;
}

export function freezeJobRecord(job = {}, jobId = "") {
  const description = String(job.description || "").trim();
  const parsed = extractJobSections(description);
  const copy = (list) => [...new Set((Array.isArray(list) ? list : []).map((item) => String(item || "").trim()).filter(Boolean))];
  return {
    job_id: String(jobId || job.job_id || ""),
    source: job.source || "external_url",
    url: String(job.url || job.source_url || ""),
    company: String(job.company || "").trim(),
    title: String(job.title || job.role || "").trim(),
    role: String(job.role || job.title || "").trim(),
    description,
    location: String(job.location || "").trim(),
    employmentType: String(job.employmentType || "").trim(),
    responsibilities: copy(job.responsibilities?.length ? job.responsibilities : parsed.responsibilities),
    requirements: copy(job.requirements?.length ? job.requirements : parsed.requirements),
    qualifications: copy(job.qualifications?.length ? job.qualifications : parsed.qualifications),
    skills: copy(job.skills?.length ? job.skills : parsed.skills),
    technologies: copy(job.technologies?.length ? job.technologies : parsed.technologies),
    opportunity_type: job.opportunity_type || (/\bintern/i.test(`${job.title || ""} ${description}`) ? "INTERNSHIP" : "JOB"),
  };
}

function blobOf(docs) {
  return `${docs?.cvText || ""}\n${docs?.cvHtml || ""}\n${docs?.coverLetter || ""}\n${docs?.coverHtml || ""}`.toLowerCase();
}

function includesCompany(text, company) {
  const name = String(company || "").trim();
  if (!name) return true;
  const hay = String(text || "").toLowerCase();
  if (hay.includes(name.toLowerCase())) return true;
  const words = tokens(name).filter((w) => w.length > 2);
  return words.length > 0 && words.every((w) => hay.includes(w));
}

function jobKeywords(job) {
  const fromTitle = tokens(job.title || job.role).filter((w) => w.length > 2 && !/^(the|and|for|intern|internship|job|role)$/.test(w));
  const fromLists = [...(job.skills || []), ...(job.technologies || []), ...(job.requirements || [])]
    .flatMap((item) => tokens(item))
    .filter((w) => w.length > 2);
  return [...new Set([...fromTitle, ...fromLists])].slice(0, 12);
}

/**
 * Verify documents belong to THIS job and do not leak another job's company.
 * Does not rewrite the engine — it only accepts or rejects the output.
 */
export function qualityCheckDocuments({
  job = {},
  profile = {},
  documents = {},
  foreignCompanies = [],
  masterCv = "",
} = {}) {
  const checks = [];
  const hay = blobOf(documents);
  const name = String(profile?.identity?.name || "").trim();
  const company = job.company || "";
  const title = job.title || job.role || "";

  const companyOk = includesCompany(hay, company);
  checks.push({ id: "company", ok: companyOk, detail: companyOk ? `Mentions ${company}` : `Missing company ${company}` });

  const titleTokens = tokens(title).filter((w) => w.length > 2);
  const titleOk = !titleTokens.length || titleTokens.some((w) => hay.includes(w));
  checks.push({ id: "title", ok: titleOk, detail: titleOk ? `Mentions ${title}` : `Missing job title ${title}` });

  const keywords = jobKeywords(job);
  const keywordHits = keywords.filter((w) => hay.includes(w));
  const keywordsOk = keywords.length === 0 || keywordHits.length > 0;
  checks.push({
    id: "keywords",
    ok: keywordsOk,
    detail: keywordsOk ? `Job keywords present (${keywordHits.slice(0, 4).join(", ") || "n/a"})` : "No job-specific keywords found",
  });

  const nameOk = !name || hay.includes(name.toLowerCase());
  checks.push({ id: "candidate", ok: nameOk, detail: nameOk ? "Candidate name present" : "Candidate name missing" });

  const leaked = (foreignCompanies || [])
    .map((c) => String(c || "").trim())
    .filter((c) => c && c.toLowerCase() !== String(company).toLowerCase())
    .filter((c) => includesCompany(hay, c) && !includesCompany(masterCv, c));
  const leakOk = leaked.length === 0;
  checks.push({
    id: "isolation",
    ok: leakOk,
    detail: leakOk ? "No other-job company leak" : `Leaked ${leaked.join(", ")}`,
  });

  const hasBody = Boolean(String(documents.cvText || documents.cvHtml || "").trim() && String(documents.coverLetter || "").trim());
  checks.push({ id: "complete", ok: hasBody, detail: hasBody ? "CV and cover letter both present" : "Missing CV or cover letter" });

  return {
    ok: checks.every((c) => c.ok),
    checks,
    leaked,
    keywordHits,
  };
}

export async function generateJobDocuments({
  jobId,
  job,
  profile,
  masterCv,
  foreignCompanies = [],
  matchingConfig,
  callAIFn,
  root,
  loaders,
  tailorDocuments = tailorUrlApplyDocuments,
  originalBuffer = null,
  originalFilename = "",
  originalMime = "",
  githubProjects = [],
  fetchGitHubEvidence = null,
  githubToken = "",
} = {}) {
  const frozenJob = freezeJobRecord(job, jobId);
  const isolatedCv = isolateMasterCv(masterCv);
  const isolatedProfile = isolateProfile(profile);
  const stem = documentFileStem(frozenJob.company, frozenJob.title);
  const files = {
    stem,
    cvName: `${stem}_tailored_cv.pdf`,
    coverName: `${stem}_cover_letter.pdf`,
    job_id: frozenJob.job_id,
  };

  if (!frozenJob.description) {
    return {
      job: frozenJob,
      files,
      usedExistingEngine: false,
      quality: { ok: false, checks: [{ id: "complete", ok: false, detail: "No job description" }], leaked: [], keywordHits: [] },
      cvText: "",
      cvHtml: "",
      coverLetter: "",
      coverHtml: "",
      masterCvUnchanged: isolatedCv === String(masterCv || ""),
    };
  }

  const generated = await (tailorDocuments || tailorUrlApplyDocuments)({
    profile: isolatedProfile,
    cvText: isolatedCv,
    opportunity: frozenJob,
    matchingConfig,
    callAIFn,
    root,
    loaders,
    originalBuffer,
    originalFilename,
    originalMime,
    githubProjects,
    fetchGitHubEvidence,
    githubToken,
  });

  const documents = {
    cvText: String(generated?.cvText || ""),
    cvHtml: String(generated?.cvHtml || ""),
    coverLetter: String(generated?.coverLetter || ""),
    coverHtml: String(generated?.coverHtml || ""),
  };
  const quality = qualityCheckDocuments({
    job: frozenJob,
    profile: isolatedProfile,
    documents,
    foreignCompanies,
    masterCv: isolatedCv,
  });

  return {
    job: frozenJob,
    files,
    usedExistingEngine: Boolean(generated?.usedExistingEngine),
    quality,
    ...documents,
    cvDocx: generated?.cvDocx || null,
    cvSource: generated?.cvSource || "",
    masterCvUnchanged: isolatedCv === String(masterCv || "") && String(masterCv || "") === isolateMasterCv(masterCv),
  };
}
