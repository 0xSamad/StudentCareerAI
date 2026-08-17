/**
 * website-enricher.mjs — User-authorized public portfolio / personal site fetch.
 * SSRF-safe. Stops on auth walls, CAPTCHA, and rate limits. Does not fetch LinkedIn.
 */

import { extractSkills } from "../../../skill-extract.mjs";
import { EVIDENCE_STATUS, FACT_SOURCES, VERIFICATION_STATUS } from "./document-types.mjs";
import { authorizedGet, assertSafePublicUrl } from "./authorized-fetch.mjs";
import { shapeCandidateFact, nowIso } from "./fact-shape.mjs";
import { isLinkedInUrl } from "./linkedin-enricher.mjs";
import { parseGitHubUsername } from "./github-enricher.mjs";

function htmlToText(html = "") {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, 20_000);
}

function pageTitle(html = "") {
  const m = String(html).match(/<title[^>]*>([^<]{2,160})<\/title>/i);
  return m ? m[1].trim() : null;
}

/**
 * @param {{ url: string, kind?: 'portfolio'|'website', fetchFn?: Function }} input
 */
export async function fetchWebsiteEvidence(input = {}) {
  const url = String(input.url || "").trim();
  const kind = input.kind === "portfolio" ? "portfolio" : "website";
  const observedAt = nowIso();

  if (!url) {
    return { ok: false, status: EVIDENCE_STATUS.UNKNOWN, reason: "UNKNOWN: no website URL provided.", facts: [], text: "", warnings: [] };
  }
  if (isLinkedInUrl(url)) {
    return {
      ok: false,
      status: EVIDENCE_STATUS.UNKNOWN,
      reason: "UNKNOWN: LinkedIn cannot be fetched as a website. Paste authorized profile text instead.",
      facts: [],
      text: "",
      warnings: [],
    };
  }
  if (parseGitHubUsername(url)) {
    return {
      ok: false,
      status: EVIDENCE_STATUS.UNKNOWN,
      reason: "UNKNOWN: GitHub pages are enriched through the public GitHub API, not HTML scraping.",
      facts: [],
      text: "",
      warnings: [],
      redirectTo: "github",
    };
  }

  const safe = assertSafePublicUrl(url);
  if (!safe.ok) {
    return { ok: false, status: EVIDENCE_STATUS.UNKNOWN, reason: safe.reason, facts: [], text: "", warnings: [] };
  }

  const fetched = await authorizedGet(url, { fetchFn: input.fetchFn });
  if (!fetched.ok) {
    return {
      ok: false,
      status: EVIDENCE_STATUS.UNKNOWN,
      reason: fetched.reason,
      protection: fetched.protection,
      facts: [],
      text: "",
      warnings: [],
    };
  }

  const title = pageTitle(fetched.body);
  const text = htmlToText(fetched.body);
  if (!text) {
    return { ok: false, status: EVIDENCE_STATUS.UNKNOWN, reason: "UNKNOWN: no readable text on the page.", facts: [], text: "", warnings: [] };
  }

  const sourceKind = kind === "portfolio" ? FACT_SOURCES.PORTFOLIO_AUTHORIZED : FACT_SOURCES.WEBSITE_AUTHORIZED;
  const source = { kind: sourceKind, label: kind === "portfolio" ? "Portfolio (user-authorized)" : "Personal website (user-authorized)", url };

  const facts = [
    shapeCandidateFact({
      factType: "url",
      value: url,
      evidence: title ? `Page title: ${title}` : `Authorized ${kind} URL`,
      source,
      confidence: 1,
      verificationStatus: VERIFICATION_STATUS.VERIFIED,
      timestamp: observedAt,
    }),
  ];

  if (title) {
    facts.push(shapeCandidateFact({
      factType: "project",
      value: title,
      evidence: `Page title on ${url}`,
      source,
      confidence: 0.55,
      verificationStatus: VERIFICATION_STATUS.UNCERTAIN,
      timestamp: observedAt,
    }));
  }

  for (const skill of extractSkills(text)) {
    facts.push(shapeCandidateFact({
      factType: "skill",
      value: skill,
      evidence: `Mentioned on authorized ${kind} page ${url}`,
      source,
      confidence: 0.6,
      verificationStatus: VERIFICATION_STATUS.UNCERTAIN,
      timestamp: observedAt,
    }));
    facts.push(shapeCandidateFact({
      factType: "technology",
      value: skill,
      evidence: `Mentioned on authorized ${kind} page ${url}`,
      source,
      confidence: 0.6,
      verificationStatus: VERIFICATION_STATUS.UNCERTAIN,
      timestamp: observedAt,
    }));
  }

  const headingRe = /(?:^|\n)\s*(?:#{1,3}\s+)?([A-Z][A-Za-z0-9 ._-]{3,80})\s*(?:\n|$)/g;
  let match;
  let headings = 0;
  while ((match = headingRe.exec(text)) && headings < 8) {
    const name = match[1].trim();
    if (/about|contact|home|blog|menu/i.test(name)) continue;
    facts.push(shapeCandidateFact({
      factType: "project",
      value: name,
      evidence: `Heading on authorized ${kind}: ${name}`,
      source,
      confidence: 0.55,
      verificationStatus: VERIFICATION_STATUS.UNCERTAIN,
      timestamp: observedAt,
    }));
    headings += 1;
  }

  return {
    ok: true,
    status: EVIDENCE_STATUS.GROUNDED,
    facts,
    text: [`# ${title || url}`, url, text.slice(0, 8000)].join("\n\n"),
    warnings: ["Skills and project headings taken from page text are UNCERTAIN until corroborated by a CV or GitHub API language field."],
  };
}
