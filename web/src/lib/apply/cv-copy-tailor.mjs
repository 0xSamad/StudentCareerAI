/**
 * Copy-edit tailoring: clone docs/cv.docx, change only job-relevant text.
 * Never overwrites the master. Never rebuilds a new resume template.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { unzip, zip } from "./docx-zip.mjs";

const SECTION_HEADINGS = [
  "PROFESSIONAL SUMMARY",
  "TECHNICAL SKILLS",
  "WORK EXPERIENCE",
  "EDUCATION",
  "ACHIEVEMENTS",
  "CERTIFICATIONS",
  "LANGUAGES",
  "INTERESTS",
  "PROJECTS",
];

const HEADING_RE = new RegExp(`^(?:#+\\s*)?(${SECTION_HEADINGS.join("|")})\\s*$`, "i");

export function masterCvDocxPath(root = "") {
  return join(String(root || "").trim() || process.cwd(), "docs", "cv.docx");
}

/** Universal ATS layout. Prefer the app template; docs/cv.docx is format-only fallback. */
export function atsFormatDocxPath(root = "") {
  const base = String(root || "").trim() || process.cwd();
  const appTemplate = join(base, "templates", "cv-ats-format.docx");
  if (existsSync(appTemplate)) return appTemplate;
  return masterCvDocxPath(base);
}

export function fileSha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function xmlEscape(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xmlUnescape(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function paraTextFromXml(p) {
  return [...p.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map((m) => xmlUnescape(m[1])).join("");
}

function isHeading(text) {
  return HEADING_RE.test(String(text || "").trim());
}

function headingName(text) {
  const m = String(text || "")
    .trim()
    .match(HEADING_RE);
  return m ? m[1].toUpperCase() : "";
}

export function jobHaystack(role, jdText) {
  return `${role || ""}\n${jdText || ""}`.toLowerCase();
}

/** security | ai | data | software | generic */
export function roleFamily(role, jdText) {
  const t = `${role || ""}\n${jdText || ""}`.toLowerCase();
  const security = /cyber|pentest|penetration test|soc analyst|bug bounty|appsec|red team|blue team|infosec|security intern|vulnerab/.test(t);
  const data = /data scien|data analyst|analytics intern|\bbi intern\b|business intelligence/.test(t);
  const ai = /\bai\b|artificial intelligence|machine learning|\bml engineer|genai|llm|deep learning|\bnlp\b|computer vision|data scientist/.test(t);
  const software = /software engineer|sde\b|backend|frontend|full[- ]stack|developer|web engineer|python developer|javascript developer/.test(t);
  if (security && !ai && !data) return "security";
  if (data && !security) return "data";
  if (ai && !security) return "ai";
  if (software && !security) return "software";
  if (security) return "security";
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
    .map((s) => s.trim())
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
  if (family === "ai" || family === "software" || family === "data") {
    if (/^programming/i.test(line)) return 16;
    if (/^web & dev/i.test(line)) return 10;
    if (/^penetration|^vulnerabilit|^tools/i.test(line)) return -4;
  }
  if (family === "security") {
    if (/^penetration|^vulnerabilit|^tools/i.test(line)) return 12;
  }
  return 0;
}

function reorderLines(lines, hay, family) {
  const scored = lines.map((line, i) => ({
    line,
    i,
    score: lineHits(line, hay) + skillFamilyBoost(line, family),
  }));
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((s) => s.line);
}

function certScore(line, hay, family) {
  let n = lineHits(line, hay);
  if (family === "ai" && /modern ai|chatgpt|machine learning|\bai\b/i.test(line)) n += 8;
  if (family === "data" && /modern ai|chatgpt|python|sql|data/i.test(line)) n += 6;
  if (family === "software" && /linux|network technician|python|javascript/i.test(line)) n += 3;
  if (family === "security" && /ejpt|pt1|pentest|cybersecurity|bug bounty|ethical hacking/i.test(line)) n += 5;
  return n;
}

function attestedFromMaster(masterText) {
  const t = String(masterText || "");
  return {
    python: /\bpython\b/i.test(t),
    sql: /\b(sql|mysql)\b/i.test(t),
    ai: /\bai\b|artificial intelligence|modern ai|chatgpt/i.test(t),
    ml: /machine learning|\bml\b|deep learning|\bnlp\b/i.test(t),
    git: /git\/github|\bgit\b/i.test(t),
    rest: /rest apis/i.test(t),
    flask: /\bflask\b/i.test(t),
    javascript: /\bjavascript\b/i.test(t),
  };
}

function gpaFromMaster(text) {
  const m = String(text || "").match(/CGPA[:\s]*([\d.]+)\s*\/\s*([\d.]+)/i);
  return m ? `CGPA ${m[1]}/${m[2]}` : "";
}

function courseworkList(eduLines, family) {
  const line = (eduLines || []).find((l) => /coursework includes/i.test(l)) || "";
  const ordered = reorderCoursework(line, family);
  const m = ordered.match(/coursework includes\s+(.+?)\.?$/i);
  return m ? m[1].replace(/\.$/, "").trim() : "";
}

function shortCertName(line) {
  return String(line || "")
    .replace(/\s+[—–-]\s+.*/, "")
    .replace(/\s+\(.*/, "")
    .trim();
}

function certLead(certLines, family) {
  const lines = certLines || [];
  const named = [];
  const take = (re) => {
    if (named.length >= 3) return;
    const hit = lines.find((l) => re.test(l));
    if (hit) named.push(shortCertName(hit));
  };
  if (family === "ai" || family === "data") {
    take(/introduction to modern ai/i);
    take(/chatgpt/i);
    take(/google cybersecurity/i);
  } else if (family === "software") {
    take(/linux for lfca|lfca/i);
    take(/network technician/i);
    take(/introduction to modern ai/i);
  } else {
    take(/\bejpt\b/i);
    take(/\bpt1\b/i);
    take(/google cybersecurity/i);
  }
  return named;
}

function educationLead(eduLines, masterSummary) {
  const gpa = gpaFromMaster(`${masterSummary}\n${(eduLines || []).join("\n")}`);
  const summary = String(masterSummary || "").replace(/\s+/g, " ").trim();
  const fromSummary = summary.match(
    /^(.+?\b(?:student|candidate|graduate)(?:\s*\([^)]+\))?)\s+at\s+(.+?)(?=\s+with\b|,|\.|$)/i,
  );
  if (fromSummary) {
    let person = fromSummary[1].trim();
    const school = fromSummary[2].trim();
    if (gpa && !/cgpa|\bgpa\b/i.test(person)) {
      person = person.replace(/\b(student|candidate|graduate)\b/i, `$1 (${gpa})`);
    }
    return school ? `${person} at ${school}` : person;
  }
  const degreeLine = (eduLines || []).map((l) => String(l || "").trim()).find((l) => l && !/coursework|cgpa|\bgpa\b|^\d{4}/i.test(l)) || "";
  const parts = degreeLine.split(/\s+[—–]\s+/);
  const degree = (parts[0] || "").trim();
  const school = (parts[1] || "").trim();
  if (degree && school) {
    const person = /student|candidate|graduate/i.test(degree) ? degree : `${degree} student`;
    return gpa ? `${person} (${gpa}) at ${school}` : `${person} at ${school}`;
  }
  if (degree) return gpa ? `${degree} (${gpa})` : degree;
  return "";
}

function attestedPracticeBit(masterText, family) {
  const t = String(masterText || "");
  const h1 = /hackerone/i.test(t);
  const ctf = /\bctfs?\b/i.test(t);
  if (!h1 && !ctf) return "";
  const extra = [h1 && "HackerOne programs", ctf && "CTFs"].filter(Boolean).join(" and ");
  if (family === "ai") {
    return `Builds practical technical skill through self-directed labs and structured problem-solving, including ${extra}.`;
  }
  if (family === "software" && h1) {
    return "Applies structured problem-solving from self-directed labs and HackerOne practice to real technical work.";
  }
  return "";
}

function joinList(items) {
  const list = (items || []).filter(Boolean);
  if (list.length >= 3) return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return list[0] || "";
}

function tailoredSummary({ family, masterSummary, company, role, eduLines, certLines, attested, masterText = "" }) {
  const close = closingSentence(company, role);
  const lead = educationLead(eduLines, masterSummary);
  const semester = ((eduLines || []).join("\n").match(/\d+(?:st|nd|rd|th)\s+Semester/i) || [""])[0];
  const courses = courseworkList(eduLines, family);
  const certs = certLead(certLines, family);
  const certBit = certs.length
    ? /15\+/.test(masterSummary)
      ? `Holder of 15+ industry certifications including ${joinList(certs)}.`
      : `Certifications include ${joinList(certs)}.`
    : /15\+/.test(masterSummary)
      ? "Holder of 15+ industry certifications."
      : "";
  const opener = [lead, semester && `currently in the ${semester}`, courses && `with coursework in ${courses}`]
    .filter(Boolean)
    .join(", ")
    .replace(/,\s*with coursework/, ", with coursework");

  if (family === "security" || family === "generic") {
    const body = stripPriorTargeting(masterSummary);
    return [body, close].filter(Boolean).join(" ");
  }

  if (family === "ai") {
    const langs = joinList([attested.python && "Python", attested.javascript && "JavaScript", attested.rest && "REST APIs"]);
    const stack = joinList([attested.flask && "Flask", attested.sql && "MySQL", attested.git && "Git/GitHub"]);
    const parts = opener ? [`${opener}.`] : [];
    if (langs) {
      parts.push(`Focus areas include ${langs}${stack ? `, with ${stack}` : ""}.`);
    }
    if (certBit) parts.push(certBit);
    const practice = attestedPracticeBit(masterText || masterSummary, family);
    if (practice) parts.push(practice);
    parts.push(close);
    return parts.filter(Boolean).join(" ");
  }

  if (family === "data") {
    const langs = joinList([attested.python && "Python", attested.sql && "SQL/MySQL", attested.git && "Git/GitHub"]);
    const parts = opener ? [`${opener}.`] : [];
    if (langs) parts.push(`Works with ${langs} on coursework and self-directed technical practice.`);
    if (certBit) parts.push(certBit);
    parts.push(close);
    return parts.filter(Boolean).join(" ");
  }

  const langs = joinList([
    attested.python && "Python",
    attested.javascript && "JavaScript",
    attested.rest && "REST APIs",
    attested.flask && "Flask",
    attested.git && "Git/GitHub",
  ]);
  const parts = opener ? [`${opener}.`] : [];
  if (langs) parts.push(`Software skills include ${langs}.`);
  if (certBit) parts.push(certBit);
  const practice = attestedPracticeBit(masterText || masterSummary, family);
  if (practice) parts.push(practice);
  parts.push(close);
  return parts.filter(Boolean).join(" ");
}

function stripPriorTargeting(summary) {
  return String(summary || "")
    .replace(/\s*Seeking (?:a |an )?(?:cybersecurity |security |ai |data science |software )?[^.]*internship[^.]*\.?/gi, "")
    .replace(/\s*Seeking (?:an? )?(?:opportunity|role|position) at [^.]*\.?/gi, "")
    .replace(/\s*Seeking (?:an? )?(?:opportunity|role|position)[^.]*\.?/gi, "")
    .replace(/\s*Applying for [^.]*\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function reorderSentences(body, hay) {
  const sentences = stripPriorTargeting(body)
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length < 2) return sentences.join(" ");
  return [...sentences].sort((a, b) => lineHits(b, hay) - lineHits(a, hay)).join(" ");
}

function closingSentence(company, role) {
  const r = String(role || "role").trim() || "role";
  const c = String(company || "").trim();
  if (!c) return `Seeking the ${r} to apply and grow these skills in a professional environment.`;
  return `Seeking the ${r} at ${c} to apply and grow these skills in a professional environment.`;
}

function reorderCoursework(line, family) {
  const m = String(line).match(/^(.*coursework includes\s+)(.+?)(\.?)$/i);
  if (!m) return line;
  const items = m[2]
    .replace(/\band\b/gi, ",")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length < 2) return line;
  const prefer =
    family === "ai" || family === "data"
      ? [/^\s*ai\b/i, /database/i, /software engineering/i, /computer networks/i, /cyber/i]
      : family === "software"
        ? [/software engineering/i, /database/i, /^\s*ai\b/i, /computer networks/i, /cyber/i]
        : [/cyber/i, /computer networks/i, /database/i, /software engineering/i, /^\s*ai\b/i];
  const scored = items.map((item, i) => {
    const idx = prefer.findIndex((re) => re.test(item));
    return { item, i, score: idx < 0 ? 50 + i : idx };
  });
  scored.sort((a, b) => a.score - b.score || a.i - b.i);
  const ordered = scored.map((s) => s.item);
  if (ordered.length === 1) return `${m[1]}${ordered[0]}${m[3]}`;
  const last = ordered[ordered.length - 1];
  return `${m[1]}${ordered.slice(0, -1).join(", ")}, and ${last}${m[3]}`;
}

export function tailoredHeadline(masterHeadline, family, role, attested = {}) {
  const original = String(masterHeadline || "").replace(/\s+/g, " ").trim();
  if (family === "security" || family === "generic") return original;
  const title = String(role || "").replace(/\s+/g, " ").trim() || "Intern";
  const label = /candidate$/i.test(title) ? title : `${title} Candidate`;
  if (family === "ai") {
    const mid = attested.ml
      ? "Python & Machine Learning"
      : attested.python && attested.ai
        ? "Python & AI Coursework"
        : attested.python
          ? "Python"
          : attested.ai
            ? "AI Coursework"
            : "";
    const bits = [label];
    if (mid) bits.push(mid);
    if (attested.ai) bits.push("AI Enthusiast");
    return bits.join(" | ");
  }
  if (family === "data") {
    const mid = attested.python && attested.sql ? "Python & Data Analytics" : attested.python ? "Python" : "Data Analytics";
    return `${/data scien/i.test(title) ? label : "Data Science Intern Candidate"} | ${mid}`;
  }
  if (family === "software") {
    const mid = [attested.python && "Python", attested.rest && "REST APIs", attested.git && "Git"].filter(Boolean).slice(0, 2).join(" & ");
    return mid ? `${label} | ${mid}` : label;
  }
  return original;
}

function splitSections(text) {
  const src = String(text || "").replace(/\r\n/g, "\n");
  const lines = src.split("\n");
  const blocks = [];
  let cur = { heading: "", lines: [] };
  for (const line of lines) {
    if (isHeading(line)) {
      if (cur.heading || cur.lines.length) blocks.push(cur);
      cur = { heading: headingName(line), lines: [] };
      continue;
    }
    cur.lines.push(line);
  }
  blocks.push(cur);
  return { preamble: blocks[0]?.heading ? { heading: "", lines: [] } : blocks[0], sections: blocks[0]?.heading ? blocks : blocks.slice(1) };
}

function findTagline(preambleLines) {
  return preambleLines.findIndex((l) => /\|/.test(l) && /intern|candidate|enthusiast|player/i.test(l) && !/@/.test(l));
}

function reorderExperienceBlock(lines, hay, family) {
  const out = [...lines];
  let start = -1;
  for (let i = 0; i <= out.length; i++) {
    const l = (out[i] || "").trim();
    const isMeta = !l || /hackerone|self-directed|remote|\d{4}/i.test(l);
    const isBullet = Boolean(l) && !isMeta;
    if (isBullet && start < 0) start = i;
    if (start >= 0 && (i === out.length || !isBullet)) {
      const slice = out.slice(start, i);
      const ordered = reorderLines(slice, hay, family);
      out.splice(start, ordered.length, ...ordered);
      start = -1;
    }
  }
  return out;
}

export function buildCopyPlan(masterText, { company = "", role = "", jdText = "", githubProjects = [] } = {}) {
  const hay = jobHaystack(role, jdText);
  const family = roleFamily(role, jdText);
  const attested = attestedFromMaster(masterText);
  const { preamble, sections } = splitSections(masterText);
  const preLines = preamble?.lines || [];
  const tagIdx = findTagline(preLines);
  const masterHeadline = tagIdx >= 0 ? preLines[tagIdx] : "";
  const headline = tailoredHeadline(masterHeadline, family, role, attested);

  const summaryBlock = sections.find((s) => s.heading === "PROFESSIONAL SUMMARY");
  const summaryBody = (summaryBlock?.lines || []).join(" ").replace(/\s+/g, " ").trim();
  const eduBlock = sections.find((s) => s.heading === "EDUCATION");
  const certBlock = sections.find((s) => s.heading === "CERTIFICATIONS");
  const certLines = (certBlock?.lines || []).map((l) => l.trim()).filter(Boolean);
  const summary = tailoredSummary({
    family,
    masterSummary: summaryBody,
    company,
    role,
    eduLines: eduBlock?.lines || [],
    certLines,
    attested,
    masterText,
  });

  const skillBlock = sections.find((s) => s.heading === "TECHNICAL SKILLS");
  const skillLines = (skillBlock?.lines || []).map((l) => l.trim()).filter(Boolean);
  const skills = skillLines.length
    ? reorderLines(
        skillLines.map((l) => reorderCsv(l, hay)),
        hay,
        family,
      )
    : [];

  const certs = certLines.length
    ? [...certLines].sort((a, b) => certScore(b, hay, family) - certScore(a, hay, family) || certLines.indexOf(a) - certLines.indexOf(b))
    : [];

  const education = (eduBlock?.lines || []).map((l) => reorderCoursework(l, family));

  const expBlock = sections.find((s) => s.heading === "WORK EXPERIENCE");
  const expLines = expBlock?.lines || [];
  const expReordered = reorderExperienceBlock(expLines, hay, family);

  const achBlock = sections.find((s) => s.heading === "ACHIEVEMENTS");
  const achievements = reorderLines((achBlock?.lines || []).map((l) => l.trim()).filter(Boolean), hay, family);

  const hasProjectsSection = sections.some((s) => s.heading === "PROJECTS");
  const addedProjects = [];
  if (hasProjectsSection && Array.isArray(githubProjects)) {
    for (const p of githubProjects) {
      const name = String(p?.name || "").trim();
      if (!name || !p?.owned) continue;
      if (lineHits(`${name} ${p.description || ""} ${(p.languages || []).join(" ")}`, hay) < 2) continue;
      addedProjects.push(name);
    }
  }

  return {
    family,
    headline,
    masterHeadline,
    summary,
    skills,
    certs,
    education,
    experience: expReordered,
    achievements,
    addedProjects,
    report: {
      targetRole: role,
      company,
      family,
      changed: {
        headline: headline !== masterHeadline,
        summary: summary !== summaryBody,
        skillOrdering: skills.join("\n") !== skillLines.join("\n"),
        certificationOrdering: certs.join("\n") !== certLines.join("\n"),
        courseworkOrdering: education.join("\n") !== (eduBlock?.lines || []).join("\n"),
        experienceEmphasis: expReordered.join("\n") !== expLines.join("\n"),
      },
      added: addedProjects,
      unchanged: ["education facts", "employment facts", "certification list", "achievements list", "original formatting"],
    },
  };
}

export function applyPlanToText(source, plan) {
  const src = String(source || "").replace(/\r\n/g, "\n");
  const { preamble, sections } = splitSections(src);
  const pre = [...(preamble?.lines || [])];
  const tagIdx = findTagline(pre);
  if (tagIdx >= 0 && plan.headline) pre[tagIdx] = plan.headline;

  const out = [...pre];
  for (const sec of sections) {
    out.push(sec.heading);
    if (sec.heading === "PROFESSIONAL SUMMARY" && plan.summary) out.push(plan.summary);
    else if (sec.heading === "TECHNICAL SKILLS" && plan.skills?.length) out.push(...plan.skills);
    else if (sec.heading === "CERTIFICATIONS" && plan.certs?.length) out.push(...plan.certs);
    else if (sec.heading === "EDUCATION" && plan.education?.length) out.push(...plan.education);
    else if (sec.heading === "WORK EXPERIENCE" && plan.experience?.length) out.push(...plan.experience);
    else if (sec.heading === "ACHIEVEMENTS" && plan.achievements?.length) out.push(...plan.achievements);
    else out.push(...sec.lines);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function splitDocxParagraphs(xml) {
  const bodyMatch = xml.match(/<w:body[^>]*>([\s\S]*)<\/w:body>/);
  if (!bodyMatch) throw new Error("docx has no w:body");
  const body = bodyMatch[1];
  const sect = body.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
  const before = body.replace(/<w:sectPr[\s\S]*?<\/w:sectPr>/, "");
  const paras = before.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
  return { paras, sectPr: sect ? sect[0] : "" };
}

function setParagraphText(pXml, text) {
  const rPrMatch = pXml.match(/<w:r\b[\s\S]*?<w:rPr>([\s\S]*?)<\/w:rPr>/);
  const rPr = rPrMatch ? `<w:rPr>${rPrMatch[1]}</w:rPr>` : "<w:rPr/>";
  const pPr = (pXml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [""])[0];
  const open = pXml.match(/^<w:p\b[^>]*>/)?.[0] || "<w:p>";
  const t = xmlEscape(text);
  const space = /\s/.test(text[0] || "") || /\s/.test(text[text.length - 1] || "") ? ' xml:space="preserve"' : "";
  return `${open}${pPr}<w:r>${rPr}<w:t${space}>${t}</w:t></w:r></w:p>`;
}

function rPrWithoutBold(rPrXml) {
  const inner = String(rPrXml || "<w:rPr/>")
    .replace(/^<w:rPr>/, "")
    .replace(/<\/w:rPr>$/, "")
    .replace(/<w:b\b[^/]*\/>/g, "")
    .replace(/<w:bCs\b[^/]*\/>/g, "")
    .replace(/<w:b\b[^>]*>[\s\S]*?<\/w:b>/g, "")
    .replace(/<w:bCs\b[^>]*>[\s\S]*?<\/w:bCs>/g, "");
  return `<w:rPr>${inner}</w:rPr>`;
}

function rPrWithBold(rPrXml) {
  const stripped = rPrWithoutBold(rPrXml).replace(/^<w:rPr>/, "").replace(/<\/w:rPr>$/, "");
  return `<w:rPr><w:b/><w:bCs/>${stripped}</w:rPr>`;
}

function wText(text) {
  const t = xmlEscape(text);
  const space = /\s/.test(text[0] || "") || /\s/.test(text[text.length - 1] || "") ? ' xml:space="preserve"' : "";
  return `<w:t${space}>${t}</w:t>`;
}

function firstRunRPr(pXml) {
  const m = pXml.match(/<w:r\b[\s\S]*?<w:rPr>([\s\S]*?)<\/w:rPr>/);
  return m ? `<w:rPr>${m[1]}</w:rPr>` : "<w:rPr/>";
}

function lastRunRPr(pXml) {
  const matches = [...pXml.matchAll(/<w:r\b[\s\S]*?<w:rPr>([\s\S]*?)<\/w:rPr>/g)];
  if (!matches.length) return firstRunRPr(pXml);
  return `<w:rPr>${matches[matches.length - 1][1]}</w:rPr>`;
}

/** Label before ':' stays bold; values after the colon are regular weight. */
function setLabeledParagraphText(pXml, text) {
  const colon = String(text).indexOf(":");
  if (colon < 0) return setParagraphText(pXml, text);
  const label = text.slice(0, colon + 1);
  const rest = text.slice(colon + 1);
  const labelBase = firstRunRPr(pXml);
  const valueBase = lastRunRPr(pXml);
  const pPr = (pXml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [""])[0];
  const open = pXml.match(/^<w:p\b[^>]*>/)?.[0] || "<w:p>";
  const boldRun = `<w:r>${rPrWithBold(labelBase)}${wText(label)}</w:r>`;
  const restRun = rest ? `<w:r>${rPrWithoutBold(valueBase)}${wText(rest)}</w:r>` : "";
  return `${open}${pPr}${boldRun}${restRun}</w:p>`;
}

function applyPlanToDocxXml(xml, plan) {
  const { paras, sectPr } = splitDocxParagraphs(xml);
  const texts = paras.map(paraTextFromXml);
  const headingIdx = {};
  texts.forEach((t, i) => {
    if (isHeading(t)) headingIdx[headingName(t)] = i;
  });

  const replaceRange = (heading, nextHeadings, newLines, { always = false, labeled = false } = {}) => {
    const start = headingIdx[heading];
    if (start == null || !newLines?.length) return;
    let end = paras.length;
    for (const h of nextHeadings) {
      if (headingIdx[h] != null && headingIdx[h] > start) end = Math.min(end, headingIdx[h]);
    }
    const body = [];
    for (let i = start + 1; i < end; i++) {
      if (texts[i].trim()) body.push(i);
    }
    const n = Math.min(body.length, newLines.length);
    const write = labeled ? setLabeledParagraphText : setParagraphText;
    for (let k = 0; k < n; k++) {
      const idx = body[k];
      if (!always && texts[idx] === newLines[k]) continue;
      paras[idx] = write(paras[idx], newLines[k]);
      texts[idx] = newLines[k];
    }
  };

  const tagIdx = texts.findIndex((t) => /\|/.test(t) && /intern|candidate|enthusiast|player/i.test(t) && !/@/.test(t));
  if (tagIdx >= 0 && plan.headline && texts[tagIdx] !== plan.headline) {
    paras[tagIdx] = setParagraphText(paras[tagIdx], plan.headline);
    texts[tagIdx] = plan.headline;
  }

  replaceRange("PROFESSIONAL SUMMARY", ["TECHNICAL SKILLS", "WORK EXPERIENCE"], plan.summary ? [plan.summary] : []);
  replaceRange("TECHNICAL SKILLS", ["WORK EXPERIENCE", "EDUCATION"], plan.skills, { always: true, labeled: true });
  replaceRange("CERTIFICATIONS", ["LANGUAGES", "INTERESTS"], plan.certs);
  replaceRange("EDUCATION", ["ACHIEVEMENTS", "CERTIFICATIONS"], plan.education);
  replaceRange("ACHIEVEMENTS", ["CERTIFICATIONS", "LANGUAGES"], plan.achievements);

  const expStart = headingIdx["WORK EXPERIENCE"];
  const expEnd = headingIdx["EDUCATION"] ?? paras.length;
  if (expStart != null && plan.experience?.length) {
    const bodyIdx = [];
    for (let i = expStart + 1; i < expEnd; i++) if (texts[i].trim()) bodyIdx.push(i);
    const newExp = plan.experience.filter((l) => String(l).trim());
    const n = Math.min(bodyIdx.length, newExp.length);
    for (let k = 0; k < n; k++) {
      if (texts[bodyIdx[k]] === newExp[k]) continue;
      paras[bodyIdx[k]] = setParagraphText(paras[bodyIdx[k]], newExp[k]);
    }
  }

  const bodyInner = paras.join("") + sectPr;
  return xml.replace(/<w:body[^>]*>[\s\S]*<\/w:body>/, `<w:body>${bodyInner}</w:body>`);
}

export function htmlFromMasterText(text, { title = "CV" } = {}) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const esc = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  let body = "";
  let headerDone = false;
  let inSkills = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!headerDone && !isHeading(line)) {
      if (/^[A-Z][A-Z\s.'-]{2,}$/.test(line) && !/\|/.test(line)) {
        body += `<h1>${esc(line)}</h1>`;
      } else if (/\|/.test(line) && /@|\+?\d/.test(line)) {
        body += `<p class="contact">${esc(line)}</p>`;
        headerDone = true;
      } else {
        body += `<p class="tag">${esc(line)}</p>`;
      }
      continue;
    }
    headerDone = true;
    if (isHeading(line)) {
      body += `<h2>${esc(line)}</h2>`;
      inSkills = headingName(line) === "TECHNICAL SKILLS";
      continue;
    }
    if (inSkills && line.includes(":")) {
      const idx = line.indexOf(":");
      body += `<p><strong>${esc(line.slice(0, idx + 1))}</strong>${esc(line.slice(idx + 1))}</p>`;
      continue;
    }
    body += `<p>${esc(line)}</p>`;
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${esc(title)}</title>
  <style>
    @page { size: letter; margin: 0.625in 0.75in; }
    body { font-family: Calibri, "Calibri Light", Arial, sans-serif; font-size: 11pt; color: #1A1A1A; line-height: 1.35; margin: 0; }
    h1 { font-size: 11pt; color: #1A237E; text-align: center; margin: 0 0 4px; letter-spacing: 0.04em; }
    .tag { text-align: center; color: #555555; margin: 0 0 2px; }
    .contact { text-align: center; color: #1A1A1A; margin: 0 0 12px; }
    h2 { font-size: 11pt; color: #1A237E; font-weight: 700; letter-spacing: 0.06em; margin: 12px 0 4px; }
    p { margin: 0 0 4px; font-weight: 400; }
    p strong { font-weight: 700; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

export function extractDocxText(buf) {
  const files = unzip(buf);
  const xml = files.get("word/document.xml");
  if (!xml) return "";
  const { paras } = splitDocxParagraphs(xml.toString("utf8"));
  return paras
    .map(paraTextFromXml)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function classifyTemplateStyles(paras) {
  const texts = paras.map(paraTextFromXml);
  const heading = paras.find((_, i) => isHeading(texts[i])) || paras[0];
  const name = paras.find((_, i) => texts[i].trim() && !isHeading(texts[i])) || paras[0];
  const contact =
    paras.find((_, i) => /\|/.test(texts[i]) && /@|linkedin|github|\+?\d/.test(texts[i])) || name;
  const skillIdx = texts.findIndex((t) => headingName(t) === "TECHNICAL SKILLS");
  const skill =
    paras.find((_, i) => skillIdx >= 0 && i > skillIdx && texts[i].includes(":")) ||
    paras.find((_, i) => texts[i].includes(":")) ||
    name;
  const body =
    paras.find((p, i) => {
      const t = texts[i].trim();
      return t && !isHeading(t) && p !== name && p !== contact;
    }) || name;
  return { heading, name, contact, skill, body };
}

/**
 * Clone the ATS format template and replace EVERY body paragraph with `atsText`.
 * Does not copy the template owner's facts. Does not write the template file.
 */
export function fillAtsFormatDocx({ root = "", templatePath = "", templateBuffer = null, atsText = "" } = {}) {
  const source = templateBuffer
    ? Buffer.from(templateBuffer)
    : (() => {
        const path = templatePath || atsFormatDocxPath(root);
        if (!path || !existsSync(path)) return null;
        return readFileSync(path);
      })();
  if (!source) return null;
  const files = unzip(source);
  for (const name of files.keys()) {
    if (!/^word\/(header|footer)\d*\.xml$/i.test(name)) continue;
    const xml = files.get(name).toString("utf8");
    files.set(name, Buffer.from(xml.replace(/<w:t\b[^>]*>[^<]*<\/w:t>/g, "<w:t xml:space=\"preserve\"></w:t>"), "utf8"));
  }
  const xmlBuf = files.get("word/document.xml");
  if (!xmlBuf) return null;
  const xml = xmlBuf.toString("utf8");
  const { paras, sectPr } = splitDocxParagraphs(xml);
  if (!paras.length) return null;
  const styles = classifyTemplateStyles(paras);
  const lines = String(atsText || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  let section = "header";
  let headerCount = 0;
  const nextParas = lines.map((line) => {
    if (isHeading(line)) {
      section = headingName(line) || "body";
      return setParagraphText(styles.heading, headingName(line) || line.toUpperCase());
    }
    if (section === "header") {
      headerCount += 1;
      if (headerCount === 1) return setParagraphText(styles.name, line);
      if (/\|/.test(line) && /@|linkedin|github|\+?\d/.test(line)) return setParagraphText(styles.contact, line);
      return setParagraphText(styles.body, line);
    }
    if (section === "TECHNICAL SKILLS" && line.includes(":")) return setLabeledParagraphText(styles.skill, line);
    return setParagraphText(styles.body, line);
  });
  const bodyInner = nextParas.join("") + sectPr;
  const nextXml = xml.replace(/<w:body[^>]*>[\s\S]*<\/w:body>/, `<w:body>${bodyInner}</w:body>`);
  files.set("word/document.xml", Buffer.from(nextXml, "utf8"));
  return zip(files);
}

export function tailorMasterCvDocx({
  root = "",
  company = "",
  role = "",
  jdText = "",
  masterPath = "",
  masterBuffer = null,
  githubProjects = [],
} = {}) {
  const path = masterPath || (!masterBuffer ? masterCvDocxPath(root) : "");
  const original = masterBuffer
    ? Buffer.from(masterBuffer)
    : path && existsSync(path)
      ? readFileSync(path)
      : null;
  if (!original) return null;
  const originalHash = fileSha256(original);
  const files = unzip(original);
  const xmlBuf = files.get("word/document.xml");
  if (!xmlBuf) return null;
  const masterText = extractDocxText(original);
  const plan = buildCopyPlan(masterText, { company, role, jdText, githubProjects });
  const nextXml = applyPlanToDocxXml(xmlBuf.toString("utf8"), plan);
  files.set("word/document.xml", Buffer.from(nextXml, "utf8"));
  const buffer = zip(files);
  const text = extractDocxText(buffer);
  const html = htmlFromMasterText(text, { title: `${role || "CV"} — ${company || ""}`.trim() });
  return {
    buffer,
    text,
    html,
    plan,
    report: plan.report,
    originalHash,
    outputHash: fileSha256(buffer),
    masterPath: path,
  };
}

export function tailorCvCopyText(cvText, extras = {}) {
  const source = String(cvText || "").trim();
  if (!source) return "";
  const plan = buildCopyPlan(source, extras);
  return applyPlanToText(source, plan);
}
