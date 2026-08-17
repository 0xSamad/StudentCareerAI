/**
 * linkedin-enricher.mjs — LinkedIn is user-authorized paste/export only.
 * Never fetches linkedin.com (auth walls, CAPTCHA, ToS).
 */

import { EVIDENCE_STATUS, FACT_SOURCES, VERIFICATION_STATUS } from "./document-types.mjs";
import { extractCandidateFacts } from "./fact-extractor.mjs";
import { shapeCandidateFact, nowIso } from "./fact-shape.mjs";

function withHttps(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw.replace(/^\/\//, "")}`;
}

export function isLinkedInUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const u = new URL(withHttps(raw));
    return /(^|\.)linkedin\.com$/i.test(u.hostname) || /^lnkd\.in$/i.test(u.hostname);
  } catch {
    return /linkedin\.com\/in\//i.test(raw);
  }
}

export function parseLinkedInSlug(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const u = new URL(withHttps(raw));
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex((p) => /^(in|pub)$/i.test(p));
    const slug = idx >= 0 ? parts[idx + 1] : null;
    return slug ? decodeURIComponent(slug).replace(/\/+$/, "") : null;
  } catch {
    const m = raw.match(/linkedin\.com\/(?:in|pub)\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]) : null;
  }
}

function canonicalLinkedInUrl(value = "") {
  const raw = String(value || "").trim();
  if (!isLinkedInUrl(raw)) return "";
  try {
    const u = new URL(withHttps(raw));
    u.hash = "";
    return u.toString();
  } catch {
    return withHttps(raw);
  }
}

/**
 * @param {{ url?: string, text?: string }} input
 */
export function enrichLinkedIn(input = {}) {
  const text = String(input.text || "").trim();
  const url = canonicalLinkedInUrl(input.url);
  const slug = parseLinkedInSlug(url || input.url);
  const observedAt = nowIso();

  if (!text) {
    if (!url) {
      return {
        ok: false,
        fetched: false,
        status: EVIDENCE_STATUS.UNKNOWN,
        reason: "UNKNOWN: enter a LinkedIn profile URL (linkedin.com/in/...) or paste profile text.",
        facts: [],
        text: "",
        warnings: ["LinkedIn HTML scraping is disabled."],
      };
    }
    const source = { kind: FACT_SOURCES.LINKEDIN_URL_ONLY, label: "LinkedIn URL (not fetched)", url };
    const facts = [
      shapeCandidateFact({
        factType: "url",
        value: url,
        evidence: "Candidate supplied this LinkedIn URL. Profile contents were not retrieved from LinkedIn.",
        source,
        confidence: 1,
        verificationStatus: VERIFICATION_STATUS.VERIFIED,
        timestamp: observedAt,
      }),
    ];
    if (slug) {
      facts.push(
        shapeCandidateFact({
          factType: "handle",
          value: slug,
          evidence: `Public profile slug from the LinkedIn URL (${slug}). Headline, jobs, and skills were not fetched.`,
          source,
          confidence: 0.4,
          verificationStatus: VERIFICATION_STATUS.UNCERTAIN,
          timestamp: observedAt,
        })
      );
    }
    return {
      ok: true,
      fetched: false,
      status: EVIDENCE_STATUS.GROUNDED,
      reason:
        "LinkedIn URL saved. Profile contents were not fetched — paste an About/Experience export to import skills and roles.",
      facts,
      text: url,
      url,
      warnings: ["LinkedIn is not scraped. Paste profile text to import experience and skills."],
    };
  }

  const source = {
    kind: FACT_SOURCES.LINKEDIN_USER_PROVIDED,
    label: "LinkedIn (user-provided text)",
    url: url || null,
  };
  const facts = extractCandidateFacts({
    text,
    docType: "LINKEDIN",
    source,
    verificationStatus: VERIFICATION_STATUS.VERIFIED,
  }).map((f) =>
    shapeCandidateFact({
      ...f,
      source,
      timestamp: observedAt,
      verificationStatus: f.verificationStatus || VERIFICATION_STATUS.VERIFIED,
      confidence: Math.min(f.confidence ?? 0.85, 0.9),
    })
  );

  if (source.url) {
    facts.push(shapeCandidateFact({
      factType: "url",
      value: source.url,
      evidence: "LinkedIn URL supplied with user-authorized profile text.",
      source,
      confidence: 1,
      verificationStatus: VERIFICATION_STATUS.VERIFIED,
      timestamp: observedAt,
    }));
  }

  return {
    ok: true,
    fetched: false,
    status: EVIDENCE_STATUS.GROUNDED,
    facts,
    text,
    url: source.url,
    warnings: [],
  };
}
