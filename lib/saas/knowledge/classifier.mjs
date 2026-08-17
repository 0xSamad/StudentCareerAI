/**
 * classifier.mjs — Classify candidate documents from filename + text.
 * Classification is a label only. It never invents candidate facts.
 */

import { DOCUMENT_TYPES } from "./document-types.mjs";

const RULES = [
  { type: "TRANSCRIPT", re: /\btranscript\b|grade\s*report|semester\s+gpa|credit\s*hours/i },
  { type: "CERTIFICATE", re: /\bcertif(?:icate|ied|ication)\b|\bcoursera\b|\budemy\b|aws certified/i },
  { type: "PUBLICATION", re: /\bpublication\b|\bpublished\b|\barxiv\b|\bdoi:\b|\bjournal\b/i },
  { type: "AWARD", re: /\baward\b|dean'?s\s+list|\bscholarship\b|\bhonor\s+roll\b/i },
  { type: "COVER_LETTER", re: /\bcover\s+letter\b|dear\s+hiring\s+manager/i },
  { type: "PERSONAL_STATEMENT", re: /\bpersonal\s+statement\b|\bstatement\s+of\s+purpose\b/i },
  { type: "GITHUB", re: /github\.com\/|^\s*#+\s*github\b/i },
  { type: "LINKEDIN", re: /linkedin\.com\/in\//i },
  { type: "PORTFOLIO", re: /\bportfolio\b/i },
  { type: "COURSEWORK", re: /\bcoursework\b|\brelevant\s+courses\b/i },
  { type: "EXTRACURRICULAR", re: /\bextracurricular\b|\bstudent\s+society\b|\bclub\b/i },
  { type: "INTERNSHIP_EXPERIENCE", re: /\bintern(ship)?\b/i },
  { type: "WORK_EXPERIENCE", re: /\bwork\s+experience\b|\bfull[- ]time\b|\bemployment\b/i },
  { type: "PROJECT_DOC", re: /\bproject\s+(doc|readme|write-?up)\b|\breadme\.md\b/i },
  { type: "PROJECT_DESCRIPTION", re: /\bprojects?\b/i },
  { type: "SKILLS", re: /\btechnical\s+skills\b|\bskills\s*:/i },
  { type: "ACHIEVEMENT", re: /\bachievements?\b|\baccomplishments?\b/i },
  { type: "CV_VERSION", re: /\bcv\b|\bresume\b/i },
  { type: "CV", re: /\bcurriculum\s+vitae\b/i },
];

const FILENAME_RULES = [
  { type: "TRANSCRIPT", re: /transcript|grade[-_ ]?report/i },
  { type: "CERTIFICATE", re: /certif/i },
  { type: "PUBLICATION", re: /publication|paper|arxiv/i },
  { type: "COVER_LETTER", re: /cover[-_ ]?letter/i },
  { type: "PERSONAL_STATEMENT", re: /personal[-_ ]?statement|sop\b/i },
  { type: "GITHUB", re: /github/i },
  { type: "LINKEDIN", re: /linkedin/i },
  { type: "PORTFOLIO", re: /portfolio/i },
  { type: "CV", re: /\b(cv|resume)\b/i },
];

export function classifyDocument({ filename = "", text = "", hintedType = "" } = {}) {
  const hint = String(hintedType || "").toUpperCase();
  if (DOCUMENT_TYPES.includes(hint) && hint !== "OTHER") {
    return { type: hint, source: "user", confidence: 1 };
  }

  const name = String(filename || "");
  for (const rule of FILENAME_RULES) {
    if (rule.re.test(name)) {
      return { type: rule.type, source: "filename", confidence: 0.85 };
    }
  }

  const blob = `${filename}\n${String(text || "").slice(0, 4000)}`;
  for (const rule of RULES) {
    if (rule.re.test(blob)) {
      return { type: rule.type, source: "heuristic", confidence: 0.7 };
    }
  }
  return { type: "OTHER", source: "fallback", confidence: 0.2 };
}
