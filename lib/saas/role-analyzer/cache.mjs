/**
 * Market-research cache. Postgres when available; otherwise in-process Map
 * (survives Next.js HMR via globalThis, same pattern as scan-job-runner).
 */

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

function memoryStore() {
  if (!globalThis.__roleAnalyzerMarketCache) {
    globalThis.__roleAnalyzerMarketCache = new Map();
  }
  return globalThis.__roleAnalyzerMarketCache;
}

export function cacheKeyFor(canonicalRole, marketScope = 'ALL', extras = {}) {
  const search = extras.searchType || extras.search_type || '';
  const id = extras.familyId || extras.family_id || '';
  return `${String(canonicalRole || '').trim().toLowerCase()}|${String(marketScope || 'ALL').toUpperCase()}|${search}|${id}`;
}

export function isFresh(entry, ttlMs = DEFAULT_TTL_MS) {
  if (!entry?.researchedAt) return false;
  const age = Date.now() - new Date(entry.researchedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < ttlMs;
}

export function dataAgeLabel(researchedAt) {
  if (!researchedAt) return null;
  const ms = Date.now() - new Date(researchedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

function rowToEntry(row) {
  if (!row) return null;
  return {
    cacheKey: row.cache_key || row.cacheKey,
    canonicalRole: row.canonical_role || row.canonicalRole,
    marketScope: row.market_scope || row.marketScope,
    searchedTitles: row.searched_titles || row.searchedTitles || [],
    postings: row.postings || [],
    skillDemand: row.skill_demand || row.skillDemand || {},
    sources: row.sources || [],
    unavailableSources: row.unavailable_sources || row.unavailableSources || [],
    pakistanCount: row.pakistan_count ?? row.pakistanCount ?? 0,
    internationalCount: row.international_count ?? row.internationalCount ?? 0,
    unknownCount: row.unknown_count ?? row.unknownCount ?? 0,
    postingCount: row.posting_count ?? row.postingCount ?? 0,
    researchedAt: row.researched_at || row.researchedAt,
  };
}

export async function readMarketCache(postgresClient, key) {
  const mem = memoryStore().get(key);
  if (mem) return mem;
  if (!postgresClient || postgresClient.isMock) return null;
  try {
    const { rows } = await postgresClient.query(
      `SELECT cache_key, canonical_role, market_scope, searched_titles, postings, skill_demand,
              sources, unavailable_sources, pakistan_count, international_count, unknown_count,
              posting_count, researched_at
         FROM role_analyzer_market_cache WHERE cache_key = $1`,
      [key]
    );
    const entry = rowToEntry(rows[0]);
    if (entry) memoryStore().set(key, entry);
    return entry;
  } catch {
    return mem || null;
  }
}

export async function writeMarketCache(postgresClient, entry) {
  const key = entry.cacheKey;
  memoryStore().set(key, entry);
  if (!postgresClient || postgresClient.isMock) return entry;
  try {
    await postgresClient.query(
      `INSERT INTO role_analyzer_market_cache (
         cache_key, canonical_role, market_scope, searched_titles, postings, skill_demand,
         sources, unavailable_sources, pakistan_count, international_count, unknown_count,
         posting_count, researched_at, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb,
         $9, $10, $11, $12, $13::timestamptz, NOW(), NOW()
       )
       ON CONFLICT (cache_key) DO UPDATE SET
         searched_titles = EXCLUDED.searched_titles,
         postings = EXCLUDED.postings,
         skill_demand = EXCLUDED.skill_demand,
         sources = EXCLUDED.sources,
         unavailable_sources = EXCLUDED.unavailable_sources,
         pakistan_count = EXCLUDED.pakistan_count,
         international_count = EXCLUDED.international_count,
         unknown_count = EXCLUDED.unknown_count,
         posting_count = EXCLUDED.posting_count,
         researched_at = EXCLUDED.researched_at,
         updated_at = NOW()`,
      [
        key,
        entry.canonicalRole,
        entry.marketScope,
        JSON.stringify(entry.searchedTitles || []),
        JSON.stringify(entry.postings || []),
        JSON.stringify(entry.skillDemand || {}),
        JSON.stringify(entry.sources || []),
        JSON.stringify(entry.unavailableSources || []),
        entry.pakistanCount || 0,
        entry.internationalCount || 0,
        entry.unknownCount || 0,
        entry.postingCount || 0,
        entry.researchedAt,
      ]
    );
  } catch {
    /* table may not exist yet in a fresh mock */
  }
  return entry;
}

export { DEFAULT_TTL_MS };
