/**
 * Collect postings for a role family until we have a usable sample (~20).
 * Sources: opportunity store → ATS boards → public feeds → Adzuna → Gemini Google Search.
 * Reuses existing providers. No parallel scraper farm.
 *
 * Job descriptions are DATA only.
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { loadProviders, resolveProvider } from '../../../providers/_registry.mjs';
import { makeHttpCtx } from '../../../providers/_http.mjs';
import { titleMatchesFamily, searchedTitlesFor, isInternshipFamily } from './role-families.mjs';
import { classifyMarket, filterByMarketScope } from './market-classify.mjs';
import { extractAnalyzerSkills, skillLooksMandatory } from './skill-taxonomy.mjs';
import { researchWithGeminiSearch } from './gemini-market-research.mjs';
import { researchPublicFeeds } from './public-feeds.mjs';
import { adzunaConfig } from '../adzuna-discovery.mjs';
import { MIN_CONFIDENT_POSTINGS, TARGET_POSTING_RANGE } from './role-baseline.mjs';
import { postingDedupeKey, shapeStoredPosting } from './posting-identity.mjs';

function loadPortalsConfig(repoRoot) {
  const candidates = [
    path.join(repoRoot, 'config', 'pakistan-portals.yml'),
    path.join(repoRoot, 'portals.yml'),
    path.join(repoRoot, 'templates', 'portals.example.yml'),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      try {
        return yaml.load(fs.readFileSync(file, 'utf-8')) || {};
      } catch {
        continue;
      }
    }
  }
  return {};
}

export function postingFromOpp(opp, family) {
  const url = opp.applicationUrl || opp.sourceUrl || opp.url || '';
  const description = String(opp.description || '');
  const skills = [...extractAnalyzerSkills(`${opp.title || opp.jobTitle || ''}\n${description}`)];
  const mandatorySkills = skills.filter((s) => skillLooksMandatory(description, s));
  const market = classifyMarket(opp);
  return shapeStoredPosting(
    {
      id: opp.id || opp.source_id || null,
      canonicalRole: family.canonical,
      searchedTitles: searchedTitlesFor(family),
      source: opp.source || opp.sourceType || opp.source_name || 'opportunity-store',
      sourceId: opp.source_id || opp.sourceId || opp.id || null,
      jobTitle: opp.title || opp.jobTitle || '',
      company: opp.company || '',
      location: opp.location || '',
      country: opp.country || '',
      market,
      url,
      description: description.slice(0, 8000),
      dateDiscovered: opp.firstDiscoveredAt || opp.lastSeenAt || opp.createdAt || null,
      postingDate: opp.postedAt || opp.created || opp.firstDiscoveredAt || null,
      skills,
      mandatorySkills,
      requirements: mandatorySkills,
      employmentType: family.employmentType || null,
    },
    family
  );
}

function mergePostings(bag, incoming, family, marketScope) {
  for (const raw of incoming || []) {
    const p = raw.jobTitle ? raw : postingFromOpp(raw, family);
    if (!p?.jobTitle) continue;
    if (!titleMatchesFamily(p.jobTitle, family)) continue;
    if (p.market && p.market !== 'UNKNOWN' && !filterByMarketScope(p.market, marketScope)) continue;
    const key = postingDedupeKey(p);
    if (!bag.has(key)) bag.set(key, shapeStoredPosting(p, family));
  }
}

async function collectFromStore(opportunityStore, family, marketScope) {
  if (!opportunityStore?.list) return [];
  const byId = new Map();
  const titles = searchedTitlesFor(family).slice(0, 8);
  for (const needle of titles) {
    try {
      const { opportunities } = await opportunityStore.list({
        search: needle,
        limit: 200,
        includeInactive: false,
      });
      for (const opp of opportunities || []) {
        if (opp?.id) byId.set(opp.id, opp);
      }
    } catch {
      /* store query is best-effort */
    }
  }
  try {
    const extra = await opportunityStore.list({ limit: 500, includeInactive: false });
    for (const opp of extra.opportunities || []) {
      if (opp?.id) byId.set(opp.id, opp);
    }
  } catch {
    /* ignore */
  }
  return [...byId.values()]
    .filter((opp) => titleMatchesFamily(opp.title, family))
    .map((opp) => postingFromOpp(opp, family))
    .filter((p) => filterByMarketScope(p.market, marketScope) || p.market === 'UNKNOWN');
}

async function fetchFromAts({ family, marketScope, repoRoot, opportunityStore, maxCompanies, deadlineMs }) {
  const unavailable = [];
  const found = [];
  const deadlineAt = Date.now() + (deadlineMs || 28_000);
  let portals;
  try {
    portals = loadPortalsConfig(repoRoot);
  } catch (err) {
    unavailable.push({ source: 'portals.yml', reason: err?.message || 'Could not load portals config' });
    return { found, unavailable };
  }
  let providers;
  try {
    providers = await loadProviders(path.join(repoRoot, 'providers'));
  } catch (err) {
    unavailable.push({ source: 'ats-providers', reason: err?.message || 'Could not load providers' });
    return { found, unavailable };
  }

  const companies = (portals.tracked_companies || [])
    .filter((c) => c && c.enabled !== false && (c.careers_url || c.api || c.provider))
    .slice(0, maxCompanies || 24);

  const httpCtx = makeHttpCtx();
  for (const company of companies) {
    if (Date.now() > deadlineAt) {
      unavailable.push({ source: company.name || 'ats', reason: 'time budget exhausted' });
      break;
    }
    const resolved = resolveProvider(company, providers);
    if (!resolved?.provider) {
      unavailable.push({ source: company.name || 'unknown-company', reason: 'no provider' });
      continue;
    }
    let jobs = [];
    try {
      jobs = await resolved.provider.fetch(company, httpCtx);
    } catch (err) {
      unavailable.push({
        source: `${resolved.provider.id}:${company.name || ''}`,
        reason: err?.message || 'fetch failed',
      });
      continue;
    }
    for (const job of jobs.slice(0, 50)) {
      const title = job.title || job.role || '';
      if (!titleMatchesFamily(title, family)) continue;
      const raw = {
        title,
        company: job.company || company.name,
        url: job.url || job.applicationUrl || job.sourceUrl,
        description: job.description || job.content || '',
        location: job.location || '',
        country: job.country || '',
        source_name: resolved.provider.id,
        source_id: job.id || job.sourceId || null,
        sourceType: 'ATS',
      };
      if (!raw.url) continue;
      if (opportunityStore?.upsert) {
        try {
          await opportunityStore.upsert(raw);
        } catch {
          /* persist is best-effort */
        }
      }
      const posting = postingFromOpp(
        {
          ...raw,
          applicationUrl: raw.url,
          source: raw.source_name,
          firstDiscoveredAt: new Date().toISOString(),
        },
        family
      );
      if (filterByMarketScope(posting.market, marketScope) || posting.market === 'UNKNOWN') found.push(posting);
    }
  }
  return { found, unavailable };
}

async function fetchFromAdzuna({ family, marketScope, repoRoot }) {
  const unavailable = [];
  const found = [];
  const cfg = adzunaConfig(repoRoot);
  if (!cfg.enabled) {
    return { found, unavailable: [{ source: 'adzuna', reason: cfg.reason || 'not configured' }] };
  }
  const queries = searchedTitlesFor(family).slice(0, 5);
  const countries =
    marketScope === 'PAKISTAN' ? ['gb'] : marketScope === 'INTERNATIONAL' ? ['us', 'gb', 'ca', 'in'] : ['us', 'gb', 'in', 'sg'];
  for (const country of countries) {
    for (const query of queries) {
      const params = new URLSearchParams({
        app_id: cfg.appId,
        app_key: cfg.appKey,
        results_per_page: '50',
        what: isInternshipFamily(family) ? `${query} internship` : query,
        sort_by: 'date',
        'content-type': 'application/json',
      });
      if (!isInternshipFamily(family)) {
        params.set('what_exclude', 'intern internship trainee');
      }
      const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params.toString()}`;
      try {
        const res = await fetch(url, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          unavailable.push({ source: `adzuna:${country}`, reason: `HTTP ${res.status}` });
          continue;
        }
        const json = await res.json();
        for (const item of json.results || []) {
          const title = item.title || '';
          if (!titleMatchesFamily(title, family)) continue;
          found.push(
            postingFromOpp(
              {
                title,
                company: item.company?.display_name || 'Adzuna employer',
                url: item.redirect_url || '',
                description: item.description || '',
                location: item.location?.display_name || country,
                country,
                source_name: 'adzuna',
                source_id: item.id,
              },
              family
            )
          );
        }
      } catch (err) {
        unavailable.push({ source: `adzuna:${country}`, reason: err?.message || 'fetch failed' });
      }
    }
  }
  return { found, unavailable };
}

function notify(onProgress, payload) {
  if (typeof onProgress !== 'function') return;
  try {
    onProgress(payload);
  } catch {
    /* ignore */
  }
}

export async function researchRoleMarket({
  family,
  marketScope = 'ALL',
  opportunityStore,
  repoRoot,
  fresh = false,
  maxCompanies = 24,
  deadlineMs = 28_000,
  matchingConfig = null,
  onProgress = null,
  minPostings = MIN_CONFIDENT_POSTINGS,
} = {}) {
  const intern = isInternshipFamily(family);
  const searchNoun = intern ? 'internships' : 'jobs';
  const searchedTitles = searchedTitlesFor(family);
  const bag = new Map();
  const unavailable = [];

  notify(onProgress, { phase: 'existing', percent: 18, message: 'Reading jobs we already have' });
  mergePostings(bag, await collectFromStore(opportunityStore, family, marketScope), family, marketScope);

  if (fresh && repoRoot && bag.size < minPostings) {
    notify(onProgress, { phase: 'research', percent: 32, message: 'Checking company career boards' });
    const ats = await fetchFromAts({
      family,
      marketScope,
      repoRoot,
      opportunityStore,
      maxCompanies,
      deadlineMs,
    });
    mergePostings(bag, ats.found, family, marketScope);
    unavailable.push(...ats.unavailable);
  }

  if (fresh && bag.size < minPostings) {
    notify(onProgress, { phase: 'research', percent: 42, message: intern ? 'Searching public internship feeds' : 'Searching public job feeds' });
    const feeds = await researchPublicFeeds({ family, marketScope });
    mergePostings(bag, feeds.found, family, marketScope);
    unavailable.push(...(feeds.unavailable || []));
  }

  if (fresh && repoRoot && bag.size < minPostings) {
    notify(onProgress, { phase: 'research', percent: 50, message: `Searching Adzuna ${searchNoun}` });
    const adz = await fetchFromAdzuna({ family, marketScope, repoRoot });
    mergePostings(bag, adz.found, family, marketScope);
    unavailable.push(...adz.unavailable);
  }

  const pakistanCount = [...bag.values()].filter((p) => p.market === 'PAKISTAN').length;
  const wantsPakistan = marketScope === 'ALL' || marketScope === 'PAKISTAN';
  const pakistanThin = wantsPakistan && pakistanCount < 5;
  let pakistanSearchAttempted = false;
  if (fresh && (bag.size < minPostings || pakistanThin)) {
    notify(onProgress, {
      phase: 'research',
      percent: 58,
      message: pakistanThin && bag.size >= minPostings
        ? `Searching the live web for Pakistan ${searchNoun}`
        : `Searching the live web for ${searchNoun}`,
    });
    pakistanSearchAttempted = wantsPakistan;
    const gem = await researchWithGeminiSearch({
      family,
      marketScope: pakistanThin && bag.size >= minPostings ? 'PAKISTAN' : marketScope,
      matchingConfig,
      minPostings,
    });
    mergePostings(bag, gem.found, family, marketScope);
    unavailable.push(...(gem.unavailable || []));
  }

  const postings = [...bag.values()]
    .sort((a, b) => String(b.postingDate || b.dateDiscovered || '').localeCompare(String(a.postingDate || a.dateDiscovered || '')))
    .slice(0, TARGET_POSTING_RANGE.max);
  const sources = [...new Set(postings.map((p) => p.source).filter(Boolean))];
  return {
    searchedTitles,
    postings,
    sources,
    unavailableSources: unavailable,
    pakistanCount: postings.filter((p) => p.market === 'PAKISTAN').length,
    internationalCount: postings.filter((p) => p.market === 'INTERNATIONAL').length,
    unknownCount: postings.filter((p) => p.market === 'UNKNOWN').length,
    postingCount: postings.length,
    researchedAt: new Date().toISOString(),
    targetPostings: minPostings,
    pakistanSearchAttempted,
  };
}
