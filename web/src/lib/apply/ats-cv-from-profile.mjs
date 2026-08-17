/**
 * Build an ATS CV from the logged-in user's profile (GitHub + LinkedIn facts).
 * Uses docs/cv.docx / templates/cv-ats-format.docx as layout only — never their content.
 */

import {
  fillAtsFormatDocx,
  htmlFromMasterText,
  extractDocxText,
  tailorMasterCvDocx,
} from "./cv-copy-tailor.mjs";
import { isDocxUpload, saveGeneratedCv } from "./user-cv-store.mjs";

function normKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fuzzySame(a, b) {
  if (!a || !b) return false;
  if (a === b || a.startsWith(b) || b.startsWith(a)) return true;
  const ta = a.split(" ").filter(Boolean);
  const tb = b.split(" ").filter(Boolean);
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.length >= 2 && short.every((t) => long.includes(t));
}

function uniqueFuzzy(items, keyFn) {
  const out = [];
  for (const item of items || []) {
    const k = keyFn(item);
    if (!k) continue;
    const hit = out.findIndex((existing) => fuzzySame(keyFn(existing), k));
    if (hit < 0) out.push(item);
    else if (k.length > keyFn(out[hit]).length) out[hit] = item;
  }
  return out;
}

function skillLines(skills = {}) {
  if (Array.isArray(skills)) {
    const list = uniqueFuzzy(skills.map((s) => String(s || "").trim()).filter(Boolean), normKey);
    return list.length ? [`Skills: ${list.join(", ")}`] : [];
  }
  const labels = [
    ["programming_languages", "Programming & Scripting"],
    ["frameworks", "Web & Dev"],
    ["ai_ml", "AI & ML"],
    ["databases", "Databases"],
    ["cloud", "Cloud"],
    ["tools", "Tools & Platforms"],
  ];
  const lines = [];
  const seen = new Set();
  for (const [key, label] of labels) {
    const values = uniqueFuzzy((skills[key] || []).map((s) => String(s || "").trim()).filter(Boolean), normKey);
    const fresh = values.filter((v) => {
      const k = normKey(v);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (fresh.length) lines.push(`${label}: ${fresh.join(", ")}`);
  }
  return lines;
}

function degreeFamily(row) {
  const d = `${row?.degree || ""} ${row?.major || ""}`.toLowerCase();
  if (/ph\.?d|doctor/.test(d)) return "phd";
  if (/master|\bms\b|\bmsc\b|\bm\.s/.test(d)) return "ms";
  if (/bachelor|\bbs\b|\bbsc\b|\bbe\b|\bb\.s/.test(d)) return "bs";
  if (/intermediate|hssc|fsc|a[- ]level/.test(d)) return "hssc";
  if (/matric|ssc|o[- ]level/.test(d)) return "ssc";
  return normKey(d);
}

function educationLines(education = []) {
  const rows = uniqueFuzzy(education, (row) =>
    `${normKey(row?.university || row?.school)} ${degreeFamily(row)}`.trim(),
  );
  const lines = [];
  for (const row of rows) {
    const degree = [row.degree, row.major].filter(Boolean).join(" in ") || row.degree || "";
    const school = row.university || row.school || "";
    const title = [degree, school].filter(Boolean).join(" — ");
    if (title) lines.push(title);
    const gpa = row.gpa ?? row.cgpa;
    const scale = row.gpa_scale || row.scale;
    if (gpa != null && gpa !== "") lines.push(scale ? `CGPA ${gpa}/${scale}` : `CGPA ${gpa}`);
    const dates = [row.start || row.start_date, row.graduation_date || row.end || row.graduation_year]
      .filter(Boolean)
      .join(" – ");
    if (dates) lines.push(dates);
    const coursework = uniqueFuzzy(row.coursework || [], normKey);
    if (coursework.length) lines.push(`Coursework includes ${coursework.join(", ")}.`);
  }
  return lines;
}

function experienceLines(experience = {}) {
  const jobs = [...(experience.jobs || []), ...(experience.internships || [])];
  const rows = uniqueFuzzy(jobs, (row) => `${normKey(row?.company || row?.organization)} ${normKey(row?.role || row?.title)}`.trim());
  const lines = [];
  for (const row of rows) {
    const role = row.role || row.title || "";
    const company = row.company || row.organization || "";
    const dates = [row.start_date || row.start, row.end_date || row.end || "Present"].filter(Boolean).join(" – ");
    const head = [role, company].filter(Boolean).join(" — ");
    if (head) lines.push(dates ? `${head}  ${dates}` : head);
    if (row.description) lines.push(String(row.description).trim());
    for (const bullet of uniqueFuzzy(row.achievements || [], normKey)) {
      lines.push(`• ${bullet}`);
    }
  }
  return lines;
}

function projectLines(projects = []) {
  const rows = uniqueFuzzy(projects, (row) => normKey(row?.name));
  const lines = [];
  for (const row of rows) {
    if (!row?.name) continue;
    const tech = uniqueFuzzy(row.technologies || row.languages || [], normKey);
    lines.push(tech.length ? `${row.name} — ${tech.join(", ")}` : row.name);
    if (row.description) lines.push(String(row.description).trim().slice(0, 280));
  }
  return lines;
}

function certLines(certs = []) {
  const names = certs.map((c) => (typeof c === "string" ? c : c?.name)).filter(Boolean);
  return uniqueFuzzy(names, normKey);
}

function achievementLines(items = []) {
  return uniqueFuzzy(
    items.map((a) => (typeof a === "string" ? a : a?.title || a?.name)).filter(Boolean),
    normKey,
  );
}

function contactLine(identity = {}) {
  const loc = [identity.city, identity.country].filter(Boolean).join(", ");
  return [identity.phone, identity.email, identity.linkedin, identity.github, identity.portfolio, loc]
    .filter(Boolean)
    .join("  |  ");
}

function headline(profile = {}) {
  const roles = profile?.preferences?.target_roles || profile?.target_roles || [];
  const first = Array.isArray(roles) ? roles.find(Boolean) : "";
  if (first) return /candidate|intern|engineer|analyst|developer/i.test(first) ? first : `${first} Candidate`;
  return "Internship Candidate";
}

function summaryFromProfile(profile = {}, projects = []) {
  const ident = profile.identity || {};
  const edu = Array.isArray(profile.education) ? profile.education[0] || {} : {};
  const degree = [edu.degree, edu.major].filter(Boolean).join(" in ");
  const school = edu.university || "";
  const skills = skillLines(profile.skills || {});
  const leadSkill = (skills[0] || "").split(":").slice(1).join(":").trim().split(", ").slice(0, 4).join(", ");
  const project = projects[0]?.name || "";
  const role = headline(profile);
  const bits = [];
  if (degree && school) bits.push(`${degree} student at ${school}`);
  else if (ident.name) bits.push(`${ident.name}`);
  if (leadSkill) bits.push(`skills in ${leadSkill}`);
  if (project) bits.push(`project work including ${project}`);
  const core = bits.join(", ");
  if (!core) return `Candidate targeting ${role}.`;
  return `${core}. Seeking ${role} roles.`;
}

export function projectsFromGitHubEvidence(result = {}) {
  const facts = Array.isArray(result?.facts) ? result.facts : [];
  const out = [];
  for (const fact of facts) {
    if (fact?.factType !== "project" || !fact.value) continue;
    const evidence = String(fact.evidence || "");
    const tech = (evidence.match(/Technologies:\s*(.+)/i) || [, ""])[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const description = (evidence.match(/Description:\s*(.+)/i) || [, ""])[1].trim();
    out.push({ name: fact.value, description, technologies: tech, owned: true });
  }
  return uniqueFuzzy(out, (p) => normKey(p.name));
}

export function mergeProjects(...lists) {
  return uniqueFuzzy(lists.flat().filter((p) => p && p.name), (p) => normKey(p.name));
}

/**
 * Canonical ATS markdown matching the docs/cv.docx section order.
 */
function sectionLines(text, heading) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let capture = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[A-Z][A-Z /&-]{2,40}$/.test(trimmed) || /^#{1,3}\s+/.test(trimmed)) {
      const name = trimmed.replace(/^#{1,3}\s+/, "").replace(/:$/, "").toUpperCase();
      if (name === heading || name.startsWith(heading)) {
        capture = true;
        continue;
      }
      if (capture) break;
    }
    if (capture && trimmed) out.push(trimmed.replace(/^[-•*]\s+/, ""));
  }
  return out;
}

function mergeLinkedInIntoProfile(profile = {}, linkedinText = "") {
  const text = String(linkedinText || "").trim();
  if (!text) return profile;
  const education = [...(profile.education || [])];
  for (const line of sectionLines(text, "EDUCATION")) {
    if (!/university|college|bachelor|master|bs\b|ms\b|phd|school|institute/i.test(line)) continue;
    const school = (line.split(/\s+[—–-]\s+/).pop() || line).trim();
    education.push({ university: school, degree: line });
  }
  const certifications = [...(profile.certifications || [])];
  for (const line of sectionLines(text, "CERTIFICATION")) {
    certifications.push(line);
  }
  const projects = [...(profile.projects || [])];
  for (const line of sectionLines(text, "PROJECT")) {
    const name = line.split(/[—–-]/)[0].trim();
    if (name) projects.push({ name, description: line });
  }
  const experienceJobs = [...(profile.experience?.jobs || []), ...(profile.experience?.internships || [])];
  for (const line of sectionLines(text, "EXPERIENCE")) {
    if (!/[—–]| at /i.test(line)) continue;
    experienceJobs.push({ role: line, company: line });
  }
  return {
    ...profile,
    education,
    certifications,
    projects,
    experience: {
      internships: profile.experience?.internships || [],
      jobs: experienceJobs.length ? experienceJobs : profile.experience?.jobs || [],
    },
  };
}

export function looksLikeAtsCv(text) {
  const t = String(text || "");
  if (t.trim().length < 80) return false;
  return /PROFESSIONAL SUMMARY|EDUCATION|TECHNICAL SKILLS|WORK EXPERIENCE/i.test(t);
}

/**
 * Canonical ATS markdown matching the docs/cv.docx section order.
 */
export function composeAtsCvFromProfile({ profile = {}, cvText = "", githubProjects = [], linkedinText = "" } = {}) {
  const merged = mergeLinkedInIntoProfile(profile, linkedinText);
  const ident = merged.identity || {};
  const name = String(ident.name || "Candidate").trim();
  const projects = mergeProjects(merged.projects || [], githubProjects);
  const certs = certLines([...(merged.certifications || []), ...((merged.achievements || []).filter((a) => /certif|certificate/i.test(String(a))))]);
  const achievements = achievementLines(merged.achievements || []).filter(
    (a) => !certs.some((c) => fuzzySame(normKey(c), normKey(a))),
  );
  const languages = uniqueFuzzy(merged.languages || [], normKey);

  const blocks = [
    [null, [name.toUpperCase(), headline(merged), contactLine(ident)].filter(Boolean)],
    ["PROFESSIONAL SUMMARY", [summaryFromProfile(merged, projects)]],
    ["TECHNICAL SKILLS", skillLines(merged.skills)],
    ["WORK EXPERIENCE", experienceLines(merged.experience)],
    ["EDUCATION", educationLines(merged.education)],
    ["PROJECTS", projectLines(projects)],
    ["CERTIFICATIONS", certs],
    ["ACHIEVEMENTS", achievements],
    ["LANGUAGES", languages],
  ];

  const lines = [];
  for (const [heading, body] of blocks) {
    const content = (body || []).filter(Boolean);
    if (!content.length) continue;
    if (heading) {
      if (lines.length) lines.push("");
      lines.push(heading);
    } else {
      lines.push(...content, "");
      continue;
    }
    lines.push(...content);
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function resolveApplyCv({
  profile = {},
  cvText = "",
  originalBuffer = null,
  originalFilename = "",
  originalMime = "",
  githubProjects = [],
  root = "",
  fetchGitHubEvidence = null,
  githubToken = "",
} = {}) {
  const uploaded = originalBuffer && originalBuffer.length;
  if (uploaded && isDocxUpload(originalFilename, originalMime, originalBuffer)) {
    const text = extractDocxText(originalBuffer) || cvText;
    return { source: "upload", buffer: Buffer.from(originalBuffer), text, html: htmlFromMasterText(text) };
  }

  let projects = mergeProjects(profile.projects || [], githubProjects);
  if (typeof fetchGitHubEvidence === "function" && (profile.identity?.github || profile.identity?.github_url)) {
    try {
      const gh = await fetchGitHubEvidence({
        url: profile.identity.github || profile.identity.github_url,
        token: githubToken || undefined,
      });
      projects = mergeProjects(projects, projectsFromGitHubEvidence(gh));
    } catch {
      /* keep profile projects */
    }
  }

  const atsText =
    uploaded || looksLikeAtsCv(cvText)
      ? String(cvText || "").trim() || composeAtsCvFromProfile({ profile, githubProjects: projects, linkedinText: "" })
      : composeAtsCvFromProfile({ profile, githubProjects: projects, linkedinText: "" });
  const buffer = fillAtsFormatDocx({ root, atsText });
  return {
    source: uploaded ? "upload-rendered" : "generated",
    buffer,
    text: buffer ? extractDocxText(buffer) : atsText,
    html: htmlFromMasterText(atsText, { title: profile.identity?.name || "CV" }),
  };
}

export async function persistGeneratedAtsCv({
  profile,
  storage,
  context = {},
  root = "",
  fetchGitHubEvidence = null,
  githubToken = "",
  githubProjects = [],
} = {}) {
  const resolved = await resolveApplyCv({
    profile,
    root,
    fetchGitHubEvidence,
    githubToken,
    githubProjects,
  });
  if (storage && resolved.buffer) {
    try {
      await saveGeneratedCv({ storage, buffer: resolved.buffer, context });
    } catch {
      /* generated file is optional; cvText still returned */
    }
  }
  return resolved;
}

export async function tailorUserCvForJob({
  profile,
  cvText,
  originalBuffer,
  originalFilename,
  originalMime,
  githubProjects,
  root,
  company,
  role,
  jdText,
  fetchGitHubEvidence,
  githubToken,
} = {}) {
  const resolved = await resolveApplyCv({
    profile,
    cvText,
    originalBuffer,
    originalFilename,
    originalMime,
    githubProjects,
    root,
    fetchGitHubEvidence,
    githubToken,
  });
  if (!resolved.buffer) {
    return { ...resolved, tailored: false };
  }
  const copy = tailorMasterCvDocx({
    root,
    company,
    role,
    jdText,
    masterBuffer: resolved.buffer,
    githubProjects,
  });
  if (!copy?.text) {
    return {
      source: resolved.source,
      buffer: resolved.buffer,
      text: resolved.text,
      html: resolved.html,
      tailored: false,
    };
  }
  return {
    source: resolved.source,
    buffer: copy.buffer,
    text: copy.text,
    html: copy.html,
    report: copy.report,
    tailored: true,
  };
}
