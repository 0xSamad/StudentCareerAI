/**
 * fact-extractor.mjs — Grounded fact extraction from candidate documents.
 *
 * Only records what appears in the supplied text/profile.
 * Missing values are omitted, never inferred.
 */

import { cleanExtractedText, heuristicExtract } from "../../profile-parser.mjs";
import { extractSourceFacts } from "../../cv-tailor.mjs";
import { extractSkills } from "../../../skill-extract.mjs";
import { FACT_SOURCES, VERIFICATION_STATUS } from "./document-types.mjs";
import { shapeCandidateFact } from "./fact-shape.mjs";

function snippetAround(text, needle, radius = 180) {
  const hay = String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const needleStr = String(needle || "");
  const idx = hay.toLowerCase().indexOf(needleStr.toLowerCase());
  if (idx < 0) {
    const cut = hay.slice(0, radius);
    const sp = cut.lastIndexOf(" ");
    return (sp > 40 ? cut.slice(0, sp) : cut).trim();
  }
  let start = Math.max(0, idx - 40);
  let end = Math.min(hay.length, idx + needleStr.length + (radius - 40));
  if (start > 0) {
    const sp = hay.lastIndexOf(" ", start);
    if (sp >= 0 && start - sp < 24) start = sp + 1;
  }
  if (end < hay.length) {
    const sp = hay.indexOf(" ", end);
    if (sp >= 0 && sp - end < 24) end = sp;
  }
  return `${start > 0 ? "…" : ""}${hay.slice(start, end).trim()}${end < hay.length ? "…" : ""}`;
}

function looksLikeSkillToken(value) {
  const t = String(value || "").trim();
  if (t.length < 2 || t.length > 40) return false;
  if (/^(and|or|the|with|using|including|from|for|to|of|in|on|a|an)$/i.test(t)) return false;
  if (t.split(/\s+/).length > 4) return false;
  return /^[A-Za-z0-9+#./\s-]{2,40}$/.test(t);
}

function sectionText(text, headings) {
  const lines = String(text || "").split("\n");
  let capture = false;
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const isHeading = /^(#{1,3}\s+.+|[A-Z][A-Za-z/& ]+:?)$/.test(trimmed);
    if (headings.some((h) => new RegExp(`^#{0,3}\\s*${h}\\b:?$`, "i").test(trimmed))) {
      capture = true;
      continue;
    }
    if (capture && isHeading) break;
    if (capture) out.push(line);
  }
  return out.join("\n").trim();
}

function addFact(facts, seen, row, defaults = {}) {
  const shaped = shapeCandidateFact({
    ...defaults,
    ...row,
    source: row.source || defaults.source,
    verificationStatus: row.verificationStatus || defaults.verificationStatus,
    documentId: row.documentId || defaults.documentId || null,
    timestamp: row.timestamp || defaults.timestamp,
  });
  if (!shaped.value) return;
  const key = `${shaped.factType}::${shaped.normalizedValue}`;
  if (seen.has(key)) return;
  seen.add(key);
  facts.push(shaped);
}

function factsFromProfile(profile, text, documentId, facts, seen, defaults = {}) {
  if (!profile || typeof profile !== "object") return;
  const sf = extractSourceFacts(profile, text);
  const d = { ...defaults, documentId };
  const add = (row) => addFact(facts, seen, row, d);
  for (const company of sf.companies || []) {
    add({
      factType: "company",
      value: company,
      snippet: snippetAround(text, company),
      documentId,
      confidence: 1,
    });
  }
  for (const name of sf.projectNames || []) {
    add({
      factType: "project",
      value: name,
      snippet: snippetAround(text, name),
      documentId,
      confidence: 1,
    });
  }
  for (const skill of sf.skills || []) {
    add({
      factType: "skill",
      value: skill,
      snippet: snippetAround(text, skill),
      documentId,
      confidence: 1,
    });
    add({
      factType: "technology",
      value: skill,
      snippet: snippetAround(text, skill),
      documentId,
      confidence: 1,
    });
  }
  for (const inst of sf.institutions || []) {
    add({
      factType: "education",
      value: inst,
      snippet: snippetAround(text, inst),
      documentId,
      confidence: 1,
    });
  }
  for (const degree of sf.degrees || []) {
    add({
      factType: "degree",
      value: degree,
      snippet: snippetAround(text, degree),
      documentId,
      confidence: 1,
    });
  }
  for (const major of sf.majors || []) {
    add({
      factType: "major",
      value: major,
      snippet: snippetAround(text, major),
      documentId,
      confidence: 1,
    });
  }
  for (const metric of sf.metrics || []) {
    add({
      factType: "metric",
      value: metric,
      snippet: snippetAround(text, metric),
      documentId,
      confidence: 1,
    });
  }

  const internships = Array.isArray(profile.experience)
    ? profile.experience
    : profile.experience?.internships || [];
  for (const item of internships) {
    if (item?.role) {
      add({
        factType: "role",
        value: item.role,
        snippet: `${item.role} at ${item.company || ""}`.trim(),
        documentId,
        confidence: 1,
      });
    }
  }
  for (const course of profile.education?.[0]?.coursework || []) {
    add({
      factType: "coursework",
      value: course,
      snippet: snippetAround(text, course),
      documentId,
      confidence: 1,
    });
  }
}

/**
 * Extract attested facts. Does not infer missing skills, employers, or degrees.
 */
export function extractCandidateFacts({
  text = "",
  docType = "OTHER",
  documentId = null,
  profile = null,
  source = null,
  verificationStatus = VERIFICATION_STATUS.VERIFIED,
} = {}) {
  const clean = cleanExtractedText(text);
  const facts = [];
  const seen = new Set();
  const base = {
    documentId,
    source: source || { kind: FACT_SOURCES.USER_DOCUMENT, label: docType || "user_document" },
    verificationStatus,
    timestamp: new Date().toISOString(),
  };

  factsFromProfile(profile, clean, documentId, facts, seen, base);

  const heuristic = heuristicExtract(clean);
  factsFromProfile(heuristic, clean, documentId, facts, seen, base);

  const add = (row) => addFact(facts, seen, row, base);

  for (const skill of extractSkills(clean)) {
    const inSkillsSection = /skills|technolog|stack|tools/i.test(snippetAround(clean, skill));
    add({
      factType: "skill",
      value: skill,
      snippet: snippetAround(clean, skill),
      documentId,
      confidence: inSkillsSection ? 0.95 : 0.8,
    });
    add({
      factType: "technology",
      value: skill,
      snippet: snippetAround(clean, skill),
      documentId,
      confidence: inSkillsSection ? 0.95 : 0.8,
    });
  }

  const skillsSection = sectionText(clean, ["Skills", "Technical Skills", "Technologies", "Tech Stack"]);
  if (skillsSection) {
    for (const token of skillsSection.split(/[,•|/\n]/)) {
      const value = token.replace(/^[-*]\s*/, "").trim();
      if (!looksLikeSkillToken(value)) continue;
      add({
        factType: "skill",
        value,
        snippet: snippetAround(clean, value),
        documentId,
        confidence: 0.9,
      });
      add({
        factType: "technology",
        value,
        snippet: snippetAround(clean, value),
        documentId,
        confidence: 0.9,
      });
    }
  }

  const projectSection = sectionText(clean, ["Projects", "Selected Projects"]);
  if (projectSection) {
    for (const line of projectSection.split("\n")) {
      const heading = line.replace(/^#{1,3}\s*/, "").replace(/^[-*]\s*/, "").trim();
      const name = heading.split(/[—:\-|•]/)[0].trim();
      if (name && name.length >= 3 && name.length <= 80 && !/technolog|skill/i.test(name)) {
        add({
          factType: "project",
          value: name,
          snippet: line.trim().slice(0, 280),
          documentId,
          confidence: 0.75,
        });
      }
    }
  }

  const urlRe = /https?:\/\/[^\s)]+/gi;
  for (const match of clean.matchAll(urlRe)) {
    add({
      factType: "url",
      value: match[0],
      snippet: snippetAround(clean, match[0]),
      documentId,
      confidence: 1,
    });
  }

  const github = clean.match(/github\.com\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?/i);
  if (github) {
    add({
      factType: "url",
      value: `https://${github[0].replace(/^https?:\/\//, "")}`,
      snippet: snippetAround(clean, github[0]),
      documentId,
      confidence: 1,
    });
  }

  if (docType === "CERTIFICATE" || /certif/i.test(clean)) {
    for (const line of clean.split("\n")) {
      if (/\bcertif(?:icate|ied|ication)\b/i.test(line)) {
        add({
          factType: "certificate",
          value: line.replace(/^[-*#\s]+/, "").trim().slice(0, 160),
          snippet: line.trim().slice(0, 280),
          documentId,
          confidence: 0.85,
        });
      }
    }
  }

  if (docType === "AWARD" || /\b(award|dean'?s\s+list|scholarship)\b/i.test(clean)) {
    for (const line of clean.split("\n")) {
      if (/\b(award|dean'?s\s+list|scholarship|honor\s+roll)\b/i.test(line)) {
        add({
          factType: "award",
          value: line.replace(/^[-*#\s]+/, "").trim().slice(0, 160),
          snippet: line.trim().slice(0, 280),
          documentId,
          confidence: 0.85,
        });
      }
    }
  }

  if (docType === "PUBLICATION" || /\b(published|arxiv|doi:)\b/i.test(clean)) {
    for (const line of clean.split("\n")) {
      if (/\b(published|arxiv|doi:|journal)\b/i.test(line)) {
        add({
          factType: "publication",
          value: line.replace(/^[-*#\s]+/, "").trim().slice(0, 200),
          snippet: line.trim().slice(0, 280),
          documentId,
          confidence: 0.8,
        });
      }
    }
  }

  if (docType === "COURSEWORK" || /coursework/i.test(clean)) {
    const coursework = sectionText(clean, ["Coursework", "Relevant Coursework"]) || (docType === "COURSEWORK" ? clean : "");
    for (const token of coursework.split(/[,|\n•]/)) {
      const value = token.replace(/^[-*]\s*/, "").trim();
      if (value.length >= 3 && value.length <= 80) {
        add({
          factType: "coursework",
          value,
          snippet: snippetAround(clean, value),
          documentId,
          confidence: 0.85,
        });
      }
    }
  }

  if (docType === "ACHIEVEMENT") {
    for (const line of clean.split("\n").filter((l) => l.trim().length > 8)) {
      add({
        factType: "achievement",
        value: line.replace(/^[-*#\s]+/, "").trim().slice(0, 200),
        snippet: line.trim().slice(0, 280),
        documentId,
        confidence: 0.7,
      });
    }
  }

  return facts;
}

export function factsToSourceFacts(facts = [], { verifiedOnly = false } = {}) {
  const companies = new Set();
  const projectNames = new Set();
  const skills = new Set();
  const metrics = new Set();
  const institutions = new Set();
  const degrees = new Set();
  const majors = new Set();
  const dates = new Set();
  const snippets = [];

  for (const fact of facts) {
    if (verifiedOnly && (fact.verificationStatus || "VERIFIED") !== "VERIFIED") continue;
    const n = String(fact.normalizedValue || fact.value || "").toLowerCase();
    if (!n) continue;
    snippets.push(fact.snippet || fact.value);
    switch (fact.factType) {
      case "company":
        companies.add(n);
        break;
      case "project":
        projectNames.add(n);
        break;
      case "skill":
      case "technology":
        skills.add(n);
        break;
      case "metric":
        metrics.add(n.replace(/\s+/g, ""));
        break;
      case "education":
        institutions.add(n);
        break;
      case "degree":
        degrees.add(n);
        break;
      case "major":
        majors.add(n);
        break;
      default:
        break;
    }
  }

  return {
    companies,
    projectNames,
    dates,
    skills,
    metrics,
    institutions,
    degrees,
    majors,
    rawCvText: snippets.join("\n"),
  };
}
