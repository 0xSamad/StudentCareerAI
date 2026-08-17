/**
 * discovery-state-store.mjs — Persisted per-source discovery state.
 *
 * One row per external source (table discovery_state, migration 012). This is
 * what lets every scan ask "what changed since our last successful fetch?"
 * instead of repeating the original search.
 */

function nowIso() {
  return new Date().toISOString();
}

function emptyState(sourceId) {
  return {
    sourceId,
    lastSuccessfulFetchAt: null,
    lastAttemptAt: null,
    lastCursor: null,
    lastPage: null,
    lastPublishedAt: null,
    lastKnownOpportunityId: null,
    lastError: null,
    rateLimitResetAt: null,
    consecutiveFailures: 0,
    totalFetches: 0,
    requestsMade: 0,
    requestsRemaining: null,
    last429: null,
    backoffUntil: null,
    lastNewCount: 0,
    lastUpdatedCount: 0,
  };
}

export class MemoryDiscoveryStateStore {
  constructor() {
    this.states = new Map();
  }

  async get(sourceId) {
    return this.states.get(sourceId) || null;
  }

  async list() {
    return [...this.states.values()];
  }

  async recordRequest(sourceId, { remaining, now } = {}) {
    const state = this._ensure(sourceId);
    state.requestsMade += 1;
    if (remaining != null && Number.isFinite(Number(remaining))) {
      state.requestsRemaining = Number(remaining);
    }
    state.lastAttemptAt = now || nowIso();
    return state;
  }

  _ensure(sourceId) {
    if (!this.states.has(sourceId)) this.states.set(sourceId, emptyState(sourceId));
    return this.states.get(sourceId);
  }

  async recordAttempt(sourceId, { now } = {}) {
    const state = this._ensure(sourceId);
    state.lastAttemptAt = now || nowIso();
    return state;
  }

  async recordSuccess(sourceId, updates = {}) {
    const state = this._ensure(sourceId);
    const ts = updates.now || nowIso();
    state.lastSuccessfulFetchAt = ts;
    state.lastAttemptAt = state.lastAttemptAt || ts;
    if (updates.lastCursor !== undefined) state.lastCursor = updates.lastCursor;
    if (updates.lastPage !== undefined) state.lastPage = updates.lastPage;
    if (updates.lastPublishedAt) state.lastPublishedAt = updates.lastPublishedAt;
    if (updates.lastKnownOpportunityId) state.lastKnownOpportunityId = updates.lastKnownOpportunityId;
    state.rateLimitResetAt = updates.rateLimitResetAt || null;
    if (updates.lastNewCount != null) state.lastNewCount = updates.lastNewCount;
    if (updates.lastUpdatedCount != null) state.lastUpdatedCount = updates.lastUpdatedCount;
    if (updates.requestsRemaining != null) state.requestsRemaining = updates.requestsRemaining;
    state.lastError = null;
    state.consecutiveFailures = 0;
    state.totalFetches += 1;
    return state;
  }

  async recordFailure(sourceId, error, { rateLimitResetAt, now, rateLimited } = {}) {
    const state = this._ensure(sourceId);
    state.lastAttemptAt = now || nowIso();
    state.lastError = String(error || 'unknown error').slice(0, 500);
    state.consecutiveFailures += 1;
    if (rateLimitResetAt) {
      state.rateLimitResetAt = rateLimitResetAt;
      state.backoffUntil = rateLimitResetAt;
    }
    if (rateLimited || String(error || '').includes('429')) {
      state.last429 = now || nowIso();
      if (!state.backoffUntil) {
        const exp = Math.min(60, 2 ** state.consecutiveFailures) * 60 * 1000;
        state.backoffUntil = new Date(Date.now() + exp).toISOString();
      }
    }
    return state;
  }
}

export class PgDiscoveryStateStore {
  /** @param {import('../database/postgres-client.mjs').PostgresClient} client */
  constructor(client) {
    this.client = client;
  }

  _map(row) {
    if (!row) return null;
    return {
      sourceId: row.source_id,
      lastSuccessfulFetchAt: row.last_successful_fetch_at,
      lastAttemptAt: row.last_attempt_at,
      lastCursor: row.last_cursor,
      lastPage: row.last_page,
      lastPublishedAt: row.last_published_at,
      lastKnownOpportunityId: row.last_known_opportunity_id,
      lastError: row.last_error,
      rateLimitResetAt: row.rate_limit_reset_at,
      consecutiveFailures: row.consecutive_failures,
      totalFetches: row.total_fetches,
      requestsMade: row.requests_made ?? 0,
      requestsRemaining: row.requests_remaining ?? null,
      last429: row.last_429_at || null,
      backoffUntil: row.backoff_until || null,
      lastNewCount: row.last_new_count ?? 0,
      lastUpdatedCount: row.last_updated_count ?? 0,
    };
  }

  async get(sourceId) {
    const { rows } = await this.client.query(
      `SELECT * FROM discovery_state WHERE source_id = $1 LIMIT 1`,
      [sourceId]
    );
    return this._map(rows[0]);
  }

  async list() {
    const { rows } = await this.client.query(`SELECT * FROM discovery_state`);
    return rows.map((r) => this._map(r));
  }

  async recordRequest(sourceId, { remaining } = {}) {
    const { rows } = await this.client.query(
      `INSERT INTO discovery_state (source_id, last_attempt_at, requests_made, requests_remaining, updated_at)
       VALUES ($1, NOW(), 1, $2, NOW())
       ON CONFLICT (source_id) DO UPDATE SET
         last_attempt_at = NOW(),
         requests_made = discovery_state.requests_made + 1,
         requests_remaining = COALESCE($2, discovery_state.requests_remaining),
         updated_at = NOW()
       RETURNING *`,
      [sourceId, remaining ?? null]
    );
    return this._map(rows[0]);
  }

  async recordAttempt(sourceId) {
    const { rows } = await this.client.query(
      `INSERT INTO discovery_state (source_id, last_attempt_at, updated_at)
       VALUES ($1, NOW(), NOW())
       ON CONFLICT (source_id) DO UPDATE SET last_attempt_at = NOW(), updated_at = NOW()
       RETURNING *`,
      [sourceId]
    );
    return this._map(rows[0]);
  }

  async recordSuccess(sourceId, updates = {}) {
    const { rows } = await this.client.query(
      `INSERT INTO discovery_state (
         source_id, last_successful_fetch_at, last_attempt_at, last_cursor, last_page,
         last_published_at, last_known_opportunity_id, last_error, rate_limit_reset_at,
         consecutive_failures, total_fetches, updated_at
       ) VALUES ($1, NOW(), NOW(), $2, $3, $4, $5, NULL, $6, 0, 1, NOW())
       ON CONFLICT (source_id) DO UPDATE SET
         last_successful_fetch_at = NOW(),
         last_cursor = COALESCE($2, discovery_state.last_cursor),
         last_page = COALESCE($3, discovery_state.last_page),
         last_published_at = COALESCE($4::timestamptz, discovery_state.last_published_at),
         last_known_opportunity_id = COALESCE($5, discovery_state.last_known_opportunity_id),
         last_error = NULL,
         rate_limit_reset_at = $6,
         consecutive_failures = 0,
         total_fetches = discovery_state.total_fetches + 1,
         last_new_count = COALESCE($7, discovery_state.last_new_count),
         last_updated_count = COALESCE($8, discovery_state.last_updated_count),
         requests_remaining = COALESCE($9, discovery_state.requests_remaining),
         updated_at = NOW()
       RETURNING *`,
      [
        sourceId,
        updates.lastCursor ?? null,
        updates.lastPage ?? null,
        updates.lastPublishedAt ?? null,
        updates.lastKnownOpportunityId ?? null,
        updates.rateLimitResetAt ?? null,
        updates.lastNewCount ?? null,
        updates.lastUpdatedCount ?? null,
        updates.requestsRemaining ?? null,
      ]
    );
    return this._map(rows[0]);
  }

  async recordFailure(sourceId, error, { rateLimitResetAt, rateLimited } = {}) {
    const limited = Boolean(rateLimited || rateLimitResetAt || String(error || '').includes('429'));
    const { rows } = await this.client.query(
      `INSERT INTO discovery_state (source_id, last_attempt_at, last_error, rate_limit_reset_at, backoff_until, last_429_at, consecutive_failures, updated_at)
       VALUES ($1, NOW(), $2, $3, $3, CASE WHEN $4 THEN NOW() ELSE NULL END, 1, NOW())
       ON CONFLICT (source_id) DO UPDATE SET
         last_attempt_at = NOW(),
         last_error = $2,
         rate_limit_reset_at = COALESCE($3::timestamptz, discovery_state.rate_limit_reset_at),
         backoff_until = COALESCE($3::timestamptz, discovery_state.backoff_until),
         last_429_at = CASE WHEN $4 THEN NOW() ELSE discovery_state.last_429_at END,
         consecutive_failures = discovery_state.consecutive_failures + 1,
         updated_at = NOW()
       RETURNING *`,
      [sourceId, String(error || 'unknown error').slice(0, 500), rateLimitResetAt ?? null, limited]
    );
    return this._map(rows[0]);
  }
}
