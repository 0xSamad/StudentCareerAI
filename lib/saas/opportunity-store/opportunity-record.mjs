/**
 * opportunity-record.mjs — Canonical opportunity shape for the global Opportunity Store.
 *
 * FETCH → NORMALIZE → DEDUPLICATE → PERSIST: every discovered listing passes
 * through normalizeOpportunity() so that deduplication is deterministic no
 * matter which source (Adzuna, official careers page, ATS API, web search)
 * produced it.
 */

import { createHash } from 'node:crypto';
import { cleanListingText, cleanListingTitle } from '../listing-quality.mjs';

export const OPPORTUNITY_TYPES = ['INTERNSHIP', 'JOB', 'OTHER', 'UNKNOWN'];
export const OPPORTUNITY_STATUSES = ['ACTIVE', 'EXPIRED', 'CLOSED', 'REMOVED', 'UNKNOWN'];
export const SAVED_STATUSES = ['SAVED', 'IGNORED', 'APPLIED', 'HIDDEN'];
export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'UNKNOWN'];

const INTERN_TITLE = /\bintern(ship)?\b|\btrainee\b|\bco[- ]?op\b|\bwerkstudent\b|\bapprentice\b/i;
const ROLE_TITLE = /engineer|developer|analyst|scientist|designer|manager|consultant|architect|administrator|specialist|associate|officer|lead\b/i;

const ATS_SOURCES = /greenhouse|lever|ashby|workday|icims|smartrecruiters|recruitee|workable|bamboohr|teamtailor|personio|rippling|breezy|jobvite/i;
const API_SOURCES = /adzuna|remotive|jobicy|themuse|arbeitnow|arbeitsagentur/i;

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Lowercase, drop query string/fragment/trailing slashes — used for URL dedupe. */
export function normalizeUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  return raw.toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '') || null;
}

/** Lowercase, collapse punctuation and whitespace — used for fingerprints. */
export function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/gi, ' ')
    .trim();
}

function cleanString(value, max = 250) {
  const s = String(value ?? '').trim();
  return s ? s.slice(0, max) : null;
}

function cleanTitle(value) {
  return cleanListingTitle(value) || cleanString(value, 120);
}

function toIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function inferOpportunityType(raw, title) {
  const explicit = String(raw.opportunity_type || raw.opportunityType || raw.type || '').toUpperCase();
  if (explicit === 'INTERNSHIP' || explicit === 'JOB' || explicit === 'OTHER') return explicit;
  if (explicit === 'CO_OP' || explicit === 'FELLOWSHIP') return 'OTHER';
  if (INTERN_TITLE.test(title)) return 'INTERNSHIP';
  if (ROLE_TITLE.test(title)) return 'JOB';
  return 'UNKNOWN';
}

function inferEmploymentType(raw, title, opportunityType) {
  const explicit = String(raw.employment_type || raw.employmentType || raw.contract_time || '').toUpperCase().replace(/[^A-Z]+/g, '_');
  if (EMPLOYMENT_TYPES.includes(explicit)) return explicit;
  if (opportunityType === 'INTERNSHIP') return 'INTERNSHIP';
  if (/part[- ]?time/i.test(title)) return 'PART_TIME';
  if (/\bcontract(or)?\b|freelance/i.test(title)) return 'CONTRACT';
  if (/full[- ]?time/i.test(title)) return 'FULL_TIME';
  return 'UNKNOWN';
}

function inferSourceType(raw, source) {
  const explicit = String(raw.sourceType || '').toUpperCase();
  if (['API', 'ATS', 'CAREERS_PAGE', 'WEB_SEARCH', 'MANUAL'].includes(explicit)) return explicit;
  if (API_SOURCES.test(source)) return 'API';
  if (ATS_SOURCES.test(source)) return 'ATS';
  if (/official-careers|careers?[-_ ]?page/i.test(source)) return 'CAREERS_PAGE';
  if (/web[-_ ]?search|bing|duckduckgo|google/i.test(source)) return 'WEB_SEARCH';
  return 'UNKNOWN';
}

function inferCountry(raw, location) {
  const explicit = cleanString(raw.country, 100);
  if (explicit) return explicit;
  const market = raw.market || raw.metadata?.market;
  const loc = String(location || '');
  if (market === 'NATIONAL' || /pakistan|karachi|lahore|islamabad|rawalpindi|faisalabad|peshawar|quetta/i.test(loc)) {
    return 'Pakistan';
  }
  const parts = loc.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 1].slice(0, 100);
  return null;
}

function inferStatus(raw) {
  const explicit = String(raw.status || '').toUpperCase();
  if (OPPORTUNITY_STATUSES.includes(explicit)) return explicit;
  const state = String(raw.state || '').toUpperCase();
  if (state === 'EXPIRED') return 'EXPIRED';
  if (state === 'CLOSED') return 'CLOSED';
  // Freshly fetched listings are live by definition.
  return 'ACTIVE';
}

function inferSalary(raw) {
  const explicit = cleanString(raw.salary, 250);
  if (explicit) return explicit;
  const min = raw.salary_min ?? raw.salaryMin ?? null;
  const max = raw.salary_max ?? raw.salaryMax ?? null;
  if (min == null && max == null) return null;
  const currency = raw.salary_currency ?? raw.salaryCurrency ?? '';
  return `${min ?? ''}${min != null && max != null ? '–' : ''}${max ?? ''} ${currency}`.trim();
}

/**
 * Deterministic identity for a listing:
 * 1. source + sourceId when both exist (the same requisition seen again).
 * 2. Normalized application/source URL.
 * 3. Fingerprint of normalized company + title + location.
 */
export function dedupeKeyFor({ source, sourceId, applicationUrl, sourceUrl, company, title, location }) {
  const src = normalizeText(source);
  const sid = String(sourceId ?? '').trim().toLowerCase();
  if (src && src !== 'unknown' && sid) return `src:${src}:${sid}`;
  const urlKey = normalizeUrl(applicationUrl || sourceUrl);
  if (urlKey) return `url:${urlKey}`;
  return `fp:${sha256([normalizeText(company), normalizeText(title), normalizeText(location)].join('|'))}`;
}

/** Hash of the fields whose change should refresh a stored record. */
export function contentHashFor({ title, company, description, location, deadline, salary, status }) {
  return sha256(
    [title, company, description, location, deadline, salary, status]
      .map((v) => String(v ?? ''))
      .join('\u0001')
  );
}

/**
 * Normalize any raw listing (scan output, Adzuna item, ingest record, ATS job)
 * into the canonical Opportunity Store shape. Never throws on messy input.
 */
export function normalizeOpportunity(raw = {}) {
  const sourceUrl = cleanString(raw.source_url || raw.sourceUrl || raw.url, 2000);
  const applicationUrl =
    cleanString(raw.application_url || raw.applicationUrl || raw.apply_url || raw.redirect_url, 2000) ||
    cleanString(raw.url, 2000) ||
    sourceUrl;
  const source = (cleanString(raw.source || raw.source_name || raw.sourceName, 100) || 'unknown').toLowerCase();
  const sourceId = cleanString(raw.source_id ?? raw.sourceId ?? raw.id_from_source, 250);
  const title = cleanTitle(raw.title || raw.role) || 'Untitled role';
  const company = cleanString(raw.company || raw.company_name || raw.companyName, 250) || 'Unknown';
  const location = cleanString(raw.location, 250);
  const opportunityType = inferOpportunityType(raw, title);
  const status = inferStatus(raw);
  const deadline = toIso(raw.deadline)?.slice(0, 10) || null;
  const salary = inferSalary(raw);
  const description =
    typeof raw.description === 'string' && raw.description.trim()
      ? cleanListingText(raw.description, 4000) || null
      : null;

  const record = {
    source,
    sourceType: inferSourceType(raw, source),
    sourceId,
    sourceUrl,
    applicationUrl,
    company,
    title,
    description,
    location,
    country: inferCountry(raw, location),
    opportunityType,
    employmentType: inferEmploymentType(raw, title, opportunityType),
    remote: Boolean(raw.remote ?? raw.is_remote ?? /\bremote\b/i.test(`${location || ''} ${title}`)),
    postedAt: toIso(raw.postedAt || raw.posted_at || raw.posted_date || raw.postedDate || raw.created),
    deadline,
    salary,
    rawData: raw.rawData && typeof raw.rawData === 'object' ? raw.rawData : { ...raw },
    status,
  };
  record.urlKey = normalizeUrl(applicationUrl || sourceUrl);
  record.dedupeKey = dedupeKeyFor(record);
  record.contentHash = contentHashFor(record);
  return record;
}

export function newOpportunityId() {
  return `opp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
