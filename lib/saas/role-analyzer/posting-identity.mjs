/**
 * Deduplicate market postings. Same job must not count twice.
 */

function stripTracking(url) {
  try {
    const x = new URL(String(url || '').trim());
    x.hash = '';
    for (const key of [...x.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$|source$)/i.test(key)) x.searchParams.delete(key);
    }
    const qs = x.searchParams.toString();
    return `${x.origin}${x.pathname.replace(/\/$/, '')}${qs ? `?${qs}` : ''}`.toLowerCase();
  } catch {
    return String(url || '').trim().toLowerCase().replace(/\/$/, '');
  }
}

export function canonicalPostingUrl(url) {
  return stripTracking(url);
}

function compact(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(inc|llc|ltd|limited|pvt|private|the)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function postingDedupeKey(posting = {}) {
  const source = String(posting.source || posting.source_name || '').toLowerCase();
  const sourceId = posting.sourceId || posting.source_id || posting.id;
  if (source && sourceId && !String(sourceId).startsWith('http')) {
    return `id:${source}:${String(sourceId).toLowerCase()}`;
  }
  const url = canonicalPostingUrl(posting.url);
  if (url && /^https?:\/\//i.test(String(posting.url || ''))) return `url:${url}`;
  return `t:${compact(posting.company)}|${compact(posting.jobTitle || posting.title)}|${compact(posting.location)}`;
}

export function shapeStoredPosting(posting = {}, family = {}, analyzedAt = new Date().toISOString()) {
  return {
    id: posting.id || posting.sourceId || posting.source_id || null,
    source: posting.source || posting.source_name || 'unknown',
    sourceId: posting.sourceId || posting.source_id || posting.id || null,
    url: posting.url || '',
    canonicalUrl: canonicalPostingUrl(posting.url),
    company: posting.company || '',
    jobTitle: posting.jobTitle || posting.title || '',
    location: posting.location || '',
    country: posting.country || '',
    market: posting.market || 'UNKNOWN',
    employmentType: family.employmentType || posting.employmentType || null,
    postingDate: posting.postingDate || posting.created || posting.dateDiscovered || null,
    description: posting.description || '',
    requirements: posting.requirements || posting.mandatorySkills || [],
    skills: posting.skills || [],
    mandatorySkills: posting.mandatorySkills || [],
    analyzedAt,
    dateDiscovered: posting.dateDiscovered || analyzedAt,
    canonicalRole: family.canonical || posting.canonicalRole || '',
  };
}
