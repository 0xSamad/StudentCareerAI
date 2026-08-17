/**
 * Pick the tailored CV that was actually attached — a copy-edit of the master
 * format — not a rebuilt career-ops template. Preview should match the PDF in
 * output/apply/{jobId}/*_tailored_cv.pdf.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";

export function slugPart(value) {
  return (String(value || "").toLowerCase().match(/[a-z0-9]+/g) || []).join("-").slice(0, 64);
}

export function isRebuiltTemplateCv(content) {
  const s = String(content || "");
  if (!s) return false;
  return (
    /Themeable tokens/i.test(s) ||
    /GitHub repository containing the student's/i.test(s) ||
    (/CORE COMPETENCIES/i.test(s) && /class="tags"|competency|tag-list/i.test(s))
  );
}

export function isFormatPreservingCv(content) {
  const s = String(content || "");
  if (!s || isRebuiltTemplateCv(s)) return false;
  const hasMasterSections = /TECHNICAL SKILLS/i.test(s) && (/CERTIFICATIONS/i.test(s) || /WORK EXPERIENCE/i.test(s));
  return hasMasterSections || /font-family:\s*Calibri/i.test(s);
}

function posix(p) {
  return String(p || "").replace(/\\/g, "/").toLowerCase();
}

function fileInfo(full) {
  try {
    const st = statSync(full);
    if (!st.isFile()) return null;
    return { path: full, name: basename(full), mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

function listDir(dir) {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function classifyArtifactName(name) {
  const n = String(name || "").toLowerCase();
  if (/_tailored_cv\.pdf$/.test(n) || (/(?:^|[-_])resume\.pdf$/.test(n) && !n.includes("cover"))) return "cvPdf";
  if (/_tailored_cv\.html$/.test(n) || (/(?:^|[-_])resume\.html$/.test(n) && !n.includes("cover"))) return "cvHtml";
  if (/_tailored_cv\.txt$/.test(n) || (/(?:^|[-_])resume\.txt$/.test(n) && !n.includes("cover"))) return "cvTxt";
  if (/cover[_-]letter\.pdf$/.test(n)) return "coverPdf";
  if (/cover[_-]letter\.html$/.test(n)) return "coverHtml";
  if (/cover[_-]letter\.txt$/.test(n)) return "coverTxt";
  return "";
}

function roleNeedles(roleSlug) {
  if (!roleSlug) return [];
  return [roleSlug, roleSlug.replace(/-/g, "_"), roleSlug.replace(/-/g, "")];
}

export function artifactMatchesListing(info, { companySlug, roleSlug, jobSlug, jobId }) {
  const n = info.name.toLowerCase();
  const p = posix(info.path);
  const job = String(jobId || "").toLowerCase();
  if (jobSlug || job) {
    if ((jobSlug && (p.includes(jobSlug) || n.includes(jobSlug))) || (job && (p.includes(job) || n.includes(job)))) {
      return true;
    }
  }
  if (!companySlug) return Boolean(jobSlug || job);
  const inName = n.includes(companySlug);
  const inFolder = p.includes(`/${companySlug}`) || p.includes(`/${companySlug}-`);
  if (!inName && !inFolder) return false;
  if (!roleSlug) return true;
  return roleNeedles(roleSlug).some((needle) => n.includes(needle) || p.includes(needle));
}

function htmlSnippet(info) {
  const kind = classifyArtifactName(info.name);
  if (kind !== "cvHtml" && kind !== "coverHtml" && kind !== "cvTxt") return "";
  try {
    return readFileSync(info.path, "utf8").slice(0, 80_000);
  } catch {
    return "";
  }
}

export function scoreArtifact(info, kind, query) {
  const n = info.name.toLowerCase();
  const p = posix(info.path);
  let score = 0;
  if (/_tailored_cv\./.test(n)) score += 300;
  if (/_cover_letter\./.test(n)) score += 80;
  if (/\/output\/apply\//.test(p)) score += 50;
  if (/\/urljob-/.test(p) || /^urljob-/.test(n)) score += 90;
  const job = String(query.jobId || "").toLowerCase();
  const jobSlug = query.jobSlug || "";
  if ((jobSlug && (p.includes(jobSlug) || n.includes(jobSlug))) || (job && (p.includes(job) || n.includes(job)))) {
    score += 250;
  }
  if (kind === "cvHtml" || kind === "cvTxt") {
    const body = htmlSnippet(info);
    if (isRebuiltTemplateCv(body)) score -= 1000;
    if (isFormatPreservingCv(body)) score += 150;
  }
  if (kind === "cvPdf") {
    if (/_tailored_cv\.pdf$/.test(n)) score += 80;
    if (/\/output\/apply\/urljob-/.test(p)) score += 40;
    if (/apply-review/.test(p) && !/^urljob-/.test(n) && !/_tailored_cv/.test(n)) score -= 120;
    try {
      const sibling = info.path.replace(/\.pdf$/i, ".html");
      const body = existsSync(sibling) ? readFileSync(sibling, "utf8").slice(0, 80_000) : "";
      if (isRebuiltTemplateCv(body)) score -= 1000;
      if (isFormatPreservingCv(body)) score += 150;
    } catch {
      /* binary-only PDF still ranks by filename */
    }
  }
  if (kind === "cvHtml" && /apply-review/.test(p) && !/^urljob-/.test(n) && !/_tailored_cv/.test(n)) {
    score -= 80;
  }
  score += Math.min(info.mtimeMs, 1e15) / 1e15;
  return score;
}

function collectCandidates(roots, query) {
  const out = [];
  const seen = new Set();
  for (const root of roots || []) {
    const applyRoot = join(root, "output", "apply");
    for (const folder of listDir(applyRoot)) {
      const dir = join(applyRoot, folder);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      for (const name of listDir(dir)) {
        const kind = classifyArtifactName(name);
        if (!kind) continue;
        const info = fileInfo(join(dir, name));
        if (!info || seen.has(info.path)) continue;
        const withFolder = { ...info, name: `${folder}/${name}` };
        if (!artifactMatchesListing(info, query) && !artifactMatchesListing(withFolder, query)) continue;
        seen.add(info.path);
        out.push({ ...info, kind });
      }
    }
    const reviewDir = join(root, "data", "apply-review");
    for (const name of listDir(reviewDir)) {
      const kind = classifyArtifactName(name);
      if (!kind) continue;
      const info = fileInfo(join(reviewDir, name));
      if (!info || seen.has(info.path)) continue;
      if (!artifactMatchesListing(info, query)) continue;
      seen.add(info.path);
      out.push({ ...info, kind });
    }
  }
  return out;
}

function pickBest(candidates, kind, query) {
  let best = null;
  let bestScore = -Infinity;
  for (const info of candidates) {
    if (info.kind !== kind) continue;
    const score = scoreArtifact(info, kind, query);
    if (score > bestScore) {
      best = info;
      bestScore = score;
    }
  }
  if (!best || bestScore < 0) return null;
  return best;
}

function readText(info) {
  if (!info) return "";
  try {
    return readFileSync(info.path, "utf8");
  } catch {
    return "";
  }
}

export function findApplyArtifacts({ roots = [], company = "", role = "", jobId = "" } = {}) {
  const query = {
    companySlug: slugPart(company),
    roleSlug: slugPart(role).slice(0, 40),
    jobSlug: slugPart(jobId),
    jobId: String(jobId || "").trim(),
  };
  const candidates = collectCandidates(roots, query);
  const cvPdf = pickBest(candidates, "cvPdf", query);
  const cvHtml = pickBest(candidates, "cvHtml", query);
  const cvTxt = pickBest(candidates, "cvTxt", query);
  const coverPdf = pickBest(candidates, "coverPdf", query);
  const coverHtml = pickBest(candidates, "coverHtml", query);
  const coverTxt = pickBest(candidates, "coverTxt", query);

  let html = readText(cvHtml);
  if (html && isRebuiltTemplateCv(html)) html = "";
  let cv = readText(cvTxt);
  if (cv && isRebuiltTemplateCv(cv)) cv = "";
  const coverLetter = readText(coverTxt);
  let coverPage = readText(coverHtml);
  if (coverPage && isRebuiltTemplateCv(coverPage)) coverPage = "";

  return {
    cvPdf: cvPdf?.path || "",
    cvHtml: html ? cvHtml.path : "",
    cvTxt: cv ? cvTxt.path : "",
    coverPdf: coverPdf?.path || "",
    coverHtml: coverPage ? coverHtml.path : "",
    coverTxt: coverTxt?.path || "",
    cv,
    html,
    coverLetter,
    coverHtmlBody: coverPage,
  };
}

const KIND_TO_KEY = {
  "cv-pdf": "cvPdf",
  "cover-pdf": "coverPdf",
  "cv-html": "cvHtml",
  "cover-html": "coverHtml",
};

export function mimeForKind(kind) {
  if (kind.endsWith("pdf")) return "application/pdf";
  if (kind.endsWith("html")) return "text/html; charset=utf-8";
  return "text/plain; charset=utf-8";
}

export function isSafeArtifactPath(filePath, roots = []) {
  const resolved = resolve(filePath);
  for (const root of roots) {
    for (const dir of [resolve(root, "output", "apply"), resolve(root, "data", "apply-review")]) {
      const rel = relative(dir, resolved);
      if (!rel || rel === "" || rel.startsWith("..") || rel.includes(`..${sep}`)) continue;
      return true;
    }
  }
  return false;
}

export function resolveApplyArtifactFile({ roots = [], company = "", role = "", jobId = "", kind = "" } = {}) {
  const key = KIND_TO_KEY[String(kind || "").trim()];
  if (!key) return "";
  const found = findApplyArtifacts({ roots, company, role, jobId });
  const file = found[key];
  if (!file || !existsSync(file)) return "";
  if (!isSafeArtifactPath(file, roots)) return "";
  return file;
}

export function fromBatches(roots, company, role, jobId) {
  const companySlug = slugPart(company);
  const roleSlug = slugPart(role);
  const jobSlug = slugPart(jobId);
  let best = null;
  for (const root of roots || []) {
    const file = join(root, "data", "apply-batches.json");
    if (!existsSync(file)) continue;
    try {
      const rows = JSON.parse(readFileSync(file, "utf8"));
      if (!Array.isArray(rows)) continue;
      for (const batch of rows) {
        for (const job of batch?.jobs || []) {
          const id = slugPart(job?.id || job?.files?.job_id || "");
          const sameJob = jobSlug && id === jobSlug;
          const sameListing =
            slugPart(job?.company || "") === companySlug &&
            (!roleSlug ||
              slugPart(job?.role || "").startsWith(roleSlug) ||
              roleSlug.startsWith(slugPart(job?.role || "")));
          if (!sameJob && !sameListing) continue;
          const docs = job?.documents || {};
          const html = String(docs.cvHtml || "");
          const text = String(docs.cvText || "");
          const cover = String(docs.coverLetter || "");
          const coverHtml = String(docs.coverHtml || "");
          if (!html && !text && !cover && !coverHtml) continue;
          if (isRebuiltTemplateCv(html) || isRebuiltTemplateCv(text)) continue;
          const at = Number(job?.updatedAt || batch?.createdAt || 0);
          if (!best || at >= best.at) best = { cvHtml: html, cvText: text, coverLetter: cover, coverHtml, at };
        }
      }
    } catch {
      /* ignore unreadable batch file */
    }
  }
  return best;
}
