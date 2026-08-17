/**
 * pakistan-company-discovery.mjs — Scan official career pages for Pakistan Top 100 companies.
 * Uses ATS providers when detected; otherwise Playwright to extract job links from careers pages.
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { loadProviders, resolveProvider } from '../../providers/_registry.mjs';
import { makeHttpCtx } from '../../providers/_http.mjs';
import { saveDiscoveredListing } from './opportunity-ingest.mjs';
import { passesSearchMode } from './cs-field-discovery.mjs';
import { inferLocationFromListing, isGarbageTitle, isSearchOrCategoryUrl } from './listing-quality.mjs';
import { isCredibleListingUrl } from './listing-url.mjs';
import { fetchCareersListings, mapPool, companyScanUrl } from './careers-http-scrape.mjs';
import { maybeSkipCachedQuery, rememberCachedQuery } from './discovery-engine/source-cache.mjs';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const PK_LOCATION_HINTS = /pakistan|karachi|lahore|islamabad|rawalpindi|faisalabad|peshawar|multan|remote/i;
const JOB_LINK_HINT =
  /\bjobs?\b|\bcareer|\bvacanc|\bintern(?:s|ship|ships)?\b|\bopening|\bposition|\brecruit|\bhiring|\bopportunit/i;
const SKIP_LINK = /facebook|twitter|instagram|youtube|linkedin\.com\/company|privacy|terms|contact|login|signup|\/faq|\/why-|about-us|our-culture|benefits|life-at|#$/i;
const JOB_TITLE_HINT = /\bintern(?:ship)?\b|\btrainee\b|engineer|developer|analyst|officer|manager|associate|specialist|consultant|executive|graduate|vacanc|opening|position|role|hiring|\bjobs?\b/i;

let browser = null;

async function getBrowser() {
  if (browser) return browser;
  const { chromium } = await import('playwright');
  browser = await chromium.launch({ headless: true });
  return browser;
}

async function closeBrowser() {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}

export function loadPakistanCompanies(repoRoot) {
  const file = path.join(repoRoot, 'config', 'pakistan-top100-companies.yml');
  if (!fs.existsSync(file)) return [];
  const data = yaml.load(fs.readFileSync(file, 'utf-8')) || {};
  return (data.pakistan_companies || []).filter((c) => c?.enabled !== false && (c?.jobs_url || c?.careers_url));
}

function passesTypeFilter(title, searchMode) {
  return passesSearchMode(title, searchMode);
}

function looksLikeJobPosting(title, url, careersUrl = '') {
  const combined = `${title} ${url}`.toLowerCase();
  if (SKIP_LINK.test(combined)) return false;
  if (isSearchOrCategoryUrl(url)) return false;
  if (isGarbageTitle(title)) return false;
  if (combined.length < 8) return false;
  if (!JOB_LINK_HINT.test(combined) && !JOB_TITLE_HINT.test(combined)) return false;
  if (!isCredibleListingUrl(url, careersUrl ? { careersUrl } : {})) return false;
  return true;
}

function inferLocation(title, url, company) {
  const loc = inferLocationFromListing(url, title);
  if (loc) return loc;
  // Official PK employer careers site — company is from Top 100 list
  if (company?.name) return 'Pakistan';
  return null;
}

async function fetchViaProvider(company, providers, httpCtx) {
  const entry = {
    name: company.name,
    careers_url: company.jobs_url || company.careers_url,
    provider: company.provider,
    enabled: true,
  };
  const resolved = resolveProvider(entry, providers);
  if (!resolved?.provider) return [];

  try {
    const jobs = await resolved.provider.fetch(entry, httpCtx);
    return (jobs || []).map((j) => ({
      title: j.title,
      url: j.url,
      location: j.location || inferLocation(j.title, j.url, company),
      company: company.name,
      source_name: resolved.provider.id,
    }));
  } catch {
    return [];
  }
}

async function scrapeCareersPage(company, maxLinks = 10) {
  const results = [];
  const startUrl = companyScanUrl(company);
  if (!startUrl) return results;
  try {
    const b = await getBrowser();
    const page = await b.newPage({ userAgent: USER_AGENT });
    const res = await page.goto(startUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 25_000,
    });
    if (!res || res.status() >= 400) {
      await page.close();
      return [];
    }
    await page.waitForTimeout(2500);

    const viewAll = page.getByText(/view (all )?jobs|explore (current )?opportunit|see (all )?openings|click here to view all jobs|current opportunities/i).first();
    if ((await viewAll.count().catch(() => 0)) && (await viewAll.isVisible().catch(() => false))) {
      await viewAll.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(2000);
    }

    const links = await page.evaluate(() => {
      const skip = /facebook|twitter|instagram|youtube|privacy|terms|contact-us|login|signup/i;
      const seen = new Set();
      const out = [];
      const nodes = document.querySelectorAll('a[href], [data-href], [data-url], [data-job-id], [data-job-url]');
      for (const a of nodes) {
        const href = a.href || a.getAttribute('data-href') || a.getAttribute('data-url') || a.getAttribute('data-job-url') || '';
        if (!href || !href.startsWith('http') || seen.has(href)) continue;
        const text = (a.textContent || a.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ');
        if (skip.test(`${text} ${href}`)) continue;
        seen.add(href);
        out.push({ url: href, title: text.slice(0, 120) || 'Open role' });
      }
      return out;
    });

    await page.close();

    for (const link of links) {
      if (!looksLikeJobPosting(link.title, link.url, startUrl)) continue;
      results.push({
        title: link.title,
        url: link.url,
        location: inferLocation(link.title, link.url, company),
        company: company.name,
        source_name: 'official-careers',
      });
      if (results.length >= maxLinks) break;
    }
  } catch {
    // site unreachable or blocked
  }
  return results;
}

/**
 * @param {object} params
 */
export async function discoverPakistanCompanies({
  repoRoot,
  profile,
  opportunityRepository,
  authContext,
  options = {},
}) {
  const companies = loadPakistanCompanies(repoRoot);
  const providers = await loadProviders(path.join(repoRoot, 'providers'));
  const httpCtx = makeHttpCtx();
  const searchMode = options.searchMode ?? 'BOTH';
  const maxCompanies = options.maxCompanies ?? 100;
  const maxJobs = options.maxJobs ?? 80;
  const maxPerCompany = options.maxPerCompany ?? 12;
  const startIndex = options.startIndex ?? 0;
  const concurrency = options.concurrency ?? 8;
  const usePlaywright = options.usePlaywright !== false;
  let playwrightLeft = usePlaywright ? Math.min(40, options.playwrightBudget ?? 40) : 0;

  const batch = [];
  for (let i = 0; i < Math.min(maxCompanies, companies.length); i += 1) {
    batch.push(companies[(startIndex + i) % companies.length]);
  }

  const stats = {
    companiesScanned: 0,
    rawFound: 0,
    saved: 0,
    existing: 0,
    ingested: [],
    byCompany: {},
    errors: 0,
    nextStartIndex: companies.length ? (startIndex + batch.length) % companies.length : 0,
    totalCompanies: companies.length,
  };

  const knownUrls = options.knownUrls instanceof Set ? options.knownUrls : new Set();
  const sourceCache = options.sourceCache || null;
  const refreshPolicy = options.refreshPolicy || null;

  const seenUrls = new Set();
  const scanKey = (company) => companyScanUrl(company) || company.name;
  const fetched = await mapPool(batch, concurrency, async (company) => {
    const cached = await maybeSkipCachedQuery({
      sourceCache,
      policy: refreshPolicy,
      sourceId: 'pakistan-top100',
      query: scanKey(company),
      country: 'pk',
      requested: options.requested || 'scheduler',
    });
    if (cached.skip) {
      return { company, listings: [], skipped: true };
    }
    let listings = await fetchViaProvider(company, providers, httpCtx);
    let meta = { etag: cached.entry?.etag, lastModified: cached.entry?.lastModified, notModified: false };
    if (!listings.length) {
      const page = await fetchCareersListings(company, {
        maxLinks: maxPerCompany * 3,
        etag: cached.entry?.etag,
        lastModified: cached.entry?.lastModified,
      });
      if (page.notModified) {
        await sourceCache?.touchChecked?.('pakistan-top100', cached.hash, {
          etag: page.etag,
          lastModified: page.lastModified,
        });
        return { company, listings: [], skipped: true, notModified: true };
      }
      listings = (page.listings || []).map((link) => ({
        title: link.title,
        url: link.url,
        location: inferLocation(link.title, link.url, company),
        company: company.name,
        source_name: 'official-careers',
      }));
      meta = page;
    }
    listings = listings.filter((l) => looksLikeJobPosting(l.title, l.url, scanKey(company)));
    return { company, listings, skipped: false, hash: cached.hash, meta };
  });

  const needBrowser = fetched
    .filter((row) => row && !row.skipped && !(row.listings || []).length)
    .sort((a, b) => Number(Boolean(b.company?.needs_browser)) - Number(Boolean(a.company?.needs_browser)));
  for (const row of needBrowser) {
    if (playwrightLeft <= 0) break;
    playwrightLeft -= 1;
    row.listings = await scrapeCareersPage(row.company, maxPerCompany * 2);
  }

  for (const row of fetched) {
    if (!row || row.skipped || !row.hash) continue;
    await rememberCachedQuery(sourceCache, refreshPolicy, {
      sourceId: 'pakistan-top100',
      query: scanKey(row.company),
      country: 'pk',
      hash: row.hash,
      resultCount: (row.listings || []).length,
      etag: row.meta?.etag,
      lastModified: row.meta?.lastModified,
      status: 'ok',
    });
  }

  for (const row of fetched) {
    if (!row || stats.saved >= maxJobs) continue;
    let { company, listings } = row;
    stats.companiesScanned += 1;

    const pkListings = listings.filter(
      (l) => PK_LOCATION_HINTS.test(`${l.title} ${l.location} ${l.url}`) || company.sector
    );
    const pool = pkListings.length > 0 ? pkListings : listings;

    let savedForCompany = 0;
    stats.byCompany[company.name] = 0;

    for (const job of pool) {
      if (stats.saved >= maxJobs || savedForCompany >= maxPerCompany) break;
      if (!job?.url || seenUrls.has(job.url)) continue;
      if (!passesTypeFilter(job.title, searchMode)) continue;
      if (!looksLikeJobPosting(job.title, job.url, scanKey(company))) continue;

      const location = job.location || inferLocation(job.title, job.url, company) || 'Pakistan';

      seenUrls.add(job.url);
      stats.rawFound += 1;

      try {
        const saved = await saveDiscoveredListing({
          rawOpportunity: {
            title: job.title,
            url: job.url,
            company: job.company || company.name,
            location,
            source_name: job.source_name || 'official-careers',
            description: `${job.title} at ${company.name} (${company.sector}). From official careers page.`,
            market: 'NATIONAL',
            sector: company.sector,
            discovery_mode: 'pakistan_top100',
          },
          opportunityRepository,
          authContext,
          profile,
          knownUrls,
        });
        if (saved?.isNew === true) {
          stats.saved += 1;
          savedForCompany += 1;
          stats.byCompany[company.name] = savedForCompany;
          stats.ingested.push(saved);
        } else if (saved?.changed === true) {
          stats.updated = (stats.updated || 0) + 1;
        } else {
          stats.existing += 1;
        }
      } catch {
        stats.errors += 1;
      }
    }
  }

  await closeBrowser();
  return stats;
}
