/**
 * web-search-discovery.mjs — Discover job URLs via configured search queries
 * (Rozee.pk, Mustakbil, LinkedIn, Indeed, etc.) when no public ATS API exists.
 */

import {
  titleFromJobUrl,
  validateDiscoveredListing,
} from './listing-quality.mjs';
import { isCredibleListingUrl } from './listing-url.mjs';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let playwrightBrowser = null;

async function getPlaywrightBrowser() {
  if (playwrightBrowser) return playwrightBrowser;
  const { chromium } = await import('playwright');
  playwrightBrowser = await chromium.launch({ headless: true });
  return playwrightBrowser;
}

async function closePlaywrightBrowser() {
  if (playwrightBrowser) {
    await playwrightBrowser.close().catch(() => {});
    playwrightBrowser = null;
  }
}

function collectUrlsFromHtml(html, urls) {
  for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
    const href = m[1].replace(/&amp;/g, '&');
    if (isJobLikeUrl(href)) urls.add(normalizeJobUrl(href));
  }
}

/**
 * @param {string} query
 * @param {number} maxResults
 * @returns {Promise<string[]>}
 */
export async function searchJobUrls(query, maxResults = 8) {
  if (!query?.trim()) return [];

  const urls = new Set();

  // Direct portal shortcuts (Rozee / Indeed Pakistan)
  const direct = await searchDirectPortals(query, maxResults);
  for (const u of direct) urls.add(u);
  if (urls.size >= maxResults) return [...urls].slice(0, maxResults);

  // Playwright Bing search (fetch-based engines block bots)
  try {
    const browser = await getPlaywrightBrowser();
    const page = await browser.newPage({ userAgent: USER_AGENT });
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=15`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(1500);
    const html = await page.content();
    await page.close();

    for (const m of html.matchAll(/href="https:\/\/www\.bing\.com\/ck\/a[^"]*?&amp;u=([^&"]+)/g)) {
      const decoded = decodeBingRedirect(m[1]);
      if (decoded && isJobLikeUrl(decoded)) urls.add(normalizeJobUrl(decoded));
    }
    collectUrlsFromHtml(html, urls);
  } catch {
    // Playwright unavailable — continue with whatever we have
  }

  if (urls.size === 0) {
    await closePlaywrightBrowser();
  }

  return [...urls].slice(0, maxResults);
}

function decodeBingRedirect(encoded) {
  try {
    const raw = decodeURIComponent(encoded);
    const b64 = raw.startsWith('a1') ? raw.slice(2) : raw;
    return Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

async function searchDirectPortals(query, maxResults) {
  const lower = query.toLowerCase();
  const urls = new Set();
  const keywords = extractKeywords(query);

  try {
    const browser = await getPlaywrightBrowser();
    const page = await browser.newPage({ userAgent: USER_AGENT });

    if (lower.includes('rozee.pk') && keywords) {
      const rozeeUrl = `https://www.rozee.pk/search/quick?keywords=${encodeURIComponent(keywords)}`;
      const res = await page.goto(rozeeUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => null);
      if (res?.ok()) {
        await page.waitForTimeout(2000);
        const links = await page.$$eval('a[href*="/job/"], a[href*="/jobs/"]', (as) =>
          as.map((a) => a.href).filter(Boolean)
        );
        for (const href of links) {
          if (isJobLikeUrl(href)) urls.add(normalizeJobUrl(href));
        }
      }
    }

    if (lower.includes('indeed.com') && keywords && urls.size < maxResults) {
      const indeedUrl = `https://pk.indeed.com/jobs?q=${encodeURIComponent(keywords)}&l=Pakistan`;
      const res = await page.goto(indeedUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => null);
      if (res?.ok()) {
        await page.waitForTimeout(2000);
        const links = await page.$$eval('a[href*="/viewjob"], a[href*="/rc/clk"]', (as) =>
          as.map((a) => a.href).filter(Boolean)
        );
        for (const href of links) {
          if (href.includes('indeed.com')) urls.add(normalizeJobUrl(href));
        }
      }
    }

    await page.close();
  } catch {
    // ignore portal errors
  }

  return [...urls].slice(0, maxResults);
}

function extractKeywords(query) {
  const stripped = query
    .replace(/site:[^\s]+/gi, '')
    .replace(/"/g, '')
    .replace(/\bOR\b/gi, ' ')
    .replace(/\bAND\b/gi, ' ')
    .trim();
  const parts = stripped.split(/\s+/).filter((w) => w.length > 2 && !/^(intern|internship|pakistan|karachi|lahore|islamabad)$/i.test(w));
  return parts.slice(0, 4).join(' ') || 'software intern';
}

function isJobLikeUrl(url) {
  return isCredibleListingUrl(url);
}

function normalizeJobUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

export { titleFromJobUrl } from './listing-quality.mjs';

export function companyFromJobUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.includes('rozee.pk')) return 'Rozee.pk listing';
    if (host.includes('mustakbil.com')) return 'Mustakbil listing';
    if (host.includes('linkedin.com')) return 'LinkedIn';
    if (host.includes('indeed.com')) return 'Indeed Pakistan';
    const base = host.split('.')[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return 'Web discovery';
  }
}

/**
 * @param {object} params
 */
export async function discoverFromSearchQueries({
  queries = [],
  profile,
  opportunityRepository,
  authContext,
  maxTotal = 25,
  maxPerQuery = 6,
}) {
  const { saveDiscoveredListing } = await import('./opportunity-ingest.mjs');
  const { isCsFieldRole } = await import('./cs-field-discovery.mjs');

  const stats = { queriesRun: 0, urlsFound: 0, saved: 0, ingested: [] };
  const seen = new Set();

  for (const entry of queries) {
    if (!entry?.enabled || stats.saved >= maxTotal) break;
    const query = entry.query || entry.q;
    if (!query) continue;

    stats.queriesRun += 1;
    const urls = await searchJobUrls(query, maxPerQuery);
    stats.urlsFound += urls.length;

    for (const url of urls) {
      if (stats.saved >= maxTotal || seen.has(url)) continue;
      seen.add(url);

      const validated = validateDiscoveredListing(url, null);
      if (!validated.ok) continue;

      const title = validated.title;
      if (!isCsFieldRole(title, profile) && !/software|developer|engineer|intern|data|ml|ai|tech|it\b/i.test(title)) {
        continue;
      }

      try {
        const saved = await saveDiscoveredListing({
          rawOpportunity: {
            title,
            url,
            company: companyFromJobUrl(url),
            location: validated.location,
            source_name: 'web-search',
            market: 'NATIONAL',
            description: `Discovered via web search: ${entry.name || query}`,
          },
          opportunityRepository,
          authContext,
          profile,
        });
        stats.saved += 1;
        stats.ingested.push(saved);
      } catch {
        // duplicate url or db error
      }
    }

    // Cap Playwright queries to keep scan under timeout
    if (stats.queriesRun >= 8) break;
  }

  await closePlaywrightBrowser();

  return stats;
}
