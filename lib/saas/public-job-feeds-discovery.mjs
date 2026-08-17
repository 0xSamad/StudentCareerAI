/**
 * public-job-feeds-discovery.mjs — Key-free remote job APIs with real posting URLs.
 * Remotive and Jobicy publish the employer/listing URL; we still drop anything
 * that is not a credible job posting.
 */

import { saveDiscoveredListing } from './opportunity-ingest.mjs';
import { isCsFieldRole, passesSearchMode } from './cs-field-discovery.mjs';
import { isCredibleListingUrl } from './listing-url.mjs';

const USER_AGENT = 'Mozilla/5.0 (compatible; career-ops/1.3; StudentCareer discovery)';

async function fetchJson(url, timeoutMs = 12_000) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error',
    headers: { accept: 'application/json', 'user-agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function workplaceFrom(location = '') {
  const loc = String(location).toLowerCase();
  if (/\bremote\b/.test(loc) || loc === 'anywhere') return 'remote';
  if (/\bhybrid\b/.test(loc)) return 'hybrid';
  return 'remote';
}

async function fromRemotive(searchMode) {
  const json = await fetchJson('https://remotive.com/api/remote-jobs?category=software-dev');
  const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
  const out = [];
  for (const j of jobs) {
    const title = String(j.title || '').trim();
    const url = String(j.url || '').trim();
    if (!title || !isCredibleListingUrl(url)) continue;
    if (!passesSearchMode(title, searchMode)) continue;
    if (!isCsFieldRole(title) && !/software|developer|engineer|intern|data|ml|ai|security/i.test(title)) continue;
    out.push({
      title,
      url,
      company: j.company_name || 'Remote employer',
      location: j.candidate_required_location || 'Remote',
      description: String(j.description || '').replace(/<[^>]+>/g, ' ').slice(0, 4000),
      postedAt: j.publication_date || null,
      source_name: 'remotive',
      source_id: j.id ? String(j.id) : null,
      market: 'INTERNATIONAL',
      discovery_mode: 'remotive_api',
      metadata: { workplace: workplaceFrom(j.candidate_required_location), job_type: j.job_type || null },
    });
  }
  return out;
}

async function fromJobicy(searchMode) {
  const json = await fetchJson('https://jobicy.com/api/v2/remote-jobs?count=50&tag=software');
  const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
  const out = [];
  for (const j of jobs) {
    const title = String(j.jobTitle || j.title || '').trim();
    const url = String(j.url || j.jobUrl || '').trim();
    if (!title || !isCredibleListingUrl(url)) continue;
    if (!passesSearchMode(title, searchMode)) continue;
    if (!isCsFieldRole(title) && !/software|developer|engineer|intern|data|ml|ai|security/i.test(title)) continue;
    out.push({
      title,
      url,
      company: j.companyName || j.company || 'Remote employer',
      location: j.jobGeo || 'Remote',
      description: String(j.jobDescription || j.description || '').replace(/<[^>]+>/g, ' ').slice(0, 4000),
      postedAt: j.pubDate || j.jobPubDate || null,
      source_name: 'jobicy',
      source_id: j.id ? String(j.id) : null,
      market: 'INTERNATIONAL',
      discovery_mode: 'jobicy_api',
      metadata: { workplace: workplaceFrom(j.jobGeo || 'Remote') },
    });
  }
  return out;
}

/**
 * @param {object} params
 */
export async function discoverFromPublicJobFeeds({
  profile,
  opportunityRepository,
  authContext,
  options = {},
}) {
  const searchMode = options.searchMode ?? 'BOTH';
  const maxTotal = options.maxTotal ?? 80;
  const knownUrls = options.knownUrls instanceof Set ? options.knownUrls : new Set();
  const stats = { saved: 0, existing: 0, rawFound: 0, errors: 0, ingested: [] };

  let listings = [];
  for (const [name, fn] of [
    ['remotive', fromRemotive],
    ['jobicy', fromJobicy],
  ]) {
    try {
      const batch = await fn(searchMode);
      stats.rawFound += batch.length;
      listings.push(...batch);
    } catch {
      stats.errors += 1;
    }
  }

  const seen = new Set();
  for (const listing of listings) {
    if (stats.saved >= maxTotal) break;
    if (seen.has(listing.url) || knownUrls.has(listing.url)) {
      stats.existing += 1;
      continue;
    }
    seen.add(listing.url);
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

  return stats;
}
