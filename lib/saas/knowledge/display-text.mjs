/**
 * display-text.mjs — Human-readable evidence snippets.
 * Does not invent content; only decodes, trims, and windows existing text.
 */

const SOURCE_LABELS = {
  user_document: "CV",
  "profile-seed": "Profile",
  "github:public-api": "GitHub",
  "github:readme": "GitHub README",
  "github:public-events": "GitHub",
  "linkedin:user-provided": "LinkedIn",
  "linkedin:url-only": "LinkedIn URL",
  "portfolio:user-authorized": "Portfolio",
  "website:user-authorized": "Website",
};

export function decodeHtmlEntities(value = "") {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) && code > 31 ? String.fromCharCode(code) : " ";
    });
}

export function formatEvidenceSnippet(text, { around = "", max = 240 } = {}) {
  let s = decodeHtmlEntities(String(text || ""));
  s = s
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_`>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";

  const needles = (Array.isArray(around) ? around : String(around || "").split(/\s+/))
    .map((t) => String(t || "").trim())
    .filter((t) => t.length > 2);
  if (needles.length && s.length > max) {
    let idx = -1;
    for (const needle of needles) {
      const found = s.toLowerCase().indexOf(needle.toLowerCase());
      if (found >= 0 && (idx < 0 || found < idx)) idx = found;
    }
    if (idx >= 0) {
      let start = Math.max(0, idx - Math.floor(max * 0.35));
      let end = Math.min(s.length, start + max);
      if (start > 0) {
        const sp = s.lastIndexOf(" ", start);
        if (sp >= 0 && start - sp < 28) start = sp + 1;
      }
      if (end < s.length) {
        const sp = s.indexOf(" ", end);
        if (sp >= 0 && sp - end < 28) end = sp;
      }
      return `${start > 0 ? "…" : ""}${s.slice(start, end).trim()}${end < s.length ? "…" : ""}`;
    }
  }

  if (s.length <= max) return s;
  const cut = s.lastIndexOf(" ", max - 1);
  return `${s.slice(0, cut > 80 ? cut : max).trim()}…`;
}

export function sourceLabel(source) {
  if (!source) return "";
  if (typeof source === "string") return SOURCE_LABELS[source] || source;
  const kind = source.kind || "";
  if (SOURCE_LABELS[kind]) return SOURCE_LABELS[kind];
  return source.label || kind || "";
}

export function humanizeDocType(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const map = {
    CV: "CV",
    CV_VERSION: "CV version",
    GITHUB: "GitHub",
    LINKEDIN: "LinkedIn",
    PORTFOLIO: "Portfolio",
    TRANSCRIPT: "Transcript",
    CERTIFICATE: "Certificate",
    PROJECT_DOC: "Project",
    PERSONAL_STATEMENT: "Personal statement",
    COVER_LETTER: "Cover letter",
    WORK_EXPERIENCE: "Work experience",
    INTERNSHIP_EXPERIENCE: "Internship",
    PROJECT_DESCRIPTION: "Project",
    SKILLS: "Skills",
    ACHIEVEMENT: "Achievement",
    PUBLICATION: "Publication",
    AWARD: "Award",
    COURSEWORK: "Coursework",
    EXTRACURRICULAR: "Extracurricular",
  };
  if (map[raw.toUpperCase()]) return map[raw.toUpperCase()];
  return raw.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function dedupeFactsForDisplay(facts = []) {
  const seen = new Set();
  const out = [];
  for (const fact of facts) {
    const value = String(fact.normalizedValue || fact.value || "").toLowerCase().trim();
    const kind = typeof fact.source === "object" ? fact.source?.kind : fact.source;
    const key = `${value}|${kind || ""}`;
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(fact);
  }
  return out;
}
