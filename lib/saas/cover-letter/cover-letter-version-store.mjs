/**
 * cover-letter-version-store.mjs — Immutable cover letter versions per job.
 */

import { newId } from "../knowledge/knowledge-store.mjs";

function matchesUser(row, context) {
  return row.tenantId === context.tenantId && row.userId === context.userId;
}

function nextVersion(rows, jobId) {
  const max = rows
    .filter((r) => r.jobId === jobId)
    .reduce((m, r) => Math.max(m, Number(r.version) || 0), 0);
  return max + 1;
}

export class MemoryCoverLetterVersionStore {
  constructor() {
    this.rows = new Map();
  }

  async saveVersion(row) {
    const siblings = [...this.rows.values()].filter(
      (r) => r.tenantId === row.tenantId && r.userId === row.userId && r.jobId === (row.jobId || row.opportunityId)
    );
    const record = {
      id: row.id || newId("clv"),
      tenantId: row.tenantId,
      userId: row.userId,
      applicationId: row.applicationId || null,
      jobId: row.jobId || row.opportunityId || null,
      kind: row.kind,
      version: row.version || nextVersion(siblings, row.jobId || row.opportunityId),
      coverLetter: row.coverLetter || row.body || null,
      subjectLine: row.subjectLine || null,
      sourceEvidence: row.sourceEvidence || [],
      requirement: row.requirement || null,
      reason: row.reason || null,
      validation: row.validation || {},
      generatedAt: row.generatedAt || new Date().toISOString(),
      createdAt: row.createdAt || new Date().toISOString(),
    };
    this.rows.set(record.id, record);
    return record;
  }

  async listVersions(context, { applicationId = null, jobId = null } = {}) {
    return [...this.rows.values()]
      .filter((r) => matchesUser(r, context))
      .filter((r) => (applicationId ? r.applicationId === applicationId : true))
      .filter((r) => (jobId ? r.jobId === jobId : true))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
}

export class PgCoverLetterVersionStore {
  constructor(client) {
    this.client = client;
  }

  async saveVersion(row) {
    const id = row.id || newId("clv");
    const jobId = row.jobId || row.opportunityId || null;
    let version = row.version;
    if (!version) {
      const listed = await this.listVersions(
        { tenantId: row.tenantId, userId: row.userId },
        { jobId }
      );
      version = nextVersion(listed, jobId);
    }
    await this.client.query(
      `INSERT INTO cover_letter_versions (
         id, tenant_id, user_id, application_id, job_id, kind, version,
         cover_letter, subject_line, source_evidence, requirement, reason,
         validation, generated_at, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13::jsonb,$14,NOW())`,
      [
        id,
        row.tenantId,
        row.userId,
        row.applicationId || null,
        jobId,
        row.kind,
        version,
        row.coverLetter || row.body || null,
        row.subjectLine || null,
        JSON.stringify(row.sourceEvidence || []),
        row.requirement || null,
        row.reason || null,
        JSON.stringify(row.validation || {}),
        row.generatedAt || new Date().toISOString(),
      ]
    );
    const listed = await this.listVersions(
      { tenantId: row.tenantId, userId: row.userId },
      { applicationId: row.applicationId, jobId }
    );
    return listed.find((r) => r.id === id) || { ...row, id, version, jobId };
  }

  async listVersions(context, { applicationId = null, jobId = null } = {}) {
    const params = [context.tenantId, context.userId];
    let sql = `SELECT id, tenant_id AS "tenantId", user_id AS "userId",
                      application_id AS "applicationId", job_id AS "jobId",
                      kind, version, cover_letter AS "coverLetter", subject_line AS "subjectLine",
                      source_evidence AS "sourceEvidence", requirement, reason, validation,
                      generated_at AS "generatedAt", created_at AS "createdAt"
               FROM cover_letter_versions
               WHERE tenant_id = $1 AND user_id = $2`;
    if (applicationId) {
      params.push(applicationId);
      sql += ` AND application_id = $${params.length}`;
    }
    if (jobId) {
      params.push(jobId);
      sql += ` AND job_id = $${params.length}`;
    }
    sql += ` ORDER BY created_at DESC`;
    const { rows } = await this.client.query(sql, params);
    return rows.map((r) => ({
      ...r,
      sourceEvidence: typeof r.sourceEvidence === "string" ? JSON.parse(r.sourceEvidence) : r.sourceEvidence,
      validation: typeof r.validation === "string" ? JSON.parse(r.validation) : r.validation,
    }));
  }
}
