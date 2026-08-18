/**
 * URL-apply adapter: call the existing in-app tailoring engines.
 * Does not reimplement CV or cover-letter generation.
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { logUrlApply } from "./extract-external-job.mjs";
import { tailorUserCvForJob } from "./ats-cv-from-profile.mjs";
import { composeCoverLetter, validateCoverLetter, buildCoverLetterBrief, renderCoverLetterHtml } from "./cover-letter-engine.mjs";

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function tailoredDraftToText(draft, profile = {}) {
  if (!draft || typeof draft !== "object") return "";
  const name = profile?.identity?.name || "Candidate";
  const lines = [
    name,
    "",
    "PROFESSIONAL SUMMARY",
    String(draft.summary || "").trim(),
    "",
    "CORE COMPETENCIES",
    (draft.competencies || []).join(", "),
    "",
    "WORK EXPERIENCE",
  ];
  for (const job of draft.experience || []) {
    lines.push(`${job.role || ""} | ${job.company || ""} | ${job.start_date || ""} – ${job.end_date || ""}`.replace(/^\s*\|\s*/, "").trim());
    for (const bullet of job.bullets || []) lines.push(`• ${bullet}`);
  }
  lines.push("", "PROJECTS");
  for (const project of draft.projects || []) {
    lines.push(project.name || "");
    if (project.description) lines.push(project.description);
    for (const achievement of project.achievements || []) lines.push(`• ${achievement}`);
    if (project.technologies?.length) lines.push((project.technologies || []).join(" · "));
  }
  return lines.filter((line) => line !== undefined && line !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function coverLetterToHtml(name, company, body) {
  const paragraphs = String(body || "")
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
  const title = `${escapeHtml(name || "Candidate")} - Cover letter${company ? ` - ${escapeHtml(company)}` : ""}`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${title}</title>
<style>body{font-family:Georgia,serif;max-width:720px;margin:48px auto;line-height:1.55;color:#111}p{margin:0 0 1em}</style>
</head><body>${paragraphs}</body></html>`;
}

function checkoutRoot(explicitRoot = "") {
  const here = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  const candidates = [explicitRoot, process.env.STUDENT_CAREER_AI_ROOT, here, process.cwd(), path.resolve(process.cwd(), "..")];
  for (const dir of candidates) {
    const root = String(dir || "").trim();
    if (root && existsSync(path.join(root, "lib", "cv-tailor.mjs"))) return root;
  }
  return explicitRoot || here;
}

async function loadEngines(root, loaders = {}) {
  if (loaders.tailorCV && loaders.generateCoverLetter) return loaders;
  const checkout = checkoutRoot(root);
  const tailorUrl = pathToFileURL(path.join(checkout, "lib", "cv-tailor.mjs")).href;
  const genUrl = pathToFileURL(path.join(checkout, "lib", "application-generator.mjs")).href;
  const tailorMod = await import(/* webpackIgnore: true */ tailorUrl);
  const genMod = await import(/* webpackIgnore: true */ genUrl);
  return {
    tailorCV: loaders.tailorCV || tailorMod.tailorCV,
    generateCoverLetter: loaders.generateCoverLetter || genMod.generateCoverLetter,
  };
}

export async function tailorUrlApplyDocuments({
  profile,
  cvText = "",
  opportunity,
  matchingConfig,
  callAIFn,
  root,
  loaders = {},
  originalBuffer = null,
  originalFilename = "",
  originalMime = "",
  githubProjects = [],
  fetchGitHubEvidence = null,
  githubToken = "",
} = {}) {
  if (!opportunity?.description) {
    return { cvText: "", cvHtml: "", coverLetter: "", coverHtml: "", usedExistingEngine: false };
  }
  logUrlApply("Normalized job created", {
    title: opportunity.title,
    company: opportunity.company,
    descriptionChars: String(opportunity.description || "").length,
  });
  logUrlApply("Calling existing tailoring engine");
  const { tailorCV, generateCoverLetter } = await loadEngines(root, loaders);
  let aiFn = callAIFn;
  if (typeof aiFn !== "function") {
    try {
      const checkout = checkoutRoot(root);
      const providerUrl = pathToFileURL(path.join(checkout, "lib", "ai-provider.mjs")).href;
      const providerMod = await import(/* webpackIgnore: true */ providerUrl);
      aiFn = (resolved, sys, usr) => providerMod.callAI(resolved, sys, usr);
    } catch {
      aiFn = callAIFn;
    }
  }
  const out = { cvText: "", cvHtml: "", coverLetter: "", coverHtml: "", cvDocx: null, usedExistingEngine: false, tailoringReport: null, cvSource: "" };

  try {
    const copy = await tailorUserCvForJob({
      profile,
      cvText,
      originalBuffer,
      originalFilename,
      originalMime,
      githubProjects: Array.isArray(profile?.githubProjects) ? profile.githubProjects : githubProjects,
      root: checkoutRoot(root),
      company: opportunity.company,
      role: opportunity.title || opportunity.role,
      jdText: opportunity.description,
      fetchGitHubEvidence,
      githubToken,
    });
    if (copy?.text && copy?.html) {
      out.cvText = copy.text;
      out.cvHtml = copy.html;
      out.cvDocx = copy.buffer;
      out.tailoringReport = copy.report;
      out.cvSource = copy.source;
      out.usedExistingEngine = true;
      logUrlApply("Tailored CV generated from user master or ATS format", {
        htmlChars: out.cvHtml.length,
        source: copy.source,
      });
    }
  } catch (err) {
    logUrlApply("User CV tailoring unavailable", { error: err instanceof Error ? err.message : "unknown" });
  }

  if (!out.cvText) {
    try {
      const record = await tailorCV({
        profile,
        cvText,
        opportunity,
        matchingConfig,
        callAIFn: aiFn,
      });
      out.cvHtml = String(record?.tailored_html || "");
      out.cvText = tailoredDraftToText(record?.tailored_draft, profile) || String(record?.original_cv || cvText || "");
      out.usedExistingEngine = Boolean(out.cvHtml || out.cvText);
      logUrlApply("Tailored CV generated", { htmlChars: out.cvHtml.length });
    } catch (err) {
      logUrlApply("Existing CV engine unavailable", { error: err instanceof Error ? err.message : "unknown" });
    }
  }

  const sourceCv = out.cvText || cvText;
  const brief = buildCoverLetterBrief({
    cvText: sourceCv,
    profile,
    company: opportunity.company,
    role: opportunity.title || opportunity.role,
    jdText: opportunity.description,
    githubProjects: Array.isArray(profile?.githubProjects) ? profile.githubProjects : [],
  });

  try {
    const letter = await generateCoverLetter({
      profile,
      opportunity,
      matchingConfig,
      callAIFn: aiFn,
      company: opportunity.company,
      position: opportunity.title || opportunity.role,
      evidencePackets: brief.evidencePackets,
      relevantExperience: brief.relevantExperience,
      relevantProjects: brief.relevantProjects,
      roleFamily: brief.family,
      selectedEvidence: brief.evidence,
      masterCvExcerpt: String(sourceCv || "").slice(0, 2400),
      jdFocus: brief.jdFocus,
    });
    const aiBody = String(letter?.body || "").trim();
    const check = aiBody ? validateCoverLetter(aiBody, brief) : { ok: false, reasons: ["empty"] };
    if (check.ok) {
      out.coverLetter = aiBody;
      logUrlApply("Tailored cover letter generated", { chars: out.coverLetter.length, source: "ai" });
    } else {
      logUrlApply("AI cover letter failed quality check; using job-specific grounded letter", {
        reasons: check.reasons,
      });
    }
  } catch (err) {
    logUrlApply("Existing cover-letter engine unavailable", { error: err instanceof Error ? err.message : "unknown" });
  }

  if (!out.coverLetter) {
    const fallback = composeCoverLetter({ brief });
    if (fallback.body) {
      out.coverLetter = fallback.body;
      logUrlApply("Cover letter generated from master CV evidence", {
        chars: out.coverLetter.length,
        family: fallback.family,
      });
    }
  }

  if (out.coverLetter) {
    out.coverHtml = renderCoverLetterHtml(brief, out.coverLetter);
    out.usedExistingEngine = true;
  }

  return out;
}
