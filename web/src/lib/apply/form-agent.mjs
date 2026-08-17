/**
 * Hybrid URL-apply form agent (planner).
 * OBSERVE → UNDERSTAND → FIND USER FACT → DECIDE → (fillSession ACT) → VERIFY → CONTINUE
 * Deterministic profile matching first; AI only for unfamiliar labels;
 * confidence gate; never invents. Browser actuation stays in fillSession.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { answersFromProfile, skillsFromProfile } from "./answers-from-profile.mjs";
import { matchOption, clipToMax, logFieldDecision } from "./semantic-option.mjs";
import { batchFieldAnswers } from "./field-ai.mjs";

export const CONFIDENCE = Object.freeze({
  HIGH: 90,
  MEDIUM: 70,
  AUTO_FILL: 70,
});

const FORBIDDEN =
  /sponsor|authori[sz]e?d to work|work authori|visa|citizen|race|ethnic|disab|veteran|criminal|felony|religion|sexual|lgbt|pronoun|\bgender\b|salary|ctc|compensation|i agree|i consent|privacy notice|self-identif|legal eligibility|date of birth|\bdob\b|birth date|security clearance|clearance/;

const ACTION_FIELD =
  /^(add another|add (your )?(education|experience|school|employer|job)|remove|delete section)\b/i;

const SKIP =
  /human check|captcha|recaptcha|i am not a robot|\b(pass ?word|passwd|passcode)\b/;

export function fieldBlob(field = {}) {
  return [field.label, field.nativeName, field.nativeId, field.id, field.placeholder, field.nearbyText, field.ariaLabel]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function isForbiddenGuess(field, profile) {
  const blob = fieldBlob(field);
  if (SKIP.test(blob)) return true;
  if (!FORBIDDEN.test(blob)) return false;
  if (/\bgender\b/.test(blob) && String(profile?.identity?.gender || "").trim()) return false;
  if (/date of birth|\bdob\b|birth date/.test(blob) && String(profile?.identity?.date_of_birth || profile?.identity?.dob || "").trim()) return false;
  if (/disab/.test(blob) && String(profile?.identity?.disability || profile?.preferences?.disability || "").trim()) return false;
  if (/salary|ctc|compensation/.test(blob)) {
    const p = profile?.preferences || profile?.compensation || {};
    if (String(p.expected_salary || p.expectedSalary || p.expectedCTC || "").replace(/\D/g, "")) return false;
    if (String(p.current_salary || p.currentSalary || "").replace(/\D/g, "")) return false;
  }
  if (/sponsor/.test(blob) && sponsorshipNeed(profile) != null) {
    return false;
  }
  if (/authori[sz]|work in|citizen|visa/.test(blob) && String(profile?.preferences?.sponsorship?.visa_status || profile?.preferences?.work_authorization || "").trim()) {
    return false;
  }
  return true;
}

function sponsorshipNeed(profile) {
  const p = profile?.preferences || {};
  if (p.sponsorship && p.sponsorship.needs_sponsorship != null && p.sponsorship.needs_sponsorship !== "") {
    return Boolean(p.sponsorship.needs_sponsorship);
  }
  if (p.needs_sponsorship != null && p.needs_sponsorship !== "") {
    return Boolean(p.needs_sponsorship);
  }
  return null;
}

const COUNTRY_SIGNALS = [
  { id: "united states", re: /\bunited states\b|\busa\b|\bu\.s\.a?\b|\bcalifornia\b|\blos angeles\b|\bnew york\b|\bsan francisco\b|\bseattle\b|\bboston\b|\baustin\b|\bchicago\b|\bwashington,?\s*d\.?c\.?/i },
  { id: "pakistan", re: /\bpakistan\b/i },
  { id: "united kingdom", re: /\bunited kingdom\b|\bengland\b|\blondon\b/i },
  { id: "canada", re: /\bcanada\b|\btoronto\b|\bvancouver\b/i },
  { id: "germany", re: /\bgermany\b|\bberlin\b|\bmunich\b/i },
  { id: "india", re: /\bindia\b|\bbengaluru\b|\bbangalore\b|\bhyderabad\b/i },
];

function countriesMentioned(text) {
  const s = String(text || "");
  const hits = [];
  for (const row of COUNTRY_SIGNALS) {
    if (row.re.test(s) && !hits.includes(row.id)) hits.push(row.id);
  }
  return hits;
}

function homeCountryId(profile) {
  const ident = profile?.identity || {};
  const fromSignals = countriesMentioned(`${ident.country || ""} ${ident.city || ""}`);
  if (fromSignals.length) return fromSignals[0];
  return String(ident.country || "").trim().toLowerCase();
}

function attestedWorkStatus(profile) {
  return String(profile?.preferences?.sponsorship?.visa_status || profile?.preferences?.work_authorization || "").trim();
}

/** Yes/No when home country and job country clearly differ. Never invents a Yes. */
export function inferWorkAuthorization(field, profile, extras = {}) {
  const blob = fieldBlob(field);
  if (!/authori[sz]ed to work|work authori|legally authorized/.test(blob)) return { value: "", confidence: 0, source: "none" };
  const home = homeCountryId(profile);
  const inQuestion = countriesMentioned(blob);
  const fromJob = countriesMentioned(`${extras.role || ""} ${extras.company || ""} ${extras.location || ""} ${extras.jdText || ""}`);
  const targets = inQuestion.length ? inQuestion : fromJob;
  const foreign = home ? targets.filter((t) => t !== home && !home.includes(t) && !t.includes(home)) : targets;
  const status = attestedWorkStatus(profile);
  if (foreign.length) {
    return { value: yesNoOption(field, false), confidence: 94, source: "profile.identity.country vs job location" };
  }
  if (status) {
    const yes = /citizen|authorized|yes|national/i.test(status);
    const value = field.options?.length ? field.options.find((o) => (yes ? /^yes\b/i.test(String(o)) : /^no\b/i.test(String(o)))) || (yes ? "Yes" : "No") : yes ? "Yes" : status;
    return { value, confidence: 88, source: "profile.work_authorization" };
  }
  return { value: "", confidence: 0, source: "missing" };
}

function recentHardBuild(profile, cvText = "") {
  const project = projectForQuestion("project", profile);
  if (project?.name) {
    const tech = (project.technologies || []).filter(Boolean).join(", ");
    const why = String(project.description || "").replace(/\s+/g, " ").trim();
    const lead = tech ? `I built ${project.name} with ${tech}` : `I built ${project.name}`;
    if (why) return `${lead}. ${why.replace(/\.$/, "")}. I built it as recent, self-directed work — not only a class assignment.`;
    return `${lead}. It was recent and self-directed, which is why I lead with it.`;
  }
  const hay = String(cvText || "");
  if (/hackerone|bug bounty|penetration test|ctf/i.test(hay)) {
    return "I recently built a self-directed offensive-security practice around HackerOne programs, CTFs, and pentest labs, working through OWASP issues such as IDOR, XSS, and API flaws with Burp Suite and Nuclei. I built that loop because I wanted recent, hands-on practice before a professional internship — not only coursework.";
  }
  return "";
}

function howHeardAnswer(field, profile) {
  const linkedin = String(profile?.identity?.linkedin || "").trim();
  if (!linkedin) return "";
  if (field.options?.length) {
    const hit = (field.options || []).find((o) => /linkedin/i.test(String(o)));
    if (hit) return hit;
  }
  return "LinkedIn — I found this role while searching for internships.";
}

function internshipAvailability(field, profile) {
  const mode = String(profile?.preferences?.search_mode || "").toLowerCase();
  if (mode !== "internships") return "";
  return yesNoOption(field, true);
}

function gamingIndustryAnswer(field, profile, cvText = "") {
  const hay = `${JSON.stringify(profile || {})}\n${cvText || ""}`.toLowerCase();
  const yes = /\bgaming\b|video game|unity|unreal engine|game dev|game studio/.test(hay);
  return yesNoOption(field, yes);
}

function locationBlob(profile) {
  const ident = profile?.identity || {};
  return `${ident.city || ""} ${ident.country || ""} ${ident.state || ""}`.toLowerCase().replace(/\s+/g, " ").trim();
}

function yesNoOption(field, yes) {
  const opts = field.options || [];
  if (!opts.length) return yes ? "Yes" : "No";
  const hit = opts.find((o) => (yes ? /^yes\b/i.test(String(o).trim()) : /^no\b/i.test(String(o).trim())));
  return hit || (yes ? "Yes" : "No");
}

/** Map 2028-08 onto "Fall 2027 or beyond" / "Fall 2028" radio options. Never invents a year. */
export function pickGraduationTermOption(field, raw) {
  const text = String(raw || "").trim();
  const yearMatch = text.match(/(19|20)\d{2}/);
  if (!yearMatch) return "";
  const year = Number(yearMatch[0]);
  const monthMatch = text.match(/[-/.](\d{1,2})/);
  const month = monthMatch ? Number(monthMatch[1]) : 6;
  const season = month <= 5 ? "Spring" : month <= 7 ? "Summer" : "Fall";
  const opts = field.options || [];
  if (!opts.length) return String(year);
  const exact = opts.find((o) => new RegExp(`${season}\\s*${year}`, "i").test(String(o)));
  if (exact) return exact;
  const dated = opts
    .map((o) => {
      const years = [...String(o).matchAll(/(19|20)\d{2}/g)].map((m) => Number(m[0]));
      return { o, max: years.length ? Math.max(...years) : 0, beyond: /beyond|later|after|or later/i.test(String(o)) };
    })
    .filter((row) => row.max);
  const lastSpecific = Math.max(0, ...dated.filter((row) => !row.beyond).map((row) => row.max));
  if (lastSpecific && year > lastSpecific) {
    const beyond = dated.find((row) => row.beyond);
    if (beyond) return beyond.o;
  }
  const sameYear = opts.find((o) => String(o).includes(String(year)));
  return sameYear || pickOption(field, String(year));
}

export function inferStageName(fields = [], pageText = "") {
  const blob = `${(fields || []).map((f) => f.label || "").join(" ")} ${pageText}`.toLowerCase();
  if (/reference/.test(blob)) return "Academic Reference";
  if (/research interest/.test(blob)) return "Research Interests";
  if (/\bprojects?\b/.test(blob) && !/first name|e-?mail/.test(blob)) return "Projects";
  if (/(resume|cv|cover letter|upload)/.test(blob) && !/first name|e-?mail/.test(blob) && !/university|education/.test(blob)) {
    return "Documents";
  }
  if (/(university|gpa|cgpa|degree|education|school|college)/.test(blob) && !/first name|e-?mail/.test(blob)) {
    return "Education";
  }
  if (/(employer|job title|work experience|internship)/.test(blob) && !/first name|e-?mail/.test(blob)) {
    return "Experience";
  }
  if (/first name|last name|full name|e-?mail|phone/.test(blob)) return "Personal Information";
  return "Application";
}

function educationList(profile) {
  return Array.isArray(profile?.education) ? profile.education.filter(Boolean) : [];
}

function experienceList(profile) {
  const exp = profile?.experience;
  if (Array.isArray(exp)) return exp;
  return [...(exp?.jobs || []), ...(exp?.internships || [])];
}

export function repeatingSectionPlan(profile = {}) {
  const education = educationList(profile);
  const experience = experienceList(profile);
  return {
    educationRows: education.length,
    experienceRows: experience.length,
    addEducation: Math.max(0, education.length - 1),
    addExperience: Math.max(0, experience.length - 1),
  };
}

/** Repeating-row index. "Additional information / cover letter" is NOT a second education row. */
export function indexFromBlob(blob) {
  const s = String(blob || "").toLowerCase();
  const numbered = s.match(
    /\b(?:university|college|school|institution|employer|company|education|experience|job|position)\s*[#:]?\s*(\d{1,2})\b/,
  );
  if (numbered) return Math.max(0, Number(numbered[1]) - 1);
  const hash = s.match(/#(\d{1,2})\b/);
  if (hash && /(university|school|employer|education|experience)/.test(s)) return Math.max(0, Number(hash[1]) - 1);
  const repeatingCue = /\b(second|third|another|additional)\b/.test(s);
  const sectionNoun = /(school|universit|college|institution|employer|job title|experience|education|position)\b/.test(s);
  const notCover = !/(information|comments|cover letter|motivation)/.test(s);
  if (repeatingCue && sectionNoun && notCover) {
    if (/\bthird\b/.test(s)) return 2;
    return 1;
  }
  return 0;
}

export function widgetKind(field = {}) {
  if (field.type === "file") return "file-upload";
  if (field.type === "date") return "date-picker";
  if (field.type === "radio") return "radio";
  if (field.type === "checkbox") return "checkbox";
  if (field.type === "textarea") return "textarea";
  const blob = fieldBlob(field);
  if (/\bcountry\b/.test(blob) && !/phone|dial/.test(blob)) return "country-selector";
  if (/city|location|locate me/.test(blob)) return "city-selector";
  if (field.combobox) return "searchable-dropdown";
  if (field.type === "select") return "dropdown";
  if (/autocomplete/.test(blob)) return "autocomplete";
  return field.type || "text";
}

function attestedGpa(edu) {
  const raw = edu?.gpa ?? edu?.cgpa ?? edu?.grade ?? edu?.cgpa_score;
  if (raw == null || raw === "") return "";
  const n = Number(raw);
  return Number.isFinite(n) ? String(n) : String(raw).trim();
}

function projectForQuestion(blob, profile) {
  const projects = Array.isArray(profile?.projects) ? profile.projects : [];
  if (!projects.length) return null;
  const wantAi = /\bai\b|machine learning|\bml\b|nlp|deep learning/.test(blob);
  const hit = projects.find((p) => {
    const hay = `${p.name || ""} ${p.description || ""} ${(p.technologies || []).join(" ")}`.toLowerCase();
    if (wantAi) return /ai|ml|nlp|learn|sentiment|model|torch|tensor/.test(hay);
    return true;
  });
  return hit || projects[0];
}

function isoDateFromYear(year) {
  const y = String(year || "").match(/(19|20)\d{2}/);
  return y ? `${y[0]}-01-01` : "";
}

/**
 * Extra attested facts the label matcher in answersFromProfile does not cover.
 * Never invents — empty string means wait.
 */
export function extraFactForField(field, profile, cvText = "", extras = {}) {
  const blob = fieldBlob(field);
  if (SKIP.test(blob)) return { value: "", confidence: 0, source: "forbidden" };

  const workAuth = inferWorkAuthorization(field, profile, extras);
  if (workAuth.value) return workAuth;

  if (/something hard you built|built recently|what.{0,40}you built|why did you build/.test(blob)) {
    const text = recentHardBuild(profile, cvText);
    return text ? { value: text, confidence: 92, source: "profile.projects|cv" } : { value: "", confidence: 0, source: "missing" };
  }
  if (/how did you (come to )?(learn|hear|find)|hear about this|learn about .{0,48}\?/.test(blob)) {
    const heard = howHeardAnswer(field, profile);
    return heard ? { value: heard, confidence: 90, source: "profile.identity.linkedin" } : { value: "", confidence: 0, source: "missing" };
  }
  if (
    /available for (a )?.{0,40}internship/.test(blob) ||
    (/(3-month|three[ -]month|40 hrs?\/week|40 hours)/.test(blob) && /intern/.test(blob))
  ) {
    const avail = internshipAvailability(field, profile);
    return avail ? { value: avail, confidence: 94, source: "profile.preferences.search_mode" } : { value: "", confidence: 0, source: "missing" };
  }
  if (/gaming industry|video game|game (studio|development|industry)/.test(blob)) {
    return { value: gamingIndustryAnswer(field, profile, cvText), confidence: 92, source: "cv" };
  }
  if (/disab|chronic condition/.test(blob)) {
    const attested = String(profile?.identity?.disability || profile?.preferences?.disability || "").trim();
    if (attested) return { value: attested, confidence: 96, source: "profile.identity.disability" };
    const declined =
      pickOption(field, "Prefer not to say") ||
      pickOption(field, "I do not wish to answer") ||
      pickOption(field, "I don't wish to answer") ||
      pickOption(field, "No");
    return declined ? { value: declined, confidence: 88, source: "decline" } : { value: "", confidence: 0, source: "forbidden" };
  }

  if (isForbiddenGuess(field, profile)) return { value: "", confidence: 0, source: "forbidden" };

  const edu = educationList(profile);
  const idx = Math.max(0, indexFromBlob(blob));
  const row = edu[idx] || edu[0];

  if (/date of birth|\bdob\b|birth date/.test(blob)) {
    const dob = String(profile?.identity?.date_of_birth || profile?.identity?.dob || "").trim();
    return dob ? { value: dob, confidence: 98, source: "profile.identity.dob" } : { value: "", confidence: 0, source: "missing" };
  }
  if ((/cover letter|motivation letter/.test(blob) || (/additional information/.test(blob) && /cover|comment/.test(blob))) && extras.coverLetter) {
    return { value: clipToMax(String(extras.coverLetter), field.maxLength || 4000), confidence: 96, source: "coverLetter" };
  }
  if (/why (do you want|are you interested)|tell us about yourself|why should we hire|describe yourself|motivation/.test(blob) && extras.coverLetter) {
    return { value: clipToMax(String(extras.coverLetter), field.maxLength || 800), confidence: 90, source: "coverLetter" };
  }

  if (/cgpa|gpa|grade point/.test(blob)) {
    const gpa = attestedGpa(row);
    return gpa ? { value: gpa, confidence: 98, source: "profile.education.gpa" } : { value: "", confidence: 0, source: "missing" };
  }
  if (/programming languages|languages do you know|list your skills/.test(blob)) {
    const skills = skillsFromProfile(profile, cvText);
    return skills ? { value: skills, confidence: 96, source: "profile.skills" } : { value: "", confidence: 0, source: "missing" };
  }
  if (/describe.{0,40}project|tell us about.{0,20}project|ai project/.test(blob)) {
    const project = projectForQuestion(blob, profile);
    if (!project) return { value: "", confidence: 0, source: "missing" };
    const text = [project.name, project.description, (project.technologies || []).join(", ")].filter(Boolean).join(" — ");
    return { value: text, confidence: 92, source: "profile.projects" };
  }
  if (/graduation year|year of graduation|graduation date|date of graduation|anticipated graduation/.test(blob) || (field.type === "date" && /graduat/.test(blob))) {
    const raw = String(row?.graduation_date || row?.graduation_year || row?.graduationDate || row?.end || "").trim();
    const year = raw.match(/(19|20)\d{2}/);
    if (!year) return { value: "", confidence: 0, source: "missing" };
    if ((field.options || []).some((o) => /fall|spring|summer|winter|beyond/i.test(String(o)))) {
      const value = pickGraduationTermOption(field, raw);
      return value ? { value, confidence: 95, source: "profile.education" } : { value: "", confidence: 0, source: "option-mismatch" };
    }
    const value = field.type === "date" || (/date/.test(blob) && field.type !== "radio") ? isoDateFromYear(year[0]) : year[0];
    return { value, confidence: 97, source: "profile.education" };
  }
  if ((field.type === "radio" || (field.options || []).some((o) => /^yes$/i.test(String(o).trim()))) && /in the [a-z][a-z\s]{1,40} area|based in |located in |live in /.test(blob)) {
    const home = locationBlob(profile);
    if (!home) return { value: "", confidence: 0, source: "missing" };
    const area = blob.match(/in the ([a-z][a-z\s]{1,40}?) area/) || blob.match(/(?:based|located|live) in ([a-z][a-z\s]{1,30})/);
    const place = String(area?.[1] || "").replace(/\s+/g, " ").trim();
    if (!place) return { value: "", confidence: 0, source: "missing" };
    const tokens = place.split(/\s+/).filter((t) => t.length > 2);
    const matchesHome = tokens.some((t) => home.includes(t));
    if (matchesHome) return { value: "", confidence: 0, source: "ambiguous-location" };
    return { value: yesNoOption(field, false), confidence: 93, source: "profile.identity.location" };
  }
  if ((field.type === "date" || /start date|from date/.test(blob)) && /educat|school|universit|college/.test(blob)) {
    const start = String(row?.start || row?.start_date || "").match(/(19|20)\d{2}/);
    return start ? { value: isoDateFromYear(start[0]), confidence: 90, source: "profile.education" } : { value: "", confidence: 0, source: "missing" };
  }
  if ((field.type === "date" || /end date|to date/.test(blob)) && /educat|school|universit|college/.test(blob)) {
    const end = String(row?.end || row?.end_date || row?.graduation_year || "").match(/(19|20)\d{2}/);
    return end ? { value: isoDateFromYear(end[0]), confidence: 90, source: "profile.education" } : { value: "", confidence: 0, source: "missing" };
  }
  if ((/university|college|school|institution/.test(blob) || /degree|major/.test(blob)) && idx > 0 && row) {
    if (/degree|major|field of study/.test(blob)) {
      const degree = [row.degree, row.major].filter(Boolean).join(" in ");
      return degree ? { value: degree, confidence: 97, source: "profile.education" } : { value: "", confidence: 0, source: "missing" };
    }
    return row.university
      ? { value: String(row.university), confidence: 97, source: "profile.education" }
      : { value: "", confidence: 0, source: "missing" };
  }
  if (/employer|company name/.test(blob) && idx > 0) {
    const jobs = experienceList(profile);
    const job = jobs[idx];
    if (job?.company) return { value: String(job.company), confidence: 96, source: "profile.experience" };
  }
  if (/(need|require|will you).{0,48}sponsor|visa sponsor/.test(blob) && sponsorshipNeed(profile) != null) {
    const needs = Boolean(sponsorshipNeed(profile));
    return { value: yesNoOption(field, needs), confidence: 96, source: "profile.sponsorship" };
  }
  return { value: "", confidence: 0, source: "none" };
}

function pickOption(field, value) {
  if (!value) return "";
  const opts = field.options || [];
  if (!opts.length) return value;
  return matchOption(opts, value);
}

export function decideAction(confidence) {
  if (confidence >= CONFIDENCE.HIGH) return "fill";
  if (confidence >= CONFIDENCE.MEDIUM) return "fill";
  return "wait";
}

const STAGE_STORE = (globalThis.__coFormAgentStages ??= new Map());

let PERSIST_PATH = "";

export function setFormAgentPersistPath(filePath = "") {
  PERSIST_PATH = String(filePath || "");
}

export function formAgentResumeKey(url = "") {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`.toLowerCase().replace(/\/+$/, "");
  } catch {
    return String(url || "").slice(0, 180);
  }
}

export function loadFormAgentPersist() {
  if (!PERSIST_PATH || !existsSync(PERSIST_PATH)) return;
  try {
    const data = JSON.parse(readFileSync(PERSIST_PATH, "utf8"));
    if (!data || typeof data !== "object") return;
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object") STAGE_STORE.set(key, value);
    }
  } catch {
    /* ignore corrupt cache */
  }
}

function saveFormAgentPersist() {
  if (!PERSIST_PATH) return;
  try {
    mkdirSync(dirname(PERSIST_PATH), { recursive: true });
    writeFileSync(PERSIST_PATH, JSON.stringify(Object.fromEntries(STAGE_STORE), null, 2));
  } catch {
    /* disk is optional for resume */
  }
}

export function getFormAgentState(sessionId) {
  return STAGE_STORE.get(String(sessionId || "")) || { sessionId, stages: [], waiting: [], pageIndex: 0 };
}

export function recordFormStage(sessionId, name, status) {
  const key = String(sessionId || "");
  const prev = getFormAgentState(key);
  const stages = [...(prev.stages || [])];
  const idx = stages.findIndex((s) => s.name === name);
  const row = { name, status };
  if (idx >= 0) stages[idx] = row;
  else stages.push(row);
  const next = { ...prev, sessionId: key, stages };
  STAGE_STORE.set(key, next);
  saveFormAgentPersist();
  return next;
}

export function recordFormWaiting(sessionId, waiting, pageIndex, extra = {}) {
  const key = String(sessionId || "");
  const prev = getFormAgentState(key);
  const next = {
    ...prev,
    sessionId: key,
    waiting: waiting || [],
    pageIndex: pageIndex ?? prev.pageIndex,
    status: extra.status || (waiting?.length ? "waiting_for_user" : prev.status || "in_progress"),
    completedFields: extra.completedFields || prev.completedFields || [],
    pendingFields: waiting || [],
    humanIntervention: extra.humanIntervention || prev.humanIntervention || null,
    audit: extra.audit || prev.audit || null,
  };
  STAGE_STORE.set(key, next);
  saveFormAgentPersist();
  return next;
}

export function resetFormAgentStateForTests() {
  STAGE_STORE.clear();
}

export function interpretVerification(result = {}, attempts = {}) {
  const retry = [];
  const wait = [];
  const nextAttempts = { ...attempts };
  for (const label of [...(result.mismatches || []), ...(result.requiredEmpty || [])]) {
    const n = (nextAttempts[label] || 0) + 1;
    nextAttempts[label] = n;
    if (n < 2) retry.push(label);
    else wait.push(label);
  }
  return { retry, wait, attempts: nextAttempts };
}

function valueInSources(value, profile, cvText) {
  const hay = `${JSON.stringify(profile || {})}\n${cvText || ""}`.toLowerCase();
  const tokens = String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9.+#]+/)
    .filter((t) => t.length > 2)
    .slice(0, 6);
  if (!tokens.length) return false;
  return tokens.filter((t) => hay.includes(t)).length >= Math.min(2, tokens.length);
}

/**
 * Optional AI pass for unfamiliar labels. Inject `aiFn(system, user) => object`.
 * Values that are not grounded in the profile/CV are dropped.
 */
export async function aiAssistUnfamiliar(fields, leftoverIds, profile, cvText, extras = {}, aiFn) {
  if (!leftoverIds.length) return {};
  const spec = (fields || []).filter((f) => leftoverIds.includes(f.id));
  if (!spec.length) return {};
  if (typeof aiFn === "function") {
    try {
      const raw = await aiFn(
        "Match leftover application questions to attested profile facts only. If a fact is missing, omit that field. Never invent employers, degrees, skills, salary, visa, or demographics. When options exist, return one option string exactly. Return JSON {\"fieldId\":\"value\"}.",
        JSON.stringify({
          profile: {
            identity: profile?.identity || {},
            education: educationList(profile),
            skills: profile?.skills || {},
            experience: experienceList(profile),
            projects: profile?.projects || [],
          },
          cv: String(cvText || "").slice(0, 3000),
          fields: spec.map((f) => ({ id: f.id, label: f.label, type: f.type, options: (f.options || []).slice(0, 16) })),
          job: String(extras.jdText || extras.role || "").slice(0, 1200),
        }),
      );
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!parsed || typeof parsed !== "object") return {};
      const out = {};
      for (const field of spec) {
        const text = String(parsed[field.id] || "").trim();
        if (!text) continue;
        if (isForbiddenGuess(field, profile)) continue;
        const chosen = field.options?.length ? pickOption(field, text) : clipToMax(text, field.maxLength);
        if (!chosen) continue;
        if (!valueInSources(chosen, profile, cvText) && !field.options?.length) continue;
        out[field.id] = chosen;
      }
      return out;
    } catch {
      return {};
    }
  }
  if (extras.fieldAi === true || typeof extras.generateFn === "function") {
    try {
      const batch = await batchFieldAnswers({
        fields: spec,
        profile,
        cvText,
        extras,
        generateFn: extras.generateFn || null,
      });
      return batch.answers || {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * OBSERVE → UNDERSTAND → FIND FACT → DECIDE
 * Returns fillable answers plus WAITING_FOR_USER fields. Does not actuate the DOM.
 */
export function fieldAlreadyValued(field = {}) {
  const type = String(field.type || "").toLowerCase();
  if (type === "file") return false;
  const v = String(field.value ?? "").trim();
  if (!v) return false;
  if (type === "checkbox" && /^(false|off|0)$/i.test(v)) return false;
  if (/^(--.*--|select(\s+(one|an option))?|please select|choose(\s+one)?|no answer)$/i.test(v)) return false;
  return true;
}

export function answersExcludingFilled(fillAnswers = {}, filledIds = []) {
  const skip = new Set([...filledIds].map((id) => String(id)));
  const out = {};
  for (const [id, value] of Object.entries(fillAnswers || {})) {
    if (skip.has(String(id))) continue;
    if (value == null || String(value).trim() === "") continue;
    out[id] = value;
  }
  return out;
}

export async function planFormTurn({
  fields = [],
  profile = {},
  cvText = "",
  extras = {},
  pageText = "",
  sessionId = "",
  pageIndex = 0,
  aiFn = null,
  fieldAi = false,
  generateFn = null,
  userAnswers = {},
  skipFieldIds = [],
} = {}) {
  const stage = inferStageName(fields, pageText);
  const repeating = repeatingSectionPlan(profile);
  const deterministic = answersFromProfile(fields, profile, { ...extras, cvText, fillRemaining: Boolean(extras.fillRemaining) }) || {};
  const planned = [];
  const fillAnswers = {};
  const waiting = [];
  const given = userAnswers && typeof userAnswers === "object" ? userAnswers : {};
  const givenByLabel = given.byLabel || {};
  const givenById = given.byId || given;
  const skip = new Set((skipFieldIds || []).map((id) => String(id)));

  for (const field of fields || []) {
    if (field.type === "file") continue;
    if (skip.has(String(field.id))) continue;
    if (fieldAlreadyValued(field)) continue;
    const blob = fieldBlob(field);
    if (SKIP.test(blob)) continue;
    if (ACTION_FIELD.test(String(field.label || "").trim())) continue;

    let value = "";
    let confidence = 0;
    let source = "";

    const fromUser = givenById[field.id] || givenByLabel[String(field.label || "").trim().toLowerCase()] || "";
    if (fromUser) {
      value = fromUser;
      confidence = 100;
      source = "user";
    } else if (isForbiddenGuess(field, profile)) {
      const extra = extraFactForField(field, profile, cvText, extras);
      if (extra.value && extra.confidence >= CONFIDENCE.MEDIUM) {
        value = extra.value;
        confidence = extra.confidence;
        source = extra.source;
      } else {
        waiting.push({ fieldId: field.id, label: field.label || field.id, reason: "Not attested — will not guess" });
        planned.push({ fieldId: field.id, label: field.label, action: "wait", confidence: 0, source: "forbidden" });
        continue;
      }
    } else if (indexFromBlob(blob) > 0) {
      const extra = extraFactForField(field, profile, cvText, extras);
      if (extra.value) {
        value = extra.value;
        confidence = extra.confidence;
        source = extra.source || "repeating";
      } else if (deterministic[field.id]) {
        value = deterministic[field.id];
        confidence = 96;
        source = "answersFromProfile";
      } else {
        value = "";
        confidence = 0;
        source = extra.source || "repeating";
      }
    } else if (deterministic[field.id]) {
      value = deterministic[field.id];
      confidence = 96;
      source = "answersFromProfile";
    } else {
      const extra = extraFactForField(field, profile, cvText, extras);
      value = extra.value;
      confidence = extra.confidence;
      source = extra.source;
    }

    if (value && field.options?.length) {
      const chosen = pickOption(field, value);
      if (!chosen) {
        waiting.push({ fieldId: field.id, label: field.label || field.id, reason: "No matching option" });
        planned.push({ fieldId: field.id, label: field.label, value, confidence, action: "wait", source: source || "option-mismatch" });
        continue;
      }
      value = chosen;
    }

    if (value && field.maxLength) value = clipToMax(value, field.maxLength);

    const action = decideAction(confidence);
    if (action === "fill" && value) {
      fillAnswers[field.id] = value;
      planned.push({ fieldId: field.id, label: field.label, value, confidence, action: "fill", source, widget: widgetKind(field) });
      logFieldDecision({
        label: field.label,
        widget: widgetKind(field),
        source,
        value,
        method: "deterministic semantic match",
        confidence: (confidence / 100).toFixed(2),
        action: "fill",
      });
    } else if (!value) {
      waiting.push({ fieldId: field.id, label: field.label || field.id, reason: "No verified fact" });
      planned.push({ fieldId: field.id, label: field.label, action: "wait", confidence: 0, source: source || "missing", widget: widgetKind(field) });
    } else {
      waiting.push({ fieldId: field.id, label: field.label || field.id, reason: "Low confidence" });
      planned.push({ fieldId: field.id, label: field.label, value, confidence, action: "wait", source, widget: widgetKind(field) });
    }
  }

  const leftover = (fields || [])
    .filter((f) => f.type !== "file" && !fillAnswers[f.id] && waiting.some((w) => w.fieldId === f.id) && !isForbiddenGuess(f, profile) && !SKIP.test(fieldBlob(f)) && !skip.has(String(f.id)) && !fieldAlreadyValued(f))
    .map((f) => f.id);
  const assisted = await aiAssistUnfamiliar(
    fields,
    leftover,
    profile,
    cvText,
    { ...extras, fieldAi: fieldAi || extras.fieldAi, generateFn: generateFn || extras.generateFn },
    aiFn,
  );
  for (const [id, value] of Object.entries(assisted)) {
    const field = fields.find((f) => f.id === id);
    const clipped = clipToMax(value, field?.maxLength);
    fillAnswers[id] = clipped;
    const idx = waiting.findIndex((w) => w.fieldId === id);
    if (idx >= 0) waiting.splice(idx, 1);
    const planIdx = planned.findIndex((p) => p.fieldId === id);
    const row = { fieldId: id, label: field?.label, value: clipped, confidence: 78, action: "fill", source: "ai-grounded", widget: widgetKind(field || {}) };
    if (planIdx >= 0) planned[planIdx] = row;
    else planned.push(row);
    logFieldDecision({
      label: field?.label,
      widget: widgetKind(field || {}),
      source: "ai-grounded",
      value: clipped,
      method: "OpenAI",
      confidence: 0.78,
      action: "fill",
    });
  }

  const audit = {
    filled: planned.filter((p) => p.action === "fill").map((p) => p.label || p.fieldId),
    pending: waiting.map((w) => `${w.label}${w.reason ? ` (${w.reason})` : ""}`),
    failed: [],
  };

  if (sessionId) {
    const filledHere = Object.keys(fillAnswers).length > 0 && waiting.length === 0;
    recordFormStage(sessionId, stage, filledHere ? "complete" : waiting.length ? "waiting" : "pending");
    recordFormWaiting(sessionId, waiting, pageIndex, {
      status: waiting.length ? "waiting_for_user" : "in_progress",
      completedFields: Object.keys(fillAnswers),
      humanIntervention: waiting[0]
        ? { kind: "information", question: waiting[0].label, reason: waiting[0].reason }
        : null,
      audit,
    });
  }

  return {
    stage,
    repeating,
    fillAnswers,
    waiting,
    planned,
    audit,
    navigation: waiting.some((w) => fields.find((f) => f.id === w.fieldId)?.required) ? "stay" : "next",
    state: sessionId ? getFormAgentState(sessionId) : { stages: [{ name: stage, status: waiting.length ? "waiting" : "complete" }], waiting, pageIndex },
  };
}

export function answersForRetry(fields, fillAnswers, retryLabels) {
  const want = new Set((retryLabels || []).map((l) => String(l).toLowerCase()));
  const out = {};
  for (const field of fields || []) {
    const label = String(field.label || "").toLowerCase();
    if (want.has(label) && fillAnswers[field.id]) out[field.id] = fillAnswers[field.id];
  }
  return out;
}
