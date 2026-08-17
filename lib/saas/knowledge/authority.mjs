/**
 * authority.mjs — What may be treated as an authoritative candidate fact.
 *
 * Only USER_SUPPLIED, TRUSTED_DOCUMENT, and USER_CONFIRMED are authoritative.
 * AI_GENERATED stays generated — never silently promoted to a user fact.
 */

import { VERIFICATION_STATUS, FACT_SOURCES } from "./document-types.mjs";
import { nowIso } from "./fact-shape.mjs";

export const AUTHORITY = Object.freeze({
  USER_SUPPLIED: "USER_SUPPLIED",
  TRUSTED_DOCUMENT: "TRUSTED_DOCUMENT",
  USER_CONFIRMED: "USER_CONFIRMED",
  GENERATED: "GENERATED",
});

export const AUTHORITATIVE = Object.freeze([
  AUTHORITY.USER_SUPPLIED,
  AUTHORITY.TRUSTED_DOCUMENT,
  AUTHORITY.USER_CONFIRMED,
]);

export const FEEDBACK_KIND = Object.freeze({
  CORRECTION: "CORRECTION",
  PREFERENCE: "PREFERENCE",
  ANSWER_APPROVED: "ANSWER_APPROVED",
  ANSWER_REJECTED: "ANSWER_REJECTED",
  ANSWER_CORRECTED: "ANSWER_CORRECTED",
  INTERVIEW_NOTE: "INTERVIEW_NOTE",
  CONFIRMATION: "CONFIRMATION",
  PROFILE_SYNC: "PROFILE_SYNC",
});

export const ANSWER_VERDICT = Object.freeze({
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CORRECTED: "CORRECTED",
});

const TRUSTED_SOURCE_KINDS = new Set([
  FACT_SOURCES.USER_DOCUMENT,
  FACT_SOURCES.PROFILE_SEED,
  FACT_SOURCES.LINKEDIN_USER_PROVIDED,
  FACT_SOURCES.PORTFOLIO_AUTHORIZED,
  FACT_SOURCES.WEBSITE_AUTHORIZED,
  FACT_SOURCES.GITHUB_PUBLIC_API,
  FACT_SOURCES.GITHUB_README,
  FACT_SOURCES.GITHUB_EVENTS,
]);

export function isAuthoritative(authority) {
  return AUTHORITATIVE.includes(authority);
}

export function isAuthoritativeItem(item = {}) {
  if (!item || typeof item !== "object") return false;
  if (item.authority) return isAuthoritative(item.authority);
  return item.verificationStatus === VERIFICATION_STATUS.VERIFIED && item.status !== "GENERATED";
}

export function authorityFromFact(fact = {}) {
  const kind = fact.source?.kind || fact.source || "";
  if (fact.authority && Object.values(AUTHORITY).includes(fact.authority)) return fact.authority;
  if (TRUSTED_SOURCE_KINDS.has(kind) && fact.verificationStatus !== VERIFICATION_STATUS.UNCERTAIN) {
    return AUTHORITY.TRUSTED_DOCUMENT;
  }
  if (kind === "user_supplied" || kind === "user-correction" || kind === "user-feedback") {
    return AUTHORITY.USER_SUPPLIED;
  }
  if (kind === "user-confirmed") return AUTHORITY.USER_CONFIRMED;
  if (fact.verificationStatus === VERIFICATION_STATUS.VERIFIED && TRUSTED_SOURCE_KINDS.has(kind)) {
    return AUTHORITY.TRUSTED_DOCUMENT;
  }
  return AUTHORITY.GENERATED;
}

export function attributedValue(value, meta = {}) {
  const authority = Object.values(AUTHORITY).includes(meta.authority)
    ? meta.authority
    : AUTHORITY.GENERATED;
  const authoritative = isAuthoritative(authority);
  const confidence =
    typeof meta.confidence === "number" && Number.isFinite(meta.confidence)
      ? Math.min(1, Math.max(0, meta.confidence))
      : authoritative
        ? 1
        : 0.4;
  const source =
    meta.source && typeof meta.source === "object"
      ? {
          kind: meta.source.kind || "generated",
          label: meta.source.label || meta.source.kind || "generated",
          url: meta.source.url || null,
        }
      : {
          kind: typeof meta.source === "string" ? meta.source : authoritative ? "user" : "generated",
          label: typeof meta.source === "string" ? meta.source : authoritative ? "User-provided" : "AI-generated",
          url: meta.sourceUrl || null,
        };

  return {
    value,
    authority,
    source,
    confidence,
    timestamp: meta.timestamp || meta.observedAt || nowIso(),
    evidence: meta.evidence || meta.snippet || null,
    verificationStatus: authoritative
      ? VERIFICATION_STATUS.VERIFIED
      : meta.verificationStatus || VERIFICATION_STATUS.UNCERTAIN,
  };
}

export function valuesOf(items = [], { authoritativeOnly = false } = {}) {
  const out = [];
  for (const item of items || []) {
    if (authoritativeOnly && !isAuthoritativeItem(item)) continue;
    const value = item && typeof item === "object" ? item.value : item;
    if (value == null || value === "") continue;
    out.push(value);
  }
  return out;
}

export function uniqueAttributed(items = []) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const value = item && typeof item === "object" ? String(item.value || "").trim() : String(item || "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    const existing = seen.has(key) ? out.find((x) => String(x.value).toLowerCase() === key) : null;
    if (existing) {
      if (isAuthoritativeItem(item) && !isAuthoritativeItem(existing)) {
        const idx = out.indexOf(existing);
        out[idx] = item && typeof item === "object" ? item : attributedValue(value);
      }
      continue;
    }
    seen.add(key);
    out.push(item && typeof item === "object" && "authority" in item ? item : attributedValue(value, item || {}));
  }
  return out;
}
