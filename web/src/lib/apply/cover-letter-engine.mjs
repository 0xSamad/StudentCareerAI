/**
 * Job-specific cover letters from the master CV + profile + JD.
 * Never overwrites docs/cv.docx. Never invents employment, projects, or skills.
 */

import { roleFamily } from "./cv-copy-tailor.mjs";

const RISKY_UNATTESTED = [
  "tensorflow",
  "pytorch",
  "keras",
  "huggingface",
  "langchain",
  "scikit-learn",
  "scikit learn",
  "pandas",
  "numpy",
  "kubernetes",
  "production-scale",
  "production scale",
  "multi-agent",
  "graph neural",
  "led a team",
  "years of experience",
  "five years",
  "3 years of",
  "published a paper",
  "phd",
];

const GENERIC_OPENERS = [
  /i am writing to express my (keen )?interest/i,
  /i am thrilled to apply/i,
  /i believe i would be a perfect fit/i,
  /i am confident that my skills and experience make me an ideal candidate/i,
];

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

function clean(raw) {
  return String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/^[ \t]*[-*•]\s+/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function headerRe(name) {
  return new RegExp(`(?:^|\\n)\\s*(?:#+\\s*)?${name}\\s*(?:\\n|$)`, "i");
}

function section(src, name, nextNames) {
  const start = headerRe(name).exec(src);
  if (!start) return "";
  const rest = src.slice(start.index + start[0].length);
  const endRe = new RegExp(`(?:^|\\n)\\s*(?:#+\\s*)?(${nextNames.join("|")})\\s*(?:\\n|$)`, "i");
  const end = rest.search(endRe);
  return clean(end >= 0 ? rest.slice(0, end) : rest);
}

function linesOf(block) {
  return clean(block)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function joinHuman(items) {
  const list = (items || []).map((s) => String(s || "").trim()).filter(Boolean);
  if (list.length >= 3) return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return list[0] || "";
}

function wordCount(text) {
  return String(text || "")
    .replace(/Dear Hiring Manager[,:]?/i, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

function formatDate(d = new Date()) {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function tokens(value) {
  return String(value || "")
    .toLowerCase()
    .match(/[a-z0-9+#]+/g) || [];
}

function haystack(role, jdText) {
  return `${role || ""}\n${jdText || ""}`.toLowerCase();
}

function lineHits(line, hay) {
  return tokens(line).filter((t) => t.length > 2 && hay.includes(t)).length;
}

function parseCv(cvText) {
  const src = clean(cvText);
  const header = src.split(/PROFESSIONAL SUMMARY/i)[0] || "";
  const headerLines = linesOf(header).filter((l) => !SECTION_HEADINGS.includes(l.toUpperCase()));
  const name =
    header.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
    headerLines.find((l) => /^[A-Z][A-Z\s.'-]{2,}$/.test(l) && !/\|/.test(l)) ||
    "";
  const contact = headerLines.find((l) => /@|\+?\d{2,}/.test(l)) || "";
  const skills = linesOf(section(src, "TECHNICAL SKILLS", ["WORK EXPERIENCE", "EDUCATION", "ACHIEVEMENTS"]));
  const education = linesOf(section(src, "EDUCATION", ["ACHIEVEMENTS", "CERTIFICATIONS", "LANGUAGES"]));
  const experience = linesOf(section(src, "WORK EXPERIENCE", ["EDUCATION", "ACHIEVEMENTS", "CERTIFICATIONS"]));
  const achievements = linesOf(section(src, "ACHIEVEMENTS", ["CERTIFICATIONS", "LANGUAGES", "INTERESTS"]));
  const certs = linesOf(section(src, "CERTIFICATIONS", ["LANGUAGES", "INTERESTS"]));
  const projects = linesOf(section(src, "PROJECTS", ["EDUCATION", "ACHIEVEMENTS", "CERTIFICATIONS", "LANGUAGES"]));
  const interests = section(src, "INTERESTS", []);
  const skillTokens = [];
  const seen = new Set();
  for (const line of skills) {
    const value = line.includes(":") ? line.split(":").slice(1).join(":") : line;
    for (const part of value.split(/[,/|]/)) {
      const token = part.trim();
      const key = token.toLowerCase();
      if (token.length < 2 || token.length > 48 || seen.has(key)) continue;
      seen.add(key);
      skillTokens.push(token);
    }
  }
  const gpaMatch = src.match(/CGPA[:\s]*([\d.]+)\s*\/\s*([\d.]+)/i);
  const semester = (src.match(/\d+(?:st|nd|rd|th)\s+Semester/i) || [""])[0];
  const courseLine = education.find((l) => /coursework includes/i.test(l)) || "";
  const coursework = courseLine
    .replace(/^.*coursework includes\s+/i, "")
    .replace(/\band\b/gi, ",")
    .split(",")
    .map((s) => s.replace(/\.$/, "").trim())
    .filter(Boolean);
  const university =
    (education.find((l) => /institute|university|college|ims/i.test(l)) || "")
      .split("|")[0]
      .trim() || "";
  return {
    name,
    contact,
    skills,
    skillTokens,
    education,
    experience,
    achievements,
    certs,
    projects,
    interests,
    gpa: gpaMatch ? `${gpaMatch[1]}/${gpaMatch[2]}` : "",
    semester,
    coursework,
    university,
    src,
  };
}

function has(cv, re) {
  return re.test(cv.src || "");
}

function certNamed(certs, re, label) {
  return (certs || []).some((l) => re.test(l)) ? label : "";
}

function overlapSkills(skillTokens, hay, prefer, limit = 5) {
  const hits = skillTokens.filter((t) => hay.includes(t.toLowerCase()));
  const preferred = skillTokens.filter((t) => prefer.test(t) && !hits.includes(t));
  const out = [...hits, ...preferred];
  const seen = new Set();
  return out.filter((t) => {
    const k = t.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, limit);
}

function jdNeedles(jdText, role) {
  const hay = haystack(role, jdText);
  const wanted = [];
  const add = (re, label) => {
    if (re.test(hay)) wanted.push(label);
  };
  add(/\bpython\b/, "Python");
  add(/\bjavascript\b/, "JavaScript");
  add(/\bsql\b|mysql/, "SQL");
  add(/rest api/, "REST APIs");
  add(/\bgit\b|github/, "Git");
  add(/flask/, "Flask");
  add(/machine learning|\bml\b|artificial intelligence|\bai\b|llm|genai/, "AI coursework");
  add(/owasp/, "OWASP Top 10");
  add(/pentest|penetration test/, "penetration testing");
  add(/web (application )?secur|appsec/, "web security");
  add(/\bctf\b/, "CTFs");
  add(/data analys|analytics/, "data analysis");
  add(/software engineer|backend|frontend|full[- ]stack/, "software engineering");
  return wanted;
}

function companyFactFromJd(company, jdText) {
  const name = String(company || "").trim();
  const text = String(jdText || "");
  if (!name || !text) return "";
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  const about = sentences.find((s) => {
    if (s.length < 40 || s.length > 180) return false;
    if (/\byou will\b|\bresponsib|\brequire|\bqualif|\bwe are looking\b/i.test(s)) return false;
    return new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(s) &&
      /\b(platform|product|mission|builds?|company|game|payment|security|ai|data)\b/i.test(s);
  });
  return about ? about.replace(/\s+/g, " ").trim() : "";
}

function authorizedProjects({ cv, profile, githubProjects }) {
  const fromCv = (cv.projects || []).filter((l) => l && !/^projects$/i.test(l)).slice(0, 4);
  const cvBlob = cv.src.toLowerCase();
  const extras = [];
  const add = (p, requireInCv) => {
    const name = String(p?.name || "").trim();
    if (!name || p?.owned === false) return;
    if (fromCv.some((l) => l.toLowerCase().includes(name.toLowerCase()))) return;
    if (extras.some((e) => e.name.toLowerCase() === name.toLowerCase())) return;
    if (requireInCv && !cvBlob.includes(name.toLowerCase())) return;
    extras.push({
      name,
      detail: String(p.description || p.detail || "").trim(),
      tech: Array.isArray(p.technologies || p.languages) ? (p.technologies || p.languages).join(", ") : "",
    });
  };
  for (const p of profile?.projects || []) add(p, true);
  for (const p of githubProjects || []) add(p, false);
  return { cvProjects: fromCv, github: extras.slice(0, 3) };
}

function collectEvidence(cv, { family, hay, profile, githubProjects }) {
  const items = [];
  const push = (id, kind, label, detail, score) => {
    if (!label) return;
    items.push({ id, kind, label, detail: detail || "", score });
  };

  const skillsPref =
    family === "security"
      ? /python|bash|linux|burp|nmap|nuclei|owasp|git/i
      : family === "data"
        ? /python|sql|mysql|git|rest/i
        : family === "ai"
          ? /python|javascript|rest|flask|git|mysql/i
          : /python|javascript|rest|flask|git|html|css/i;
  const skills = overlapSkills(cv.skillTokens, hay, skillsPref, 6);
  if (skills.length) push("skills", "skill", joinHuman(skills), skills.join(", "), 8 + skills.filter((s) => hay.includes(s.toLowerCase())).length);

  if (cv.coursework.length) {
    const ordered =
      family === "ai" || family === "data"
        ? [...cv.coursework.filter((c) => /^ai$/i.test(c) || /database/i.test(c)), ...cv.coursework.filter((c) => !/^ai$/i.test(c) && !/database/i.test(c))]
        : family === "software"
          ? [...cv.coursework.filter((c) => /software engineering/i.test(c)), ...cv.coursework.filter((c) => !/software engineering/i.test(c))]
          : [...cv.coursework.filter((c) => /cyber/i.test(c) || /network/i.test(c)), ...cv.coursework.filter((c) => !/cyber/i.test(c) && !/network/i.test(c))];
    const uniq = [...new Set(ordered)];
    push("coursework", "education", joinHuman(uniq), uniq.join(", "), family === "security" && uniq.some((c) => /cyber/i.test(c)) ? 10 : 12);
  }

  if (cv.gpa) push("gpa", "education", `CGPA ${cv.gpa}`, cv.gpa, 6);
  if (cv.semester) push("semester", "education", cv.semester, cv.semester, 4);
  if (cv.university) push("university", "education", cv.university.replace(/\s+\|.*/, ""), cv.university, 5);

  const modernAi = certNamed(cv.certs, /introduction to modern ai/i, "Introduction to Modern AI (Cisco Networking Academy)");
  const chatgpt = certNamed(cv.certs, /chatgpt/i, "Applied ChatGPT for Cybersecurity (Coursera)");
  const ejpt = certNamed(cv.certs, /\bejpt\b/i, "eJPT");
  const pt1 = certNamed(cv.certs, /\bpt1\b/i, "PT1");
  const google = certNamed(cv.certs, /google cybersecurity/i, "Google Cybersecurity Professional Certificate");
  const linux = certNamed(cv.certs, /linux for lfca|lfca/i, "Learning Linux for LFCA Certification");
  if (family === "ai" || family === "data") {
    push("cert-modern-ai", "cert", modernAi, modernAi, 14);
    push("cert-chatgpt", "cert", chatgpt, chatgpt, 10);
    push("cert-google", "cert", google, google, 4);
  } else if (family === "software") {
    push("cert-linux", "cert", linux, linux, 8);
    push("cert-modern-ai", "cert", modernAi, modernAi, 6);
  } else {
    push("cert-ejpt", "cert", ejpt, ejpt, 12);
    push("cert-pt1", "cert", pt1, pt1, 11);
    push("cert-google", "cert", google, google, 8);
  }
  if (has(cv, /15\+\s+industry certifications/i)) push("certs-count", "cert", "15+ industry certifications", "15+", 5);

  const hackerone = cv.experience.some((l) => /hackerone/i.test(l));
  if (hackerone) {
    const secScore = family === "security" ? 16 : family === "generic" ? 8 : 3;
    push(
      "hackerone",
      "experience",
      "Bug Bounty Researcher on HackerOne",
      "structured testing, OWASP Top 10, API security, documented failure analysis",
      family === "ai" || family === "data" || family === "software" ? Math.min(secScore, 3) : secScore,
    );
  }

  const ctf = has(cv, /\bctf\b/i);
  if (ctf) push("ctf", "achievement", "CTF practice", "CTF competitions", family === "security" ? 10 : 2);

  const firstPlace = (cv.achievements || []).find((l) => /1st position in computer science/i.test(l));
  if (firstPlace) push("first-place", "achievement", "1st Position in Computer Science across Government Colleges in Peshawar", firstPlace, family === "security" ? 7 : 9);

  const { cvProjects, github } = authorizedProjects({ cv, profile, githubProjects });
  for (const line of cvProjects) {
    push("cv-project", "project", line.slice(0, 80), line, 9 + lineHits(line, hay));
  }
  for (const p of github) {
    const blob = `${p.name} ${p.detail} ${p.tech}`;
    push("github", "project", p.name, [p.detail, p.tech].filter(Boolean).join(" — "), 8 + lineHits(blob, hay));
  }

  items.sort((a, b) => b.score - a.score);
  const selected = [];
  const seen = new Set();
  for (const item of items) {
    if (!item.label || seen.has(item.id)) continue;
    seen.add(item.id);
    selected.push(item);
    if (selected.length >= 6) break;
  }
  return { all: items, selected, skills };
}

export function buildCoverLetterBrief({
  cvText = "",
  profile = {},
  company = "",
  role = "",
  jdText = "",
  githubProjects = [],
  linkedinFacts = null,
  foreignCompanies = [],
} = {}) {
  const cv = parseCv(cvText);
  const family = roleFamily(role, jdText);
  const hay = haystack(role, jdText);
  const identity = profile?.identity || {};
  const name = String(identity.name || cv.name || "").trim() || "Candidate";
  const email = String(identity.email || "").trim() || (cv.contact.match(/[^\s|]+@[^\s|]+/) || [""])[0];
  const phone = String(identity.phone || "").trim();
  const location = [identity.city, identity.country].filter(Boolean).join(", ") ||
    (cv.contact.match(/Peshawar[^|]*/i) || [""])[0].trim();
  const linkedin = String(identity.linkedin || "").trim();
  const evidence = collectEvidence(cv, { family, hay, profile, githubProjects });
  const jdFocus = jdNeedles(jdText, role).filter((label) => {
    const blob = `${cv.src}\n${evidence.skills.join(" ")}`.toLowerCase();
    if (/python/i.test(label)) return /\bpython\b/i.test(blob);
    if (/javascript/i.test(label)) return /\bjavascript\b/i.test(blob);
    if (/^sql$/i.test(label)) return /\b(sql|mysql)\b/i.test(blob);
    if (/rest/i.test(label)) return /rest apis/i.test(blob);
    if (/^git$/i.test(label)) return /\bgit\b/i.test(blob);
    if (/flask/i.test(label)) return /\bflask\b/i.test(blob);
    if (/ai coursework/i.test(label)) return /\bai\b|modern ai|chatgpt/i.test(blob);
    if (/owasp|penetration|web security|ctf/i.test(label)) return /owasp|pentest|hackerone|ctf|cyber/i.test(blob);
    if (/software engineering/i.test(label)) return /software engineering/i.test(blob);
    if (/data analysis/i.test(label)) return /mysql|sql|database|python/i.test(blob);
    return blob.includes(label.toLowerCase());
  });
  const linkedinBits = [];
  if (linkedinFacts && typeof linkedinFacts === "object") {
    for (const row of [...(linkedinFacts.experience || []), ...(linkedinFacts.certifications || [])].slice(0, 3)) {
      const label = String(row?.title || row?.name || row || "").trim();
      if (label && cv.src.toLowerCase().includes(label.toLowerCase())) linkedinBits.push(label);
    }
  }
  return {
    family,
    name,
    email,
    phone,
    location,
    linkedin,
    contact: cv.contact,
    company: String(company || "").trim(),
    role: String(role || "").trim(),
    jdText: String(jdText || ""),
    companyFact: companyFactFromJd(company, jdText),
    jdFocus,
    cv,
    evidence: evidence.selected,
    skills: evidence.skills,
    linkedinBits,
    foreignCompanies: (foreignCompanies || []).map((c) => String(c || "").trim()).filter(Boolean),
    intern: /\bintern/i.test(`${role}\n${jdText}`),
    attestedText: cv.src,
    relevantExperience: evidence.selected.filter((e) => e.kind === "experience").map((e) => e.label),
    relevantProjects: evidence.selected.filter((e) => e.kind === "project").map((e) => e.label),
    evidencePackets: evidence.selected.map((e) => ({ text: `${e.kind}: ${e.label}${e.detail ? ` — ${e.detail}` : ""}` })),
  };
}

function pick(brief, id) {
  return brief.evidence.find((e) => e.id === id) || null;
}

function academicSentence(brief) {
  const uni = pick(brief, "university")?.label || brief.cv.university.replace(/\s+\|.*/, "");
  const gpa = pick(brief, "gpa")?.detail || brief.cv.gpa;
  const semester = pick(brief, "semester")?.label || brief.cv.semester;
  const courses = pick(brief, "coursework")?.detail || joinHuman(brief.cv.coursework);
  const uniPhrase = /institute of management/i.test(uni)
    ? "the Institute of Management Sciences (IMS), Peshawar"
    : uni || "university";
  const degree = /software engineering/i.test(brief.cv.src) ? "BS Software Engineering student" : "software engineering student";
  const bits = [`I am a ${degree}`];
  if (gpa) bits[0] += ` (CGPA ${gpa})`;
  bits[0] += ` at ${uniPhrase}`;
  if (semester) bits.push(`currently in my ${semester}`);
  let sentence = bits.join(", ");
  if (courses) sentence += `, with coursework covering ${courses}`;
  return `${sentence}.`;
}

function certSentence(brief, names) {
  const found = names.map((id) => pick(brief, id)?.label).filter(Boolean);
  const count = pick(brief, "certs-count");
  if (!found.length && !count) return "";
  if (found.length && count) return `I hold ${count.label}, including ${joinHuman(found)}.`;
  if (found.length) return `Relevant certifications include ${joinHuman(found)}.`;
  return `I hold ${count.label}.`;
}

function opener(brief) {
  const roleAt = [brief.role, brief.company].filter(Boolean).join(" at ") || "this role";
  const focus = joinHuman(brief.jdFocus.slice(0, 3));
  if (brief.family === "ai") {
    return focus
      ? `I am applying for ${roleAt} because the posting is built around ${focus}, which is the part of my degree and independent study I am leaning into now.`
      : `I am applying for ${roleAt} to put my AI coursework and Python practice into a real product team.`;
  }
  if (brief.family === "data") {
    return focus
      ? `I am applying for ${roleAt} because it asks for ${focus}, and those are skills I already use in coursework and technical practice.`
      : `I am applying for ${roleAt} to apply my Python and database coursework to real data problems.`;
  }
  if (brief.family === "software") {
    return focus
      ? `I am applying for ${roleAt} because it is software-engineering work centered on ${focus}.`
      : `I am applying for ${roleAt} to turn my software-engineering coursework into production habits on a real team.`;
  }
  if (brief.family === "security") {
    return focus
      ? `I am applying for ${roleAt} because the work is framed around ${focus}, which is already how I practice independently.`
      : `I am applying for ${roleAt} to take my independent security practice into a professional team.`;
  }
  return `I am applying for ${roleAt} to contribute the technical foundation I have built in my degree and independent labs.`;
}

function craftParagraph(brief) {
  const skills = joinHuman(brief.skills.slice(0, 5));
  const firstPlace = pick(brief, "first-place");
  const github = brief.evidence.filter((e) => e.id === "github" || e.id === "cv-project").slice(0, 2);

  if (brief.family === "ai") {
    const certs = certSentence(brief, ["cert-modern-ai", "cert-chatgpt", "cert-google"]);
    const parts = [academicSentence(brief)];
    if (skills) {
      parts.push(
        `The tools I can actually point to are ${skills}, used in coursework and self-directed labs rather than as a buzzword list.`,
      );
    }
    if (certs) parts.push(certs);
    if (github.length) {
      parts.push(`Relevant project work includes ${joinHuman(github.map((g) => g.label))}${github[0].detail ? ` (${github[0].detail})` : ""}.`);
    }
    parts.push(
      "I am looking for an internship where I can grow those foundations on a real product, not a role that assumes I have already shipped production machine-learning systems.",
    );
    return parts.join(" ");
  }

  if (brief.family === "data") {
    const certs = certSentence(brief, ["cert-modern-ai", "cert-chatgpt"]);
    const parts = [academicSentence(brief)];
    if (skills) {
      parts.push(`For this kind of work I can bring ${skills}, which I already use when I clean up, query, and reason about data in academic and lab settings.`);
    }
    if (certs) parts.push(certs);
    if (github.length) parts.push(`Project work that supports this includes ${joinHuman(github.map((g) => g.label))}.`);
    parts.push("I am applying as a student who can be useful quickly with Python and databases, and who will be honest about the professional data-science experience I do not yet have.");
    return parts.join(" ");
  }

  if (brief.family === "software") {
    const certs = certSentence(brief, ["cert-linux", "cert-modern-ai"]);
    const parts = [academicSentence(brief)];
    if (skills) parts.push(`I build with ${skills}, and I am used to working through problems in Git-based workflows rather than only writing homework snippets.`);
    if (certs) parts.push(certs);
    if (github.length) parts.push(`I can point to ${joinHuman(github.map((g) => g.label))} as concrete software work.`);
    parts.push("A software internship is the right next step: enough engineering foundation to contribute, and a clear runway to learn the team's codebase.");
    return parts.join(" ");
  }

  const hackerone = pick(brief, "hackerone");
  const certs = certSentence(brief, ["cert-ejpt", "cert-pt1", "cert-google"]);
  const parts = [academicSentence(brief)];
  if (hackerone) {
    parts.push(
      `Since 2024 I have worked as a Bug Bounty Researcher on HackerOne: ${hackerone.detail}${skills ? `, using ${skills}` : ""}.`,
    );
  }
  if (pick(brief, "ctf")) {
    parts.push("I also train through CTF competitions and lab practice, which is how I keep the work concrete instead of only theoretical.");
  }
  if (certs) parts.push(certs);
  if (firstPlace && !parts.join(" ").includes("1st Position") && !parts.join(" ").includes("first position")) {
    parts.push(`${firstPlace.label}.`);
  }
  return parts.join(" ");
}

function evidenceParagraph(brief) {
  const firstPlace = pick(brief, "first-place");
  const github = brief.evidence.filter((e) => e.id === "github" || e.id === "cv-project")[0];
  const hackerone = pick(brief, "hackerone");

  if (brief.family === "ai" || brief.family === "data" || brief.family === "software") {
    const bits = [];
    if (firstPlace) {
      bits.push(
        `A concrete differentiator is academic performance: ${firstPlace.label.replace(/^1st Position/, "first position")}. That is not a substitute for job experience, but it is evidence I take technical work seriously and finish it at a high standard.`,
      );
    }
    if (github) {
      bits.push(`On the project side, ${github.label}${github.detail ? ` — ${github.detail}` : ""} is the work I would discuss first.`);
    }
    if (brief.linkedinBits?.length) {
      bits.push(`LinkedIn items that also appear on my CV include ${joinHuman(brief.linkedinBits)}.`);
    }
    if (!bits.length) {
      bits.push("I do not invent production experience I have not done; what I can show is coursework, certifications, and the habit of writing down what failed and iterating.");
    } else if (brief.family === "ai") {
      bits.push("I am not claiming production LLM systems or years of machine-learning engineering. What I can bring on day one is preparation, Python fluency, and a willingness to be measured by the work.");
    } else if (brief.family === "data") {
      bits.push("I am not claiming a professional data-science job I have not held. I am claiming that I can learn the team's data quickly and be precise about what I know versus what I am still learning.");
    } else {
      bits.push("I would rather show working software and clear communication than overclaim seniority I do not have.");
    }
    return bits.join(" ");
  }

  const bits = [];
  if (hackerone) {
    bits.push(
      "That HackerOne work is how I already read a system, look for broken access control, and document the failure — the same discipline a security internship needs on day one. I am not claiming a professional SOC or pentest job I have not held; I am claiming that the practice is already specific, repeatable, and written down.",
    );
  }
  if (firstPlace) {
    bits.push(`${firstPlace.label}. That academic result sits alongside the security certifications rather than replacing hands-on practice.`);
  }
  if (github) bits.push(`Project evidence includes ${github.label}.`);
  if (!bits.length) {
    bits.push("I want to apply this testing discipline carefully on a professional team and keep growing.");
  }
  return bits.join(" ");
}

function whyParagraph(brief) {
  const company = brief.company || "the team";
  const role = brief.role || "this internship";
  const fact = brief.companyFact;
  const loc = brief.location || "Peshawar, Pakistan";
  const contribute =
    brief.family === "ai"
      ? "I can contribute Python-fluent execution, academic AI preparation, and a habit of measuring what failed and iterating"
      : brief.family === "data"
        ? "I can contribute careful Python and SQL/database work, plus the academic foundation to grow into the team's data problems"
        : brief.family === "software"
          ? "I can contribute working software habits — Python, REST APIs, Git, and structured debugging — and learn the team's codebase quickly"
          : "I can contribute a testing discipline that is already in place, while I keep learning your tools, scope, and reporting standard";
  const about = fact ? ` ${fact.replace(/\.$/, "")}.` : "";
  return `${company}'s ${role} is where I want to apply that.${about} ${contribute}. I am based in ${loc} and available immediately. I would rather send a letter that is specific and honest than one that tries to sound senior.`;
}

function closing(brief) {
  return `Thank you for considering my application. I would welcome the chance to discuss how I can contribute as ${/\bintern/i.test(brief.role) ? "an intern" : "a member of the team"}.\n\nSincerely,\n${brief.name}`;
}

function headerBlock(brief) {
  const contact = [brief.phone, brief.email, brief.linkedin, brief.location].filter(Boolean).join("  |  ") || brief.contact;
  return [
    brief.name,
    contact,
    "",
    formatDate(),
    "",
    "Hiring Team",
    brief.company || "",
    brief.role || "",
  ]
    .filter((line, i, arr) => line || arr[i - 1])
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function composeCoverLetterBody(brief) {
  const greeting = "Dear Hiring Manager,";
  const paras = [opener(brief), craftParagraph(brief), evidenceParagraph(brief), whyParagraph(brief)].filter(Boolean);
  return [headerBlock(brief), "", greeting, "", paras.join("\n\n"), "", closing(brief)].join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function copiedJdParagraph(body, jdText) {
  const jd = String(jdText || "").replace(/\s+/g, " ").trim();
  if (jd.length < 80) return false;
  const letter = String(body || "").replace(/\s+/g, " ");
  const chunks = jd.split(/(?<=[.!?])\s+/).filter((s) => s.split(/\s+/).length >= 18);
  return chunks.some((c) => letter.includes(c.slice(0, 120)));
}

export function validateCoverLetter(body, brief = {}, extras = {}) {
  const text = String(body || "").trim();
  const reasons = [];
  const company = brief.company || extras.company || "";
  const role = brief.role || extras.role || "";
  const name = brief.name || extras.name || "";
  const attested = `${brief.attestedText || ""}\n${(brief.evidence || []).map((e) => `${e.label} ${e.detail}`).join("\n")}`.toLowerCase();
  const foreign = extras.foreignCompanies || brief.foreignCompanies || [];

  if (!text) reasons.push("empty");
  if (company && !new RegExp(company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text)) reasons.push("missing-company");
  const roleToks = tokens(role).filter((w) => w.length > 2 && !/^(the|and|for|intern|internship|job|role)$/.test(w));
  if (roleToks.length && !roleToks.some((w) => text.toLowerCase().includes(w))) reasons.push("missing-role");
  if (name && !text.toLowerCase().includes(String(name).toLowerCase())) reasons.push("missing-name");
  if (/\[company name\]|\[job title\]|lorem ipsum|tbd\b|n\/a\b/i.test(text)) reasons.push("placeholder");
  if (GENERIC_OPENERS.some((re) => re.test(text))) reasons.push("generic-opener");
  if (!/dear hiring manager/i.test(text)) reasons.push("missing-greeting");
  if (!/sincerely/i.test(text)) reasons.push("missing-close");

  const wc = wordCount(text.replace(headerBlock(brief), " "));
  const min = brief.intern ? 250 : 250;
  const max = brief.intern ? 380 : 420;
  if (wc && (wc < min || wc > max)) reasons.push(`word-count:${wc}`);

  for (const risky of RISKY_UNATTESTED) {
    const re = new RegExp(risky.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (re.test(text) && !re.test(attested)) reasons.push(`unattested:${risky}`);
  }

  for (const other of foreign) {
    if (!other || other.toLowerCase() === String(company).toLowerCase()) continue;
    if (new RegExp(other.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text) && !new RegExp(other.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(attested)) {
      reasons.push(`leak:${other}`);
    }
  }

  const evidenceHits = (brief.evidence || []).filter((e) => e.label && new RegExp(e.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 40), "i").test(text));
  const skillHits = (brief.skills || []).filter((s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text));
  if ((brief.evidence || []).length && evidenceHits.length === 0 && skillHits.length === 0) reasons.push("no-evidence");

  if (copiedJdParagraph(text, brief.jdText)) reasons.push("copied-jd");

  const differentiator = evidenceHits.some((e) => /cert|achievement|project|experience|education/i.test(e.kind)) ||
    /cgpa|coursework|hackerone|1st position|introduction to modern ai|ejpt|python/i.test(text);
  if (!differentiator) reasons.push("no-differentiator");

  return {
    ok: reasons.length === 0,
    reasons,
    wordCount: wc,
    evidenceHits: evidenceHits.map((e) => e.id),
    skillHits,
  };
}

export function renderCoverLetterHtml(brief, body) {
  const letter = String(body || "").trim();
  const title = `${escapeHtml(brief.name || "Candidate")} - Cover letter${brief.company ? ` - ${escapeHtml(brief.company)}` : ""}`;
  const blocks = letter.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${title}</title>
  <style>
    @page { size: letter; margin: 0.85in 1in; }
    body { font-family: Calibri, Georgia, serif; font-size: 11pt; color: #1A1A1A; line-height: 1.45; max-width: 720px; margin: 0 auto; }
    p { margin: 0 0 12px; font-weight: 400; }
  </style>
</head>
<body>${blocks}</body>
</html>`;
}

export function composeCoverLetter(opts = {}) {
  const brief = opts.brief || buildCoverLetterBrief(opts);
  let body = composeCoverLetterBody(brief);
  let check = validateCoverLetter(body, brief);
  let guard = 0;
  while (!check.ok && check.reasons.some((r) => /^word-count:/.test(r)) && check.wordCount < 250 && guard < 3) {
    const extra =
      brief.family === "security"
        ? "I document what I try, what failed, and what I would test next, and I would bring that same discipline to this internship."
        : "I am ready to start immediately, to take feedback directly, and to be useful on well-scoped work while I learn the team's standards.";
    if (body.includes(extra)) break;
    const next = body.replace(/\nSincerely,/, `\n\n${extra}\n\nSincerely,`);
    body = next === body ? `${body}\n\n${extra}` : next;
    check = validateCoverLetter(body, brief);
    guard += 1;
  }
  return {
    body,
    html: renderCoverLetterHtml(brief, body),
    brief,
    validation: check,
    family: brief.family,
    evidence: brief.evidence,
  };
}

export function groundedCoverLetterOrNull(opts = {}) {
  const result = composeCoverLetter(opts);
  if (!String(opts.cvText || result.brief?.attestedText || "").trim()) return null;
  if (!result.body) return null;
  return result;
}
