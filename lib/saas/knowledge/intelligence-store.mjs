/**
 * intelligence-store.mjs — Per-user Candidate Intelligence persistence.
 * Tenant + user scoped. Memory for tests; Postgres when DATABASE_URL is set.
 */

import { newId } from "./knowledge-store.mjs";
import { emptyIntelligenceProfile } from "./intelligence-profile.mjs";
import { AUTHORITY } from "./authority.mjs";

function matchesUser(row, context) {
  return row.tenantId === context.tenantId && row.userId === context.userId;
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export class MemoryIntelligenceStore {
  constructor() {
    this.profiles = new Map();
    this.events = new Map();
  }

  async getProfile(context) {
    const row = [...this.profiles.values()].find((p) => matchesUser(p, context));
    return row ? { ...row, profile: { ...emptyIntelligenceProfile(), ...row.profile } } : null;
  }

  async saveProfile(row) {
    const id = row.id || newId("cip");
    const record = {
      id,
      tenantId: row.tenantId,
      userId: row.userId,
      profile: row.profile || emptyIntelligenceProfile(),
      createdAt: row.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.profiles.set(`${record.tenantId}:${record.userId}`, record);
    return record;
  }

  async saveEvent(event) {
    const record = {
      id: event.id || newId("cfe"),
      tenantId: event.tenantId,
      userId: event.userId,
      kind: event.kind,
      field: event.field || null,
      previousValue: event.previousValue || null,
      newValue: event.newValue || null,
      question: event.question || null,
      proposedAnswer: event.proposedAnswer || null,
      correctedAnswer: event.correctedAnswer || null,
      verdict: event.verdict || null,
      opportunityId: event.opportunityId || null,
      company: event.company || null,
      authority: event.authority || AUTHORITY.USER_SUPPLIED,
      metadata: event.metadata || {},
      createdAt: event.createdAt || new Date().toISOString(),
    };
    this.events.set(record.id, record);
    return record;
  }

  async listEvents(context, { kind = null, limit = 200 } = {}) {
    return [...this.events.values()]
      .filter((e) => matchesUser(e, context))
      .filter((e) => (kind ? e.kind === kind : true))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit);
  }

  async deleteUserData(context) {
    for (const [key, row] of this.profiles) {
      if (matchesUser(row, context)) this.profiles.delete(key);
    }
    for (const [id, event] of this.events) {
      if (matchesUser(event, context)) this.events.delete(id);
    }
  }
}

export class PgIntelligenceStore {
  constructor(client) {
    this.client = client;
  }

  async getProfile(context) {
    const { rows } = await this.client.query(
      `SELECT id, tenant_id AS "tenantId", user_id AS "userId", profile,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM candidate_intelligence_profiles
       WHERE tenant_id = $1 AND user_id = $2
       LIMIT 1`,
      [context.tenantId, context.userId]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      ...row,
      profile: { ...emptyIntelligenceProfile(), ...parseJson(row.profile, {}) },
    };
  }

  async saveProfile(row) {
    const id = row.id || newId("cip");
    await this.client.query(
      `INSERT INTO candidate_intelligence_profiles (id, tenant_id, user_id, profile, created_at, updated_at)
       VALUES ($1,$2,$3,$4::jsonb,NOW(),NOW())
       ON CONFLICT (tenant_id, user_id) DO UPDATE
         SET profile = EXCLUDED.profile, updated_at = NOW()`,
      [id, row.tenantId, row.userId, JSON.stringify(row.profile || {})]
    );
    return this.getProfile({ tenantId: row.tenantId, userId: row.userId });
  }

  async saveEvent(event) {
    const id = event.id || newId("cfe");
    await this.client.query(
      `INSERT INTO candidate_feedback_events (
         id, tenant_id, user_id, kind, field, previous_value, new_value,
         question, proposed_answer, corrected_answer, verdict, opportunity_id,
         company, authority, metadata, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,NOW())`,
      [
        id,
        event.tenantId,
        event.userId,
        event.kind,
        event.field || null,
        event.previousValue || null,
        event.newValue || null,
        event.question || null,
        event.proposedAnswer || null,
        event.correctedAnswer || null,
        event.verdict || null,
        event.opportunityId || null,
        event.company || null,
        event.authority || AUTHORITY.USER_SUPPLIED,
        JSON.stringify(event.metadata || {}),
      ]
    );
    const listed = await this.listEvents(
      { tenantId: event.tenantId, userId: event.userId },
      { limit: 5 }
    );
    return listed.find((e) => e.id === id) || { ...event, id };
  }

  async listEvents(context, { kind = null, limit = 200 } = {}) {
    const params = [context.tenantId, context.userId];
    let sql = `SELECT id, tenant_id AS "tenantId", user_id AS "userId", kind, field,
                      previous_value AS "previousValue", new_value AS "newValue",
                      question, proposed_answer AS "proposedAnswer",
                      corrected_answer AS "correctedAnswer", verdict,
                      opportunity_id AS "opportunityId", company, authority,
                      metadata, created_at AS "createdAt"
               FROM candidate_feedback_events
               WHERE tenant_id = $1 AND user_id = $2`;
    if (kind) {
      params.push(kind);
      sql += ` AND kind = $${params.length}`;
    }
    params.push(limit);
    sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
    const { rows } = await this.client.query(sql, params);
    return rows.map((r) => ({
      ...r,
      metadata: parseJson(r.metadata, {}),
    }));
  }

  async deleteUserData(context) {
    await this.client.query(
      `DELETE FROM candidate_feedback_events WHERE tenant_id = $1 AND user_id = $2`,
      [context.tenantId, context.userId]
    );
    await this.client.query(
      `DELETE FROM candidate_intelligence_profiles WHERE tenant_id = $1 AND user_id = $2`,
      [context.tenantId, context.userId]
    );
  }
}
