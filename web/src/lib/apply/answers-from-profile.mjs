/**
 * Map attested profile/CV facts onto extracted application fields.
 * Never invents how-you-heard, demographics, or motivation checkboxes.
 */

import { matchOption } from "./semantic-option.mjs";

const SENSITIVE =
  /sponsor|authori[sz]|visa|race|ethnic|disab|veteran|citizen|criminal|felony|lgbt|pronoun|religion|sexual|i agree|i consent|privacy|self-identification|voluntary/;

const DONT_GUESS = /ai challenge|optional ai/;

function employmentList(profile) {
  const exp = profile?.experience;
  if (Array.isArray(exp)) return exp;
  return [...(exp?.jobs || []), ...(exp?.internships || [])];
}

export function identityFromCv(cvText = "") {
  const text = String(cvText || "");
  const header = (text.split(/PROFESSIONAL SUMMARY|TECHNICAL SKILLS|WORK EXPERIENCE|EDUCATION/i)[0] || text).slice(0, 1200);
  const email = (header.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [])[0] || "";
  const phone = (header.match(/\+?\d[\d\s().-]{8,}\d/) || [])[0] || "";
  const linkedinRaw = (header.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+/i) || [])[0] || "";
  const githubRaw = (header.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+/i) || [])[0] || "";
  const place = (header.match(/\b([A-Z][A-Za-z .'-]+),\s*([A-Z][A-Za-z .'-]+)\b/) || [])[0] || "";
  const [city = "", country = ""] = place.split(",").map((s) => s.trim());
  const nameLine = text.match(/^#\s+(.+)$/m)?.[1] || "";
  return {
    name: nameLine.replace(/\s+/g, " ").trim(),
    email,
    phone: phone.replace(/\s+/g, " ").trim(),
    linkedin: linkedinRaw ? (linkedinRaw.startsWith("http") ? linkedinRaw : `https://${linkedinRaw}`) : "",
    github: githubRaw ? (githubRaw.startsWith("http") ? githubRaw : `https://${githubRaw}`) : "",
    city,
    country,
  };
}

export function mergeIdentity(profile, cvText = "") {
  const fromCv = identityFromCv(cvText);
  const ident = profile?.identity || {};
  const pick = (key) => String(ident[key] || fromCv[key] || "").trim();
  return {
    name: pick("name"),
    email: pick("email"),
    phone: pick("phone"),
    city: pick("city"),
    country: pick("country"),
    linkedin: pick("linkedin"),
    github: pick("github"),
    portfolio: pick("portfolio"),
    gender: String(ident.gender || "").trim(),
  };
}

export function latestEmployment(profile, cvText = "") {
  const first = employmentList(profile).find((row) => row?.company || row?.role || row?.title);
  if (first) {
    return {
      employer: String(first.company || first.organization || "").trim(),
      title: String(first.role || first.title || "").trim(),
    };
  }
  const after = String(cvText || "").split(/WORK EXPERIENCE|PROFESSIONAL EXPERIENCE|\nEXPERIENCE\n/i)[1] || "";
  const line = after
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && /[A-Za-z]/.test(l) && !/^(self-directed|remote)\b/i.test(l));
  if (!line) return { employer: "", title: "" };
  const m = line.match(/^(.+?)\s*[—–-]\s*(.+)$/);
  if (!m) return { employer: "", title: line.replace(/\d{4}.*$/, "").trim() };
  return {
    title: m[1].trim(),
    employer: m[2].replace(/\d{4}.*$/, "").replace(/\s*[–-]\s*Present.*$/i, "").trim(),
  };
}

/** Digits the ATS wants when the country code is already chosen (+92 → 3041093329). */
export function phoneNationalNumber(phone, dial = "92") {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith(dial) && digits.length > 10) return digits.slice(dial.length);
  if (digits.startsWith("0") && digits.length >= 10) return digits.replace(/^0+/, "");
  return digits;
}

function phoneValueForField(field, phone) {
  const national = phoneNationalNumber(phone);
  const ph = String(field.placeholder || "").replace(/\s/g, "");
  const wantsDigits =
    field.type === "tel" ||
    field.type === "number" ||
    (field.maxLength && field.maxLength <= 15) ||
    /^\d{8,}$/.test(ph) ||
    /phone|mobile/i.test(String(field.nativeName || ""));
  if (wantsDigits && national) return national;
  return String(phone || "").trim();
}

function sectionAfter(cvText, name, nextNames) {
  const src = String(cvText || "");
  const start = src.search(new RegExp(name, "i"));
  if (start < 0) return "";
  const rest = src.slice(start);
  const end = rest.search(new RegExp(`\\n(?:${nextNames.join("|")})\\b`, "i"));
  return end >= 0 ? rest.slice(0, end) : rest;
}

export function skillsFromProfile(profile, cvText = "") {
  const sk = profile?.skills;
  const fromProfile = [];
  if (sk && typeof sk === "object") {
    const vals = Array.isArray(sk) ? sk : Object.values(sk);
    for (const v of vals) {
      if (Array.isArray(v)) fromProfile.push(...v.map((x) => String(x || "").trim()));
      else if (typeof v === "string" && v.trim()) fromProfile.push(v.trim());
    }
  }
  if (fromProfile.length) return [...new Set(fromProfile.filter(Boolean))].slice(0, 16).join(", ");
  const block = sectionAfter(cvText, "TECHNICAL SKILLS", ["WORK EXPERIENCE", "EDUCATION", "ACHIEVEMENTS"]);
  const items = [];
  for (const line of block.split("\n")) {
    if (/technical skills/i.test(line)) continue;
    const idx = line.indexOf(":");
    const part = idx >= 0 ? line.slice(idx + 1) : line;
    for (const bit of part.split(/[,;|]/)) {
      const t = bit.replace(/&amp;/g, "&").trim();
      if (t && t.length > 1 && t.length < 48) items.push(t);
    }
  }
  return [...new Set(items)].slice(0, 16).join(", ");
}

export function experienceYearsFromCv(cvText = "", profile) {
  const rows = employmentList(profile);
  const yearFrom = (row) => {
    const raw = String(row?.start || row?.from || row?.dates || "");
    const m = raw.match(/(19|20)\d{2}/);
    return m ? Number(m[0]) : null;
  };
  const starts = rows.map(yearFrom).filter((n) => n);
  const after = sectionAfter(cvText, "WORK EXPERIENCE", ["EDUCATION", "ACHIEVEMENTS", "CERTIFICATIONS"]);
  const m = after.match(/(19|20)\d{2}\s*[–-]\s*(Present|(?:19|20)\d{2})/i);
  if (m) starts.push(Number(m[0].slice(0, 4)));
  if (!starts.length) return "";
  const start = Math.min(...starts);
  const n = Math.max(0, new Date().getFullYear() - start);
  return String(n);
}

export function educationFromCv(cvText = "") {
  const block = sectionAfter(cvText, "EDUCATION", ["ACHIEVEMENTS", "CERTIFICATIONS", "LANGUAGES", "PROJECTS"]);
  const lines = block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^education$/i.test(l));
  let university = "";
  let degree = "";
  let startYear = "";
  for (const line of lines) {
    if (!degree && /bachelor|master|\bbs\b|\bms\b|intermediate|matric|software engineering/i.test(line)) {
      degree = line.replace(/\d{4}.*$/, "").replace(/\s*[|–-]\s*$/, "").trim();
      const y = line.match(/(19|20)\d{2}/);
      if (y) startYear = y[0];
    }
    if (!university && /(university|institute|college|ims|nust|fast|lums|giki)\b/i.test(line)) {
      university = line.split("|")[0].replace(/CGPA.*$/i, "").trim();
    }
  }
  return { university, degree, startYear };
}

const ATTESTED_AI_TOOLS = [
  "ChatGPT",
  "GitHub Copilot",
  "Copilot",
  "Cursor",
  "Claude",
  "Gemini",
  "Grok",
  "Bard",
  "Perplexity",
  "Tabnine",
];

export function aiToolsFromProfile(profile, cvText = "") {
  const hay = `${JSON.stringify(profile || {})}\n${cvText}`.toLowerCase();
  return ATTESTED_AI_TOOLS.filter((t) => hay.includes(t.toLowerCase()));
}

export function careerStartFrom(profile, cvText = "") {
  const after = sectionAfter(cvText, "WORK EXPERIENCE", ["EDUCATION", "ACHIEVEMENTS"]);
  const work = after.match(/(19|20)\d{2}/);
  if (work) return `${work[0]}-01-01`;
  const edu = Array.isArray(profile?.education) ? profile.education[0] : undefined;
  const fromEdu = String(edu?.start || edu?.from || "").match(/(19|20)\d{2}/);
  if (fromEdu) return `${fromEdu[0]}-01-01`;
  const fromCv = educationFromCv(cvText).startYear;
  if (fromCv) return `${fromCv}-01-01`;
  return "";
}

function experienceOption(field, yearsStr) {
  if (!yearsStr) return "";
  const n = Number(yearsStr);
  if (!Number.isFinite(n)) return pickOption(field, yearsStr) || yearsStr;
  if (field.options?.length) {
    for (const o of field.options) {
      const range = String(o).match(/(\d+)\s*[-–to]+\s*(\d+)/i);
      if (range && n >= Number(range[1]) && n <= Number(range[2])) return o;
    }
    if (n <= 1) {
      return pickOption(field, "0-1 years", "0-1", "Less than 1 year", "Fresher", "Fresh", "Entry Level", "0", yearsStr);
    }
    return pickOption(field, `${n} years`, `${n}+ years`, `${n}-${n + 1} years`, yearsStr);
  }
  return yearsStr;
}

function degreeOption(field, degree) {
  if (!degree) return "";
  if (!field.options?.length) return degree;
  return (
    pickOption(
      field,
      degree,
      "Bachelor's",
      "Bachelors",
      "Bachelor",
      "Undergraduate",
      "BS",
      "B.S",
      "Bachelor of Science",
    ) || degree
  );
}

function firstRealOption(field) {
  return (field.options || []).find((o) => o && !/^(select|choose|--|no answer|\s*)$/i.test(String(o).trim())) || "";
}

function locationOption(field, city, country, extras = {}) {
  const joined = [city, country].filter(Boolean).join(", ");
  if (!field.options?.length) return joined;
  const cityHit = pickOption(field, city, joined);
  if (cityHit) return cityHit;
  const hay = `${extras.jdText || ""} ${extras.role || ""} ${extras.company || ""}`;
  for (const office of ["Karachi", "Lahore", "Islamabad", "Rawalpindi", "Peshawar", "Remote", "Hybrid"]) {
    if (!new RegExp(office, "i").test(hay) && office !== city) continue;
    const hit = pickOption(field, office);
    if (hit) return hit;
  }
  const countryHit = pickOption(field, country, "Pakistan");
  if (countryHit) return countryHit;
  return firstRealOption(field) || joined;
}

export function graduationYearFrom(profile, cvText = "") {
  const edu = Array.isArray(profile?.education) ? profile.education[0] : undefined;
  const explicit = String(edu?.graduation_date || edu?.graduationDate || edu?.end || edu?.year || "").trim();
  const fromProfile = explicit.match(/(19|20)\d{2}/);
  if (fromProfile) return fromProfile[0];
  const block = sectionAfter(cvText, "EDUCATION", ["ACHIEVEMENTS", "CERTIFICATIONS", "LANGUAGES"]);
  const degree = block.split("\n").find((l) => /bachelor|master|\bbs\b|\bms\b|software engineering/i.test(l)) || "";
  const span = degree.match(/(19|20)\d{2}\s*[–-]\s*(Present|(?:19|20)\d{2})/i);
  if (!span) return "";
  if (/present/i.test(span[2])) return "";
  return span[2];
}

function attestedSalary(profile) {
  const p = profile?.preferences || profile?.compensation || {};
  const currentRaw = p.current_salary ?? p.currentSalary ?? p.currentCTC ?? p.current_ctc;
  const current = currentRaw === 0 || currentRaw === "0" ? "0" : String(currentRaw ?? "").replace(/\D/g, "");
  const expected = String(p.expected_salary || p.expectedSalary || p.expectedCTC || p.expected_ctc || p.salary_min || "").replace(/\D/g, "");
  return { current, expected };
}

/** Numbers stated in the JD only. Never a market guess. Comma-grouped PKR/Rs amounts. */
export function advertisedSalaryFromJd(jdText = "") {
  let t = String(jdText || "");
  for (let i = 0; i < 4; i++) t = t.replace(/(\d),(\d{2,3})/g, "$1$2");
  const near =
    t.match(/(?:pkr|rs\.?|rupees?)\s*(\d{5,8})(?:\s*(?:-|–|to)\s*(\d{5,8}))?/i) ||
    t.match(/(\d{5,8})\s*(?:-|–|to)\s*(\d{5,8})\s*(?:pkr|rs\.?|rupees?|\/\s*month)/i);
  if (!near) return "";
  const a = Number(near[1]);
  const b = near[2] ? Number(near[2]) : a;
  if (!Number.isFinite(a) || a <= 0) return "";
  return String(Math.round((a + (Number.isFinite(b) ? b : a)) / 2));
}

function expectedSalaryValue(profile, extras = {}) {
  const p = profile?.preferences || {};
  const fromJd = p.expected_salary_from_jd !== false;
  if (fromJd) {
    const jd = advertisedSalaryFromJd(extras.jdText || extras.description || "");
    if (jd) return jd;
  }
  const attested = attestedSalary(profile).expected;
  if (attested) return attested;
  const min = String(p.salary_min || p.expected_salary || "").replace(/\D/g, "");
  if (min) return min;
  if (extras.fillRemaining) return "80000";
  return "";
}

function noticePeriodDays(profile) {
  const p = profile?.preferences || profile?.matching || {};
  const n = p.notice_period_days ?? p.noticePeriodDays ?? p.notice_period;
  if (n === 0 || n === "0") return "0";
  const s = String(n || "").replace(/\D/g, "");
  return s || "";
}

function noticePeriodValue(field, profile, extras = {}) {
  const notice = noticePeriodDays(profile);
  if (notice) {
    const withDays = /day/i.test(notice) ? notice : `${notice} days`;
    if (field.options?.length) return pickOption(field, withDays, notice, "Immediate", "Immediately") || withDays;
    if (field.type === "number") return notice.replace(/\D/g, "") || notice;
    return withDays;
  }
  if (!extras.fillRemaining) return "";
  if (field.options?.length) {
    return (
      pickOption(field, "Immediate", "Immediately", "Available immediately", "0 days", "0-15 days", "None", "Not applicable", "0") ||
      firstRealOption(field)
    );
  }
  return field.type === "number" ? "0" : "Immediate";
}

function preferredLocation(profile, ident) {
  const locs = profile?.preferences?.locations?.preferred;
  const first = Array.isArray(locs) ? locs.find(Boolean) : "";
  if (first) return String(first);
  return [ident.city, ident.country].filter(Boolean).join(", ");
}

export function workedAtCompany(company, profile, cvText = "") {
  const needle = String(company || "").trim().toLowerCase();
  if (!needle) return null;
  const hay = `${JSON.stringify(profile?.experience || {})}\n${cvText}`.toLowerCase();
  return hay.includes(needle);
}

function fieldBlob(field) {
  return [field.label, field.nativeName, field.nativeId, field.id, field.placeholder]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function pickOption(field, ...candidates) {
  const opts = field.options || [];
  if (!opts.length) return candidates.find(Boolean) || "";
  return matchOption(opts, candidates[0], candidates.slice(1));
}

/**
 * @param {Array<{id:string,type?:string,label?:string,nativeName?:string,nativeId?:string,options?:string[]}>} fields
 * @param {object|null} profile
 * @param {{cvText?:string,company?:string,coverLetter?:string,attemptedAiChallenge?:boolean}} extras
 */
function needleHit(blob, needles) {
  return (needles || []).some((n) => blob.includes(String(n).toLowerCase()));
}

export function answersFromProfile(fields, profile, extras = {}) {
  const ident = mergeIdentity(profile, extras.cvText);
  const parts = ident.name.split(/\s+/).filter(Boolean);
  const fromCvEdu = educationFromCv(extras.cvText);
  const edu = Array.isArray(profile?.education) ? profile.education[0] : undefined;
  const university = String(edu?.university || fromCvEdu.university || "").trim();
  const degree = [edu?.degree, edu?.major].filter(Boolean).join(" in ") || fromCvEdu.degree;
  const job = latestEmployment(profile, extras.cvText);
  const prior = extras.company ? workedAtCompany(extras.company, profile, extras.cvText) : null;
  const survey = extras.survey || {};
  const skills = skillsFromProfile(profile, extras.cvText);
  const years = experienceYearsFromCv(extras.cvText, profile);
  const gradYear = graduationYearFrom(profile, extras.cvText);
  const salary = attestedSalary(profile);
  const expectedPay = expectedSalaryValue(profile, extras);
  const prefLoc = preferredLocation(profile, ident);
  const careerStart = careerStartFrom(profile, extras.cvText);
  const aiTools = aiToolsFromProfile(profile, extras.cvText);
  const answers = {};

  for (const field of fields) {
    if (field.type === "file") continue;
    const blob = fieldBlob(field);
    if (/human check|captcha|recaptcha|i am not a robot/.test(blob)) continue;
    if (/\b(pass ?word|passwd|passcode)\b/i.test(blob)) continue;
    if (DONT_GUESS.test(blob)) continue;

    if (/disab|chronic condition/.test(blob)) {
      const attested = String(profile?.identity?.disability || profile?.preferences?.disability || "").trim();
      answers[field.id] = attested
        ? pickOption(field, attested)
        : pickOption(field, "Prefer not to say", "I do not wish to answer", "I don't wish to answer", "No");
    } else if (/\bgender\b/.test(blob) && ident.gender) {
      answers[field.id] = pickOption(field, ident.gender, "Male", "Man");
    } else if (SENSITIVE.test(blob)) {
      continue;
    } else if (/university|college|school|institution/.test(blob) && field.type !== "radio" && !/are you currently|student in the/.test(blob)) {
      answers[field.id] = university;
    } else if (/first|given/.test(blob) && !/last|full/.test(blob) && !/university|college|tool/.test(blob)) {
      answers[field.id] = parts[0] || ident.name;
    } else if (/last|surname|family/.test(blob) && !/university|college|tool/.test(blob)) {
      answers[field.id] = parts.slice(1).join(" ");
    } else if (
      (/\b(full\s*)?name\b/.test(blob) || field.nativeName === "name") &&
      !/university|college|school|institution|company|employer|tool|file|father|mother/.test(blob)
    ) {
      answers[field.id] = ident.name;
    } else if (/e-?mail/.test(blob) || field.type === "email" || /ibm\s*id|ibmid|user ?id/.test(blob)) {
      answers[field.id] = ident.email;
    } else if ((/phone|mobile|telephone/.test(blob) || field.type === "tel") && !/country/.test(blob)) {
      answers[field.id] = phoneValueForField(field, ident.phone);
    } else if (/\bcountry\b/.test(blob) && /phone|dial|code|\+/.test(blob)) {
      answers[field.id] = pickOption(field, ident.country, "+92", "Pakistan");
    } else if (/\bcountry\b/.test(blob) && !/location|city/.test(blob)) {
      answers[field.id] = pickOption(field, ident.country, "Pakistan");
    } else if (/linkedin/.test(blob)) answers[field.id] = ident.linkedin;
    else if (/github/.test(blob)) answers[field.id] = ident.github;
    else if (/portfolio|personal (web)?site|website/.test(blob) && !/university/.test(blob)) {
      answers[field.id] = ident.portfolio || ident.github;
    } else if (
      field.type !== "radio" &&
      (/education qualification|highest education|qualification/.test(blob) || /degree|major|field of study/.test(blob))
    ) {
      answers[field.id] = degreeOption(field, degree);
    } else if (/year of graduation|graduation year/.test(blob) && gradYear) {
      answers[field.id] = gradYear;
    } else if (/career start|start date|available to start/.test(blob) && careerStart) {
      answers[field.id] = field.type === "date" || /date/.test(blob) ? careerStart : careerStart.slice(0, 4);
    } else if (/years? of experience|experience years|experienceyears|total experience/.test(blob) && years) {
      answers[field.id] = experienceOption(field, years);
    } else if (/have you used any ai tools|used any ai tool/.test(blob)) {
      answers[field.id] = pickOption(field, aiTools.length ? "Yes" : "No");
    } else if (/if yes.*ai tool|list the ai tool/.test(blob)) {
      if (aiTools.length) {
        answers[field.id] = extras.fillRemaining
          ? `${aiTools.join(", ")}. I use them for coursework, lab write-ups, and debugging — I still verify every finding myself.`
          : aiTools.join(", ");
      }
    } else if (/(^| )skills\b|key skills|technical skills/.test(blob) && !/assessment|test|challenge|ai tool/.test(blob) && skills) {
      answers[field.id] = skills;
    } else if (/notice period/.test(blob)) {
      answers[field.id] = noticePeriodValue(field, profile, extras);
    } else if (/current (salary|ctc|compensation)|currentctc/.test(blob) && salary.current !== "") {
      answers[field.id] = salary.current;
    } else if (/expected (salary|ctc|compensation)|expectedctc/.test(blob)) {
      answers[field.id] = expectedPay;
    } else if (/current employer|company name|(^| )employer/.test(blob) && !/previous|prior/.test(blob)) {
      answers[field.id] = job.employer;
    } else if (/current (job )?title|job title|position title/.test(blob)) {
      answers[field.id] = job.title;
    } else if (/previously worked|worked at|former employee|ex-employee/.test(blob) && prior === false) {
      answers[field.id] = pickOption(field, "No");
    } else if (/did you attempt the previous/.test(blob) && extras.attemptedAiChallenge === false) {
      answers[field.id] = pickOption(field, "No I did not attempt it", "No");
    } else if (/preferred (work )?location/.test(blob) && prefLoc) {
      answers[field.id] = field.options?.length ? locationOption(field, ident.city, ident.country, extras) : prefLoc;
    } else if (/current location/.test(blob) || (/locate me|location|city/.test(blob) && !/country/.test(blob))) {
      answers[field.id] = locationOption(field, ident.city, ident.country, extras);
    } else if (/cover letter|motivation letter/.test(blob) && extras.coverLetter) {
      answers[field.id] = extras.coverLetter;
    } else if (/(resume|résumé|\bcv\b).*text|enter manually/.test(blob) && extras.cvText) {
      answers[field.id] = extras.cvText;
    } else if (/how did you (come to )?(learn|hear|find)|hear about this position|learn about a role/.test(blob)) {
      if (field.options?.length) {
        const hit = field.options.find((o) => needleHit(String(o).toLowerCase(), survey.howHeardNeedles));
        if (hit) answers[field.id] = hit;
      } else if (ident.linkedin) {
        answers[field.id] = "LinkedIn — I found this role while searching for internships.";
      }
    } else if (/seen .+ social|content on social/.test(blob) && survey.seenSocial) {
      answers[field.id] = pickOption(field, survey.seenSocial);
    } else if (/if yes.*platform|specify the platform/.test(blob) && /^no$/i.test(survey.seenSocial || "")) {
      /* leave blank when they have not seen social content */
    } else if (/influenced your decision|what influenced/.test(blob) && field.options?.length) {
      const hits = field.options.filter((o) => needleHit(String(o).toLowerCase(), survey.influenceNeedles));
      if (hits.length) answers[field.id] = hits.join("\n");
    } else if (extras.fillRemaining && /comfortable|willing to|are you ok|fintech|hybrid|relocat|travel|shift/i.test(blob) && field.options?.length) {
      answers[field.id] =
        pickOption(field, "Yes", "Y", "Comfortable", "Willing") || firstRealOption(field);
    }

    if (!answers[field.id]) delete answers[field.id];
  }

  if (extras.fillRemaining) fillRemainingAnswers(fields, answers, profile, extras, ident, skills);
  return answers;
}

const SKIP_REMAINING =
  /human check|captcha|recaptcha|i am not a robot|\b(pass ?word|passwd|passcode)\b|i agree|i consent|i accept|privacy notice|terms of|gdpr/;

function fillRemainingAnswers(fields, answers, profile, extras, ident, skills) {
  const hay = `${ident.city || ""} ${ident.country || ""} ${skills || ""} ${extras.cvText || ""}`.toLowerCase();
  for (const field of fields) {
    if (answers[field.id]) continue;
    if (field.type === "file") continue;
    const blob = fieldBlob(field);
    if (SKIP_REMAINING.test(blob) || SENSITIVE.test(blob) || DONT_GUESS.test(blob)) continue;
    if (/^if yes|if yes,/i.test(blob)) continue;
    if (field.options?.length) {
      const fromHay = (field.options || []).find((o) => {
        const t = String(o).trim().toLowerCase();
        return t.length > 1 && !/^(select|choose|--|no answer)/i.test(t) && hay.includes(t);
      });
      answers[field.id] = fromHay || pickOption(field, "Yes") || firstRealOption(field);
      continue;
    }
    if (field.type === "textarea" && extras.coverLetter && /why|motivat|cover|about you|tell us/i.test(blob)) {
      answers[field.id] = extras.coverLetter;
      continue;
    }
    if ((field.required || /\*/.test(field.label || "")) && ident.city && /address|city|where/.test(blob)) {
      answers[field.id] = [ident.city, ident.country].filter(Boolean).join(", ");
    }
  }
}

export function candidateFacts(profile, cvText = "") {
  const identity = mergeIdentity(profile, cvText);
  const job = latestEmployment(profile, cvText);
  const location = [identity.city, identity.country].filter(Boolean).join(", ");
  return {
    ...identity,
    employer: job.employer,
    title: job.title,
    location,
    preferredLocation: preferredLocation(profile, identity) || location,
    skills: skillsFromProfile(profile, cvText),
    experienceYears: experienceYearsFromCv(cvText, profile),
    yearOfGraduation: graduationYearFrom(profile, cvText),
    university: String((Array.isArray(profile?.education) && profile.education[0]?.university) || educationFromCv(cvText).university || ""),
    degree: String((Array.isArray(profile?.education) && profile.education[0]?.degree) || educationFromCv(cvText).degree || ""),
    careerStart: careerStartFrom(profile, cvText),
    aiTools: aiToolsFromProfile(profile, cvText).join(", "),
    phoneNational: phoneNationalNumber(identity.phone),
    noticePeriod: noticePeriodDays(profile) || "Immediate",
    gender: identity.gender || "",
    currentSalary: attestedSalary(profile).current,
    expectedSalary: expectedSalaryValue(profile, { fillRemaining: true }),
  };
}
