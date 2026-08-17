/**
 * international-company-discovery.mjs — Scan official career pages for global employers.
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { loadProviders, resolveProvider } from '../../providers/_registry.mjs';
import { makeHttpCtx } from '../../providers/_http.mjs';
import { saveDiscoveredListing } from './opportunity-ingest.mjs';
import { isCsFieldRole, passesSearchMode } from './cs-field-discovery.mjs';
import { inferLocationFromListing, isGarbageTitle, isSearchOrCategoryUrl, isAllowedTargetListing } from './listing-quality.mjs';
import { isCredibleListingUrl } from './listing-url.mjs';
import { fetchCareersListings, mapPool } from './careers-http-scrape.mjs';
import { maybeSkipCachedQuery, rememberCachedQuery } from './discovery-engine/source-cache.mjs';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const JOB_LINK_HINT =
  /\bjobs?\b|\bcareer|\bintern(?:s|ship|ships)?\b|\bopening|\bposition|\brecruit|\bhiring|\bopportunit|university|graduate/i;
const SKIP_LINK = /facebook|twitter|instagram|youtube|linkedin\.com\/company|privacy|terms|contact|login|signup|\/faq|about-us|benefits|#$/i;
const JOB_TITLE_HINT = /\bintern(?:ship)?\b|graduate|\btrainee\b|engineer|developer|analyst|scientist|specialist|associate|software|data|machine learning|\bai\b|cloud|security|product/i;

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

export function loadInternationalCompanies(repoRoot) {
  const file = path.join(repoRoot, 'config', 'international-top100-companies.yml');
  if (!fs.existsSync(file)) return [];
  const data = yaml.load(fs.readFileSync(file, 'utf-8')) || {};
  return (data.international_companies || []).filter((c) => c?.enabled !== false && c?.careers_url);
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
  if (/\b(remote|work from home|\bwfh\b)\b/i.test(`${title} ${url}`)) return 'Remote';
  return null;
}

async function fetchViaProvider(company, providers, httpCtx) {
  const entry = {
    name: company.name,
    careers_url: company.careers_url,
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
  try {
    const b = await getBrowser();
    const page = await b.newPage({ userAgent: USER_AGENT });
    const res = await page.goto(company.careers_url, {
      waitUntil: 'domcontentloaded',
      timeout: 25_000,
    });
    if (!res || res.status() >= 400) {
      await page.close();
      return [];
    }
    await page.waitForTimeout(2000);
    const links = await page.evaluate(({ jobHint }) => {
      const hint = new RegExp(jobHint, 'i');
      const skip = /facebook|twitter|instagram|youtube|privacy|terms|contact-us|login|signup/i;
      const seen = new Set();
      const out = [];
      for (const a of document.querySelectorAll('a[href]')) {
        const href = a.href;
        if (!href || !href.startsWith('http') || seen.has(href)) continue;
        const text = (a.textContent || '').trim().replace(/\s+/g, ' ');
        const combined = `${text} ${href}`;
        if (skip.test(combined)) continue;
        if (!hint.test(combined)) continue;
        if (text.length < 4 && !hint.test(href)) continue;
        seen.add(href);
        out.push({ url: href, title: text.slice(0, 140) || 'Open role' });
      }
      return out;
    }, { jobHint: JOB_LINK_HINT.source });
    await page.close();

    for (const link of links) {
      if (!looksLikeJobPosting(link.title, link.url, company.careers_url)) continue;
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
    // unreachable or blocked
  }
  return results;
}

export async function discoverInternationalCompanies({
  repoRoot,
  profile,
  opportunityRepository,
  authContext,
  options = {},
}) {
  const companies = loadInternationalCompanies(repoRoot);
  const providers = await loadProviders(path.join(repoRoot, 'providers'));
  const httpCtx = makeHttpCtx();
  const searchMode = options.searchMode ?? 'BOTH';
  const maxCompanies = options.maxCompanies ?? 100;
  const maxJobs = options.maxJobs ?? 80;
  const maxPerCompany = options.maxPerCompany ?? 12;
  const startIndex = options.startIndex ?? 0;
  const concurrency = options.concurrency ?? 8;
  const usePlaywright = options.usePlaywright !== false;
  let playwrightLeft = usePlaywright ? Math.min(6, options.playwrightBudget ?? 6) : 0;
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
  const seenUrls = new Set();
  const knownUrls = options.knownUrls instanceof Set ? options.knownUrls : new Set();
  const sourceCache = options.sourceCache || null;
  const refreshPolicy = options.refreshPolicy || null;

  const fetched = await mapPool(batch, concurrency, async (company) => {
    const cached = await maybeSkipCachedQuery({
      sourceCache,
      policy: refreshPolicy,
      sourceId: 'international-top100',
      query: company.careers_url || company.name,
      requested: options.requested || 'scheduler',
    });
    if (cached.skip) {
      return { company, listings: [], skipped: true };
    }
    let listings = await fetchViaProvider(company, providers, httpCtx);
    let meta = { etag: cached.entry?.etag, lastModified: cached.entry?.lastModified };
    if (!listings.length) {
      const page = await fetchCareersListings(company, {
        maxLinks: maxPerCompany * 3,
        etag: cached.entry?.etag,
        lastModified: cached.entry?.lastModified,
      });
      if (page.notModified) {
        await sourceCache?.touchChecked?.('international-top100', cached.hash, {
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
    listings = listings.filter((l) => looksLikeJobPosting(l.title, l.url, company.careers_url));
    await rememberCachedQuery(sourceCache, refreshPolicy, {
      sourceId: 'international-top100',
      query: company.careers_url || company.name,
      hash: cached.hash,
      resultCount: listings.length,
      etag: meta.etag,
      lastModified: meta.lastModified,
      status: 'ok',
    });
    return { company, listings, skipped: false };
  });

  for (const row of fetched) {
    if (!row || stats.saved >= maxJobs) continue;
    let { company, listings } = row;
    stats.companiesScanned += 1;
    if (!row.skipped && !listings.length && playwrightLeft > 0) {
      playwrightLeft -= 1;
      listings = await scrapeCareersPage(company, maxPerCompany * 2);
    }
    let savedForCompany = 0;
    stats.byCompany[company.name] = 0;

    for (const job of listings) {
      if (stats.saved >= maxJobs || savedForCompany >= maxPerCompany) break;
      if (!job?.url || seenUrls.has(job.url)) continue;
      if (!passesTypeFilter(job.title, searchMode)) continue;
      if (!looksLikeJobPosting(job.title, job.url, company.careers_url)) continue;
      if (!isCsFieldRole(job.title, profile) && !/software|developer|engineer|intern|data|ml|ai|tech|cloud|security|junior|graduate|student/i.test(job.title)) {
        continue;
      }
      const location = job.location || inferLocation(job.title, job.url, company);
      if (!isAllowedTargetListing({ title: job.title, url: job.url, location, market: 'INTERNATIONAL' })) continue;

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
            description: `${job.title} at ${company.name}. From official careers page.`,
            market: 'INTERNATIONAL',
            sector: company.sector || null,
            discovery_mode: 'international_top100',
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
