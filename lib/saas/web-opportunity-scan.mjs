/**
 * web-opportunity-scan.mjs — Profile-driven portal scan for the SaaS web app.
 *
 * Phase 1: Verified ATS APIs (Careem, 10Pearls, Amazon, Stripe, IBM, …)
 *          — round-robin so every company contributes listings (not IBM-only).
 * Phase 2: Web search queries (Rozee.pk, Mustakbil, LinkedIn, Indeed, …)
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { loadProviders, resolveProvider } from '../../providers/_registry.mjs';
import { makeHttpCtx } from '../../providers/_http.mjs';
import { saveDiscoveredListing } from './opportunity-ingest.mjs';
import { isCsFieldRole, passesSearchMode, isStudentOpportunityTitle } from './cs-field-discovery.mjs';
import { discoverFromSearchQueries } from './web-search-discovery.mjs';
import { discoverPakistanCompanies, loadPakistanCompanies } from './pakistan-company-discovery.mjs';
import { discoverInternationalCompanies, loadInternationalCompanies } from './international-company-discovery.mjs';
import { discoverFromAdzuna } from './adzuna-discovery.mjs';
import { discoverFromPublicJobFeeds } from './public-job-feeds-discovery.mjs';
import { loadLocalAdzunaEnv } from './load-local-env.mjs';
import { STRATEGIES, planFetch } from './discovery-engine/index.mjs';
import { intervalFor } from './discovery-engine/refresh-policy.mjs';
import { emptyScanMetrics, mergeScanMetrics } from './discovery-engine/scan-metrics.mjs';

const DEFAULT_MAX_COMPANIES = 40;
const DEFAULT_MAX_JOBS = 250;
const MAX_LISTINGS_PER_COMPANY = 80;
const MAX_SAVED_PER_COMPANY = 20;
const MAX_WEB_SEARCH_TOTAL = 40;
const MAX_PAKISTAN_COMPANIES_PER_SCAN = 100;
const MAX_PAKISTAN_JOBS = 200;
const MAX_INTERNATIONAL_COMPANIES_PER_SCAN = 100;
const MAX_INTERNATIONAL_JOBS = 200;
const MAX_API_JOBS = 150;

const NATIONAL_COMPANY_NAMES = new Set([
  'Careem',
  'Careem Pakistan',
  '10Pearls',
]);

const INTERNATIONAL_COMPANY_NAMES = new Set([
  'IBM',
  'Amazon / AWS',
  'Stripe',
  'OpenAI',
  'Anthropic',
  'NVIDIA',
]);

const COMPANY_PRIORITY = [
  'Careem',
  '10Pearls',
  'Amazon / AWS',
  'Stripe',
  'IBM',
];

function loadPortalsConfig(repoRoot) {
  const candidates = [
    path.join(repoRoot, 'config', 'pakistan-portals.yml'),
    path.join(repoRoot, 'portals.yml'),
    path.join(repoRoot, 'templates', 'portals.example.yml'),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      return yaml.load(fs.readFileSync(file, 'utf-8')) || {};
    }
  }
  return {};
}

function formatScanMessage(stats) {
  const metrics = stats.metrics || {};
  const newCount = metrics.new ?? stats.newCount ?? stats.verifiedMatched ?? 0;
  const existingCount = metrics.duplicates ?? stats.existingCount ?? 0;
  const updatedCount = metrics.updated ?? 0;
  const pk = stats.pakistanTop100 || {};
  const intl = stats.internationalTop100 || {};
  const adz = stats.apis?.adzuna || {};
  const adzBit = adz.configured
    ? `Adzuna ${adz.saved || 0} new`
    : adz.reason === "skipped_fresh"
      ? "Adzuna fresh (skipped)"
      : adz.reason === "skipped_rate_limited"
        ? "Adzuna rate-limited (waiting)"
        : adz.reason
          ? `Adzuna skipped (${adz.reason})`
          : "Adzuna skipped";
  const pkBit = pk.skipped
    ? "Pakistan fresh (skipped)"
    : `Pakistan ${pk.companiesScanned || 0}/${pk.totalCompanies || 100} companies`;
  const intlBit = intl.skipped
    ? "international fresh (skipped)"
    : `international ${intl.companiesScanned || 0}/${intl.totalCompanies || 100}`;
  const updatedBit = updatedCount ? `, ${updatedCount} updated` : "";
  return `${newCount} new listing${newCount === 1 ? "" : "s"} saved${
    existingCount ? ` (${existingCount} already stored)` : ""
  }${updatedBit}. ${pkBit}, ${intlBit}, ${adzBit}.`;
}

function compactByCompany(byCompany = {}) {
  return Object.fromEntries(
    Object.entries(byCompany)
      .filter(([, count]) => Number(count) > 0)
      .slice(0, 40)
  );
}

function remainingMs(deadlineAt) {
  if (!deadlineAt) return Number.POSITIVE_INFINITY;
  return deadlineAt - Date.now();
}

function inferMarket(companyName) {
  if (NATIONAL_COMPANY_NAMES.has(companyName)) return 'NATIONAL';
  if (INTERNATIONAL_COMPANY_NAMES.has(companyName)) return 'INTERNATIONAL';
  return 'INTERNATIONAL';
}

function sortCompanies(companies = []) {
  return [...companies].sort((a, b) => {
    const ai = COMPANY_PRIORITY.indexOf(a.name);
    const bi = COMPANY_PRIORITY.indexOf(b.name);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

function passesTypeFilter(title, mode) {
  return passesSearchMode(title, mode);
}

async function scanAtsRoundRobin({
  companies,
  providers,
  httpCtx,
  profile,
  opportunityRepository,
  authContext,
  searchMode,
  maxJobs,
  knownUrls = null,
}) {
  const stats = {
    companiesScanned: 0,
    rawFound: 0,
    verifiedMatched: 0,
    existing: 0,
    skipped: { title: 0, location: 0, type: 0, errors: 0, provider: 0 },
    ingested: [],
    byCompany: {},
  };

  const seenUrls = new Set();
  const companySavedCounts = new Map();
  const companyJobs = [];

  for (const company of companies) {
    const resolved = resolveProvider(company, providers);
    if (!resolved?.provider) {
      stats.skipped.provider += 1;
      continue;
    }

    stats.companiesScanned += 1;
    let jobs = [];
    try {
      jobs = await resolved.provider.fetch(company, httpCtx);
    } catch {
      stats.skipped.errors += 1;
      continue;
    }

    if (jobs.length > MAX_LISTINGS_PER_COMPANY) {
      jobs = jobs.slice(0, MAX_LISTINGS_PER_COMPANY);
    }

    if (searchMode === 'INTERNSHIP') {
      jobs = jobs
        .filter((j) => isStudentOpportunityTitle(j.title || ''))
        .concat(jobs.filter((j) => !isStudentOpportunityTitle(j.title || '')));
    }

    const filtered = [];
    for (const job of jobs) {
      if (!job?.url || seenUrls.has(job.url)) continue;
      if (!isCsFieldRole(job.title || '', profile)) {
        stats.skipped.title += 1;
        continue;
      }
      if (!passesTypeFilter(job.title || '', searchMode)) {
        stats.skipped.type += 1;
        continue;
      }
      filtered.push(job);
    }

    companyJobs.push({ company, providerId: resolved.provider.id, jobs: filtered });
    stats.byCompany[company.name] = filtered.length;
    companySavedCounts.set(company.name, 0);
  }

  let round = 0;
  while (stats.ingested.length < maxJobs) {
    let addedThisRound = 0;
    for (const bucket of companyJobs) {
      if (stats.ingested.length >= maxJobs) break;
      const savedForCompany = companySavedCounts.get(bucket.company.name) || 0;
      if (savedForCompany >= MAX_SAVED_PER_COMPANY) continue;

      const job = bucket.jobs[round];
      if (!job?.url || seenUrls.has(job.url)) continue;

      seenUrls.add(job.url);
      stats.rawFound += 1;

      try {
        const saved = await saveDiscoveredListing({
          rawOpportunity: {
            ...job,
            company: job.company || bucket.company.name,
            source_name: bucket.providerId,
            market: inferMarket(bucket.company.name),
            discovery_mode: 'ats_scan',
          },
          opportunityRepository,
          authContext,
          profile,
          knownUrls,
        });
        if (saved?.isNew === false) {
          stats.existing += 1;
          continue;
        }
        stats.verifiedMatched += 1;
        companySavedCounts.set(bucket.company.name, savedForCompany + 1);
        addedThisRound += 1;
      } catch {
        stats.skipped.errors += 1;
      }
    }
    if (addedThisRound === 0) break;
    round += 1;
  }

  return stats;
}

async function scanCsFieldListings({
  repoRoot,
  profile,
  opportunityRepository,
  authContext,
  options = {},
}) {
  loadLocalAdzunaEnv(repoRoot);
  const portalsConfig = loadPortalsConfig(repoRoot);
  const providers = await loadProviders(path.join(repoRoot, 'providers'));
  const httpCtx = makeHttpCtx();
  const searchMode = options.searchMode ?? 'BOTH';
  const market = options.market ?? 'ALL';
  const maxCompanies = options.maxCompanies ?? DEFAULT_MAX_COMPANIES;
  const maxJobs = options.maxJobs ?? DEFAULT_MAX_JOBS;
  const pakistanStartIndex = options.pakistanStartIndex ?? 0;
  const deadlineAt =
    options.deadlineMs === 0 ? 0 : Number(options.deadlineAt) || Date.now() + (options.deadlineMs || 240_000);
  const usePlaywright = options.usePlaywright === true;
  const includeWebSearch = options.includeWebSearch === true;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  // Incremental discovery: the backend (not the frontend) decides per source
  // whether a fetch is needed. With a state store present, each source is
  // gated by its DiscoveryStrategy: INITIAL on first run, INCREMENTAL after,
  // SKIP while fresh or rate-limited (docs/INCREMENTAL_DISCOVERY.md).
  const stateStore = options.discoveryStateStore || null;
  const sourceCache = options.sourceCache || null;
  const refreshPolicy = options.refreshPolicy || null;
  const force = options.force === true;
  const discoveryPlans = {};

  async function planSource(sourceId) {
    const fallback = {
      mode: 'initial',
      reason: 'no_state_store',
      publishedAfter: null,
      maxDaysOld: null,
      dedupeOnly: true,
    };
    if (!stateStore || !STRATEGIES[sourceId]) {
      discoveryPlans[sourceId] = fallback;
      return fallback;
    }
    try {
      const state = await stateStore.get(sourceId);
      const plan = planFetch(STRATEGIES[sourceId], state, {
        force,
        intervalMs: refreshPolicy ? intervalFor(refreshPolicy, sourceId) : undefined,
      });
      discoveryPlans[sourceId] = { mode: plan.mode, reason: plan.reason };
      if (plan.mode !== 'skip') await stateStore.recordAttempt(sourceId);
      return plan;
    } catch {
      discoveryPlans[sourceId] = fallback;
      return fallback;
    }
  }

  async function recordOutcome(sourceId, { errored, error, rateLimitResetAt, lastPublishedAt, lastNewCount, lastUpdatedCount } = {}) {
    if (!stateStore || !STRATEGIES[sourceId]) return;
    try {
      if (rateLimitResetAt) {
        await stateStore.recordFailure(sourceId, error || 'rate_limited', { rateLimitResetAt, rateLimited: true });
      } else if (errored) {
        await stateStore.recordFailure(sourceId, error || 'scan_error');
      } else {
        await stateStore.recordSuccess(sourceId, {
          lastPublishedAt: lastPublishedAt || null,
          lastNewCount,
          lastUpdatedCount,
        });
      }
    } catch {
      // state persistence failures never break the scan itself
    }
  }

  let knownUrls = new Set();
  if (typeof opportunityRepository.listKnownUrls === "function") {
    try {
      knownUrls = await opportunityRepository.listKnownUrls(authContext);
    } catch {
      knownUrls = new Set();
    }
  }

  let atsStats = {
    companiesScanned: 0,
    rawFound: 0,
    verifiedMatched: 0,
    existing: 0,
    skipped: { title: 0, location: 0, type: 0, errors: 0, provider: 0 },
    ingested: [],
    byCompany: {},
  };
  let webStats = { queriesRun: 0, urlsFound: 0, saved: 0, ingested: [] };
  let publicFeedStats = { saved: 0, existing: 0, rawFound: 0, errors: 0, ingested: [] };
  let pakistanStats = {
    companiesScanned: 0,
    rawFound: 0,
    saved: 0,
    existing: 0,
    ingested: [],
    byCompany: {},
    nextStartIndex: 0,
    totalCompanies: 0,
  };
  let internationalStats = {
    companiesScanned: 0,
    rawFound: 0,
    saved: 0,
    existing: 0,
    ingested: [],
    byCompany: {},
    nextStartIndex: 0,
    totalCompanies: 0,
  };
  let apiStats = {
    adzuna: {
      configured: false,
      reason: 'not_run',
      countriesQueried: 0,
      queriesRun: 0,
      rawFound: 0,
      saved: 0,
      existing: 0,
      errors: 0,
      ingested: [],
    },
  };

  // Official career sites and Adzuna run together — Adzuna is not the only source.
  if (!options.light && remainingMs(deadlineAt) > 8_000) {
    onProgress?.({
      phase: "career_sites",
      message: "Crawling 100 Pakistan + 100 international career sites, plus Adzuna…",
    });
    const tasks = [];
    if (market === "ALL" || market === "INTERNATIONAL" || market === "NATIONAL") {
      const adzunaPlan = await planSource('adzuna');
      if (adzunaPlan.mode === 'skip') {
        apiStats.adzuna.reason = `skipped_${adzunaPlan.reason}`;
        onProgress?.({
          phase: "adzuna",
          message:
            adzunaPlan.reason === 'rate_limited'
              ? "Adzuna: rate-limited, waiting for the reset window"
              : "Adzuna: already fresh, serving saved listings",
        });
      } else {
        tasks.push(
          discoverFromAdzuna({
            repoRoot,
            profile,
            opportunityRepository,
            authContext,
            options: {
              searchMode,
              market,
              maxTotal: options.maxApiJobs ?? MAX_API_JOBS,
              deadlineAt: deadlineAt || 0,
              knownUrls,
              sourceCache,
              refreshPolicy,
              discoveryStateStore: stateStore,
              requested: force ? 'manual' : 'scheduler',
              // Incremental window from the plan: initial = historical window,
              // incremental = only what may be new since the last success.
              maxDaysOld: adzunaPlan.maxDaysOld,
              publishedAfter: adzunaPlan.publishedAfter,
              maxRequests: STRATEGIES.adzuna.maxRequestsPerRun,
            },
          }).then(async (stats) => {
            apiStats.adzuna = stats;
            await recordOutcome('adzuna', {
              errored: Boolean(stats.errors) || (stats.configured === false && stats.reason && !String(stats.reason).startsWith('skipped_')),
              error: stats.reason || (stats.errors ? 'adzuna_fetch_error' : null),
              rateLimitResetAt: stats.rateLimitResetAt,
              lastPublishedAt: stats.lastPublishedAt,
              lastNewCount: stats.saved,
              lastUpdatedCount: (stats.updated || 0) + (stats.existing || 0),
            });
            onProgress?.({
              phase: "adzuna",
              message: `Adzuna (${adzunaPlan.mode}): ${stats.saved || 0} new listings${stats.existing ? ` (${stats.existing} already saved)` : ""}${stats.skippedOld ? `, ${stats.skippedOld} older than the window` : ""}`,
            });
            return stats;
          })
        );
      }
    }
    if (market === "ALL" || market === "NATIONAL") {
      const pkPlan = await planSource('pakistan-top100');
      if (pkPlan.mode === 'skip') {
        pakistanStats.skipped = true;
        pakistanStats.reason = `skipped_${pkPlan.reason}`;
        onProgress?.({ phase: "pakistan", message: "Pakistan career sites: already fresh, serving saved listings" });
      } else {
        tasks.push(
          discoverPakistanCompanies({
            repoRoot,
            profile,
            opportunityRepository,
            authContext,
            options: {
              searchMode,
              maxCompanies: options.maxPakistanCompanies ?? MAX_PAKISTAN_COMPANIES_PER_SCAN,
              maxJobs: market === "NATIONAL" ? maxJobs : MAX_PAKISTAN_JOBS,
              maxPerCompany: options.maxPerCompany ?? 8,
              startIndex: pakistanStartIndex,
              concurrency: 12,
              usePlaywright,
              playwrightBudget: usePlaywright ? (options.playwrightBudget ?? 40) : 0,
              knownUrls,
              sourceCache,
              refreshPolicy,
              requested: force ? 'manual' : 'scheduler',
            },
          }).then(async (stats) => {
            pakistanStats = stats;
            await recordOutcome('pakistan-top100', {
              lastNewCount: stats.saved,
              lastUpdatedCount: stats.existing,
            });
            onProgress?.({
              phase: "pakistan",
              message: `Pakistan career sites: ${stats.companiesScanned || 0}/${stats.totalCompanies || 100} scanned, ${stats.saved || 0} new`,
            });
            return stats;
          })
        );
      }
    }
    if (market === "ALL" || market === "INTERNATIONAL") {
      const intlPlan = await planSource('international-top100');
      if (intlPlan.mode === 'skip') {
        internationalStats.skipped = true;
        internationalStats.reason = `skipped_${intlPlan.reason}`;
        onProgress?.({ phase: "international", message: "International career sites: already fresh, serving saved listings" });
      } else {
        tasks.push(
          discoverInternationalCompanies({
            repoRoot,
            profile,
            opportunityRepository,
            authContext,
            options: {
              searchMode,
              maxCompanies: options.maxInternationalCompanies ?? MAX_INTERNATIONAL_COMPANIES_PER_SCAN,
              maxJobs: market === "INTERNATIONAL" ? maxJobs : MAX_INTERNATIONAL_JOBS,
              maxPerCompany: options.maxPerCompany ?? 8,
              concurrency: 12,
              usePlaywright,
              playwrightBudget: usePlaywright ? (options.playwrightBudget ?? 12) : 0,
              knownUrls,
              sourceCache,
              refreshPolicy,
              requested: force ? 'manual' : 'scheduler',
            },
          }).then(async (stats) => {
            internationalStats = stats;
            await recordOutcome('international-top100', {
              lastNewCount: stats.saved,
              lastUpdatedCount: stats.existing,
            });
            onProgress?.({
              phase: "international",
              message: `International career sites: ${stats.companiesScanned || 0} scanned, ${stats.saved || 0} new`,
            });
            return stats;
          })
        );
      }
    }
    await Promise.all(tasks);
  } else if (options.light && (market === "ALL" || market === "NATIONAL")) {
    const pkAts = sortCompanies(
      (portalsConfig.tracked_companies || []).filter(
        (c) =>
          c &&
          c.enabled !== false &&
          NATIONAL_COMPANY_NAMES.has(c.name) &&
          (c.careers_url || c.api || c.provider)
      )
    );
    const lightPlan = await planSource('ats-round-robin');
    if (pkAts.length > 0 && lightPlan.mode !== 'skip') {
      const pkAtsStats = await scanAtsRoundRobin({
        companies: pkAts,
        providers,
        httpCtx,
        profile,
        opportunityRepository,
        authContext,
        searchMode,
        maxJobs: Math.min(20, maxJobs),
        knownUrls,
      });
      await recordOutcome('ats-round-robin');
      pakistanStats = {
        companiesScanned: pkAtsStats.companiesScanned,
        rawFound: pkAtsStats.rawFound,
        saved: pkAtsStats.verifiedMatched,
        existing: pkAtsStats.existing || 0,
        ingested: [],
        byCompany: pkAtsStats.byCompany,
        nextStartIndex: pakistanStartIndex,
      };
    }
  }

  if ((market === "ALL" || market === "INTERNATIONAL") && remainingMs(deadlineAt) > 8_000) {
    const companies = sortCompanies(
      (portalsConfig.tracked_companies || []).filter(
        (c) => c && c.enabled !== false && (c.careers_url || c.api || c.provider)
      )
    ).slice(0, maxCompanies);

    if (companies.length > 0 && remainingMs(deadlineAt) > 8_000) {
      const atsPlan = await planSource('ats-round-robin');
      if (atsPlan.mode === 'skip') {
        atsStats.skipped = true;
        atsStats.reason = `skipped_${atsPlan.reason}`;
      } else {
        onProgress?.({ phase: "ats", message: "Checking configured ATS career feeds…" });
        atsStats = await scanAtsRoundRobin({
          companies,
          providers,
          httpCtx,
          profile,
          opportunityRepository,
          authContext,
          searchMode,
          maxJobs: options.light ? Math.min(30, maxJobs) : market === "INTERNATIONAL" ? maxJobs : Math.floor(maxJobs * 0.35),
          knownUrls,
        });
        await recordOutcome('ats-round-robin');
      }
    }
  }

  const webQueries = (portalsConfig.search_queries || []).filter((q) => q?.enabled !== false);
  if (includeWebSearch && webQueries.length > 0 && !options.light && remainingMs(deadlineAt) > 12_000) {
    webStats = await discoverFromSearchQueries({
      queries: webQueries,
      profile,
      opportunityRepository,
      authContext,
      maxTotal: MAX_WEB_SEARCH_TOTAL,
      maxPerQuery: 5,
    });
  }

  if (!options.light && remainingMs(deadlineAt) > 8_000) {
    onProgress?.({
      phase: 'public_feeds',
      message: 'Checking verified remote job feeds (Remotive, Jobicy)…',
    });
    publicFeedStats = await discoverFromPublicJobFeeds({
      profile,
      opportunityRepository,
      authContext,
      options: { searchMode, maxTotal: 80, knownUrls },
    });
  }

  const newCount =
    (webStats.saved || 0) +
    (pakistanStats.saved || 0) +
    (internationalStats.saved || 0) +
    (atsStats.verifiedMatched || 0) +
    (apiStats.adzuna.saved || 0) +
    (publicFeedStats.saved || 0);
  const existingCount =
    (pakistanStats.existing || 0) +
    (internationalStats.existing || 0) +
    (atsStats.existing || 0) +
    (apiStats.adzuna.existing || 0) +
    (publicFeedStats.existing || 0);

  const metrics = emptyScanMetrics();
  mergeScanMetrics(metrics, {
    fetched:
      (webStats.urlsFound || 0) +
      (pakistanStats.rawFound || 0) +
      (internationalStats.rawFound || 0) +
      (atsStats.rawFound || 0) +
      (apiStats.adzuna.rawFound || 0) +
      (publicFeedStats.rawFound || 0),
    new: newCount,
    updated:
      (pakistanStats.updated || 0) +
      (internationalStats.updated || 0) +
      (atsStats.updated || 0) +
      (apiStats.adzuna.updated || 0) +
      (publicFeedStats.updated || 0),
    duplicates: existingCount,
    failed:
      (pakistanStats.errors || 0) +
      (internationalStats.errors || 0) +
      (apiStats.adzuna.errors || 0) +
      (publicFeedStats.errors || 0),
  });
  metrics.normalized = metrics.new + metrics.updated + metrics.duplicates;

  const pakistanTop100 = {
    companiesScanned: pakistanStats.companiesScanned,
    saved: pakistanStats.saved,
    existing: pakistanStats.existing || 0,
    skipped: pakistanStats.skipped === true,
    nextStartIndex: pakistanStats.nextStartIndex,
    totalCompanies: pakistanStats.totalCompanies || loadPakistanCompanies(repoRoot).length,
  };
  const internationalTop100 = {
    companiesScanned: internationalStats.companiesScanned,
    saved: internationalStats.saved,
    existing: internationalStats.existing || 0,
    skipped: internationalStats.skipped === true,
    nextStartIndex: internationalStats.nextStartIndex,
    totalCompanies: internationalStats.totalCompanies || loadInternationalCompanies(repoRoot).length,
  };
  const stats = {
    companiesScanned: atsStats.companiesScanned + pakistanStats.companiesScanned + internationalStats.companiesScanned,
    rawFound:
      webStats.urlsFound +
      pakistanStats.rawFound +
      internationalStats.rawFound +
      atsStats.rawFound +
      apiStats.adzuna.rawFound +
      publicFeedStats.rawFound,
    verifiedMatched: newCount,
    newCount,
    existingCount,
    metrics,
    fetched: metrics.fetched,
    normalized: metrics.normalized,
    updatedCount: metrics.updated,
    duplicates: metrics.duplicates,
    failed: metrics.failed,
    skipped: atsStats.skipped,
    discoveryMode: market === "NATIONAL" ? "pakistan_top100" : "cs_field",
    market,
    byCompany: compactByCompany({
      ...pakistanStats.byCompany,
      ...internationalStats.byCompany,
      ...atsStats.byCompany,
    }),
    webSearch: {
      queriesRun: webStats.queriesRun,
      urlsFound: webStats.urlsFound,
      saved: webStats.saved,
    },
    pakistanTop100,
    internationalTop100,
    // Per-source incremental plan chosen for this run (initial/incremental/skip).
    discovery: discoveryPlans,
    apis: {
      adzuna: {
        configured: apiStats.adzuna.configured,
        reason: apiStats.adzuna.reason,
        countriesQueried: apiStats.adzuna.countriesQueried,
        queriesRun: apiStats.adzuna.queriesRun,
        rawFound: apiStats.adzuna.rawFound,
        saved: apiStats.adzuna.saved,
        existing: apiStats.adzuna.existing || 0,
        skippedOld: apiStats.adzuna.skippedOld || 0,
        errors: apiStats.adzuna.errors,
      },
    },
  };
  stats.message = formatScanMessage(stats);
  return stats;
}

export async function scanOpportunitiesForUser(params) {
  return scanCsFieldListings(params);
}
