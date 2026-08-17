/**
 * source-cache.mjs — Per-query SourceCache.
 *
 * If the exact query (source + parametersHash) was recently fetched, serve
 * from the database. Do not make another external request.
 */

import { createHash, randomUUID } from 'node:crypto';
import { canRefresh, nextFetchAtFrom } from './refresh-policy.mjs';

export const CACHE_STATUSES = Object.freeze(['ok', 'error', 'rate_limited', 'not_modified', 'fresh']);

export function parametersHash({ sourceId, query = '', country = '', opportunityType = '', extra = '' } = {}) {
  const payload = JSON.stringify({
    sourceId: String(sourceId || '').toLowerCase(),
    query: String(query || '').trim().toLowerCase(),
    country: String(country || '').trim().toLowerCase(),
    opportunityType: String(opportunityType || '').trim().toUpperCase(),
    extra: extra == null ? '' : extra,
  });
  return createHash('sha256').update(payload).digest('hex');
}

function emptyEntry(sourceId, hash) {
  return {
    id: null,
    sourceId,
    query: null,
    country: null,
    opportunityType: null,
    parametersHash: hash,
    lastFetchedAt: null,
    lastCheckedAt: null,
    nextFetchAt: null,
    resultCount: 0,
    etag: null,
    lastModified: null,
    cursor: null,
    status: 'ok',
  };
}

export class MemorySourceCache {
  constructor() {
    this.rows = new Map();
  }

  _key(sourceId, hash) {
    return `${sourceId}::${hash}`;
  }

  async get(sourceId, hash) {
    return this.rows.get(this._key(sourceId, hash)) || null;
  }

  async getByQuery({ sourceId, query, country, opportunityType, extra } = {}) {
    return this.get(sourceId, parametersHash({ sourceId, query, country, opportunityType, extra }));
  }

  async put(entry) {
    const hash = entry.parametersHash || parametersHash(entry);
    const key = this._key(entry.sourceId, hash);
    const prev = this.rows.get(key) || emptyEntry(entry.sourceId, hash);
    const now = entry.now || new Date().toISOString();
    const next = {
      ...prev,
      ...entry,
      id: prev.id || entry.id || randomUUID(),
      parametersHash: hash,
      lastFetchedAt: entry.lastFetchedAt || now,
      lastCheckedAt: entry.lastCheckedAt || entry.lastFetchedAt || now,
      updatedAt: now,
    };
    this.rows.set(key, next);
    return next;
  }

  async touchChecked(sourceId, hash, { now, etag, lastModified } = {}) {
    const existing = await this.get(sourceId, hash);
    if (!existing) return null;
    existing.lastCheckedAt = now || new Date().toISOString();
    if (etag) existing.etag = etag;
    if (lastModified) existing.lastModified = lastModified;
    existing.status = 'not_modified';
    return existing;
  }

  async list() {
    return [...this.rows.values()];
  }

  async listDue(now = Date.now()) {
    const t = typeof now === 'number' ? now : new Date(now).getTime();
    return (await this.list()).filter((row) => {
      if (row.status === 'rate_limited' && row.nextFetchAt && new Date(row.nextFetchAt).getTime() > t) {
        return false;
      }
      if (!row.nextFetchAt) return true;
      return new Date(row.nextFetchAt).getTime() <= t;
    });
  }

  async newestFetchedAt() {
    let newest = null;
    for (const row of this.rows.values()) {
      if (row.lastFetchedAt && (!newest || row.lastFetchedAt > newest)) newest = row.lastFetchedAt;
    }
    return newest;
  }
}

export class PgSourceCache {
  /** @param {import('../database/postgres-client.mjs').PostgresClient} client */
  constructor(client) {
    this.client = client;
  }

  _map(row) {
    if (!row) return null;
    return {
      id: row.id,
      sourceId: row.source_id,
      query: row.query,
      country: row.country,
      opportunityType: row.opportunity_type,
      parametersHash: row.parameters_hash,
      lastFetchedAt: row.last_fetched_at,
      lastCheckedAt: row.last_checked_at,
      nextFetchAt: row.next_fetch_at,
      resultCount: row.result_count,
      etag: row.etag,
      lastModified: row.last_modified,
      cursor: row.cursor,
      status: row.status,
    };
  }

  async get(sourceId, hash) {
    const { rows } = await this.client.query(
      `SELECT * FROM source_cache WHERE source_id = $1 AND parameters_hash = $2 LIMIT 1`,
      [sourceId, hash]
    );
    return this._map(rows[0]);
  }

  async getByQuery(params) {
    return this.get(params.sourceId, parametersHash(params));
  }

  async put(entry) {
    const hash = entry.parametersHash || parametersHash(entry);
    const id = entry.id || randomUUID();
    const { rows } = await this.client.query(
      `INSERT INTO source_cache (
         id, source_id, query, country, opportunity_type, parameters_hash,
         last_fetched_at, last_checked_at, next_fetch_at, result_count,
         etag, last_modified, cursor, status, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         COALESCE($7::timestamptz, NOW()), COALESCE($8::timestamptz, NOW()), $9, $10,
         $11, $12, $13, $14, NOW()
       )
       ON CONFLICT (source_id, parameters_hash) DO UPDATE SET
         query = COALESCE($3, source_cache.query),
         country = COALESCE($4, source_cache.country),
         opportunity_type = COALESCE($5, source_cache.opportunity_type),
         last_fetched_at = COALESCE($7::timestamptz, NOW()),
         last_checked_at = COALESCE($8::timestamptz, NOW()),
         next_fetch_at = $9,
         result_count = $10,
         etag = COALESCE($11, source_cache.etag),
         last_modified = COALESCE($12, source_cache.last_modified),
         cursor = COALESCE($13, source_cache.cursor),
         status = $14,
         updated_at = NOW()
       RETURNING *`,
      [
        id,
        entry.sourceId,
        entry.query ?? null,
        entry.country ?? null,
        entry.opportunityType ?? null,
        hash,
        entry.lastFetchedAt ?? null,
        entry.lastCheckedAt ?? entry.lastFetchedAt ?? null,
        entry.nextFetchAt ?? null,
        Number(entry.resultCount) || 0,
        entry.etag ?? null,
        entry.lastModified ?? null,
        entry.cursor ?? null,
        entry.status || 'ok',
      ]
    );
    return this._map(rows[0]);
  }

  async touchChecked(sourceId, hash, { now, etag, lastModified } = {}) {
    const { rows } = await this.client.query(
      `UPDATE source_cache
       SET last_checked_at = COALESCE($3::timestamptz, NOW()),
           etag = COALESCE($4, etag),
           last_modified = COALESCE($5, last_modified),
           status = 'not_modified',
           updated_at = NOW()
       WHERE source_id = $1 AND parameters_hash = $2
       RETURNING *`,
      [sourceId, hash, now || null, etag || null, lastModified || null]
    );
    return this._map(rows[0]);
  }

  async list() {
    const { rows } = await this.client.query(`SELECT * FROM source_cache`);
    return rows.map((r) => this._map(r));
  }

  async listDue(now = new Date().toISOString()) {
    const { rows } = await this.client.query(
      `SELECT * FROM source_cache
       WHERE next_fetch_at IS NULL OR next_fetch_at <= $1::timestamptz`,
      [typeof now === 'number' ? new Date(now).toISOString() : now]
    );
    return rows.map((r) => this._map(r));
  }

  async newestFetchedAt() {
    const { rows } = await this.client.query(
      `SELECT MAX(last_fetched_at) AS ts FROM source_cache`
    );
    return rows[0]?.ts || null;
  }
}

/**
 * Look up a query fingerprint. If it was fetched recently enough, skip the
 * external request and serve from the database.
 */
export async function maybeSkipCachedQuery({
  sourceCache,
  policy,
  sourceId,
  query,
  country,
  opportunityType,
  extra,
  sourceState,
  requested = 'scheduler',
  now = Date.now(),
}) {
  const hash = parametersHash({ sourceId, query, country, opportunityType, extra });
  if (!sourceCache) return { skip: false, entry: null, hash };
  const entry = await sourceCache.get(sourceId, hash);
  if (!entry) return { skip: false, entry: null, hash };
  const decision = canRefresh({ policy, sourceId, cacheEntry: entry, sourceState, requested, now });
  return { skip: !decision.allowed, reason: decision.reason, entry, hash };
}

export async function rememberCachedQuery(sourceCache, policy, {
  sourceId,
  query,
  country,
  opportunityType,
  extra,
  hash,
  resultCount = 0,
  etag,
  lastModified,
  cursor,
  status = 'ok',
  now,
}) {
  if (!sourceCache) return null;
  const parameters = hash || parametersHash({ sourceId, query, country, opportunityType, extra });
  const fetchedAt = now || new Date().toISOString();
  return sourceCache.put({
    sourceId,
    query: query || null,
    country: country || null,
    opportunityType: opportunityType || null,
    parametersHash: parameters,
    lastFetchedAt: fetchedAt,
    lastCheckedAt: fetchedAt,
    nextFetchAt: policy ? nextFetchAtFrom(policy, sourceId, fetchedAt) : null,
    resultCount,
    etag: etag || null,
    lastModified: lastModified || null,
    cursor: cursor || null,
    status,
  });
}

