/**
 * field-classifier.mjs — Semantic application-field intent.
 * Does not invent answers. UNKNOWN stays UNKNOWN.
 */

import { categorizeQuestion, isSensitiveCategory } from "../../application-generator.mjs";

export const FIELD_INTENT = Object.freeze({
  MOTIVATION_QUESTION: "MOTIVATION_QUESTION",
  WORK_AUTHORIZATION: "WORK_AUTHORIZATION",
  SPONSORSHIP: "SPONSORSHIP",
  SALARY: "SALARY",
  DEMOGRAPHIC: "DEMOGRAPHIC",
  DISABILITY: "DISABILITY",
  CRIMINAL_LEGAL: "CRIMINAL_LEGAL",
  CITIZENSHIP: "CITIZENSHIP",
  RELOCATION: "RELOCATION",
  NAME: "NAME",
  EMAIL: "EMAIL",
  PHONE: "PHONE",
  LOCATION: "LOCATION",
  UNIVERSITY: "UNIVERSITY",
  DEGREE: "DEGREE",
  GRADUATION: "GRADUATION",
  GPA: "GPA",
  LINKEDIN: "LINKEDIN",
  GITHUB: "GITHUB",
  AVAILABILITY: "AVAILABILITY",
  EXPERIENCE: "EXPERIENCE",
  SKILLS: "SKILLS",
  COVER_LETTER_TEXT: "COVER_LETTER_TEXT",
  COVER_LETTER_UPLOAD: "COVER_LETTER_UPLOAD",
  CV_UPLOAD: "CV_UPLOAD",
  FILE_UPLOAD: "FILE_UPLOAD",
  UNKNOWN: "UNKNOWN",
});

const CATEGORY_TO_INTENT = Object.freeze({
  work_authorization: FIELD_INTENT.WORK_AUTHORIZATION,
  sponsorship: FIELD_INTENT.SPONSORSHIP,
  salary: FIELD_INTENT.SALARY,
  demographic: FIELD_INTENT.DEMOGRAPHIC,
  disability: FIELD_INTENT.DISABILITY,
  criminal_legal: FIELD_INTENT.CRIMINAL_LEGAL,
  citizenship: FIELD_INTENT.CITIZENSHIP,
  relocation: FIELD_INTENT.RELOCATION,
  name: FIELD_INTENT.NAME,
  email: FIELD_INTENT.EMAIL,
  phone: FIELD_INTENT.PHONE,
  location: FIELD_INTENT.LOCATION,
  university: FIELD_INTENT.UNIVERSITY,
  degree: FIELD_INTENT.DEGREE,
  graduation: FIELD_INTENT.GRADUATION,
  gpa: FIELD_INTENT.GPA,
  linkedin: FIELD_INTENT.LINKEDIN,
  github: FIELD_INTENT.GITHUB,
  availability: FIELD_INTENT.AVAILABILITY,
  why_company: FIELD_INTENT.MOTIVATION_QUESTION,
  experience: FIELD_INTENT.EXPERIENCE,
  skills: FIELD_INTENT.SKILLS,
  cover_text: FIELD_INTENT.COVER_LETTER_TEXT,
  unknown: FIELD_INTENT.UNKNOWN,
});

function fieldBlob(field = {}) {
  return [
    field.label,
    field.name,
    field.id,
    field.accessibleName,
    field.ariaLabel,
    field.placeholder,
    field.surroundingText,
    field.type,
  ]
    .filter(Boolean)
    .join(" ");
}

export function classifyFileIntent(field = {}) {
  const blob = fieldBlob(field);
  if (/cover\s*letter|motivation\s*letter|letter\s+of\s+interest/i.test(blob)) {
    return FIELD_INTENT.COVER_LETTER_UPLOAD;
  }
  if (/\bresume\b|\bcv\b|curriculum\s+vitae/i.test(blob)) {
    return FIELD_INTENT.CV_UPLOAD;
  }
  return FIELD_INTENT.FILE_UPLOAD;
}

/**
 * Classify a form field from labels, accessible names, surrounding text, and type.
 * @returns {{ intent: string, category: string, isSensitive: boolean, questionText: string }}
 */
export function classifyApplicationField(field = {}) {
  const type = String(field.type || "").toLowerCase();
  const questionText = [field.label, field.accessibleName, field.ariaLabel, field.surroundingText, field.name]
    .filter(Boolean)
    .join(" ")
    .trim() || String(field.name || field.id || "");

  if (type === "file") {
    const intent = classifyFileIntent({ ...field, label: questionText });
    return { intent, category: intent === FIELD_INTENT.CV_UPLOAD ? "cv_file" : intent === FIELD_INTENT.COVER_LETTER_UPLOAD ? "cover_file" : "file", isSensitive: false, questionText };
  }

  if (/why\s+do\s+you\s+want\s+to\s+join\s+(our\s+)?team/i.test(questionText) || /motivation/i.test(questionText)) {
    return { intent: FIELD_INTENT.MOTIVATION_QUESTION, category: "why_company", isSensitive: false, questionText };
  }

  const { category, isSensitive } = categorizeQuestion(questionText);
  const intent = CATEGORY_TO_INTENT[category] || FIELD_INTENT.UNKNOWN;
  return {
    intent,
    category,
    isSensitive: isSensitive || isSensitiveCategory(category),
    questionText,
  };
}

export function isSensitiveIntent(intent) {
  return [
    FIELD_INTENT.WORK_AUTHORIZATION,
    FIELD_INTENT.SPONSORSHIP,
    FIELD_INTENT.SALARY,
    FIELD_INTENT.DEMOGRAPHIC,
    FIELD_INTENT.DISABILITY,
    FIELD_INTENT.CRIMINAL_LEGAL,
    FIELD_INTENT.CITIZENSHIP,
    FIELD_INTENT.RELOCATION,
  ].includes(intent);
}

const INTENT_VALUES = new Set(Object.values(FIELD_INTENT));

function parseJsonArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.fields)) return raw.fields;
  const text = typeof raw === "string" ? raw : JSON.stringify(raw || "");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * AI-assisted classification for fields the deterministic classifier left UNKNOWN.
 * The model may only return an intent enum. It must not invent answers.
 */
export async function classifyUnknownFieldsWithAI(fields, callAIFn) {
  if (typeof callAIFn !== "function" || !Array.isArray(fields) || fields.length === 0) return new Map();
  const unknown = fields.filter((f) => f.intent === FIELD_INTENT.UNKNOWN || f.classification?.intent === FIELD_INTENT.UNKNOWN);
  const payload = unknown.map((f) => ({
    id: f.id || f.name,
    label: f.label || f.accessibleName || "",
    name: f.name || "",
    type: f.type || "",
    surroundingText: String(f.surroundingText || "").slice(0, 180),
  }));
  if (!payload.length) return new Map();

  const system =
    "You classify job-application form fields. Return JSON only: an array of {id, intent}. " +
    `intent must be one of: ${Object.values(FIELD_INTENT).join(", ")}. ` +
    "Do not invent candidate answers. Do not guess WORK_AUTHORIZATION or other sensitive intents unless the label clearly asks that. If unsure, use UNKNOWN.";
  const user = JSON.stringify(payload);

  let raw;
  try {
    raw = await callAIFn(null, system, user);
  } catch {
    try {
      raw = await callAIFn({ prompt: user, system, schema: true });
    } catch {
      return new Map();
    }
  }

  const map = new Map();
  for (const row of parseJsonArray(raw)) {
    const id = row?.id;
    const intent = String(row?.intent || "").toUpperCase();
    if (!id || !INTENT_VALUES.has(intent)) continue;
    map.set(String(id), intent);
  }
  return map;
}
