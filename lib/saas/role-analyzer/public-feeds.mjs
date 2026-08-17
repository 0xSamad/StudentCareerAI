/**
 * Key-free public job feeds to thicken a thin intern sample.
 * Titles are filtered by role family. Descriptions are DATA only.
 */

import { extractAnalyzerSkills, skillLooksMandatory } from './skill-taxonomy.mjs';
import { titleMatchesFamily } from './role-families.mjs';
import { classifyMarket, filterByMarketScope } from './market-classify.mjs';

const USER_AGENT = 'StudentCareerAI/1.0 role-analyzer ( intern research )';

function toPosting(raw, family, source) {
  const jobTitle = String(raw.title || '').trim();
  const company = String(raw.company || '').trim();
  const url = String(raw.url || '').trim();
  if (!jobTitle || !url) return null;
  if (!titleMatchesFamily(jobTitle, family)) return null;
  const description = String(raw.description || '').slice(0, 8000);
  const skills = [...extractAnalyzerSkills(`${jobTitle}\n${description}`)];
  const market = classifyMarket({
    title: jobTitle,
    company,
    location: raw.location,
    country: raw.country,
    url,
  });
  return {
    id: null,
    canonicalRole: family.canonical,
    source,
    jobTitle,
    company: company || source,
    location: raw.location || '',
    country: raw.country || '',
    market,
    url,
    description,
    dateDiscovered: new Date().toISOString(),
    skills,
    mandatorySkills: skills.filter((s) => skillLooksMandatory(description, s)),
    requirements: skills.filter((s) => skillLooksMandatory(description, s)),
  };
}

async function fetchJson(url, timeoutMs = 12_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'error',
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fromRemotive(family, marketScope) {
  const json = await fetchJson('https://remotive.com/api/remote-jobs');
  const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
  const found = [];
  for (const j of jobs) {
    const posting = toPosting(
      {
        title: j.title,
        company: j.company_name,
        url: j.url,
        location: j.candidate_required_location || 'Remote',
        description: j.description || '',
        country: '',
      },
      family,
      'remotive'
    );
    if (posting && (filterByMarketScope(posting.market, marketScope) || posting.market === 'UNKNOWN' || posting.market === 'INTERNATIONAL')) {
      found.push(posting);
    }
    if (found.length >= 25) break;
  }
  return found;
}

async function fromJobicy(family, marketScope) {
  const json = await fetchJson('https://jobicy.com/api/v2/remote-jobs?count=50');
  const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
  const found = [];
  for (const j of jobs) {
    const posting = toPosting(
      {
        title: j.jobTitle || j.title,
        company: j.companyName || j.company,
        url: j.url || j.jobUrl,
        location: j.jobGeo || 'Remote',
        description: j.jobDescription || j.description || '',
        country: '',
      },
      family,
      'jobicy'
    );
    if (posting && (filterByMarketScope(posting.market, marketScope) || posting.market === 'UNKNOWN' || posting.market === 'INTERNATIONAL')) {
      found.push(posting);
    }
    if (found.length >= 25) break;
  }
  return found;
}

export async function researchPublicFeeds({ family, marketScope = 'ALL' } = {}) {
  const found = [];
  const unavailable = [];
  for (const [name, fn] of [
    ['remotive', fromRemotive],
    ['jobicy', fromJobicy],
  ]) {
    try {
      found.push(...(await fn(family, marketScope)));
    } catch (err) {
      unavailable.push({ source: name, reason: err?.message || 'feed failed' });
    }
  }
  return { found, unavailable };
}
