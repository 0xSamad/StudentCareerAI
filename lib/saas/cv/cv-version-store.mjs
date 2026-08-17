/**
 * cv-version-store.mjs — Immutable CV version history.
 * Every decision stores the master snapshot; tailored copies are stored only after validation.
 */

import { newId } from "../knowledge/knowledge-store.mjs";

function matchesUser(row, context) {
  return row.tenantId === context.tenantId && row.userId === context.userId;
}

export class MemoryCvVersionStore {
  constructor() {
    this.rows = new Map();
  }

  async saveVersion(row) {
    const record = {
      id: row.id || newId("cvv"),
      tenantId: row.tenantId,
      userId: row.userId,
      applicationId: row.applicationId || null,
      opportunityId: row.opportunityId || null,
      kind: row.kind,
      cvText: row.cvText || "",
      cvHtml: row.cvHtml || null,
      decision: row.decision || {},
      changes: row.changes || [],
      reason: row.reason || null,
      validation: row.validation || {},
      createdAt: row.createdAt || new Date().toISOString(),
    };
    this.rows.set(record.id, record);
    return record;
  }

  async listVersions(context, { applicationId = null, opportunityId = null } = {}) {
    return [...this.rows.values()]
      .filter((r) => matchesUser(r, context))
      .filter((r) => (applicationId ? r.applicationId === applicationId : true))
      .filter((r) => (opportunityId ? r.opportunityId === opportunityId : true))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
}

export class PgCvVersionStore {
  constructor(client) {
    this.client = client;
  }

  async saveVersion(row) {
    const id = row.id || newId("cvv");
    await this.client.query(
      `INSERT INTO cv_versions (
         id, tenant_id, user_id, application_id, opportunity_id, kind,
         cv_text, cv_html, decision, changes, reason, validation, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12::jsonb,NOW())`,
      [
        id,
        row.tenantId,
        row.userId,
        row.applicationId || null,
        row.opportunityId || null,
        row.kind,
        row.cvText || "",
        row.cvHtml || null,
        JSON.stringify(row.decision || {}),
        JSON.stringify(row.changes || []),
        row.reason || null,
        JSON.stringify(row.validation || {}),
      ]
    );
    const listed = await this.listVersions(
      { tenantId: row.tenantId, userId: row.userId },
      { applicationId: row.applicationId, opportunityId: row.opportunityId }
    );
    return listed.find((r) => r.id === id) || { ...row, id };
  }

  async listVersions(context, { applicationId = null, opportunityId = null } = {}) {
    const params = [context.tenantId, context.userId];
    let sql = `SELECT id, tenant_id AS "tenantId", user_id AS "userId",
                      application_id AS "applicationId", opportunity_id AS "opportunityId",
                      kind, cv_text AS "cvText", cv_html AS "cvHtml",
                      decision, changes, reason, validation, created_at AS "createdAt"
               FROM cv_versions
               WHERE tenant_id = $1 AND user_id = $2`;
    if (applicationId) {
      params.push(applicationId);
      sql += ` AND application_id = $${params.length}`;
    }
    if (opportunityId) {
      params.push(opportunityId);
      sql += ` AND opportunity_id = $${params.length}`;
    }
    sql += ` ORDER BY created_at DESC`;
    const { rows } = await this.client.query(sql, params);
    return rows.map((r) => ({
      ...r,
      decision: typeof r.decision === "string" ? JSON.parse(r.decision) : r.decision,
      changes: typeof r.changes === "string" ? JSON.parse(r.changes) : r.changes,
      validation: typeof r.validation === "string" ? JSON.parse(r.validation) : r.validation,
    }));
  }
}
