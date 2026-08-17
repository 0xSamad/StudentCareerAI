/**
 * Fetch a pasted job URL and normalize it into the same opportunity shape
 * used by in-app Apply. Never invents a job description.
 */

const MIN_DESCRIPTION_CHARS = 120;
const FETCH_TIMEOUT_MS = 12_000;

export function logUrlApply(step, extra = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(extra || {})) {
    if (value == null) continue;
    if (typeof value === "string" && value.length > 180) {
      safe[key] = `${value.slice(0, 180)}…`;
    } else {
      safe[key] = value;
    }
  }
  console.log("[URL APPLY]", step, Object.keys(safe).length ? safe : "");
}

export function htmlToVisibleText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function unique(list) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const value = String(item || "").replace(/\s+/g, " ").trim();
    const key = value.toLowerCase();
    if (!value || value.length > 80 || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function flattenLd(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data.flatMap(flattenLd);
  if (Array.isArray(data["@graph"])) return data["@graph"].flatMap(flattenLd);
  if (typeof data === "object") return [data];
  return [];
}

function isJobPosting(node) {
  const type = node?.["@type"];
  return type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
}

export function jobPostingFromHtml(html) {
  const nodes = [];
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(String(html || "")))) {
    try {
      nodes.push(...flattenLd(JSON.parse(match[1])));
    } catch {
      /* ignore broken JSON-LD */
    }
  }
  return nodes.find(isJobPosting) || null;
}

function orgName(org) {
  if (!org) return "";
  if (typeof org === "string") return org.trim();
  if (Array.isArray(org)) return orgName(org[0]);
  return String(org.name || org.legalName || "").trim();
}

function locationName(loc) {
  if (!loc) return "";
  if (typeof loc === "string") return loc.trim();
  if (Array.isArray(loc)) return locationName(loc[0]);
  const addr = loc.address || loc;
  if (typeof addr === "string") return addr.trim();
  return [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(", ");
}

function collectSkills(job) {
  const out = [];
  const add = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(add);
      return;
    }
    if (typeof value === "object") {
      add(value.name || value.value || value.text);
      return;
    }
    String(value)
      .split(/[,;•\n|/]/)
      .forEach((part) => out.push(part.trim()));
  };
  add(job.skills);
  add(job.skillsRequired);
  add(job.qualifications);
  add(job.experienceRequirements);
  add(job.educationRequirements);
  add(job.knowsAbout);
  return unique(out).slice(0, 40);
}

function metaContent(html, property) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  const match = String(html || "").match(re);
  return match ? match[1].trim() : "";
}

function headingTitle(html) {
  const h1 = String(html || "").match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!h1) return "";
  return htmlToVisibleText(h1[1]).split("\n")[0].slice(0, 180);
}

function parseGreenhouse(url) {
  try {
    const parsed = new URL(url);
    if (/(^|\.)greenhouse\.io$/i.test(parsed.hostname)) {
      const pathMatch = parsed.pathname.match(/\/([^/]+)\/jobs\/(\d+)/);
      if (pathMatch) return { token: pathMatch[1], jobId: pathMatch[2] };
      const token = parsed.searchParams.get("for");
      const jobId = parsed.searchParams.get("token") || parsed.searchParams.get("gh_jid");
      if (token && jobId) return { token, jobId };
    }
    const ghJid = parsed.searchParams.get("gh_jid");
    if (ghJid) return { token: null, jobId: ghJid };
    return null;
  } catch {
    return null;
  }
}

export function greenhouseFromHtml(html, jobIdHint = "") {
  const text = String(html || "");
  const withId =
    text.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/"'?#]+)\/jobs\/(\d+)/i) ||
    text.match(/boards\.greenhouse\.io\/([^/"'?#]+)\/jobs\/(\d+)/i) ||
    text.match(/boards-api\.greenhouse\.io\/v1\/boards\/([^/"'?#]+)\/jobs\/(\d+)/i);
  if (withId) return { token: withId[1], jobId: withId[2] };
  const tokenMatch =
    text.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/"'?#]+)/i) ||
    text.match(/boards-api\.greenhouse\.io\/v1\/boards\/([^/"'?#]+)/i) ||
    text.match(/boards\.greenhouse\.io\/(?:embed\/job_app\?for=)?([^/"'?#&]+)/i);
  const jid = jobIdHint || (text.match(/gh_jid=(\d+)/) || [])[1];
  if (tokenMatch && jid) return { token: tokenMatch[1], jobId: jid };
  return null;
}

function parseLever(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.match(/^jobs\.(?:eu\.)?lever\.co$/i);
    if (!host) return null;
    const segs = parsed.pathname.split("/").filter(Boolean);
    if (segs.length < 2) return null;
    const apiHost = /eu\.lever\.co$/i.test(parsed.hostname) ? "api.eu.lever.co" : "api.lever.co";
    return { company: segs[0], postingId: segs[1], apiHost };
  } catch {
    return null;
  }
}

async function fetchText(url) {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 StudentCareer-apply",
    },
  });
  if (!res.ok) return { ok: false, status: res.status, text: "" };
  return { ok: true, status: res.status, text: await res.text() };
}

async function fetchJson(url) {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 StudentCareer-apply" },
  });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function fromGreenhouseParsed(parsed) {
  if (!parsed?.token || !parsed?.jobId) return null;
  const data = await fetchJson(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(parsed.token)}/jobs/${encodeURIComponent(parsed.jobId)}`
  );
  if (!data?.title) return null;
  const description = htmlToVisibleText(data.content || "");
  logUrlApply("Job page fetched", { source: "greenhouse-api", token: parsed.token, jobId: parsed.jobId });
  return {
    title: String(data.title || "").trim(),
    company: orgName(data.company) || String(parsed.token || "").replace(/[-_]+/g, " "),
    description,
    location: data.location?.name || "",
    employmentType: "",
    sourceKind: "greenhouse-api",
  };
}

async function fromGreenhouse(url, html = "") {
  const fromUrl = parseGreenhouse(url);
  const parsed = fromUrl?.token && fromUrl?.jobId ? fromUrl : greenhouseFromHtml(html, fromUrl?.jobId);
  return fromGreenhouseParsed(parsed);
}

async function fromLever(url) {
  const parsed = parseLever(url);
  if (!parsed) return null;
  const data = await fetchJson(
    `https://${parsed.apiHost}/v0/postings/${encodeURIComponent(parsed.company)}/${encodeURIComponent(parsed.postingId)}`
  );
  if (!data) return null;
  const title = String(data.text || data.title || "").trim();
  if (!title) return null;
  const description = String(data.descriptionPlain || htmlToVisibleText(data.description || "")).trim();
  return {
    title,
    company: String(parsed.company || "").replace(/[-_]+/g, " "),
    description,
    location: data.categories?.location || "",
    employmentType: data.categories?.commitment || "",
    sourceKind: "lever-api",
  };
}

function fromJobPosting(job, html) {
  if (!job) return null;
  const description = htmlToVisibleText(job.description || "");
  return {
    title: String(job.title || "").trim(),
    company: orgName(job.hiringOrganization),
    description,
    location: locationName(job.jobLocation),
    employmentType: Array.isArray(job.employmentType) ? job.employmentType.join(", ") : String(job.employmentType || ""),
    seniority: String(job.experienceRequirements || job.estimatedSalary || ""),
    skills: collectSkills(job),
    requirements: unique([
      htmlToVisibleText(job.qualifications || ""),
      htmlToVisibleText(job.experienceRequirements || ""),
      htmlToVisibleText(job.educationRequirements || ""),
    ]).filter((line) => line.length > 8),
    sourceKind: "json-ld",
    ogTitle: metaContent(html, "og:title"),
  };
}

function visibleJobText(html) {
  const main = String(html || "").match(/<(?:main|article)[^>]*>([\s\S]{200,})<\/(?:main|article)>/i);
  const body = main ? main[1] : String(html || "");
  return htmlToVisibleText(body).slice(0, 20_000);
}

function looksLikeJobText(text) {
  const t = String(text || "");
  if (t.replace(/\s+/g, "").length < MIN_DESCRIPTION_CHARS) return false;
  return /responsibilit|requirement|qualif|about the (role|job)|what you.?ll|we are looking|internship|full[- ]time|apply now/i.test(t);
}

const SECTION_HEADING = {
  responsibilities: /^(responsibilit|what you.?ll do|what you will do|the role|about the (role|job)|day[- ]to[- ]day|you will)/i,
  requirements: /^(requirement|what (we|you).{0,16}(need|look)|must have|you have|we.?re looking|minimum)/i,
  qualifications: /^(qualif|education|degree|preferred)/i,
  skills: /^(skills?|competenc|nice to have)/i,
  technologies: /^(tech(nolog(?:y|ies))?|stack|tools?|software)/i,
};

function classifyHeading(line) {
  const t = String(line || "").replace(/[:\-–—]+$/, "").trim();
  if (!t || t.length > 48) return "";
  for (const [key, re] of Object.entries(SECTION_HEADING)) {
    if (re.test(t)) return key;
  }
  return "";
}

function bulletLine(line) {
  return String(line || "")
    .replace(/^[\s•\-*–—\d.)]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split a verified JD into attested sections. Never invents bullets. */
export function extractJobSections(description = "") {
  const lines = String(description || "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const sections = {
    responsibilities: [],
    requirements: [],
    qualifications: [],
    skills: [],
    technologies: [],
  };
  let current = "responsibilities";
  for (const line of lines) {
    const heading = classifyHeading(line);
    if (heading) {
      current = heading;
      continue;
    }
    const item = bulletLine(line);
    if (!item || item.length < 3) continue;
    if (current === "skills" || current === "technologies") {
      for (const part of item.split(/[,;/|]/)) {
        const token = bulletLine(part);
        if (token && token.length < 48) sections[current].push(token);
      }
    } else {
      sections[current].push(item);
    }
  }
  return {
    responsibilities: unique(sections.responsibilities).slice(0, 24),
    requirements: unique(sections.requirements).slice(0, 24),
    qualifications: unique(sections.qualifications).slice(0, 16),
    skills: unique(sections.skills).slice(0, 40),
    technologies: unique(sections.technologies).slice(0, 40),
  };
}

export function normalizeExternalJob({
  url,
  title = "",
  company = "",
  description = "",
  location = "",
  employmentType = "",
  seniority = "",
  skills = [],
  requirements = [],
  responsibilities = [],
  qualifications = [],
  technologies = [],
  sourceKind = "external_url",
} = {}) {
  const role = String(title || "").trim();
  const desc = String(description || "").trim();
  const parsed = extractJobSections(desc);
  const reqLines = unique([...(Array.isArray(requirements) ? requirements : []), ...parsed.requirements]).filter(Boolean);
  const skillList = unique([...(Array.isArray(skills) ? skills : []), ...parsed.skills]);
  const techList = unique([...(Array.isArray(technologies) ? technologies : []), ...parsed.technologies]);
  const responsibilityList = unique([
    ...(Array.isArray(responsibilities) ? responsibilities : []),
    ...parsed.responsibilities,
  ]);
  const qualificationList = unique([
    ...(Array.isArray(qualifications) ? qualifications : []),
    ...parsed.qualifications,
  ]);
  const descriptionWithReqs = [desc, reqLines.length ? `Requirements:\n${reqLines.map((r) => `• ${r}`).join("\n")}` : ""]
    .filter(Boolean)
    .join("\n\n");
  const intern = /\bintern(ship)?\b/i.test(`${role}\n${desc}`);
  return {
    source: "external_url",
    source_url: url,
    url,
    application_url: url,
    company: String(company || "").trim(),
    title: role,
    role,
    description: descriptionWithReqs,
    requirements: reqLines,
    responsibilities: responsibilityList,
    qualifications: qualificationList,
    skills: skillList,
    technologies: techList,
    location: String(location || "").trim(),
    employmentType: String(employmentType || "").trim(),
    seniority: String(seniority || "").trim(),
    opportunity_type: intern ? "INTERNSHIP" : "JOB",
    sourceKind,
  };
}

export async function extractExternalJob({
  url,
  pastedDescription = "",
  companyHint = "",
  roleHint = "",
  fetchPage = fetchText,
} = {}) {
  const pasted = String(pastedDescription || "").trim();
  let page = { ok: false, text: "" };
  try {
    page = await fetchPage(url);
    if (page.ok) logUrlApply("Job page fetched", { status: page.status || 200, bytes: page.text.length });
  } catch (err) {
    logUrlApply("Job page fetched", { ok: false, error: err instanceof Error ? err.message : "fetch failed" });
  }

  const ats =
    (await fromGreenhouse(url, page.text).catch(() => null)) ||
    (await fromLever(url).catch(() => null));
  const posting = fromJobPosting(jobPostingFromHtml(page.text), page.text);
  const visible = visibleJobText(page.text);
  const ogTitle = metaContent(page.text, "og:title");
  const ogSite = metaContent(page.text, "og:site_name");

  const title = String(
    ats?.title || posting?.title || roleHint || headingTitle(page.text) || ogTitle || ""
  )
    .replace(/\s*[|\-–].{0,40}(job|career|lever|greenhouse|indeed).*$/i, "")
    .trim();
  const company = String(ats?.company || posting?.company || companyHint || ogSite || "").trim();
  let description = pasted || ats?.description || posting?.description || "";
  if (!looksLikeJobText(description) && looksLikeJobText(visible)) description = visible;
  if (pasted) description = pasted;

  const skills = unique([...(ats?.skills || []), ...(posting?.skills || [])]);
  const requirements = unique([...(ats?.requirements || []), ...(posting?.requirements || [])]);
  const job = normalizeExternalJob({
    url,
    title,
    company,
    description,
    location: ats?.location || posting?.location || "",
    employmentType: ats?.employmentType || posting?.employmentType || "",
    seniority: posting?.seniority || "",
    skills,
    requirements,
    sourceKind: pasted ? "pasted-description" : ats?.sourceKind || posting?.sourceKind || (page.ok ? "html" : "unfetched"),
  });

  logUrlApply("Job title extracted", { title: job.title || "(none)" });
  logUrlApply("Company extracted", { company: job.company || "(none)" });
  logUrlApply("Job description length", { chars: job.description.length, sourceKind: job.sourceKind });

  const hasDescription = job.description.trim().length >= MIN_DESCRIPTION_CHARS;
  return {
    ok: hasDescription && Boolean(job.title || job.company),
    hasDescription,
    job,
    warning: hasDescription
      ? null
      : "Unable to extract the full job description from this page. Paste the job description to generate a tailored CV and cover letter.",
  };
}
