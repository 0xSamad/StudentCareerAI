/**
 * pg-store.mjs — Postgres-backed Opportunity Store (tables from migration
 * 011_opportunity_store.sql: opportunity_store + saved_opportunities).
 *
 * opportunity_store is GLOBAL — one row per real-world listing regardless of
 * how many users' scans encounter it. saved_opportunities is per-user.
 */

import {
  normalizeOpportunity,
  normalizeUrl,
  newOpportunityId,
  SAVED_STATUSES,
  OPPORTUNITY_STATUSES,
} from './opportunity-record.mjs';

function rowColumns(prefix = '') {
  const p = prefix ? `${prefix}.` : '';
  return `
  ${p}id, ${p}dedupe_key AS "dedupeKey", ${p}url_key AS "urlKey",
  ${p}source, ${p}source_type AS "sourceType", ${p}source_id AS "sourceId",
  ${p}source_url AS "sourceUrl", ${p}application_url AS "applicationUrl",
  ${p}company, ${p}title, ${p}description, ${p}location, ${p}country,
  ${p}opportunity_type AS "opportunityType", ${p}employment_type AS "employmentType",
  ${p}remote, ${p}posted_at AS "postedAt", ${p}deadline, ${p}salary,
  ${p}raw_data AS "rawData", ${p}content_hash AS "contentHash",
  ${p}first_discovered_at AS "firstDiscoveredAt", ${p}last_seen_at AS "lastSeenAt",
  ${p}last_checked_at AS "lastCheckedAt", ${p}status, ${p}is_active AS "isActive",
  ${p}created_at AS "createdAt", ${p}updated_at AS "updatedAt"`;
}

const ROW_COLUMNS = rowColumns();

export class PgOpportunityStore {
  /** @param {import('../database/postgres-client.mjs').PostgresClient} client */
  constructor(client) {
    this.client = client;
  }

  /**
   * FETCH → NORMALIZE → DEDUPLICATE → PERSIST.
   * Matches by dedupe key (source+sourceId preferred) or normalized URL.
   * Existing rows get lastSeenAt/lastCheckedAt bumped and content refreshed;
   * no duplicate row is ever created for the same listing.
   */
  async upsert(raw) {
    const record = normalizeOpportunity(raw);

    const { rows: found } = await this.client.query(
      `SELECT id, content_hash FROM opportunity_store
       WHERE dedupe_key = $1 OR (url_key IS NOT NULL AND url_key = $2)
       LIMIT 1`,
      [record.dedupeKey, record.urlKey]
    );

    if (found[0]) {
      const changed = found[0].content_hash !== record.contentHash;
      const { rows } = await this.client.query(
        `UPDATE opportunity_store SET
           last_seen_at = NOW(),
           last_checked_at = NOW(),
           description = CASE WHEN content_hash IS DISTINCT FROM $2 AND $3::text IS NOT NULL THEN $3 ELSE description END,
           salary = CASE WHEN content_hash IS DISTINCT FROM $2 AND $4::text IS NOT NULL THEN $4 ELSE salary END,
           deadline = COALESCE($5::date, deadline),
           status = CASE WHEN $6 <> 'UNKNOWN' THEN $6 ELSE status END,
           is_active = CASE WHEN $6 <> 'UNKNOWN' THEN ($6 = 'ACTIVE') ELSE is_active END,
           content_hash = $2,
           updated_at = NOW()
         WHERE id = $1
         RETURNING ${ROW_COLUMNS}`,
        [found[0].id, record.contentHash, record.description, record.salary, record.deadline, record.status]
      );
      return { opportunity: rows[0] || null, isNew: false, changed };
    }

    const id = newOpportunityId();
    const { rows } = await this.client.query(
      `INSERT INTO opportunity_store (
         id, dedupe_key, url_key, source, source_type, source_id, source_url, application_url,
         company, title, description, location, country, opportunity_type, employment_type,
         remote, posted_at, deadline, salary, raw_data, content_hash,
         first_discovered_at, last_seen_at, last_checked_at, status, is_active, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
         $16, $17, $18, $19, $20::jsonb, $21, NOW(), NOW(), NOW(), $22, $23, NOW(), NOW()
       )
       ON CONFLICT (dedupe_key) DO UPDATE SET
         last_seen_at = NOW(), last_checked_at = NOW(), updated_at = NOW()
       RETURNING ${ROW_COLUMNS}, (xmax = 0) AS "isNew"`,
      [
        id,
        record.dedupeKey,
        record.urlKey,
        record.source,
        record.sourceType,
        record.sourceId,
        record.sourceUrl,
        record.applicationUrl,
        record.company,
        record.title,
        record.description,
        record.location,
        record.country,
        record.opportunityType,
        record.employmentType,
        record.remote,
        record.postedAt,
        record.deadline,
        record.salary,
        JSON.stringify(record.rawData || {}),
        record.contentHash,
        record.status,
        record.status === 'ACTIVE',
      ]
    );
    const row = rows[0];
    if (!row) return { opportunity: { id, ...record }, isNew: true, changed: false };
    return { opportunity: row, isNew: row.isNew !== false, changed: false };
  }

  /** Bump lastSeenAt for a listing re-encountered by URL (incremental refresh). */
  async touchSeenByUrl(url) {
    const key = normalizeUrl(url);
    if (!key) return false;
    const { rowCount } = await this.client.query(
      `UPDATE opportunity_store
       SET last_seen_at = NOW(), last_checked_at = NOW()
       WHERE url_key = $1`,
      [key]
    );
    return rowCount > 0;
  }

  async getById(id) {
    const { rows } = await this.client.query(
      `SELECT ${ROW_COLUMNS} FROM opportunity_store WHERE id = $1 LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  async getByUrl(url) {
    const key = normalizeUrl(url);
    if (!key) return null;
    const { rows } = await this.client.query(
      `SELECT ${ROW_COLUMNS} FROM opportunity_store WHERE url_key = $1 LIMIT 1`,
      [key]
    );
    return rows[0] || null;
  }

  async markStatus(id, status) {
    const wanted = String(status || '').toUpperCase();
    if (!OPPORTUNITY_STATUSES.includes(wanted)) throw new Error(`Invalid opportunity status: ${status}`);
    const { rows } = await this.client.query(
      `UPDATE opportunity_store
       SET status = $2,
           is_active = ($2 = 'ACTIVE'),
           last_checked_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING ${ROW_COLUMNS}`,
      [id, wanted]
    );
    return rows[0] || null;
  }

  /** Apply-time check: bump lastCheckedAt only. Never deletes. */
  async touchChecked(id) {
    const { rowCount } = await this.client.query(
      `UPDATE opportunity_store
       SET last_checked_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
    return rowCount > 0;
  }

  async count() {
    const { rows } = await this.client.query(`SELECT COUNT(*)::int AS n FROM opportunity_store`);
    return rows[0]?.n ?? 0;
  }

  /** SERVE FROM DATABASE — the primary read path for the app. */
  async list(filters = {}, { userId } = {}) {
    const limit = Math.min(Number(filters.limit) || 100, 2500);
    const offset = Math.max(Number(filters.offset) || 0, 0);
    const params = [userId || null];
    const where = [];

    if (!filters.includeInactive) where.push(`o.is_active = TRUE`);
    if (filters.type) {
      params.push(String(filters.type).toUpperCase());
      where.push(`o.opportunity_type = $${params.length}`);
    }
    if (filters.status) {
      params.push(String(filters.status).toUpperCase());
      where.push(`o.status = $${params.length}`);
    }
    if (filters.country) {
      params.push(`%${filters.country}%`);
      where.push(`o.country ILIKE $${params.length}`);
    }
    if (filters.remote !== undefined && filters.remote !== null) {
      params.push(Boolean(filters.remote));
      where.push(`o.remote = $${params.length}`);
    }
    if (filters.search) {
      params.push(`%${filters.search}%`);
      where.push(`(o.company ILIKE $${params.length} OR o.title ILIKE $${params.length} OR o.location ILIKE $${params.length})`);
    }
    if (!filters.includeHidden) {
      where.push(`(s.status IS NULL OR s.status <> 'HIDDEN')`);
    }
    if (filters.savedOnly) {
      where.push(`s.status IN ('SAVED', 'APPLIED')`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const base = `FROM opportunity_store o
       LEFT JOIN saved_opportunities s ON s.opportunity_id = o.id AND s.user_id = $1
       ${whereSql}`;

    const { rows: countRows } = await this.client.query(`SELECT COUNT(*)::int AS n ${base}`, params);
    params.push(limit, offset);
    const { rows } = await this.client.query(
      `SELECT ${rowColumns('o')},
              s.status AS "userState", s.saved_at AS "userSavedAt"
       ${base}
       ORDER BY
         CASE
           WHEN COALESCE(o.country, '') ILIKE '%pakistan%'
             OR COALESCE(o.location, '') ~* 'pakistan|karachi|lahore|islamabad|rawalpindi|faisalabad|peshawar|multan|quetta'
             OR COALESCE(o.title, '') ~* 'pakistan|karachi|lahore|islamabad|peshawar'
             THEN 0
           WHEN o.remote IS TRUE
             OR COALESCE(o.location, '') ILIKE '%remote%'
             OR COALESCE(o.title, '') ~* 'remote|work from home'
             THEN 1
           ELSE 2
         END,
         o.last_seen_at DESC NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { total: countRows[0]?.n ?? rows.length, opportunities: rows };
  }

  // ── User-specific state (saved_opportunities) ────────────────────────────

  async setUserState({ userId, tenantId = 'default', opportunityId, status }) {
    const wanted = String(status || 'SAVED').toUpperCase();
    if (!SAVED_STATUSES.includes(wanted)) throw new Error(`Invalid saved status: ${status}`);
    if (!userId || !opportunityId) throw new Error('userId and opportunityId are required');
    const { rows } = await this.client.query(
      `INSERT INTO saved_opportunities (id, tenant_id, user_id, opportunity_id, status, saved_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (user_id, opportunity_id) DO UPDATE SET
         status = EXCLUDED.status, updated_at = NOW()
       RETURNING id, tenant_id AS "tenantId", user_id AS "userId",
                 opportunity_id AS "opportunityId", status,
                 saved_at AS "savedAt", updated_at AS "updatedAt"`,
      [`sav_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, tenantId, userId, opportunityId, wanted]
    );
    return rows[0] || null;
  }

  async clearUserState({ userId, opportunityId }) {
    const { rowCount } = await this.client.query(
      `DELETE FROM saved_opportunities WHERE user_id = $1 AND opportunity_id = $2`,
      [userId, opportunityId]
    );
    return rowCount > 0;
  }

  async listKnownUrls() {
    try {
      const { rows } = await this.client.query(
        `SELECT DISTINCT u FROM (
           SELECT application_url AS u FROM opportunity_store WHERE application_url IS NOT NULL
           UNION
           SELECT source_url AS u FROM opportunity_store WHERE source_url IS NOT NULL
         ) urls`
      );
      return new Set(rows.map((row) => row.u).filter(Boolean));
    } catch {
      return new Set();
    }
  }

  async listUserStates(userId) {
    const { rows } = await this.client.query(
      `SELECT s.id, s.tenant_id AS "tenantId", s.user_id AS "userId",
              s.opportunity_id AS "opportunityId", s.status,
              s.saved_at AS "savedAt", s.updated_at AS "updatedAt",
              row_to_json(o.*) AS opportunity
       FROM saved_opportunities s
       LEFT JOIN opportunity_store o ON o.id = s.opportunity_id
       WHERE s.user_id = $1
       ORDER BY s.updated_at DESC`,
      [userId]
    );
    return rows;
  }
}
