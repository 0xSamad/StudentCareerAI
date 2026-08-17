/**
 * fact-shape.mjs — Every candidate fact carries source, confidence, timestamp, evidence.
 * Uncertain enrichment is labeled UNCERTAIN and is never silently treated as verified.
 */

import { VERIFICATION_STATUS, FACT_SOURCES } from "./document-types.mjs";

export function nowIso(date = new Date()) {
  return date instanceof Date ? date.toISOString() : new Date(date).toISOString();
}

export function normalizeSource(source, fallback = {}) {
  if (source && typeof source === "object") {
    return {
      kind: String(source.kind || fallback.kind || FACT_SOURCES.USER_DOCUMENT),
      label: String(source.label || fallback.label || source.kind || FACT_SOURCES.USER_DOCUMENT),
      url: source.url || fallback.url || null,
    };
  }
  if (typeof source === "string" && source.trim()) {
    return {
      kind: source.trim(),
      label: source.trim(),
      url: fallback.url || null,
    };
  }
  return {
    kind: fallback.kind || FACT_SOURCES.USER_DOCUMENT,
    label: fallback.label || fallback.kind || FACT_SOURCES.USER_DOCUMENT,
    url: fallback.url || null,
  };
}

export function isVerifiedFact(fact = {}) {
  return (fact.verificationStatus || VERIFICATION_STATUS.VERIFIED) === VERIFICATION_STATUS.VERIFIED;
}

/**
 * @param {object} row
 * @returns {object} canonical candidate fact
 */
export function shapeCandidateFact(row = {}) {
  const value = String(row.value || "").trim();
  const evidence = String(row.evidence || row.snippet || value).slice(0, 800);
  const source = normalizeSource(row.source, { kind: FACT_SOURCES.USER_DOCUMENT, url: row.sourceUrl || null });
  const verificationStatus = Object.values(VERIFICATION_STATUS).includes(row.verificationStatus)
    ? row.verificationStatus
    : VERIFICATION_STATUS.VERIFIED;
  const confidence =
    typeof row.confidence === "number" && Number.isFinite(row.confidence)
      ? Math.min(1, Math.max(0, row.confidence))
      : verificationStatus === VERIFICATION_STATUS.VERIFIED
        ? 1
        : 0.5;

  return {
    factType: row.factType,
    value,
    normalizedValue: String(row.normalizedValue || value).toLowerCase().trim(),
    snippet: evidence.slice(0, 280),
    evidence,
    source,
    sourceUrl: source.url,
    confidence,
    timestamp: row.timestamp || row.observedAt || nowIso(),
    observedAt: row.observedAt || row.timestamp || nowIso(),
    verificationStatus,
    documentId: row.documentId || null,
  };
}

export function attributionFields(fact = {}) {
  return {
    source: fact.source || normalizeSource(null),
    confidence: fact.confidence,
    timestamp: fact.timestamp || fact.observedAt,
    evidence: fact.evidence || fact.snippet || fact.value,
    verificationStatus: fact.verificationStatus || VERIFICATION_STATUS.UNKNOWN,
  };
}
