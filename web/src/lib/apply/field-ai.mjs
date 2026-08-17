/**
 * Batched, grounded field-answer AI. Server-side only.
 * Deterministic matching happens first; this runs only on leftover fields.
 * Never invents salary, visa, demographics, or employment.
 */

import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clipToMax, fieldCacheKey, matchOption } from "./semantic-option.mjs";

const SKIP =
  /human check|captcha|recaptcha|i am not a robot|\b(pass ?word|passwd|passcode)\b|sponsor|authori[sz]|visa|citizen|race|ethnic|disab|veteran|criminal|felony|religion|sexual|lgbt|pronoun|\bgender\b|salary|i agree|i consent/;

function fieldBlob(field = {}) {
  return [field.label, field.nativeName, field.nativeId, field.id, field.placeholder, field.nearbyText, field.ariaLabel]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const CACHE = new Map();

function profileBrief(profile, cvText = "", extras = {}) {
  const ident = profile?.identity || {};
  const edu = Array.isArray(profile?.education) ? profile.education[0] || {} : {};
  const jobs = [...(profile?.experience?.jobs || []), ...(profile?.experience?.internships || [])].slice(0, 3);
  const projects = (profile?.projects || []).slice(0, 3).map((p) => ({
    name: p.name,
    description: String(p.description || "").slice(0, 180),
    technologies: p.technologies || [],
  }));
  return {
    name: ident.name || "",
    email: ident.email || "",
    phone: ident.phone || "",
    city: ident.city || "",
    country: ident.country || "",
    linkedin: ident.linkedin || "",
    gender: ident.gender || "",
    university: edu.university || "",
    degree: [edu.degree, edu.major].filter(Boolean).join(" in "),
    gpa: edu.gpa ?? edu.cgpa ?? "",
    graduation: edu.graduation_date || edu.end || "",
    jobs: jobs.map((j) => ({ company: j.company, role: j.role || j.title })),
    projects,
    skills: profile?.skills || {},
    coverLetter: String(extras.coverLetter || "").slice(0, 1200),
    cv: String(cvText || "").slice(0, 2500),
    company: extras.company || "",
    role: extras.role || "",
  };
}

async function loadProvider() {
  try {
    const moduleUrl = pathToFileURL(join(ROOT, "lib", "saas", "ai", "http-chat-provider.mjs")).href;
    const { providerFromEnv } = await import(/* webpackIgnore: true */ moduleUrl);
    return providerFromEnv(process.env);
  } catch {
    return null;
  }
}

function grounded(value, profile, cvText, extras = {}) {
  const hay = `${JSON.stringify(profile || {})}\n${cvText || ""}\n${extras.coverLetter || ""}\n${extras.role || ""}\n${extras.company || ""}`.toLowerCase();
  const tokens = String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9.+#]+/)
    .filter((t) => t.length > 2 && !/^(the|and|for|you|your|this|that|with|from|have|want)$/.test(t))
    .slice(0, 8);
  if (!tokens.length) return false;
  return tokens.filter((t) => hay.includes(t)).length >= Math.min(2, tokens.length);
}

function parseAnswers(raw) {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (Array.isArray(parsed?.answers)) return parsed.answers;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return Object.entries(parsed).map(([id, value]) => ({
      id,
      action: value ? "fill" : "human_input_required",
      value,
      confidence: value ? 0.8 : 0.2,
      reason: "legacy-map",
    }));
  }
  return [];
}

export function resetFieldAiCacheForTests() {
  CACHE.clear();
}

/**
 * One OpenAI call for many leftover fields. Returns { [fieldId]: value }.
 */
export async function batchFieldAnswers({
  fields = [],
  profile = {},
  cvText = "",
  extras = {},
  generateFn = null,
} = {}) {
  const leftover = (fields || []).filter((f) => f?.id && f.type !== "file" && !SKIP.test(fieldBlob(f)));
  if (!leftover.length) return { answers: {}, model: "", cached: 0, called: false };

  const out = {};
  const need = [];
  for (const field of leftover) {
    const key = fieldCacheKey(field);
    if (CACHE.has(key)) {
      const cached = CACHE.get(key);
      if (cached) out[field.id] = cached;
      continue;
    }
    need.push(field);
  }
  if (!need.length) return { answers: out, model: "cache", cached: leftover.length, called: false };

  let provider = null;
  let model = "";
  let raw = "";
  if (typeof generateFn === "function") {
    raw = await generateFn(need, profileBrief(profile, cvText, extras));
    model = "injected";
  } else {
    provider = await loadProvider();
    if (!provider) return { answers: out, model: "", cached: leftover.length - need.length, called: false };
    model = provider.defaultModel || provider.name || "openai";
    raw = await provider.generateStructuredJSON({
      temperature: 0,
      systemPrompt: `You map leftover job-application fields to attested candidate facts.
Return JSON only: {"answers":[{"id":"...","action":"fill"|"select"|"skip"|"human_input_required","value":"","confidence":0.0,"reason":"..."}]}
Rules:
- Use ONLY the profile, CV excerpt, and cover letter. Never invent jobs, skills, GPA, salary, visa, citizenship, demographics, or metrics.
- If options exist, value MUST be one of those option strings exactly (semantic match allowed, then copy the option text).
- action=human_input_required when the fact is missing or confidence < 0.70.
- Sensitive/legal fields: always human_input_required unless the profile states them.
- Textareas: concise, truthful, grounded. Respect maxLength.
- Do not copy the job description. Do not use generic "I am thrilled" openers.`,
      userPrompt: JSON.stringify({
        profile: profileBrief(profile, cvText, extras),
        job: String(extras.jdText || "").slice(0, 1200),
        fields: need.map((f) => ({
          id: f.id,
          label: f.label || f.nativeName || f.id,
          type: f.type || "text",
          options: (f.options || []).slice(0, 24),
          maxLength: f.maxLength || undefined,
          nearbyText: String(f.nearbyText || "").slice(0, 180),
          placeholder: f.placeholder || "",
        })),
      }),
    });
  }

  const rows = parseAnswers(raw);
  for (const field of need) {
    const row = rows.find((r) => r.id === field.id);
    if (!row) continue;
    const action = String(row.action || "fill").toLowerCase();
    if (action === "skip" || action === "human_input_required") continue;
    let confidence = Number(row.confidence);
    if (!Number.isFinite(confidence)) confidence = 0;
    if (confidence > 1) confidence = confidence / 100;
    if (confidence < 0.7) continue;
    if (confidence < 0.9 && /sponsor|authori|visa|citizen|salary|race|ethnic|disab|veteran|criminal/i.test(fieldBlob(field))) {
      continue;
    }
    let value = String(row.value || "").trim();
    if (!value) continue;
    if (field.options?.length) {
      const chosen = matchOption(field.options, value);
      if (!chosen) continue;
      value = chosen;
    }
    value = clipToMax(value, field.maxLength);
    if (!field.options?.length && !grounded(value, profile, cvText, extras)) continue;
    out[field.id] = value;
    CACHE.set(fieldCacheKey(field), value);
  }

  return { answers: out, model, cached: leftover.length - need.length, called: true };
}

/** Adapter for planFormTurn({ aiFn }). */
export async function defaultFormAiFn(systemPrompt, userPrompt) {
  const provider = await loadProvider();
  if (!provider) return {};
  const text = await provider.generateStructuredJSON({
    temperature: 0,
    systemPrompt,
    userPrompt,
  });
  try {
    return typeof text === "string" ? JSON.parse(text) : text;
  } catch {
    return {};
  }
}
