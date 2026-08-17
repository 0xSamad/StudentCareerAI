/**
 * Source-grounded CV + cover letter for a live apply.
 * CV text is a copy-edit of the master (headline / summary emphasis / reorder).
 * Never rebuilds a different resume template. Markdown is stripped so the
 * PDF cannot leak ** or ###.
 */

import { htmlFromMasterText, tailorCvCopyText } from "./cv-copy-tailor.mjs";
import { composeCoverLetter } from "./cover-letter-engine.mjs";

function stripMarkdown(raw) {
  return String(raw || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`+/g, "")
    .replace(/(^|\n)\*([^*\n]+)\*(?=\n|$)/g, "$1$2")
    .replace(/^[ \t]*[-*]\s+/gm, "• ");
}

function cleanText(raw) {
  return stripMarkdown(String(raw || ""))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/â€”|â€“|â€“/g, " - ")
    .replace(/[—–]/g, " - ")
    .replace(/([A-Za-z])(\d{4})/g, "$1 $2")
    .replace(/\)(?=[A-Z0-9])/g, ") ")
    .replace(/(Tester|Testing|Scratch|Certificate|Certification|Path|Competition|OSINT|Linux|AI|Analyst|Essentials|Training|Cybersecurity)(?=[A-Z])/g, "$1 | ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripDecor(line) {
  return String(line || "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/^\*+|\*+$/g, "")
    .replace(/^[-*]\s+/, "• ")
    .replace(/\s+\*\s+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

function headerRe(name) {
  return new RegExp(`(?:^|\\n)\\s*(?:#+\\s*)?${name}\\s*(?:\\n|$)`, "i");
}

function section(cvText, name, nextNames) {
  const src = String(cvText || "");
  const start = headerRe(name).exec(src);
  if (!start) return "";
  const rest = src.slice(start.index + start[0].length);
  const endRe = new RegExp(`(?:^|\\n)\\s*(?:#+\\s*)?(${nextNames.join("|")})\\s*(?:\\n|$)`, "i");
  const end = rest.search(endRe);
  return cleanText(end >= 0 ? rest.slice(0, end) : rest);
}

function splitLines(block) {
  return cleanText(block)
    .split("\n")
    .map((l) => stripDecor(l.trim()))
    .filter(Boolean);
}

function jobHaystack(role, jdText) {
  return `${role || ""}\n${jdText || ""}`.toLowerCase();
}

/** software | ai | security | generic — from the job title and JD, not the CV. */
export function roleFamily(role, jdText) {
  const t = `${role || ""}\n${jdText || ""}`.toLowerCase();
  const security = /cyber|pentest|penetration test|soc analyst|bug bounty|appsec|red team|blue team|infosec|security intern|vulnerab/.test(t);
  const ai = /\bai\b|artificial intelligence|machine learning|\bml engineer|genai|llm|deep learning|\bnlp\b|computer vision|data scientist/.test(t);
  const software = /software engineer|sde\b|backend|frontend|full[- ]stack|developer|web engineer|python developer|javascript developer/.test(t);
  if (ai) return "ai";
  if (software && !security) return "software";
  if (security && !software) return "security";
  if (software) return "software";
  return "generic";
}

function lineHits(line, hay) {
  const tokens = String(line || "")
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((t) => t.length > 2);
  return tokens.filter((t) => hay.includes(t)).length;
}

function reorderCsv(line, hay) {
  const idx = String(line).indexOf(":");
  if (idx < 0) return line;
  const label = line.slice(0, idx);
  const items = line
    .slice(idx + 1)
    .split(",")
    .map((s) => stripDecor(s.trim()))
    .filter(Boolean);
  if (items.length < 2) return line;
  const lead = [];
  const rest = [];
  for (const item of items) {
    if (lineHits(item, hay) > 0) lead.push(item);
    else rest.push(item);
  }
  return `${label}: ${[...lead, ...rest].join(", ")}`;
}

function skillFamilyBoost(line, family) {
  if (family === "ai" || family === "software") {
    if (/^programming|^web & dev/i.test(line)) return 12;
    if (/^penetration|^vulnerabilit|^tools/i.test(line)) return -4;
  }
  if (family === "security") {
    if (/^penetration|^vulnerabilit|^tools/i.test(line)) return 12;
  }
  return 0;
}

function skillOverlap(skillLines, hay, family) {
  const scored = skillLines.map((line) => {
    const ordered = reorderCsv(line, hay);
    return { line: ordered, score: lineHits(ordered, hay) + skillFamilyBoost(ordered, family) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.line);
}

function attestedSkillTokens(skillLines) {
  const out = [];
  const seen = new Set();
  for (const line of skillLines) {
    const value = String(line).includes(":") ? String(line).split(":").slice(1).join(":") : String(line);
    for (const part of value.split(/[,/|]/)) {
      const token = stripDecor(part.trim());
      const key = token.toLowerCase();
      if (token.length < 2 || token.length > 40 || seen.has(key)) continue;
      seen.add(key);
      out.push(token);
    }
  }
  return out;
}

function pickOverlapTokens(skillLines, hay, limit = 4) {
  const tokens = attestedSkillTokens(skillLines);
  const hits = tokens.filter((t) => hay.includes(t.toLowerCase()));
  const fallback = tokens.filter((t) => /python|javascript|sql|mysql|git|rest|flask|linux/i.test(t));
  return (hits.length ? hits : fallback).slice(0, limit);
}

function joinSkills(tokens) {
  if (tokens.length >= 3) return `${tokens.slice(0, -1).join(", ")}, and ${tokens[tokens.length - 1]}`;
  if (tokens.length === 2) return `${tokens[0]} and ${tokens[1]}`;
  if (tokens.length === 1) return tokens[0];
  return "";
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function defaultSurveyAnswers() {
  return {
    howHeardNeedles: ["careers page", "website", "company site"],
    seenSocial: "No",
    influenceNeedles: ["career growth and development", "opportunity to drive impact"],
  };
}

function parseCv(cvText) {
  const src = cleanText(cvText);
  const header = src.split(/PROFESSIONAL SUMMARY/i)[0] || "";
  const lines = header
    .split("\n")
    .map((l) => stripDecor(l.replace(/^#\s+/, "").trim()))
    .filter(Boolean);
  const name =
    header.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
    lines.find((l) => /^[A-Z][A-Z\s.'-]{2,}$/.test(l) && !/\|/.test(l)) ||
    "Candidate";
  const contact = lines.find((l) => /@|\+?\d{2,}/.test(l)) || "";
  const tagline = lines.find((l) => l && l !== name && !/@|\+?\d{2,}/.test(l)) || "";
  return {
    name,
    contact,
    tagline,
    summary: section(src, "PROFESSIONAL SUMMARY", ["TECHNICAL SKILLS", "WORK EXPERIENCE", "EDUCATION"]),
    skills: splitLines(section(src, "TECHNICAL SKILLS", ["WORK EXPERIENCE", "EDUCATION", "ACHIEVEMENTS"])).map((l) =>
      l.replace(/^•\s*/, ""),
    ),
    experience: splitLines(section(src, "WORK EXPERIENCE", ["EDUCATION", "ACHIEVEMENTS", "CERTIFICATIONS"])),
    education: splitLines(section(src, "EDUCATION", ["ACHIEVEMENTS", "CERTIFICATIONS", "LANGUAGES"])),
    achievements: splitLines(section(src, "ACHIEVEMENTS", ["CERTIFICATIONS", "LANGUAGES", "INTERESTS"])),
    certs: splitLines(section(src, "CERTIFICATIONS", ["LANGUAGES", "INTERESTS"])).map((l) => l.replace(/^•\s*/, "")),
    languages: section(src, "LANGUAGES", ["INTERESTS"]),
    interests: section(src, "INTERESTS", []),
  };
}

export function cvLooksCollapsed(text) {
  const t = String(text || "");
  if (t.trim().length < 400) return true;
  const skills = section(t, "TECHNICAL SKILLS", ["WORK EXPERIENCE", "EDUCATION", "ACHIEVEMENTS"]);
  const exp = section(t, "WORK EXPERIENCE", ["EDUCATION", "ACHIEVEMENTS", "CERTIFICATIONS"]);
  return skills.trim().length < 40 && exp.trim().length < 40;
}

export function pickMasterCv(...candidates) {
  const list = candidates.map((c) => String(c || "").trim()).filter(Boolean);
  const rich = list.find((c) => !cvLooksCollapsed(c));
  if (rich) return rich;
  return list.slice().sort((a, b) => b.length - a.length)[0] || "";
}

/** Drop leftover targeting from a previous apply so Amazon never leaks into Careem. */
function stripPriorTargeting(summary) {
  return cleanText(summary)
    .replace(/\s*Seeking (?:a |an )?(?:cybersecurity |security )?internship[^.]*\.?/gi, "")
    .replace(/\s*Seeking (?:an? )?(?:opportunity|role|position) at [^.]*\.?/gi, "")
    .replace(/\s*Seeking (?:an? )?(?:opportunity|role|position)[^.]*\.?/gi, "")
    .replace(/\s*Applying for [^.]*\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sentenceScore(sentence, hay) {
  const s = String(sentence || "");
  let n = lineHits(s, hay);
  if (/software engineering|python|database|coursework|analytical/i.test(s) && /software|engineer|python|data|sql|developer|sde/i.test(hay)) n += 2;
  if (/cyber|pentest|owasp|hackerone|vulnerab/i.test(s) && /security|pentest|vulnerab|soc|owasp|cyber|bug bounty/i.test(hay)) n += 2;
  if (/cyber|pentest|idor|xss|xxe/i.test(s) && /software|engineer|data scien|developer|sde/i.test(hay) && !/security|pentest|cyber/i.test(hay)) n -= 1;
  return n;
}

function reorderSentences(body, hay) {
  const sentences = stripPriorTargeting(body)
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length < 2) return sentences.join(" ");
  return [...sentences].sort((a, b) => sentenceScore(b, hay) - sentenceScore(a, hay)).join(" ");
}

function closingSentence(company, role, skills, hay, family) {
  const apply = joinSkills(pickOverlapTokens(skills, hay, 4));
  if (!company) return "";
  if (family === "security" || /\bintern/i.test(role)) {
    return `Seeking the ${role || "role"} at ${company} to apply and grow these skills in a professional environment.`;
  }
  const skillBit = apply ? `, drawing on attested strengths in ${apply}` : "";
  return `Applying for ${role || "this role"} at ${company}${skillBit}.`;
}

function skillItems(cv, labelRe) {
  const line = (cv.skills || []).find((l) => labelRe.test(String(l).split(":")[0] || ""));
  if (!line) return [];
  const value = line.includes(":") ? line.split(":").slice(1).join(":") : line;
  return value
    .split(",")
    .map((s) => stripDecor(s.trim()))
    .filter(Boolean);
}

function certShortName(line) {
  return stripDecor(line)
    .split(/\t|\s{2,}|\s+\|\s+/)[0]
    .replace(/\s+\d{4}.*$/, "")
    .trim();
}

function tailoredTagline(cv, family) {
  const original = stripDecor(cv.tagline || "");
  if (family === "security") {
    return original || "Cybersecurity Intern Candidate | Penetration Testing Enthusiast | CTF Player";
  }
  const parts = [];
  const hay = `${cv.summary}\n${(cv.education || []).join("\n")}`;
  if (/software engineering/i.test(hay)) parts.push("Software Engineering Student");
  else if (original && !/cybersecurity intern/i.test(original)) parts.push(original.split("|")[0].trim());
  else parts.push("Software Engineering Student");

  if (family === "ai") {
    const bits = [];
    if (skillItems(cv, /programming/i).some((x) => /python/i.test(x))) bits.push("Python");
    if (/coursework includes[^\n]*\bAI\b/i.test(hay) || (cv.certs || []).some((c) => /modern ai|chatgpt/i.test(c))) {
      bits.push("AI Coursework");
    }
    if (skillItems(cv, /web/i).some((x) => /rest/i.test(x))) bits.push("REST APIs");
    if (bits.length) parts.push(bits.join(", "));
  } else {
    const langs = skillItems(cv, /programming/i).filter((x) => /python|javascript/i.test(x));
    const web = skillItems(cv, /web/i).filter((x) => /rest apis|git\/github/i.test(x));
    const shown = [...langs.slice(0, 2), ...web.slice(0, 1)];
    if (shown.length) parts.push(shown.join(", "));
  }
  return parts.join(" | ");
}

function softwareAiSummary(cv, close) {
  const edu = (cv.education || []).join("\n");
  const summary = stripPriorTargeting(cv.summary);
  const parts = [];

  let lead =
    (summary.match(/BS Software Engineering student\s*\(CGPA\s*[\d.]+\/[\d.]+\)\s*at IMS Peshawar/i) || [""])[0];
  if (!lead && /software engineering/i.test(edu + summary)) {
    lead = "BS Software Engineering student";
    const gpa = summary.match(/CGPA\s*[\d.]+\/[\d.]+/i) || edu.match(/CGPA:\s*[\d.]+(?:\s*\/\s*[\d.]+)?/i);
    if (gpa) lead += ` (${String(gpa[0]).replace(/^CGPA:?\s*/i, "CGPA ")})`;
    if (/IMS Peshawar/i.test(summary + edu)) lead += " at IMS Peshawar";
  }
  lead = lead.replace(/\s+with a strong foundation in cybersecurity and penetration testing\.?/i, "");
  const semester = edu.match(/\d+(?:st|nd|rd|th)\s+Semester/i);
  const courseList = edu.match(/coursework includes\s+([^.\n]+)/i)?.[1];
  if (lead) {
    if (semester && !new RegExp(semester[0], "i").test(lead)) lead += `, currently in the ${semester[0]}`;
    if (courseList && !/coursework/i.test(lead)) lead += `, with coursework in ${courseList.trim()}`;
    parts.push(`${lead.replace(/\.\s*$/, "")}.`);
  }

  const prog = skillItems(cv, /programming/i).join(", ");
  const web = skillItems(cv, /web/i).join(", ");
  if (prog || web) {
    parts.push(`Programming and development skills include ${[prog, web].filter(Boolean).join("; ")}.`);
  }

  const hacker =
    (summary.match(/Registered on HackerOne[^.]*\./i) || [""])[0] ||
    ((cv.experience || []).some((l) => /hackerone/i.test(l))
      ? "Registered on HackerOne and actively developing structured testing skills aligned with OWASP Top 10."
      : "");
  if (hacker) {
    parts.push(
      hacker
        .replace(/offensive security skills/i, "structured testing skills")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }

  const holder = /15\+\s*industry certifications/i.test(summary + (cv.achievements || []).join("\n"));
  if (holder) {
    const prefer = (cv.certs || [])
      .filter((c) => /modern ai|chatgpt|google cybersecurity|ejpt|\bpt1\b/i.test(c))
      .map(certShortName)
      .slice(0, 4);
    const named = prefer.length ? ` including ${joinSkills(prefer)}` : "";
    parts.push(`Holder of 15+ industry certifications${named}.`);
  }

  if (close) parts.push(close);
  return parts.filter(Boolean).join(" ");
}

function tailoredSummary(cv, company, role, hay, family) {
  const close = closingSentence(company, role, cv.skills, hay, family);
  if (family === "software" || family === "ai") return softwareAiSummary(cv, close);
  const body = reorderSentences(cv.summary, hay);
  return [body, close].filter(Boolean).join(" ");
}

function certScore(line, hay, family) {
  let n = lineHits(line, hay);
  if (family === "ai" && /modern ai|chatgpt|machine learning|\bai\b/i.test(line)) n += 8;
  if (family === "software" && /linux|network technician|python|javascript/i.test(line)) n += 3;
  if (family === "security" && /ejpt|pt1|pentest|cybersecurity|bug bounty|ethical hacking/i.test(line)) n += 5;
  return n;
}

function orderCerts(certs, hay, family) {
  return [...certs].sort((a, b) => certScore(b, hay, family) - certScore(a, hay, family));
}

function tailoredDocs(cvText, company, role, jdText) {
  const cv = parseCv(cvText);
  const hay = jobHaystack(role, jdText);
  const family = roleFamily(role, jdText);
  const skills = cv.skills.length ? skillOverlap(cv.skills, hay, family) : [];
  return {
    cv,
    hay,
    family,
    skills,
    certs: cv.certs.length ? orderCerts(cv.certs, hay, family) : [],
    tagline: tailoredTagline(cv, family),
    summary: tailoredSummary(cv, company, role, hay, family),
  };
}

function parsedEnough(cv) {
  return cv.skills.length > 0 || cv.experience.length > 0 || cv.education.length > 0;
}

export function tailorCvText({ cvText, company = "", role = "", jdText = "" }) {
  const source = String(cvText || "").trim();
  if (!source) return "";
  return stripMarkdown(tailorCvCopyText(source, { company, role, jdText }));
}

function looksLikeDatedHeader(line) {
  if (/^•/.test(line)) return false;
  if (/cgpa|semester|coursework/i.test(line)) return false;
  return /\d{4}/.test(line) && /present|\d{4}\s*$|-\s*\d{4}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(line);
}

function splitTitleDates(line) {
  if (line.includes("\t")) {
    const [title, ...rest] = line.split("\t");
    return { title: title.trim(), dates: rest.join(" ").trim() };
  }
  const m = line.match(/^(.*?)(?:\s{2,}|\s+)(\d{4}\s*-\s*(?:Present|\d{4}).*)$/i);
  if (m) return { title: m[1].trim(), dates: m[2].trim() };
  return { title: line, dates: "" };
}

function renderJobish(lines) {
  let html = "";
  let inList = false;
  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = stripDecor(raw);
    if (/^•\s+/.test(line) || /^•/.test(line)) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${escapeHtml(line.replace(/^•\s*/, ""))}</li>`;
      continue;
    }
    closeList();
    if (looksLikeDatedHeader(line)) {
      const { title, dates } = splitTitleDates(line);
      html += dates
        ? `<h3>${escapeHtml(title)} <span class="dates">${escapeHtml(dates)}</span></h3>`
        : `<h3>${escapeHtml(title)}</h3>`;
    } else {
      html += `<p class="meta">${escapeHtml(line)}</p>`;
    }
  }
  closeList();
  return html;
}

function renderCertLine(line) {
  const cleaned = stripDecor(line);
  const parts = cleaned.split(/\t|\s{2,}|\s+\|\s+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return `<p class="cert"><strong>${escapeHtml(parts[0])}</strong> — ${escapeHtml(parts.slice(1).join(" | "))}</p>`;
  }
  return `<p class="cert">${escapeHtml(cleaned)}</p>`;
}

function renderAchievements(lines) {
  const items = lines.map((l) => stripDecor(l).replace(/^•\s*/, "")).filter(Boolean);
  if (!items.length) return "";
  return `<ul>${items.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`;
}

function cvHtmlShell(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; color: #1a1a2e; max-width: 760px; margin: 32px auto; padding: 0 24px; line-height: 1.45; }
    h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: 0.02em; }
    .tag { color: #333; margin: 0 0 4px; font-size: 13px; }
    .contact { color: #555; font-size: 13px; margin: 0 0 16px; }
    hr { border: 0; border-top: 2px solid #0e7c86; margin: 0 0 16px; }
    h2 { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #0e7c86; margin: 18px 0 6px; }
    h3 { font-size: 14px; margin: 10px 0 2px; }
    .dates { float: right; font-weight: normal; color: #555; font-size: 12px; }
    .meta { color: #555; font-size: 13px; margin: 0 0 4px; }
    p, li { font-size: 13px; margin: 0 0 5px; }
    ul { padding-left: 18px; margin: 0 0 8px; }
    .skill { margin: 0 0 3px; }
    .cert { margin: 0 0 4px; }
    @media print {
      body { max-width: none; margin: 0; padding: 0; }
    }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

export function tailorCvHtml({ cvText, company = "", role = "", jdText = "" }) {
  const text = tailorCvText({ cvText, company, role, jdText });
  if (!text) {
    return cvHtmlShell("CV", "<p></p>");
  }
  return htmlFromMasterText(text, { title: `${role || "CV"}${company ? ` - ${company}` : ""}` });
}

export function tailorCoverLetter({ cvText, profile, company = "", role = "", jdText = "", githubProjects = [] } = {}) {
  return composeCoverLetter({ cvText, profile, company, role, jdText, githubProjects }).body;
}

export function tailorCoverLetterHtml({ cvText, profile, company = "", role = "", jdText = "", githubProjects = [] } = {}) {
  return composeCoverLetter({ cvText, profile, company, role, jdText, githubProjects }).html;
}
