import fs from "node:fs";
import path from "node:path";
import { studentCareerRoot } from "@/lib/student-career-ai";

function slugPart(value: string) {
  return (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).join("-");
}

function newestPdfIn(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  let best = "";
  let bestMs = -1;
  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().endsWith(".pdf")) continue;
    const full = path.join(dir, name);
    try {
      const ms = fs.statSync(full).mtimeMs;
      if (ms > bestMs) {
        bestMs = ms;
        best = full;
      }
    } catch {
      /* skip */
    }
  }
  return best || null;
}

/**
 * Locate the tailored CV PDF for a company (newest match wins). Prefers the
 * apply-time PDF in output/apply/{company}-{role}/resume.pdf so we never attach
 * another job's file. Falls back to output/*.pdf from the `pdf` mode.
 */
export function resolveTailoredCv(company?: string, role?: string): string | null {
  const c = (company ?? "").trim();
  if (!c) return null;
  const companySlug = slugPart(c);
  const roleSlug = slugPart(role || "").slice(0, 40);
  const applyRoot = path.join(studentCareerRoot(), "output", "apply");
  const applyDirs = [
    roleSlug ? path.join(applyRoot, `${companySlug}-${roleSlug}`) : "",
    path.join(applyRoot, companySlug),
  ].filter(Boolean);
  for (const dir of applyDirs) {
    const exact = path.join(dir, "resume.pdf");
    if (fs.existsSync(exact)) return exact;
    const newest = newestPdfIn(dir);
    if (newest) return newest;
  }

  const dir = path.join(studentCareerRoot(), "output");
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf"));
  } catch {
    return null;
  }
  const slug = companySlug;
  const first = slug.split("-")[0];
  const matches = files.filter((f) => {
    const l = f.toLowerCase();
    return l.includes(slug) || (first.length > 2 && l.includes(first));
  });
  if (!matches.length) return null;
  matches.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
  return path.join(dir, matches[0]);
}

/**
 * Best-effort company name from an application form/page title. ATS titles look
 * like "Role - Region @ Company" (Ashby) or "Company — Role" / "Role at Company".
 * Used as a fallback when the apply flow was started by pasting a URL (no offer
 * context) rather than from a report's Apply button.
 */
export function companyFromTitle(title?: string): string {
  const t = (title ?? "").trim();
  if (!t) return "";
  const at = t.match(/@\s*([^|@]+?)\s*$/);
  if (at) return at[1].trim();
  const atWord = t.match(/\bat\s+([A-Z][\w&.\- ]+?)\s*$/);
  if (atWord) return atWord[1].trim();
  return "";
}
