/**
 * source-adapters.mjs — CareerOS Opportunity Discovery Normalization Layer
 *
 * Sits between raw provider results and the CareerOS student pipeline.
 * Normalizes every discovered opportunity into a common schema with:
 *   - source tracking (which provider/portal found it)
 *   - country inference (Pakistan-aware)
 *   - remote work detection
 *   - opportunity type classification (via classify-opportunity.mjs)
 *   - URL-based + fuzzy deduplication
 *
 * Does NOT replace the existing provider system — extends it.
 * Zero external dependencies beyond what's already in the project.
 */

import { classifyOpportunity } from './classify-opportunity.mjs';

// ── Normalized Opportunity Schema ─────────────────────────────────────────────

/**
 * @typedef {Object} NormalizedOpportunity
 * @property {string}      source           Provider id or portal name
 * @property {string}      source_url       API/page URL that produced the result
 * @property {string}      company          Company name
 * @property {string}      title            Job/internship title
 * @property {string}      description      Full description (may be empty)
 * @property {string}      location         Raw location string from provider
 * @property {string|null} country          Inferred country (Pakistan-aware)
 * @property {boolean|null} remote          Whether position is remote-eligible
 * @property {string}      opportunity_type INTERNSHIP | JOB | OTHER
 * @property {string}      classification_confidence HIGH | MEDIUM | LOW
 * @property {string}      classification_reason     Audit trail
 * @property {string|null} posted_date      ISO date string
 * @property {string|null} deadline         Application deadline (rarely available)
 * @property {string}      application_url  Canonical URL to apply
 * @property {string}      url              Original URL (dedup key)
 */

// ── Pakistan Location Database ────────────────────────────────────────────────
// Major cities, provinces, and common location strings

const PAKISTAN_CITIES = [
  'karachi', 'lahore', 'islamabad', 'rawalpindi', 'faisalabad',
  'peshawar', 'quetta', 'multan', 'hyderabad', 'sialkot',
  'gujranwala', 'bahawalpur', 'sargodha', 'sukkur', 'larkana',
  'abbottabad', 'mardan', 'mingora', 'dera ghazi khan', 'sahiwal',
  'okara', 'wah cantt', 'taxila', 'mirpur', 'muzaffarabad',
  'gilgit', 'skardu', 'chitral', 'swat', 'mansehra',
];

const PAKISTAN_PROVINCES = [
  'sindh', 'punjab', 'balochistan', 'khyber pakhtunkhwa', 'kpk',
  'gilgit-baltistan', 'azad kashmir', 'ajk',
  'islamabad capital territory', 'ict',
];

const PAKISTAN_MARKERS = [
  'pakistan', 'pk', ...PAKISTAN_CITIES, ...PAKISTAN_PROVINCES,
];

// ── Country Inference Maps ────────────────────────────────────────────────────

const COUNTRY_CITY_MAP = {
  // United States
  'san francisco': 'United States', 'new york': 'United States',
  'seattle': 'United States', 'austin': 'United States',
  'boston': 'United States', 'chicago': 'United States',
  'los angeles': 'United States', 'san jose': 'United States',
  'mountain view': 'United States', 'menlo park': 'United States',
  'palo alto': 'United States', 'sunnyvale': 'United States',
  'cupertino': 'United States', 'redmond': 'United States',
  'pittsburgh': 'United States', 'atlanta': 'United States',
  'denver': 'United States', 'portland': 'United States',
  'washington dc': 'United States', 'dallas': 'United States',
  'houston': 'United States', 'miami': 'United States',
  'philadelphia': 'United States', 'phoenix': 'United States',
  'san diego': 'United States', 'detroit': 'United States',
  'raleigh': 'United States', 'nashville': 'United States',
  'minneapolis': 'United States', 'salt lake city': 'United States',

  // United Kingdom
  'london': 'United Kingdom', 'cambridge': 'United Kingdom',
  'oxford': 'United Kingdom', 'edinburgh': 'United Kingdom',
  'manchester': 'United Kingdom', 'bristol': 'United Kingdom',
  'birmingham': 'United Kingdom', 'glasgow': 'United Kingdom',
  'leeds': 'United Kingdom', 'liverpool': 'United Kingdom',

  // Germany
  'berlin': 'Germany', 'munich': 'Germany', 'hamburg': 'Germany',
  'frankfurt': 'Germany', 'stuttgart': 'Germany', 'cologne': 'Germany',
  'düsseldorf': 'Germany', 'dusseldorf': 'Germany',

  // Canada
  'toronto': 'Canada', 'vancouver': 'Canada', 'montreal': 'Canada',
  'ottawa': 'Canada', 'calgary': 'Canada', 'waterloo': 'Canada',

  // UAE
  'dubai': 'UAE', 'abu dhabi': 'UAE', 'sharjah': 'UAE',

  // India
  'bangalore': 'India', 'bengaluru': 'India', 'mumbai': 'India',
  'hyderabad': 'India', 'pune': 'India', 'chennai': 'India',
  'noida': 'India', 'gurgaon': 'India', 'gurugram': 'India',
  'delhi': 'India', 'new delhi': 'India', 'kolkata': 'India',

  // Singapore
  'singapore': 'Singapore',

  // Japan
  'tokyo': 'Japan', 'osaka': 'Japan',

  // China
  'beijing': 'China', 'shanghai': 'China', 'shenzhen': 'China',
  'hangzhou': 'China', 'guangzhou': 'China',

  // Australia
  'sydney': 'Australia', 'melbourne': 'Australia',

  // France
  'paris': 'France', 'lyon': 'France',

  // Netherlands
  'amsterdam': 'Netherlands',

  // Ireland
  'dublin': 'Ireland',

  // Sweden
  'stockholm': 'Sweden',

  // Switzerland
  'zurich': 'Switzerland', 'geneva': 'Switzerland',

  // South Korea
  'seoul': 'South Korea',

  // Israel
  'tel aviv': 'Israel',
};

const COUNTRY_KEYWORDS = {
  'united states': 'United States', 'usa': 'United States', 'u.s.': 'United States',
  'united kingdom': 'United Kingdom',
  'germany': 'Germany', 'deutschland': 'Germany',
  'canada': 'Canada',
  'india': 'India',
  'australia': 'Australia',
  'france': 'France',
  'japan': 'Japan',
  'china': 'China',
  'singapore': 'Singapore',
  'netherlands': 'Netherlands',
  'ireland': 'Ireland',
  'sweden': 'Sweden',
  'switzerland': 'Switzerland',
  'south korea': 'South Korea',
  'brazil': 'Brazil',
  'mexico': 'Mexico',
  'spain': 'Spain',
  'italy': 'Italy',
  'poland': 'Poland',
  'turkey': 'Turkey', 'türkiye': 'Turkey',
  'united arab emirates': 'UAE',
  'saudi arabia': 'Saudi Arabia',
  'israel': 'Israel',
  'pakistan': 'Pakistan',
};

// Short codes that MUST match as whole words to avoid false positives
// (e.g. 'uk' inside 'Timbuktu', 'uae' inside some compound).
const COUNTRY_SHORT_CODES = [
  { pattern: /\buk\b/i,  country: 'United Kingdom' },
  { pattern: /\buae\b/i, country: 'UAE' },
];

// ── Remote Detection ──────────────────────────────────────────────────────────

const REMOTE_PATTERNS = [
  /\bfully\s+remote\b/i,
  /\bremote[- ]?first\b/i,
  /\b100%\s+remote\b/i,
  /\bwork\s+from\s+home\b/i,
  /\bwfh\b/i,
  /\bremote\s+(?:position|role|job|opportunity|work|software|engineer|developer|ml|ai|data)\b/i,
  /\btelecommute\b/i,
  /\banywhere\b/i,
  /\bremote\b/i,
];

const REMOTE_LOCATION_EXACT = [
  'remote', 'remote, us', 'remote - us', 'remote usa',
  'remote, worldwide', 'remote / global', 'worldwide remote',
  'fully remote', 'work from home',
];

const NOT_REMOTE_PATTERNS = [
  /\bon[- ]?site\s+(?:only|required)\b/i,
  /\bno\s+remote\b/i,
  /\bin[- ]?office\s+(?:only|required)\b/i,
];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Infer country from a location string. Pakistan-aware.
 *
 * @param {string} location - Raw location string from provider
 * @returns {string|null}
 */
export function inferCountry(location) {
  if (!location || typeof location !== 'string') return null;
  const lower = location.toLowerCase().trim();
  if (!lower) return null;

  // Check Pakistan markers first (priority for Pakistani users)
  for (const marker of PAKISTAN_MARKERS) {
    if (lower.includes(marker)) return 'Pakistan';
  }

  // Check country keywords (longer matches first to avoid false positives)
  const sortedCountries = Object.keys(COUNTRY_KEYWORDS).sort((a, b) => b.length - a.length);
  for (const kw of sortedCountries) {
    if (lower.includes(kw)) return COUNTRY_KEYWORDS[kw];
  }

  // Check short codes with word-boundary matching (prevents 'uk' in 'Timbuktu')
  for (const { pattern, country } of COUNTRY_SHORT_CODES) {
    if (pattern.test(lower)) return country;
  }

  // Check city map
  for (const [city, country] of Object.entries(COUNTRY_CITY_MAP)) {
    if (lower.includes(city)) return country;
  }

  return null;
}

/**
 * Detect whether a position is remote-eligible from location and title strings.
 *
 * @param {string} location
 * @param {string} [title]
 * @returns {boolean|null} true = remote, false = explicitly not remote, null = unknown
 */
export function inferRemote(location, title) {
  const combined = [location || '', title || ''].join(' ');

  // Check for explicit "not remote" first
  for (const pat of NOT_REMOTE_PATTERNS) {
    if (pat.test(combined)) return false;
  }

  // Check for exact remote location strings
  const locLower = (location || '').toLowerCase().trim();
  if (REMOTE_LOCATION_EXACT.includes(locLower)) return true;

  // Check remote patterns
  for (const pat of REMOTE_PATTERNS) {
    if (pat.test(combined)) return true;
  }

  return null;
}

/**
 * Normalize a raw provider Job into the CareerOS normalized opportunity schema.
 *
 * @param {object} job       - Raw Job from a provider's fetch()
 * @param {string} source    - Provider id or source name
 * @param {string} sourceUrl - API/page URL that produced the result
 * @returns {NormalizedOpportunity}
 */
export function normalizeOpportunity(job, source, sourceUrl) {
  const title    = String(job.title    || '').trim();
  const company  = String(job.company  || '').trim();
  const location = String(job.location || '').trim();
  const description = String(job.description || '').trim();
  const url      = String(job.url      || '').trim();

  // Classify the opportunity
  const classification = classifyOpportunity({
    title,
    description,
    employment_type: job.employment_type || '',
    company,
    location,
  });

  // Infer country and remote status
  const country = inferCountry(location);
  const remote  = inferRemote(location, title);

  // Convert epoch to ISO date
  let postedDate = null;
  if (typeof job.postedAt === 'number' && !isNaN(job.postedAt)) {
    postedDate = new Date(job.postedAt).toISOString().slice(0, 10);
  }

  return {
    source:      source || 'unknown',
    source_url:  sourceUrl || '',
    company,
    title,
    description,
    location,
    country,
    remote,
    opportunity_type:            classification.opportunity_type,
    classification_confidence:   classification.classification_confidence,
    classification_reason:       classification.classification_reason,
    posted_date: postedDate,
    deadline:    job.deadline || null,
    application_url: url,
    url,
  };
}

/**
 * Normalize a URL for deduplication purposes.
 * Strips trailing slashes, removes common tracking params, lowercases.
 *
 * @param {string} url
 * @returns {string}
 */
export function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const parsed = new URL(url);
    // Remove common tracking parameters
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
      'ref', 'source', 'tracking', 'gh_jid', 'lever_origin',
    ];
    for (const p of trackingParams) parsed.searchParams.delete(p);
    // Normalize
    let normalized = parsed.origin + parsed.pathname;
    // Remove trailing slash (but keep root /)
    if (normalized.length > parsed.origin.length + 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    // Add remaining search params if any
    const search = parsed.searchParams.toString();
    if (search) normalized += '?' + search;
    return normalized.toLowerCase();
  } catch {
    // Not a valid URL, just lowercase and trim
    return url.toLowerCase().trim().replace(/\/+$/, '');
  }
}

/**
 * Generate a fuzzy dedup key from title + company.
 * Used to catch the same role posted across multiple sources.
 *
 * @param {string} title
 * @param {string} company
 * @returns {string}
 */
export function fuzzyKey(title, company) {
  const norm = (s) =>
    (s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  return `${norm(company)}::${norm(title)}`;
}

/**
 * Deduplicate an array of normalized opportunities.
 *
 * Two-tier dedup:
 *   1. Exact URL match (after normalization) — drops duplicates
 *   2. Fuzzy title+company match — keeps first seen, marks later as duplicate
 *
 * @param {NormalizedOpportunity[]} opportunities
 * @returns {{ unique: NormalizedOpportunity[], duplicates: NormalizedOpportunity[] }}
 */
export function deduplicateOpportunities(opportunities) {
  const seenUrls  = new Map();  // normalizedUrl → opportunity
  const seenFuzzy = new Map();  // fuzzyKey → opportunity
  const unique     = [];
  const duplicates = [];

  for (const opp of opportunities) {
    // Tier 1: exact URL dedup
    const normUrl = normalizeUrl(opp.url);
    if (normUrl && seenUrls.has(normUrl)) {
      duplicates.push(opp);
      continue;
    }

    // Tier 2: fuzzy title+company dedup
    const fk = fuzzyKey(opp.title, opp.company);
    if (fk && fk !== '::' && seenFuzzy.has(fk)) {
      duplicates.push(opp);
      continue;
    }

    if (normUrl) seenUrls.set(normUrl, opp);
    if (fk && fk !== '::') seenFuzzy.set(fk, opp);
    unique.push(opp);
  }

  return { unique, duplicates };
}

/**
 * Full pipeline: normalize + classify + deduplicate a batch of raw provider jobs.
 *
 * @param {object[]} jobs       - Raw Job[] from provider fetch()
 * @param {string}   source     - Provider id
 * @param {string}   sourceUrl  - API URL
 * @returns {{ opportunities: NormalizedOpportunity[], duplicates: NormalizedOpportunity[], stats: object }}
 */
export function processDiscoveredJobs(jobs, source, sourceUrl) {
  if (!Array.isArray(jobs)) return { opportunities: [], duplicates: [], stats: { total: 0, unique: 0, duplicates: 0 } };

  const normalized = jobs.map(j => normalizeOpportunity(j, source, sourceUrl));
  const { unique, duplicates } = deduplicateOpportunities(normalized);

  return {
    opportunities: unique,
    duplicates,
    stats: {
      total: jobs.length,
      unique: unique.length,
      duplicates: duplicates.length,
    },
  };
}

/**
 * Merge results from multiple sources, deduplicating across sources.
 *
 * @param {Array<{ opportunities: NormalizedOpportunity[], source: string }>} batches
 * @returns {{ opportunities: NormalizedOpportunity[], duplicates: NormalizedOpportunity[], stats: object }}
 */
export function mergeMultipleSources(batches) {
  const all = [];
  const sourceCounts = {};

  for (const batch of batches) {
    sourceCounts[batch.source] = (batch.opportunities || []).length;
    all.push(...(batch.opportunities || []));
  }

  const { unique, duplicates } = deduplicateOpportunities(all);

  return {
    opportunities: unique,
    duplicates,
    stats: {
      total_before_dedup: all.length,
      unique: unique.length,
      cross_source_duplicates: duplicates.length,
      by_source: sourceCounts,
    },
  };
}
