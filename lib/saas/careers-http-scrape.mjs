/**
 * careers-http-scrape.mjs — Fast HTML fetch of allow-listed employer career pages.
 * Used before Playwright so a full scan can cover 100+100 companies.
 */

import { titleFromJobUrl, isGarbageTitle, isSearchOrCategoryUrl, cleanListingText, cleanListingTitle } from './listing-quality.mjs';
import { isCredibleListingUrl, isCareerHubUrl } from './listing-url.mjs';
import { conditionalFetch } from './discovery-engine/conditional-fetch.mjs';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const HREF_RE = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
const JOB_HINT =
  /\bjobs?\b|\bcareer|\bvacanc|\bintern(?:s|ship|ships)?\b|\bopening|\bposition|\brecruit|\bhiring|\bopportunit|gh_jid|lever|ashby|workday|greenhouse/i;
const SKIP = /facebook|twitter|instagram|youtube|linkedin\.com\/company|privacy|terms|contact|login|signup|\/faq|#$/i;
const FOLLOW_HREF =
  /greenhouse\.io|lever\.co|ashbyhq|myworkdayjobs|workable\.com|pinpointhq|oraclecloud\.com|successfactors|taleo\.net|eightfold\.ai|icims\.com|jobs\.jazz\.com\.pk|careers\.nayatel\.com/i;
const VIEW_JOBS = /view (all )?jobs|explore (current )?opportunit|see (all )?openings|current openings|all vacancies/i;

export async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next;
      next += 1;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch {
        results[idx] = null;
      }
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

function absolutize(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return '';
  }
}

function stripTags(html = '') {
  return cleanListingText(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
    140
  );
}

function pushJobLink(out, seen, href, titleText, baseUrl, maxLinks) {
  if (!href || !href.startsWith('http') || seen.has(href) || out.length >= maxLinks) return;
  if (SKIP.test(`${titleText} ${href}`)) return;
  if (isSearchOrCategoryUrl(href) || isCareerHubUrl(href)) return;
  if (!isCredibleListingUrl(href, { careersUrl: baseUrl })) return;
  const title = titleText.length >= 6 && !isGarbageTitle(titleText) ? cleanListingTitle(titleText) : titleFromJobUrl(href, titleText || 'Open role');
  if (!title || isGarbageTitle(title)) return;
  seen.add(href);
  out.push({ url: href, title });
}

function extractJsonLdJobs(html, baseUrl, out, seen, maxLinks) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || ''))) && out.length < maxLinks) {
    try {
      const data = JSON.parse(m[1]);
      const nodes = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
      for (const node of nodes) {
        const type = String(node?.['@type'] || '');
        if (!/jobposting/i.test(type)) continue;
        const href = absolutize(node.url || node.sameAs || '', baseUrl);
        pushJobLink(out, seen, href, String(node.title || node.name || '').slice(0, 140), baseUrl, maxLinks);
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
}

export function extractFollowTargets(html, baseUrl, { maxFollow = 3 } = {}) {
  const seen = new Set();
  const out = [];
  const raw = String(html || '');
  let m;
  HREF_RE.lastIndex = 0;
  while ((m = HREF_RE.exec(raw)) && out.length < maxFollow) {
    const href = absolutize(m[1], baseUrl);
    if (!href || !href.startsWith('http') || seen.has(href)) continue;
    const titleText = stripTags(m[2]).slice(0, 140);
    if (SKIP.test(`${titleText} ${href}`)) continue;
    if (FOLLOW_HREF.test(href) || VIEW_JOBS.test(titleText)) {
      seen.add(href);
      out.push(href);
    }
  }
  return out;
}

export function extractJobLinksFromHtml(html, baseUrl, { maxLinks = 20 } = {}) {
  const seen = new Set();
  const out = [];
  const raw = String(html || '');
  extractJsonLdJobs(raw, baseUrl, out, seen, maxLinks);
  let m;
  HREF_RE.lastIndex = 0;
  while ((m = HREF_RE.exec(raw)) && out.length < maxLinks * 3) {
    const href = absolutize(m[1], baseUrl);
    const titleText = stripTags(m[2]).slice(0, 140);
    const combined = `${titleText} ${href}`;
    if (!JOB_HINT.test(combined) && !JOB_HINT.test(href)) continue;
    pushJobLink(out, seen, href, titleText, baseUrl, maxLinks);
  }
  return out.slice(0, maxLinks);
}

export function companyScanUrl(company) {
  return String(company?.jobs_url || company?.careers_url || '').trim();
}

async function fetchHtml(url, { timeoutMs, etag, lastModified } = {}) {
  return conditionalFetch(url, {
    etag,
    lastModified,
    parse: 'text',
    label: 'careers',
    timeoutMs,
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': USER_AGENT,
    },
  });
}

export async function fetchCareersListings(company, { maxLinks = 20, timeoutMs = 10_000, etag = null, lastModified = null } = {}) {
  const url = companyScanUrl(company);
  if (!url) return { listings: [], notModified: false, etag: null, lastModified: null, status: 0 };
  try {
    const result = await fetchHtml(url, { timeoutMs, etag, lastModified });
    if (result.notModified) {
      return { listings: [], notModified: true, etag: result.etag, lastModified: result.lastModified, status: 304 };
    }
    let listings = extractJobLinksFromHtml(result.body, url, { maxLinks });
    if (!listings.length) {
      const follows = extractFollowTargets(result.body, url, { maxFollow: 2 });
      for (const follow of follows) {
        if (follow === url) continue;
        try {
          const page = await fetchHtml(follow, { timeoutMs });
          listings = listings.concat(extractJobLinksFromHtml(page.body, follow, { maxLinks }));
        } catch {
          /* follow failed */
        }
        if (listings.length >= maxLinks) break;
      }
    }
    const seen = new Set();
    listings = listings.filter((row) => {
      if (!row?.url || seen.has(row.url)) return false;
      seen.add(row.url);
      return true;
    });
    return {
      listings: listings.slice(0, maxLinks),
      notModified: false,
      etag: result.etag,
      lastModified: result.lastModified,
      status: result.status,
    };
  } catch (err) {
    if (err?.rateLimited) throw err;
    return { listings: [], notModified: false, etag: null, lastModified: null, status: err?.status || 0 };
  }
}
