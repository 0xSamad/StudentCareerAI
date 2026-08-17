/**
 * profile-parser.mjs — Honest CV/profile extraction helpers.
 *
 * Never invent profile facts. Missing values stay null / empty arrays.
 */

const KNOWN_HEADINGS = new Set([
  "summary",
  "professional summary",
  "objective",
  "profile",
  "education",
  "academic background",
  "academics",
  "skills",
  "technical skills",
  "core skills",
  "technologies",
  "experience",
  "work experience",
  "professional experience",
  "employment",
  "internships",
  "projects",
  "personal projects",
  "coursework",
  "relevant coursework",
  "certifications",
  "certificates",
  "licenses & certifications",
  "achievements",
  "awards",
  "honors",
  "languages",
  "interests",
  "hobbies",
  "contact",
]);

const COUNTRIES = [
  "Pakistan",
  "India",
  "Bangladesh",
  "Nepal",
  "Sri Lanka",
  "United Arab Emirates",
  "UAE",
  "Saudi Arabia",
  "United States",
  "USA",
  "United Kingdom",
  "UK",
  "Canada",
  "Germany",
  "France",
  "Australia",
  "Malaysia",
  "Singapore",
  "Turkey",
  "Egypt",
  "Qatar",
  "Oman",
  "Bahrain",
  "Kuwait",
];

const PROGRAMMING = new Set([
  "python", "bash", "javascript", "typescript", "java", "c++", "c", "c#", "go",
  "golang", "rust", "php", "kotlin", "swift", "ruby", "scala", "r", "powershell",
  "html", "css",
]);
const FRAMEWORKS = new Set([
  "flask", "django", "fastapi", "react", "next.js", "nextjs", "node.js", "nodejs",
  "express", "spring", "angular", "vue", "vue.js", "laravel", "rails",
]);
const AI_ML = new Set([
  "pytorch", "tensorflow", "scikit-learn", "machine learning", "deep learning",
  "nlp", "llms", "llm", "transformers", "langchain", "computer vision", "chatgpt",
  "openai", "huggingface", "hugging face",
]);
const DATABASES = new Set([
  "mysql", "postgresql", "postgres", "mongodb", "redis", "sqlite", "sql", "elasticsearch",
]);
const CLOUD = new Set(["aws", "gcp", "azure", "docker", "kubernetes", "terraform"]);
const CATALOG_SKILLS = [
  "Python", "Bash", "JavaScript", "TypeScript", "Java", "C++", "C#", "Go", "Rust",
  "PHP", "SQL", "HTML", "CSS", "Flask", "Django", "FastAPI", "React", "Next.js",
  "Node.js", "Express", "Spring", "MySQL", "PostgreSQL", "MongoDB", "Redis",
  "Git", "GitHub", "Linux", "Kali Linux", "VirtualBox", "Docker", "AWS",
  "Burp Suite", "OWASP ZAP", "Nmap", "Nessus", "Katana", "Nuclei", "Wireshark",
  "Metasploit", "OWASP Top 10", "REST APIs", "OSINT", "IDOR", "XSS", "XXE",
  "SQLi", "Broken Access Control", "HTTP Verb Tampering", "Open Redirect",
  "File Upload Exploits", "Web Application Pentesting", "API Pentesting",
  "Network Pentesting", "Penetration Testing", "Threat Analysis",
  "Linux Administration", "Technical Writing", "Blue Team Fundamentals",
];

function uniqStrings(values) {
  return [...new Set((values || []).filter((v) => typeof v === "string").map((v) => v.trim()).filter(Boolean))];
}

export function cleanExtractedText(raw = "") {
  return String(raw || "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "")
    .replace(/PK!\s*[^\n]+/g, "")
    .replace(/\[Content_Types\]\.xml[^\n]*/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\r/g, "")
    .trim();
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function sanitizeName(name, fallback = "") {
  const cleaned = String(name || "")
    .replace(/^#+\s*/, "")
    .replace(/[|•].*$/, "")
    .trim()
    .slice(0, 80);
  if (!cleaned || /PK!|xml|\[Content_Types\]/i.test(cleaned)) return fallback;
  return cleaned;
}

function isSectionHeading(trimmed) {
  const plain = String(trimmed || "").replace(/:$/, "").trim();
  if (!plain) return false;
  if (/^#{1,3}\s+\S/.test(plain)) return true;
  const withoutHashes = plain.replace(/^#{1,3}\s*/, "").trim();
  if (KNOWN_HEADINGS.has(withoutHashes.toLowerCase())) return true;
  return /^[A-Z][A-Z0-9/& ]{2,48}$/.test(withoutHashes) && withoutHashes.split(/\s+/).length <= 6;
}

function sectionText(text, headings) {
  const lines = String(text || "").split("\n");
  let capture = false;
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const matchesWanted = headings.some((h) =>
      new RegExp(`^#{0,3}\\s*${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b:?$`, "i").test(trimmed)
    );
    if (matchesWanted) {
      capture = true;
      continue;
    }
    if (capture && isSectionHeading(trimmed)) break;
    if (capture) out.push(line);
  }
  return out.join("\n").trim();
}

function normalizeDate(value) {
  const v = String(value || "").trim();
  if (!v || /^present|current|ongoing|now$/i.test(v)) return null;
  if (/^\d{4}-\d{2}$/.test(v)) return v;
  let m = v.match(/(?:^|\b)(20\d{2})[\/\-](0[1-9]|1[0-2])(?:\b|$)/);
  if (m) return `${m[1]}-${m[2]}`;
  m = v.match(/(?:^|\b)(0[1-9]|1[0-2])[\/\-](20\d{2})(?:\b|$)/);
  if (m) return `${m[2]}-${m[1]}`;
  const months = {
    jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03",
    apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07",
    aug: "08", august: "08", sep: "09", sept: "09", september: "09", oct: "10",
    october: "10", nov: "11", november: "11", dec: "12", december: "12",
  };
  m = v.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/i);
  if (m) return `${m[2]}-${months[m[1].toLowerCase()]}`;
  return null;
}

function cleanOrgName(value) {
  return String(value || "")
    .replace(/^[-*•]\s*/, "")
    .replace(/\s*[|•]\s*C?GPA[:\s].*$/i, "")
    .replace(/\s+C?GPA[:\s].*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanDegree(value) {
  return String(value || "")
    .replace(/\s+student\b/i, "")
    .replace(/20\d{2}\s*[—–\-|to]+.*$/i, "")
    .replace(/20\d{2}\s*$/, "")
    .replace(/\s*[—–\-]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function formatPeriod(raw) {
  const v = String(raw || "").replace(/\u2013|\u2014/g, "—").replace(/\s+/g, " ").trim();
  if (!v) return "";
  const range = v.match(/(20\d{2})\s*[—–\-to]+\s*(20\d{2}|Present|Current|Now)/i);
  if (range) {
    const end = /present|current|now/i.test(range[2]) ? "Present" : range[2];
    return `${range[1]} – ${end}`;
  }
  const year = v.match(/20\d{2}/);
  return year ? year[0] : "";
}

function splitDegreeAndDates(line) {
  const em = String(line || "").replace(/\u2013|\u2014/g, "—").trim();
  const spaced = em.match(/^(.*?)(?:\t|\s{2,})(20\d{2}.*)$/);
  if (spaced) return { degree: cleanDegree(spaced[1]), dates: spaced[2].trim() };
  const glued = em.match(/^(.*?)(20\d{2}\s*[—–\-]?\s*(?:20\d{2}|Present|Current|Now)?)\s*$/i);
  if (glued && glued[1] && /bachelor|master|diploma|intermediate|matric|hssc|ssc|b\.?s|ph\.?d|m\.?s/i.test(glued[1])) {
    return { degree: cleanDegree(glued[1]), dates: glued[2].trim() };
  }
  return { degree: cleanDegree(em), dates: "" };
}

function degreeFamily(degree) {
  const d = skillKey(cleanDegree(degree));
  if (/phd|dphil|doctor/.test(d)) return "phd";
  if (/\bmasters?\b|\bmsc\b|\bm\.?sc?\b/.test(d)) return "master";
  if (/\bbachelors?\b|\bbsc\b|\bb\.?sc?\b|\bbe\b|\bbtech\b/.test(d)) return "bachelor";
  if (/\bdiploma\b|\bdit\b/.test(d)) return "diploma";
  if (/\bintermediate\b|\bhssc\b|\bfsc\b|\ba-?levels?\b/.test(d)) return "intermediate";
  if (/\bmatric/.test(d) || /\bssc\b/.test(d) || /\bo-?levels?\b/.test(d)) return "matric";
  return "";
}

function universitiesOverlap(a, b) {
  const na = skillKey(cleanOrgName(a)).replace(/[^a-z0-9]+/g, " ").trim();
  const nb = skillKey(cleanOrgName(b)).replace(/[^a-z0-9]+/g, " ").trim();
  if (!na || !nb) return true;
  const compactA = na.replace(/\s/g, "");
  const compactB = nb.replace(/\s/g, "");
  if (compactA.includes(compactB) || compactB.includes(compactA)) return true;
  const stop = new Set(["the", "and", "of", "college", "university", "institute", "school", "campus", "public", "government"]);
  const tokens = (s) => s.split(/\s+/).filter((t) => t.length > 2 && !stop.has(t));
  const left = new Set(tokens(na));
  const overlap = tokens(nb).filter((t) => left.has(t));
  return overlap.some((t) => t.length >= 4) || overlap.includes("ims");
}

function sameEducation(a, b) {
  const fa = degreeFamily(a?.degree);
  const fb = degreeFamily(b?.degree);
  if (fa && fb && fa === fb) return universitiesOverlap(a?.university, b?.university);
  return skillKey(cleanDegree(a?.degree)) === skillKey(cleanDegree(b?.degree))
    && universitiesOverlap(a?.university, b?.university);
}

function educationRecency(row) {
  const blob = `${row?.period || ""} ${row?.graduation_date || ""} ${row?.start_date || ""}`;
  const present = /present|current|ongoing/i.test(blob) ? 1 : 0;
  const years = [...blob.matchAll(/20\d{2}/g)].map((m) => Number(m[0]));
  const latest = years.length ? Math.max(...years) : 0;
  const familyRank = { phd: 6, master: 5, bachelor: 4, intermediate: 3, diploma: 2, matric: 1, "": 0 };
  return present * 1e7 + latest * 10 + (familyRank[degreeFamily(row?.degree)] || 0);
}

function sortEducation(rows) {
  return [...rows].sort((a, b) => educationRecency(b) - educationRecency(a));
}

function mergeEducationPair(a = {}, b = {}) {
  const degree = preferDegree(cleanDegree(a.degree), cleanDegree(b.degree));
  const uniA = cleanOrgName(a.university);
  const uniB = cleanOrgName(b.university);
  return {
    university: (uniA.length >= uniB.length ? uniA : uniB) || uniA || uniB || null,
    degree,
    major: pickFilled(a.major, b.major) || extractMajor(degree || ""),
    period: a.period || b.period || "",
    graduation_date: a.graduation_date || b.graduation_date || null,
    gpa: a.gpa ?? b.gpa ?? null,
    gpa_scale: a.gpa_scale || b.gpa_scale || 4.0,
    coursework: uniqStrings([...(a.coursework || []), ...(b.coursework || [])]),
  };
}

function dedupeEducation(rows) {
  const out = [];
  for (const row of rows) {
    if (!educationHasContent(row)) continue;
    const cleaned = {
      ...row,
      university: cleanOrgName(row.university) || null,
      degree: cleanDegree(row.degree) || null,
      period: row.period || formatPeriod(row.graduation_date) || "",
    };
    const idx = out.findIndex((existing) => sameEducation(existing, cleaned));
    if (idx === -1) out.push(cleaned);
    else out[idx] = mergeEducationPair(out[idx], cleaned);
  }
  return sortEducation(out);
}

function extractUniversity(text) {
  const edu = sectionText(text, ["Education", "Academic Background", "Academics"]);
  const source = edu || text;
  const lines = source.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (/(university|college|institute|school|lums|nust|giki|fast|iba)/i.test(line) && !/matriculation|high school/i.test(line)) {
      const cleaned = cleanOrgName(line);
      if (cleaned) return cleaned;
    }
  }
  return null;
}

function extractDegree(text) {
  const edu = sectionText(text, ["Education", "Academic Background", "Academics"]);
  const source = edu || text;
  return cleanDegree(firstMatch(source, [
    /\b(Bachelor(?: of [A-Za-z ]+)?(?: in [A-Za-z ]+)?|Master(?: of [A-Za-z ]+)?(?: in [A-Za-z ]+)?|B\.?S\.?c?(?: in [A-Za-z ]+)?|M\.?S\.?c?(?: in [A-Za-z ]+)?|PhD(?: in [A-Za-z ]+)?)\b/i,
  ]));
}

function extractMajor(text) {
  return firstMatch(text, [
    /\b(?:major|field of study|specialization)\s*[:\-]\s*([A-Za-z&/ ,.-]{3,80})/i,
    /\bin\s+(Computer Science|Software Engineering|Electrical Engineering|Data Science|Artificial Intelligence|Information Technology|Cybersecurity)\b/i,
    /\b(Computer Science|Software Engineering|Electrical Engineering|Data Science|Artificial Intelligence|Information Technology|Cybersecurity)\b/i,
  ]);
}

function extractGpa(text) {
  const match = text.match(/\b(?:c?gpa|grade point average)\b[^\d]{0,12}(\d(?:\.\d+)?)\s*(?:\/\s*(\d(?:\.\d+)?))?/i);
  if (!match) return { gpa: null, gpa_scale: null };
  return {
    gpa: Number(match[1]),
    gpa_scale: match[2] ? Number(match[2]) : 4.0,
  };
}

function extractGraduationDate(text) {
  const match = text.match(
    /\b(?:expected\s+)?graduat(?:ion|e|ing)?\b[^\dA-Za-z]{0,10}([A-Za-z]{3,9}\s+20\d{2}|20\d{2}[\/\-]\d{2}|\d{2}[\/\-]20\d{2}|20\d{2})/i
  );
  return normalizeDate(match?.[1] || "");
}

function extractCoursework(text) {
  const fromHeading = sectionText(text, ["Coursework", "Relevant Coursework"]);
  const blobs = [];
  if (fromHeading) blobs.push(fromHeading);
  const includes = [...String(text || "").matchAll(/coursework includes\s+([^.\n]+)/gi)];
  for (const match of includes) blobs.push(match[1]);
  const items = [];
  for (const blob of blobs) {
    for (const part of String(blob).split(/,|;|\n|•|\band\b/i)) {
      const item = part.replace(/^[-*]\s*/, "").replace(/\s+/g, " ").trim();
      if (item.length >= 2 && item.length <= 80 && !/top-performing|semester/i.test(item)) {
        items.push(item);
      }
    }
  }
  return uniqStrings(items).slice(0, 16);
}

function extractLocation(text) {
  const countryRe = COUNTRIES.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = String(text || "").match(new RegExp(`\\b([A-Z][A-Za-z .'-]{2,40}),\\s*(${countryRe})\\b`));
  if (!match) return { city: "", country: "" };
  const city = match[1].replace(/\s+/g, " ").trim();
  if (/(university|institute|college|linkedin|github|email)/i.test(city)) return { city: "", country: "" };
  let country = match[2];
  if (/^uae$/i.test(country)) country = "United Arab Emirates";
  if (/^usa$/i.test(country)) country = "United States";
  if (/^uk$/i.test(country)) country = "United Kingdom";
  return { city, country };
}

function extractTargetRoles(text) {
  const roles = [];
  const source = `${sectionText(text, ["Summary", "Objective", "Professional Summary"])}\n${String(text || "").slice(0, 1200)}`;
  const patterns = [
    "Cybersecurity Intern",
    "Security Intern",
    "Penetration Testing Intern",
    "Software Engineering Intern",
    "Machine Learning Intern",
    "AI Research Intern",
    "Backend Engineer",
    "Frontend Engineer",
    "Full Stack Engineer",
    "Data Scientist",
    "Data Analyst",
    "Product Manager",
  ];
  for (const role of patterns) {
    if (new RegExp(role.replace(/\s+/g, "\\s+"), "i").test(source)) roles.push(role);
  }
  const seeking = source.match(/\bseeking\s+an?\s+([A-Za-z][A-Za-z /-]{3,40}?internship)/i);
  if (seeking) {
    const label = seeking[1].replace(/\s+/g, " ").trim();
    const titled = /intern/i.test(label) ? label.replace(/\binternship\b/i, "Intern") : `${label} Intern`;
    roles.unshift(titled.replace(/\s+/g, " ").replace(/\bIntern Intern\b/i, "Intern"));
  }
  const headline = source.match(/\b([A-Za-z][A-Za-z /-]{3,40}Intern(?:ship)? Candidate)/i);
  if (headline) {
    roles.unshift(headline[1].replace(/\s+Candidate$/i, "").replace(/\binternship\b/i, "Intern").trim());
  }
  return uniqStrings(roles).slice(0, 6);
}

function skillKey(name) {
  return String(name || "").toLowerCase().replace(/\.+$/, "").trim();
}

export function categorizeSkill(name, hint = "") {
  const key = skillKey(name);
  const h = String(hint || "").toLowerCase();
  if (/programming|scripting|language/.test(h) || PROGRAMMING.has(key)) return "programming_languages";
  if (/ai|machine learning|ml\b/.test(h) || AI_ML.has(key)) return "ai_ml";
  if (/framework|backend|web & dev/.test(h) || FRAMEWORKS.has(key)) {
    if (DATABASES.has(key)) return "databases";
    if (PROGRAMMING.has(key)) return "programming_languages";
    return "frameworks";
  }
  if (/database/.test(h) || DATABASES.has(key)) return "databases";
  if (/cloud/.test(h) || CLOUD.has(key)) return "cloud";
  return "tools";
}

function splitSkillList(raw) {
  let s = String(raw || "");
  s = s.replace(/c\s*\/\s*c\+\+/gi, "C++");
  s = s.replace(/html\s*\/\s*css/gi, "HTML, CSS");
  s = s.replace(/git\s*\/\s*github/gi, "Git, GitHub");
  return uniqStrings(
    s
      .split(/\s*(?:,|;|•|·|\||\n)\s*/)
      .map((part) => part.replace(/^[-*]\s*/, "").replace(/\s+/g, " ").trim())
      .filter((part) => part.length >= 2 && part.length <= 60 && !/^other$/i.test(part))
  );
}

function emptySkills() {
  return {
    programming_languages: [],
    frameworks: [],
    ai_ml: [],
    databases: [],
    cloud: [],
    tools: [],
  };
}

function addSkill(bucket, name, hint) {
  const cleaned = String(name || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return;
  const cat = categorizeSkill(cleaned, hint);
  bucket[cat].push(cleaned);
}

function extractSkillsFromText(text) {
  const bucket = emptySkills();
  const section = sectionText(text, ["Skills", "Technical Skills", "Core Skills", "Technologies"]);
  const source = section || "";
  if (source) {
    for (const line of source.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const labeled = trimmed.match(/^([A-Za-z][A-Za-z0-9 &/+-]{1,40})\s*:\s*(.+)$/);
      if (labeled) {
        for (const item of splitSkillList(labeled[2])) addSkill(bucket, item, labeled[1]);
      } else {
        for (const item of splitSkillList(trimmed.replace(/^[-*•]\s*/, ""))) addSkill(bucket, item);
      }
    }
  }
  const haystack = [
    source,
    sectionText(text, ["Summary", "Professional Summary", "Objective"]),
    sectionText(text, ["Work Experience", "Experience", "Professional Experience"]),
  ].join("\n");
  for (const skill of CATALOG_SKILLS) {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "i");
    if (pattern.test(haystack)) addSkill(bucket, skill);
  }
  return normalizeSkills(bucket);
}

function mergeSkillMaps(a = {}, b = {}) {
  const left = normalizeSkills(a);
  const right = normalizeSkills(b);
  const merged = emptySkills();
  const seen = new Set();
  const order = ["programming_languages", "ai_ml", "frameworks", "databases", "cloud", "tools"];
  for (const cat of order) {
    for (const skill of [...left[cat], ...right[cat]]) {
      const key = skillKey(skill);
      if (seen.has(key)) continue;
      seen.add(key);
      merged[cat].push(skill);
    }
  }
  return merged;
}

function parseExperienceHeader(line) {
  const em = String(line || "").replace(/\u2013|\u2014/g, "—").trim();
  if (!em || isSectionHeading(em)) return null;
  let match = em.match(/^(.{3,90}?)\s+—\s+(.{2,90}?)(?:\t|\s{2,})(.{0,40})$/);
  if (!match) match = em.match(/^(.{3,90}?)\s+—\s+(.{2,90}?)\s+\(?(20\d{2}.*)$/);
  if (!match) match = em.match(/^(.{3,90}?)\s+[-–]\s+(.{2,90}?)(?:\t|\s{2,})(20\d{2}.*)$/);
  if (!match) match = em.match(/^(.{3,90}?)\s+at\s+(.{2,90}?)\s+\(?(20\d{2}.*)$/i);
  if (!match) return null;
  const role = match[1].trim();
  const company = match[2].trim();
  if (role.length < 3 || company.length < 2) return null;
  if (/^(summary|skills|education|certifications)$/i.test(role)) return null;
  const dates = String(match[3] || "").trim();
  return {
    role,
    company,
    start_date: normalizeDate(dates.split(/–|—|-|to/i)[0]),
    end_date: /present|current|ongoing/i.test(dates) ? null : normalizeDate(dates.split(/–|—|-|to/i).pop()),
    dates,
    achievements: [],
    description: "",
    location: "",
  };
}

function extractExperience(text) {
  const section = sectionText(text, [
    "Work Experience",
    "Experience",
    "Professional Experience",
    "Employment",
    "Internships",
  ]);
  if (!section) return { internships: [] };
  const jobs = [];
  let current = null;
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const header = parseExperienceHeader(trimmed);
    if (header) {
      if (current) jobs.push(current);
      current = header;
      continue;
    }
    if (!current) continue;
    if (/^[-*•]/.test(trimmed)) {
      current.achievements.push(trimmed.replace(/^[-*•]\s*/, ""));
    } else if (!current.location && /remote|self-directed|on-?site|hybrid|internship/i.test(trimmed) && trimmed.length < 90) {
      current.location = trimmed;
    } else {
      current.description = [current.description, trimmed].filter(Boolean).join(" ");
    }
  }
  if (current) jobs.push(current);
  return {
    internships: jobs.map((job) => ({
      company: job.company,
      role: job.role,
      start_date: job.start_date,
      end_date: job.end_date,
      description: [job.dates, job.location, job.description, ...(job.achievements || [])]
        .filter(Boolean)
        .join(" ")
        .trim(),
      achievements: uniqStrings(job.achievements),
    })),
  };
}

function isDegreeLine(line) {
  return /\b(bachelor|master|b\.?s\.?|m\.?s\.?|phd|intermediate|diploma|matriculation|hssc|ssc|a-?levels?|o-?levels?)\b/i.test(line);
}

function isInstitutionLine(line) {
  return /(university|college|institute|school|academy|lums|nust|giki|fast|iba)/i.test(line);
}

function collectEducationDetails(lines, degreeIndex) {
  let university = "";
  let gpa = { gpa: null, gpa_scale: null };
  let graduation_date = null;
  const bullets = [];
  const consume = (raw) => {
    const nxt = String(raw || "").replace(/^[-*•]\s*/, "");
    if (/coursework includes/i.test(nxt) || /^[-*•]/.test(String(raw || ""))) {
      bullets.push(nxt);
      return;
    }
    const foundGpa = extractGpa(nxt);
    if (foundGpa.gpa != null) gpa = foundGpa;
    const foundGrad = extractGraduationDate(nxt);
    if (foundGrad) graduation_date = foundGrad;
    if (!university && isInstitutionLine(nxt)) university = cleanOrgName(nxt);
  };
  for (let j = degreeIndex + 1; j < lines.length; j += 1) {
    if (isDegreeLine(lines[j]) && !/^[-*•]/.test(lines[j])) break;
    consume(lines[j]);
  }
  if (!university && degreeIndex > 0) {
    const prev = lines[degreeIndex - 1];
    if (prev && !isDegreeLine(prev)) consume(prev);
  }
  return { university, gpa, graduation_date, bullets };
}

function extractEducationEntries(text) {
  const section = sectionText(text, ["Education", "Academic Background", "Academics"]);
  if (!section) return [];
  const lines = section.split("\n").map((l) => l.trim()).filter(Boolean);
  const entries = [];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.replace(/^[-*•]\s*/, "");
    if (!isDegreeLine(line)) continue;
    if (/^[-*•]/.test(raw) && /coursework|semester/i.test(line)) continue;
    const { degree, dates } = splitDegreeAndDates(line);
    const details = collectEducationDetails(lines, i);
    const period = formatPeriod(dates);
    entries.push({
      university: details.university || null,
      degree: degree || null,
      major: extractMajor(`${degree} ${details.bullets.join(" ")}`),
      period,
      graduation_date: /present|current/i.test(dates) ? null : normalizeDate(dates) || details.graduation_date,
      gpa: details.gpa.gpa,
      gpa_scale: details.gpa.gpa_scale || 4.0,
      coursework: extractCoursework(details.bullets.join(". ")),
    });
  }
  return dedupeEducation(entries);
}

function extractCertifications(text) {
  const section = sectionText(text, ["Certifications", "Certificates", "Licenses & Certifications"]);
  if (!section) return [];
  const out = [];
  for (const raw of section.split("\n")) {
    const line = raw.replace(/^[-*•]\s*/, "").trim();
    if (!line || isSectionHeading(line)) continue;
    const bits = line.split(/\t|\s{2,}|\s+\|\s+/).map((p) => p.trim()).filter(Boolean);
    if (!bits.length) continue;
    const name = bits[0];
    if (name.length < 3) continue;
    let issuer = "";
    let date = "";
    for (const bit of bits.slice(1)) {
      if (/\b(20\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(bit) && !issuer) {
        if (/[A-Za-z]{3,}/.test(bit) && !/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(bit)) {
          issuer = bit.replace(/\s*[|•]\s*(20\d{2}|[A-Z][a-z]{2}.*)$/, "").trim();
          date = bit.replace(issuer, "").replace(/^[|•\s]+/, "").trim() || date;
        } else {
          date = bit;
        }
      } else if (!issuer) {
        issuer = bit;
      } else if (!date) {
        date = bit;
      }
    }
    out.push({
      name,
      issuer: issuer.replace(/\s*[|•]\s*$/, "").trim(),
      date: date || null,
    });
  }
  return out.slice(0, 30);
}

function extractAchievements(text) {
  const section = sectionText(text, ["Achievements", "Awards", "Honors"]);
  if (!section) return [];
  return uniqStrings(
    section
      .split("\n")
      .map((line) => line.replace(/^[-*•]\s*/, "").trim())
      .filter((line) => line.length >= 8 && !isSectionHeading(line))
  ).slice(0, 16);
}

function extractLanguages(text) {
  const section = sectionText(text, ["Languages"]);
  if (!section) return [];
  return uniqStrings(
    section
      .split(/\s{2,}|\s*\|\s*|\n|,/)
      .map((part) => part.replace(/^[-*•]\s*/, "").trim())
      .filter((part) => part.length >= 3 && part.length <= 40)
  );
}

function extractProjects(text) {
  const section = sectionText(text, ["Projects", "Personal Projects"]);
  if (!section) return [];
  const projects = [];
  let current = null;
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[-*•]/.test(trimmed) && current) {
      current.description = [current.description, trimmed.replace(/^[-*•]\s*/, "")].filter(Boolean).join(" ");
      continue;
    }
    if (isSectionHeading(trimmed)) break;
    if (current) projects.push(current);
    current = { name: trimmed.replace(/\s{2,}.*$/, "").trim(), description: "", technologies: [], achievements: [] };
  }
  if (current) projects.push(current);
  return projects.filter((p) => p.name);
}

function pickFilled(primary, fallback) {
  if (typeof primary === "string" && primary.trim()) return primary.trim();
  if (typeof fallback === "string" && fallback.trim()) return fallback.trim();
  return primary ?? fallback ?? "";
}

function normalizeIdentity(identity = {}, text = "") {
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const phoneMatch = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}/);
  const githubMatch = text.match(/github\.com\/[a-zA-Z0-9_-]+/i);
  const linkedinMatch = text.match(/linkedin\.com\/in\/[a-zA-Z0-9_-]+/i);
  const portfolioMatch = text.match(/https?:\/\/[^\s]+/gi)?.find((u) => !/github|linkedin/i.test(u));
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const fallbackName = sanitizeName(lines[0] || "", "Student Candidate");
  const location = extractLocation(text);
  const city = typeof identity.city === "string" && identity.city.trim() ? identity.city.trim() : location.city;
  const country = typeof identity.country === "string" && identity.country.trim() ? identity.country.trim() : location.country;

  return {
    name: sanitizeName(identity.name, fallbackName) || fallbackName,
    email: typeof identity.email === "string" && identity.email.trim() ? identity.email.trim() : emailMatch?.[0] || "",
    phone: typeof identity.phone === "string" && identity.phone.trim() ? identity.phone.trim() : phoneMatch?.[0] || "",
    city,
    country,
    linkedin: identity.linkedin || (linkedinMatch ? `https://${linkedinMatch[0].replace(/^https?:\/\//, "")}` : null),
    github: identity.github || (githubMatch ? `https://${githubMatch[0].replace(/^https?:\/\//, "")}` : null),
    portfolio: identity.portfolio || portfolioMatch || null,
  };
}

function normalizeEducationRow(row = {}, text = "") {
  const gpa = extractGpa(`${row.university || ""} ${text}`);
  const degree = preferDegree(row.degree, extractDegree(text));
  return {
    university: cleanOrgName(row.university) || extractUniversity(text),
    degree,
    major: (typeof row.major === "string" && row.major.trim() ? row.major.trim() : extractMajor(`${degree}\n${text}`)) || null,
    graduation_date: normalizeDate(row.graduation_date) || extractGraduationDate(text),
    gpa:
      typeof row.gpa === "number"
        ? row.gpa
        : typeof row.gpa === "string" && row.gpa.trim()
          ? Number(row.gpa)
          : gpa.gpa,
    gpa_scale:
      typeof row.gpa_scale === "number"
        ? row.gpa_scale
        : typeof row.gpa_scale === "string" && row.gpa_scale.trim()
          ? Number(row.gpa_scale)
          : gpa.gpa_scale || 4.0,
    coursework: uniqStrings([...(row.coursework || []), ...extractCoursework(text)]),
  };
}

function preferDegree(ai, heuristic) {
  const a = cleanDegree(ai);
  const h = cleanDegree(heuristic);
  if (!a) return h || null;
  if (!h) return a;
  if (/student/i.test(String(ai || "")) && !/student/i.test(h)) return h;
  return a;
}

function educationHasContent(row) {
  return Boolean(row?.university || row?.degree || row?.major || row?.gpa != null);
}

function mergeEducation(aiList = [], text = "") {
  const heuristic = extractEducationEntries(text);
  const incoming = Array.isArray(aiList) ? aiList.filter((row) => row && typeof row === "object") : [];
  if (!incoming.length) {
    if (heuristic.length) return heuristic;
    const single = normalizeEducationRow({}, text);
    return educationHasContent(single) ? [single] : [];
  }
  const fromAi = incoming.map((row) => ({
    university: cleanOrgName(row.university) || null,
    degree: cleanDegree(row.degree) || null,
    major: typeof row.major === "string" ? row.major.trim() : row.major || null,
    period: formatPeriod(row.period || row.dates || `${row.start_date || ""} ${row.end_date || ""} ${row.graduation_date || ""}`),
    graduation_date: normalizeDate(row.graduation_date),
    gpa:
      typeof row.gpa === "number"
        ? row.gpa
        : typeof row.gpa === "string" && row.gpa.trim()
          ? Number(row.gpa)
          : null,
    gpa_scale:
      typeof row.gpa_scale === "number"
        ? row.gpa_scale
        : typeof row.gpa_scale === "string" && row.gpa_scale.trim()
          ? Number(row.gpa_scale)
          : 4.0,
    coursework: uniqStrings(row.coursework || []),
  }));
  const combined = dedupeEducation([...fromAi, ...heuristic]);
  return combined.map((row) => {
    const needsSchool = !row.university;
    const needsGpa = row.gpa == null && (degreeFamily(row.degree) === "bachelor" || combined.length === 1);
    if (!needsSchool && !needsGpa && row.major && row.graduation_date) return row;
    return {
      ...row,
      university: row.university || (needsSchool ? extractUniversity(text) : null),
      gpa: needsGpa ? extractGpa(text).gpa : row.gpa,
      gpa_scale: row.gpa_scale || extractGpa(text).gpa_scale || 4.0,
      major: row.major || extractMajor(`${row.degree || ""}\n${text}`),
      graduation_date: row.graduation_date || (combined.length === 1 ? extractGraduationDate(text) : null),
    };
  });
}

function normalizeSkills(skills = {}) {
  return {
    programming_languages: uniqStrings(skills.programming_languages),
    frameworks: uniqStrings(skills.frameworks),
    ai_ml: uniqStrings(skills.ai_ml),
    databases: uniqStrings(skills.databases),
    cloud: uniqStrings(skills.cloud),
    tools: uniqStrings(skills.tools),
  };
}

function normalizeExperience(experience = {}, text = "") {
  const internships = Array.isArray(experience.internships) ? experience.internships : [];
  const jobs = Array.isArray(experience.jobs) ? experience.jobs : [];
  const fromAi = [...internships, ...jobs]
      .map((item) => ({
        company: typeof item?.company === "string" ? item.company.trim() : "",
        role: typeof item?.role === "string" ? item.role.trim() : "",
        start_date: normalizeDate(item?.start_date),
        end_date: normalizeDate(item?.end_date),
        description: typeof item?.description === "string" ? item.description.trim() : "",
        achievements: uniqStrings(item?.achievements || []),
      }))
    .filter((item) => item.company || item.role || item.description);
  const heuristic = extractExperience(text).internships;
  const merged = [...fromAi];
  for (const extra of heuristic) {
    const already = merged.some(
      (row) => skillKey(row.company) === skillKey(extra.company) && skillKey(row.role) === skillKey(extra.role)
    );
    if (!already) merged.push(extra);
  }
  return { internships: merged, jobs: [] };
}

function normalizeProjects(projects = [], text = "") {
  const fromAi = (Array.isArray(projects) ? projects : [])
    .map((item) => ({
      name: typeof item?.name === "string" ? item.name.trim() : "",
      description: typeof item?.description === "string" ? item.description.trim() : "",
      technologies: uniqStrings(item?.technologies || []),
      achievements: uniqStrings(item?.achievements || []),
    }))
    .filter((item) => item.name || item.description);
  if (fromAi.length) return fromAi;
  return extractProjects(text);
}

function normalizeCertifications(list = [], text = "") {
  const fromAi = (Array.isArray(list) ? list : [])
    .map((item) => {
      if (typeof item === "string") return { name: item.trim(), issuer: "", date: null };
      return {
        name: typeof item?.name === "string" ? item.name.trim() : "",
        issuer: typeof item?.issuer === "string" ? item.issuer.trim() : "",
        date: item?.date || null,
      };
    })
    .filter((item) => item.name);
  if (fromAi.length) return fromAi;
  return extractCertifications(text);
}

export function heuristicExtract(text = "") {
  const clean = cleanExtractedText(text);
  const identity = normalizeIdentity({}, clean);
  const education = mergeEducation([], clean);
  return {
    cv_markdown: clean ? `# ${identity.name || "Student Candidate"}\n\n${clean}` : "",
    identity,
    education,
    skills: extractSkillsFromText(clean),
    experience: extractExperience(clean),
    projects: extractProjects(clean),
    certifications: extractCertifications(clean),
    achievements: extractAchievements(clean),
    languages: extractLanguages(clean),
    target_roles: extractTargetRoles(clean),
    warnings: [
      "AI parsing was unavailable or incomplete, so only directly detectable fields were extracted.",
    ],
  };
}

export function normalizeParsedProfile(extracted = {}, rawText = "") {
  const clean = cleanExtractedText(rawText);
  const heuristic = heuristicExtract(clean);
  const identity = normalizeIdentity(extracted.identity || {}, clean);
  const education = mergeEducation(extracted.education || [], clean);
  const skills = mergeSkillMaps(extracted.skills || {}, heuristic.skills);
  const experience = normalizeExperience(extracted.experience || {}, clean);
  const projects = normalizeProjects(extracted.projects || [], clean);
  const certifications = normalizeCertifications(extracted.certifications || [], clean);
  const achievements = uniqStrings([
    ...(Array.isArray(extracted.achievements) ? extracted.achievements : []),
    ...heuristic.achievements,
  ]);
  const languages = uniqStrings([
    ...(Array.isArray(extracted.languages) ? extracted.languages : []),
    ...heuristic.languages,
  ]);
  const target_roles = uniqStrings([...(extracted.target_roles || []), ...heuristic.target_roles]);
  const usedAi = extracted && Object.keys(extracted).length > 0 && (extracted.identity || extracted.skills || extracted.education);
  const warnings = uniqStrings([
    ...(Array.isArray(extracted.warnings) ? extracted.warnings : []),
    ...(!usedAi ? heuristic.warnings : []),
  ]);

  const cv_markdown =
    typeof extracted.cv_markdown === "string" && extracted.cv_markdown.trim().length > 30
      ? extracted.cv_markdown.trim()
      : heuristic.cv_markdown;

  return {
    cv_markdown,
    identity,
    education,
    skills,
    experience,
    projects,
    certifications,
    achievements,
    languages,
    target_roles,
    warnings,
  };
}
