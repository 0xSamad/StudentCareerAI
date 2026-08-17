/**
 * adzuna-discovery.mjs — Optional Adzuna API discovery source.
 *
 * Runs after indexed search and curated employer lists. Adzuna requires both
 * ADZUNA_APP_ID and ADZUNA_APP_KEY; if either is missing this source is skipped.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveDiscoveredListing } from './opportunity-ingest.mjs';
import { isCsFieldRole, passesSearchMode } from './cs-field-discovery.mjs';
import { loadLocalAdzunaEnv } from './load-local-env.mjs';
import { mapPool } from './careers-http-scrape.mjs';
import { fetchWithBackoff } from './discovery-engine/rate-limiter.mjs';
import { conditionalFetch } from './discovery-engine/conditional-fetch.mjs';
import { maybeSkipCachedQuery, rememberCachedQuery } from './discovery-engine/source-cache.mjs';
import { isCredibleListingUrl, resolveListingUrl } from './listing-url.mjs';
import { isAllowedTargetListing } from './listing-quality.mjs';

const DEFAULT_COUNTRIES = ['gb', 'us', 'ca'];
const DEFAULT_RESULTS_PER_PAGE = 20;
const MAX_PAGES_PER_QUERY = 1;
const DEFAULT_MAX_TOTAL = 120;
const SUPPORTED_COUNTRIES = new Set([
  'gb', 'us', 'ca', 'au', 'at', 'be', 'br', 'de', 'es', 'fr', 'in', 'it',
  'mx', 'nl', 'nz', 'pl', 'sg', 'za', 'ie', 'ch', 'ae',
]);

const COUNTRY_WHERE = {
  pk: 'Pakistan',
  ae: 'United Arab Emirates',
  in: 'India',
  sg: 'Singapore',
  us: 'United States',
  gb: 'United Kingdom',
  ca: 'Canada',
};

function envList(name, fallback) {
  return String(process.env[name] || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .concat([])
    .length
    ? String(process.env[name] || '')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    : fallback;
}

function queriesForMode(searchMode) {
  const internship = [
    'remote software intern',
    'remote computer science internship',
    'remote software engineering intern',
    'pakistan software intern',
    'remote data intern',
  ];
  const jobs = [
    'remote junior software engineer',
    'remote graduate software engineer',
    'pakistan software engineer',
    'remote backend engineer',
    'remote data analyst',
  ];
  if (searchMode === 'INTERNSHIP') return internship;
  if (searchMode === 'JOB') return jobs;
  return [...internship, ...jobs];
}

function passesTypeFilter(title, searchMode) {
  return passesSearchMode(title, searchMode);
}

export function adzunaConfig(repoRoot) {
  const root =
    repoRoot ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  loadLocalAdzunaEnv(root);
  const appId = process.env.ADZUNA_APP_ID?.trim();
  const appKey = process.env.ADZUNA_APP_KEY?.trim();
  if (!appId) return { enabled: false, reason: 'missing_app_id' };
  if (!appKey) return { enabled: false, reason: 'missing_app_key' };
  return {
    enabled: true,
    appId,
    appKey,
    countries: envList('ADZUNA_COUNTRIES', DEFAULT_COUNTRIES).filter((c) => SUPPORTED_COUNTRIES.has(c)),
  };
}

async function fetchAdzunaResults({ country, query, appId, appKey, page, resultsPerPage, maxDaysOld, etag, lastModified, onRequest }) {
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: String(resultsPerPage),
    what: query,
    sort_by: 'date',
    'content-type': 'application/json',
  });
  if (COUNTRY_WHERE[country]) params.set('where', COUNTRY_WHERE[country]);
  if (Number.isFinite(maxDaysOld) && maxDaysOld > 0) {
    params.set('max_days_old', String(Math.ceil(maxDaysOld)));
  }

  const url = `https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(country)}/search/${page}?${params.toString()}`;
  return fetchWithBackoff(
    async () => {
      await onRequest?.();
      const result = await conditionalFetch(url, {
        etag,
        lastModified,
        parse: 'json',
        label: 'adzuna',
        timeoutMs: 12_000,
        headers: {
          accept: 'application/json',
          'user-agent': 'career-ops/1.3 StudentCareer discovery',
        },
      });
      if (result.notModified) {
        return { results: [], notModified: true, etag: result.etag, lastModified: result.lastModified, remaining: result.requestsRemaining };
      }
      const results = Array.isArray(result.body?.results) ? result.body.results : [];
      return {
        results,
        notModified: false,
        etag: result.etag,
        lastModified: result.lastModified,
        remaining: result.requestsRemaining,
      };
    },
    { retries: 2, baseDelayMs: 600 }
  );
}

function normalizeAdzunaListing(item, country) {
  const title = item?.title || '';
  const url = item?.redirect_url || '';
  const company = item?.company?.display_name || 'Adzuna employer';
  const location = item?.location?.display_name || COUNTRY_WHERE[country] || null;
  if (!title || !url || !/^https?:\/\//i.test(url)) return null;
  return {
    title,
    url,
    company,
    location,
    description: item?.description || `${title} at ${company}. Listed by Adzuna.`,
    postedAt: item?.created || null,
    source_name: 'adzuna',
    source_id: item?.id || null,
    market: country === 'pk' ? 'NATIONAL' : 'INTERNATIONAL',
    discovery_mode: 'adzuna_api',
    metadata: {
      adzuna_country: country,
      category: item?.category?.label || null,
      salary_min: item?.salary_min || null,
      salary_max: item?.salary_max || null,
    },
  };
}

/**
 * @param {object} params
 */
export async function discoverFromAdzuna({
  profile,
  opportunityRepository,
  authContext,
  options = {},
  repoRoot,
}) {
  const cfg = adzunaConfig(repoRoot);
  const stats = {
    configured: cfg.enabled,
    reason: cfg.enabled ? null : cfg.reason,
    countriesQueried: 0,
    queriesRun: 0,
    rawFound: 0,
    saved: 0,
    existing: 0,
    skippedOld: 0,
    cacheHits: 0,
    notModified: 0,
    errors: 0,
    lastPublishedAt: null,
    rateLimitResetAt: null,
    ingested: [],
  };
  if (!cfg.enabled) return stats;

  const searchMode = options.searchMode ?? 'BOTH';
  const maxTotal = options.maxTotal ?? DEFAULT_MAX_TOTAL;
  const resultsPerPage = options.resultsPerPage ?? DEFAULT_RESULTS_PER_PAGE;
  const deadline = Number(options.deadlineAt) || 0;
  // Incremental discovery window (from planFetch): server-side max_days_old
  // plus a client-side publishedAfter cutoff for exact overlap handling.
  const maxDaysOld = Number(options.maxDaysOld) || null;
  const publishedAfter = options.publishedAfter ? new Date(options.publishedAfter).getTime() : 0;
  const maxRequests = Number(options.maxRequests) || 40;
  const knownUrls = options.knownUrls instanceof Set ? options.knownUrls : new Set();
  const sourceCache = options.sourceCache || null;
  const refreshPolicy = options.refreshPolicy || null;
  const stateStore = options.discoveryStateStore || null;
  const opportunityType = searchMode === 'JOB' ? 'JOB' : searchMode === 'INTERNSHIP' ? 'INTERNSHIP' : '';
  const seen = new Set();
  const queries = queriesForMode(searchMode);
  const countries =
    options.market === 'NATIONAL'
      ? []
      : (options.market === 'INTERNATIONAL'
          ? cfg.countries.filter((c) => c !== 'pk')
          : cfg.countries);
  if (countries.length === 0) {
    stats.reason = options.market === 'NATIONAL' ? 'pakistan_uses_employer_pages' : 'no_supported_countries';
    return stats;
  }

  const tasks = [];
  for (const country of countries) {
    for (const query of queries) {
      for (let page = 1; page <= MAX_PAGES_PER_QUERY; page += 1) {
        tasks.push({ country, query, page });
      }
    }
  }
  // Per-source request budget: never exceed the per-run cap.
  const budgeted = tasks.slice(0, maxRequests);

  stats.countriesQueried = countries.length;
  stats.queriesRun = budgeted.length;

  const fetched = await mapPool(budgeted, 4, async (task) => {
    if (deadline && Date.now() > deadline) return { country: task.country, error: true, results: [] };
    if (stats.rateLimitResetAt) return { country: task.country, error: true, results: [] };

    const cached = await maybeSkipCachedQuery({
      sourceCache,
      policy: refreshPolicy,
      sourceId: 'adzuna',
      query: task.query,
      country: task.country,
      opportunityType,
      extra: `page=${task.page}`,
      requested: options.requested || 'scheduler',
    });
    if (cached.skip) {
      stats.cacheHits += 1;
      return { country: task.country, error: false, results: [], cacheHit: true };
    }

    try {
      const packed = await fetchAdzunaResults({
        country: task.country,
        query: task.query,
        page: task.page,
        appId: cfg.appId,
        appKey: cfg.appKey,
        resultsPerPage,
        maxDaysOld,
        etag: cached.entry?.etag,
        lastModified: cached.entry?.lastModified,
      });
      const results = Array.isArray(packed) ? packed : packed.results || [];
      const notModified = packed?.notModified === true;
      if (notModified) {
        stats.notModified += 1;
        await sourceCache?.touchChecked?.('adzuna', cached.hash, {
          etag: packed.etag,
          lastModified: packed.lastModified,
        });
        return { country: task.country, error: false, results: [], notModified: true };
      }
      await rememberCachedQuery(sourceCache, refreshPolicy, {
        sourceId: 'adzuna',
        query: task.query,
        country: task.country,
        opportunityType,
        extra: `page=${task.page}`,
        hash: cached.hash,
        resultCount: results.length,
        etag: packed.etag,
        lastModified: packed.lastModified,
        status: 'ok',
      });
      await stateStore?.recordRequest?.('adzuna', { remaining: packed.remaining });
      return { country: task.country, error: false, results };
    } catch (err) {
      if (err?.rateLimited && !stats.rateLimitResetAt) {
        stats.rateLimitResetAt = err.rateLimitResetAt || null;
        await rememberCachedQuery(sourceCache, refreshPolicy, {
          sourceId: 'adzuna',
          query: task.query,
          country: task.country,
          opportunityType,
          extra: `page=${task.page}`,
          hash: cached.hash,
          resultCount: 0,
          status: 'rate_limited',
        });
      }
      return { country: task.country, error: true, results: [] };
    }
  });

  for (const batch of fetched) {
    if (!batch) continue;
    if (batch.error) stats.errors += 1;
    const results = Array.isArray(batch.results) ? batch.results : [];
    stats.rawFound += results.length;
    for (const item of results) {
      if (stats.saved >= maxTotal) break;
      if (deadline && Date.now() > deadline) break;
      const listing = normalizeAdzunaListing(item, batch.country);
      if (!listing || seen.has(listing.url)) continue;
      seen.add(listing.url);
      // Track the newest posting we saw — persisted as lastPublishedAt so the
      // next scan can anchor its incremental window.
      if (listing.postedAt && (!stats.lastPublishedAt || new Date(listing.postedAt) > new Date(stats.lastPublishedAt))) {
        stats.lastPublishedAt = listing.postedAt;
      }
      // Incremental cutoff: anything older than the window was already
      // imported by a previous scan — skip without touching the database.
      if (publishedAfter && listing.postedAt && new Date(listing.postedAt).getTime() < publishedAfter) {
        stats.skippedOld += 1;
        continue;
      }
      if (!passesTypeFilter(listing.title, searchMode)) continue;
      if (!isCsFieldRole(listing.title, profile) && !/software|developer|engineer|intern|data|ml|ai|tech|it\b/i.test(listing.title)) {
        continue;
      }
      listing.url = await resolveListingUrl(listing.url);
      if (!isCredibleListingUrl(listing.url)) continue;
      if (!isAllowedTargetListing(listing)) continue;
      try {
        const saved = await saveDiscoveredListing({
          rawOpportunity: listing,
          opportunityRepository,
          authContext,
          profile,
          knownUrls,
        });
        if (saved?.isNew === true) {
          stats.saved += 1;
        } else if (saved?.changed === true) {
          stats.updated = (stats.updated || 0) + 1;
        } else {
          stats.existing += 1;
          continue;
        }
      } catch {
        stats.errors += 1;
      }
    }
  }

  return stats;
}
