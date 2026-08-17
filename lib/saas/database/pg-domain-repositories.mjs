/**
 * pg-domain-repositories.mjs — PostgreSQL-backed tenant-scoped repositories.
 *
 * Used when DATABASE_URL is configured. Enforces tenant_id + user_id on every query.
 */

import crypto from "node:crypto";
import {
  IStudentProfileRepository,
  IOpportunityRepository,
  IApplicationRepository,
} from "./repository-interface.mjs";
import { hasProfileContent, mergeProfileRecord } from "./merge-profile.mjs";

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function extractIdentityFields(profileData = {}) {
  const identity = profileData.identity || {};
  const preferences = profileData.preferences || {};
  const matching = profileData.matching || {};
  return {
    phone: identity.phone || null,
    linkedin_url: identity.linkedin || identity.linkedin_url || null,
    github_url: identity.github || identity.github_url || null,
    portfolio_url: identity.portfolio || identity.portfolio_url || null,
    city: identity.city || null,
    country: identity.country || null,
    search_mode: preferences.search_mode || "internships",
    target_roles: JSON.stringify(preferences.target_roles || []),
    preferred_locations: JSON.stringify(preferences.locations?.preferred || preferences.preferred_locations || []),
    remote_ok: preferences.remote_ok !== false,
    work_authorization: preferences.work_authorization || "Citizen",
    needs_sponsorship: !!preferences.needs_sponsorship,
    min_match_score: Number(matching.min_match_score ?? matching.minMatchScore ?? 3.5),
    max_applications_per_day: Number(preferences.max_applications_per_day ?? 10),
    auto_submit: !!preferences.auto_submit,
  };
}

export class PgStudentProfileRepository extends IStudentProfileRepository {
  /**
   * @param {import('./postgres-client.mjs').PostgresClient} client
   */
  constructor(client) {
    super();
    if (!client || client.isMock) {
      throw new Error("PgStudentProfileRepository requires a real PostgresClient with DATABASE_URL");
    }
    this.client = client;
  }

  async getByUserId(userId, tenantId) {
    if (!userId || !tenantId) throw new Error("userId and tenantId are required");
    const { rows } = await this.client.query(
      `SELECT id, tenant_id AS "tenantId", user_id AS "userId",
              profile_data AS "profileData", raw_cv_text AS "rawCvText",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM profiles
       WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [tenantId, userId]
    );
    if (!rows[0]) return null;
    const row = rows[0];
    const data = typeof row.profileData === "object" && row.profileData ? row.profileData : {};
    return {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      ...data,
      cvText: row.rawCvText || data.cvText || "",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async upsertProfile(userId, tenantId, profileData = {}) {
    if (!userId || !tenantId) throw new Error("userId and tenantId are required");
    const existing = await this.getByUserId(userId, tenantId);
    const merged = mergeProfileRecord(existing || {}, profileData);
    const id = existing?.id || profileData.id || `prof_${userId}`;
    const fields = extractIdentityFields(merged);
    const cvText = hasProfileContent(merged.cvText) ? merged.cvText : existing?.cvText || null;

    const { cvText: _cv, raw_cv_text: _raw, id: _id, tenantId: _t, userId: _u, createdAt, updatedAt, ...rest } =
      merged;
    const profileJson = { ...rest };

    await this.client.query(
      `INSERT INTO profiles (
         id, tenant_id, user_id, phone, linkedin_url, github_url, portfolio_url,
         city, country, search_mode, target_roles, preferred_locations,
         remote_ok, work_authorization, needs_sponsorship, min_match_score,
         max_applications_per_day, auto_submit, raw_cv_text, profile_data,
         created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb,
         $13, $14, $15, $16, $17, $18, $19, $20::jsonb, NOW(), NOW()
       )
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET
         phone = EXCLUDED.phone,
         linkedin_url = EXCLUDED.linkedin_url,
         github_url = EXCLUDED.github_url,
         portfolio_url = EXCLUDED.portfolio_url,
         city = EXCLUDED.city,
         country = EXCLUDED.country,
         search_mode = EXCLUDED.search_mode,
         target_roles = EXCLUDED.target_roles,
         preferred_locations = EXCLUDED.preferred_locations,
         remote_ok = EXCLUDED.remote_ok,
         work_authorization = EXCLUDED.work_authorization,
         needs_sponsorship = EXCLUDED.needs_sponsorship,
         min_match_score = EXCLUDED.min_match_score,
         max_applications_per_day = EXCLUDED.max_applications_per_day,
         auto_submit = EXCLUDED.auto_submit,
         raw_cv_text = COALESCE(EXCLUDED.raw_cv_text, profiles.raw_cv_text),
         profile_data = EXCLUDED.profile_data,
         updated_at = NOW()`,
      [
        id,
        tenantId,
        userId,
        fields.phone,
        fields.linkedin_url,
        fields.github_url,
        fields.portfolio_url,
        fields.city,
        fields.country,
        fields.search_mode,
        fields.target_roles,
        fields.preferred_locations,
        fields.remote_ok,
        fields.work_authorization,
        fields.needs_sponsorship,
        fields.min_match_score,
        fields.max_applications_per_day,
        fields.auto_submit,
        cvText,
        JSON.stringify(profileJson),
      ]
    );
    return this.getByUserId(userId, tenantId);
  }

  async deleteProfile(userId, tenantId) {
    const { rowCount } = await this.client.query(
      `UPDATE profiles SET deleted_at = NOW() WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [tenantId, userId]
    );
    return rowCount > 0;
  }
}

export class PgOpportunityRepository extends IOpportunityRepository {
  /**
   * @param {import('./postgres-client.mjs').PostgresClient} client
   */
  constructor(client) {
    super();
    if (!client || client.isMock) {
      throw new Error("PgOpportunityRepository requires a real PostgresClient with DATABASE_URL");
    }
    this.client = client;
  }

  _mapRow(row) {
    const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
    return {
      ...meta,
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      company: row.company_name || row.company || meta.company,
      company_name: row.company_name,
      title: row.title,
      role: row.title,
      type: row.opportunity_type,
      opportunity_type: row.opportunity_type,
      location: row.location || meta.location,
      remote: row.is_remote,
      url: row.url || meta.url || meta.source_url || null,
      description: row.description,
      requirements: row.requirements,
      source_type: row.source_type || "DISCOVERY",
      source_name: row.source_name,
      source_id: row.source_id,
      discovered_at: row.discovered_at,
      is_demo: !!row.is_demo,
      is_verified: !!row.is_verified,
      matchScore: meta.match_score ?? meta.matchScore ?? null,
      match_score: meta.match_score ?? meta.matchScore ?? null,
      eligibility_status: meta.eligibility_status ?? meta.eligibilityStatus ?? "PENDING",
      state: meta.state ?? "DISCOVERED",
      posted_at: row.posted_date,
      deadline: row.deadline,
      market: meta.market ?? null,
      sector: meta.sector ?? null,
      metadata: meta,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async findByFilters(filters = {}, context = {}) {
    const { tenantId, userId } = context;
    const params = [tenantId];
    let sql = `SELECT o.id, o.tenant_id AS "tenantId", o.user_id AS "userId",
                      o.company_name, o.title, o.opportunity_type, o.location,
                      o.is_remote, o.url, o.description, o.requirements,
                      o.source_type, o.source_name, o.source_id, o.discovered_at,
                      o.is_demo, o.is_verified, o.metadata, o.posted_date, o.deadline,
                      o.created_at AS "createdAt", o.updated_at AS "updatedAt"
               FROM opportunities o
               WHERE o.deleted_at IS NULL
                 AND (o.tenant_id = $1 OR o.tenant_id = 'global')`;
    if (userId) {
      params.push(userId);
      sql += ` AND (o.user_id IS NULL OR o.user_id = $${params.length})`;
    }
    if (filters.type) {
      params.push(String(filters.type).toUpperCase());
      sql += ` AND o.opportunity_type = $${params.length}`;
    }
    if (filters.includeDemo !== true) {
      sql += ` AND o.is_demo = FALSE`;
    }
    if (filters.verifiedOnly === true) {
      sql += ` AND o.is_verified = TRUE`;
    }
    if (filters.search) {
      params.push(`%${String(filters.search).toLowerCase()}%`);
      sql += ` AND (LOWER(o.company_name) LIKE $${params.length} OR LOWER(o.title) LIKE $${params.length})`;
    }
    sql += ` ORDER BY o.discovered_at DESC NULLS LAST, o.created_at DESC`;
    if (filters.limit && Number(filters.limit) > 0) {
      params.push(Math.min(Number(filters.limit), 500));
      sql += ` LIMIT $${params.length}`;
    }
    const { rows } = await this.client.query(sql, params);
    let items = rows.map((r) => this._mapRow(r));
    if (filters.minScore) {
      items = items.filter((o) => typeof o.matchScore === "number" && o.matchScore >= filters.minScore);
    }
    if (filters.eligibleOnly === true) {
      items = items.filter(
        (o) =>
          o.eligibility_status === "ELIGIBLE" ||
          o.eligibility_status === "REQUIRES_REVIEW"
      );
    }
    if (filters.market) {
      const want = String(filters.market).toUpperCase();
      items = items.filter((o) => {
        const m = (o.market || o.metadata?.market || "INTERNATIONAL").toUpperCase();
        return m === want;
      });
    }
    return items;
  }

  async countByFilters(filters = {}, context = {}) {
    const { tenantId, userId } = context;
    const params = [tenantId];
    let sql = `SELECT COUNT(*)::int AS count FROM opportunities o
               WHERE o.deleted_at IS NULL AND (o.tenant_id = $1 OR o.tenant_id = 'global')`;
    if (userId) {
      params.push(userId);
      sql += ` AND (o.user_id IS NULL OR o.user_id = $${params.length})`;
    }
    if (filters.includeDemo !== true) {
      sql += ` AND o.is_demo = FALSE`;
    }
    const { rows } = await this.client.query(sql, params);
    return rows[0]?.count ?? 0;
  }

  async findById(id, context = {}) {
    const { tenantId, userId } = context;
    const params = [id, tenantId];
    let sql = `SELECT o.id, o.tenant_id AS "tenantId", o.user_id AS "userId",
                      o.company_name, o.title, o.opportunity_type, o.location,
                      o.is_remote, o.url, o.description, o.requirements,
                      o.source_type, o.source_name, o.source_id, o.discovered_at,
                      o.is_demo, o.is_verified, o.metadata, o.posted_date, o.deadline,
                      o.created_at AS "createdAt", o.updated_at AS "updatedAt"
               FROM opportunities o
               WHERE o.deleted_at IS NULL AND o.id = $1
                 AND (o.tenant_id = $2 OR o.tenant_id = 'global')`;
    if (userId) {
      params.push(userId);
      sql += ` AND (o.user_id IS NULL OR o.user_id = $${params.length})`;
    }
    sql += ` LIMIT 1`;
    const { rows } = await this.client.query(sql, params);
    return rows[0] ? this._mapRow(rows[0]) : null;
  }

  async listKnownUrls(context = {}) {
    const { tenantId, userId } = context;
    if (!tenantId) return new Set();
    const params = [tenantId];
    let sql = `SELECT url FROM opportunities
               WHERE deleted_at IS NULL AND url IS NOT NULL
                 AND (tenant_id = $1 OR tenant_id = 'global')`;
    if (userId) {
      params.push(userId);
      sql += ` AND (user_id IS NULL OR user_id = $${params.length})`;
    }
    const { rows } = await this.client.query(sql, params);
    return new Set(rows.map((r) => r.url).filter(Boolean));
  }

  async upsertDiscovered(opportunity, context = {}) {
    const { tenantId = "default", userId = null } = context;
    const id = opportunity.id || newId("opp");
    const url = opportunity.url;
    if (!url) throw new Error("Opportunity url is required");

    const meta = {
      match_score: opportunity.match_score ?? opportunity.matchScore ?? null,
      match_tier: opportunity.match_tier ?? opportunity.matchTier ?? null,
      eligibility_status: opportunity.eligibility_status ?? opportunity.eligibilityStatus ?? "PENDING",
      state: opportunity.state ?? "DISCOVERED",
      ...(opportunity.metadata || {}),
    };
    const postedDate = opportunity.posted_date || opportunity.postedDate || null;
    const deadline = opportunity.deadline || null;

    const { rows } = await this.client.query(
      `INSERT INTO opportunities (
         id, tenant_id, user_id, company_name, title, opportunity_type, location,
         is_remote, url, description, requirements, source_type, source_name, source_id,
         discovered_at, posted_date, deadline, is_demo, is_verified, metadata, active, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb,
         $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb, TRUE, NOW(), NOW()
       )
       ON CONFLICT (url) DO UPDATE SET
         tenant_id = CASE WHEN opportunities.tenant_id = 'global' THEN EXCLUDED.tenant_id ELSE opportunities.tenant_id END,
         user_id = COALESCE(EXCLUDED.user_id, opportunities.user_id),
         company_name = EXCLUDED.company_name,
         title = EXCLUDED.title,
         opportunity_type = EXCLUDED.opportunity_type,
         location = EXCLUDED.location,
         description = EXCLUDED.description,
         requirements = EXCLUDED.requirements,
         posted_date = COALESCE(EXCLUDED.posted_date, opportunities.posted_date),
         deadline = COALESCE(EXCLUDED.deadline, opportunities.deadline),
         metadata = opportunities.metadata || EXCLUDED.metadata,
         is_demo = EXCLUDED.is_demo,
         is_verified = EXCLUDED.is_verified,
         updated_at = NOW()
       RETURNING id, tenant_id AS "tenantId", user_id AS "userId",
                 company_name, title, opportunity_type, location, is_remote, url,
                 description, requirements, source_type, source_name, source_id,
                 discovered_at, is_demo, is_verified, metadata, posted_date, deadline,
                 created_at AS "createdAt", updated_at AS "updatedAt",
                 (xmax = 0) AS "isNew"`,
      [
        id,
        tenantId,
        userId,
        String(opportunity.company || opportunity.company_name || "Unknown").slice(0, 250),
        String(opportunity.title || opportunity.role || "Untitled").slice(0, 250),
        ["INTERNSHIP", "JOB", "CO_OP", "FELLOWSHIP"].includes(
          String(opportunity.opportunity_type || opportunity.type || "INTERNSHIP").toUpperCase()
        )
          ? String(opportunity.opportunity_type || opportunity.type || "INTERNSHIP").toUpperCase()
          : "INTERNSHIP",
        opportunity.location || null,
        !!(opportunity.remote ?? opportunity.is_remote),
        url,
        opportunity.description || "",
        JSON.stringify(opportunity.requirements || {}),
        opportunity.source_type || "DISCOVERY",
        opportunity.source_name || null,
        opportunity.source_id || null,
        opportunity.discovered_at || new Date().toISOString(),
        postedDate,
        deadline,
        !!opportunity.is_demo,
        !!opportunity.is_verified,
        JSON.stringify(meta),
      ]
    );
    const row = rows[0];
    if (!row) return { id, tenantId, userId, url, isNew: false, ...opportunity };
    return { ...this._mapRow(row), isNew: !!row.isNew };
  }
}

export class PgApplicationRepository extends IApplicationRepository {
  /**
   * @param {import('./postgres-client.mjs').PostgresClient} client
   */
  constructor(client) {
    super();
    if (!client || client.isMock) {
      throw new Error("PgApplicationRepository requires a real PostgresClient with DATABASE_URL");
    }
    this.client = client;
  }

  _mapRow(row) {
    const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
    return {
      ...meta,
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      opportunity_id: row.opportunityId,
      opportunityId: row.opportunityId,
      company: row.company || row.company_name || meta.company,
      title: row.title || meta.title,
      role: row.title || meta.role || meta.title,
      state: row.state,
      type: row.opportunity_type || meta.opportunity_type,
      opportunity_type: row.opportunity_type || meta.opportunity_type,
      location: row.location || meta.location || null,
      url: row.oppUrl || meta.url || meta.source_url || null,
      deadline: row.deadline || meta.deadline || null,
      remote: row.is_remote,
      source_name: row.source_name || meta.source_name || null,
      matchScore: row.matchScore != null ? Number(row.matchScore) : meta.match_score ?? null,
      match_score: row.matchScore != null ? Number(row.matchScore) : meta.match_score ?? null,
      eligibilityStatus: row.eligibilityStatus,
      eligibility_status: row.eligibilityStatus,
      submission_mode: row.submissionMode,
      dry_run: row.submissionMode === "SAFE_DRY_RUN" || row.state === "DRY_RUN" || row.state === "READY" || row.state === "SELECTED",
      submitted_at: row.appliedAt,
      applied_at: row.appliedAt,
      artifacts: meta.artifacts || {},
      stateHistory: meta.stateHistory || meta.state_history || [],
      pause_reason: row.pause_reason || meta.pause_reason || null,
      paused_at: row.paused_at || meta.paused_at || null,
      metadata: meta,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async _ensureOpportunity(data, context) {
    const requestedId = String(data.opportunity_id || data.opportunityId || data.id || "").slice(0, 64);
    if (!requestedId) throw new Error("opportunity_id is required");
    const url = String(data.url || data.metadata?.url || data.metadata?.source_url || "").trim();

    const byId = await this.client.query(`SELECT id FROM opportunities WHERE id = $1 LIMIT 1`, [requestedId]);
    if (byId.rows[0]) return byId.rows[0].id;

    if (url) {
      const byUrl = await this.client.query(`SELECT id FROM opportunities WHERE url = $1 LIMIT 1`, [url]);
      if (byUrl.rows[0]) return byUrl.rows[0].id;
    }

    const insertUrl = url || `https://placeholder.local/opp/${requestedId}`;
    const oppType = String(data.opportunity_type || data.metadata?.opportunity_type || data.type || "INTERNSHIP").toUpperCase();
    const safeType = ["INTERNSHIP", "JOB", "CO_OP", "FELLOWSHIP"].includes(oppType) ? oppType : "INTERNSHIP";
    await this.client.query(
      `INSERT INTO opportunities (
         id, tenant_id, user_id, company_name, title, opportunity_type, url,
         description, is_demo, is_verified, source_type, active, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, '', FALSE, FALSE, 'QUEUE', TRUE, NOW(), NOW())
       ON CONFLICT (url) DO NOTHING`,
      [
        requestedId,
        context.tenantId,
        context.userId,
        String(data.company || "Unknown").slice(0, 250),
        String(data.title || data.role || "Untitled").slice(0, 250),
        safeType,
        insertUrl,
      ]
    );
    const again = await this.client.query(
      `SELECT id FROM opportunities WHERE id = $1 OR url = $2 LIMIT 1`,
      [requestedId, insertUrl]
    );
    if (again.rows[0]) return again.rows[0].id;
    throw new Error("Could not attach this listing to an opportunity record.");
  }

  async create(data, context) {
    const { tenantId, userId } = context;
    if (!tenantId || !userId) throw new Error("tenantId and userId are required");
    const id = data.id || newId("app");
    const opportunityId = await this._ensureOpportunity(data, context);
    const requestedState = data.state || "DISCOVERED";
    const statesToTry = [...new Set([requestedState, "APPLICATION_READY", "DISCOVERED"])];
    const meta = {
      artifacts: data.artifacts || {},
      stateHistory: data.stateHistory || data.state_history || [
        { state: requestedState, timestamp: new Date().toISOString(), reason: "Initial creation" },
      ],
      ...(data.metadata || {}),
    };
    const scoreRaw = data.match_score ?? data.matchScore;
    const scoreNum = scoreRaw == null || scoreRaw === "" ? null : Number(scoreRaw);
    const matchScore = Number.isFinite(scoreNum) ? Math.max(0, Math.min(100, scoreNum)) : null;
    const params = [
      id,
      tenantId,
      userId,
      opportunityId,
      String(data.company || "Unknown").slice(0, 250),
      String(data.title || data.role || "Untitled").slice(0, 250),
      requestedState,
      matchScore,
      String(data.eligibility_status ?? data.eligibilityStatus ?? "ELIGIBLE").slice(0, 50),
      data.dry_run === false ? "LIVE" : "SAFE_DRY_RUN",
      data.submitted_at || data.applied_at || null,
      JSON.stringify(meta),
    ];

    let lastErr;
    for (const state of statesToTry) {
      params[6] = state;
      try {
        await this.client.query(
          `INSERT INTO applications (
             id, tenant_id, user_id, opportunity_id, company, title, state,
             match_score, eligibility_status, submission_mode, applied_at, metadata,
             created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,NOW(),NOW())`,
          params
        );
        return this.getById(id, context);
      } catch (err) {
        lastErr = err;
        const msg = String(err?.message || err);
        if (/chk_app_state|check constraint/i.test(msg)) continue;
        throw err;
      }
    }
    throw lastErr;
  }

  async getById(id, context) {
    const { rows } = await this.client.query(
      `SELECT id, tenant_id AS "tenantId", user_id AS "userId",
              opportunity_id AS "opportunityId", company, title, state,
              match_score AS "matchScore", eligibility_status AS "eligibilityStatus",
              submission_mode AS "submissionMode", applied_at AS "appliedAt",
              metadata, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM applications
       WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND deleted_at IS NULL`,
      [id, context.tenantId, context.userId]
    );
    return rows[0] ? this._mapRow(rows[0]) : null;
  }

  async findMany(query = {}, context) {
    const { tenantId, userId } = context;
    if (!tenantId || !userId) throw new Error("tenantId and userId are required");
    const params = [tenantId, userId];
    let sql = `SELECT a.id, a.tenant_id AS "tenantId", a.user_id AS "userId",
                      a.opportunity_id AS "opportunityId", a.company, a.title, a.state,
                      a.match_score AS "matchScore", a.eligibility_status AS "eligibilityStatus",
                      a.submission_mode AS "submissionMode", a.applied_at AS "appliedAt",
                      a.metadata, a.created_at AS "createdAt", a.updated_at AS "updatedAt",
                      o.location, o.opportunity_type, o.url AS "oppUrl", o.deadline,
                      o.is_remote, o.source_name, o.company_name
               FROM applications a
               LEFT JOIN opportunities o ON o.id = a.opportunity_id
               WHERE a.tenant_id = $1 AND a.user_id = $2 AND a.deleted_at IS NULL`;
    if (query.state) {
      params.push(query.state);
      sql += ` AND a.state = $${params.length}`;
    }
    sql += ` ORDER BY a.created_at DESC`;
    const { rows } = await this.client.query(sql, params);
    return rows.map((r) => this._mapRow(r));
  }

  async getByOpportunityId(opportunityId, userId, tenantId) {
    const { rows } = await this.client.query(
      `SELECT id, tenant_id AS "tenantId", user_id AS "userId",
              opportunity_id AS "opportunityId", company, title, state,
              match_score AS "matchScore", eligibility_status AS "eligibilityStatus",
              submission_mode AS "submissionMode", applied_at AS "appliedAt",
              metadata, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM applications
       WHERE tenant_id = $1 AND user_id = $2
         AND (opportunity_id = $3 OR id = $3 OR metadata->>'globalOpportunityId' = $3)
         AND deleted_at IS NULL
       LIMIT 1`,
      [tenantId, userId, opportunityId]
    );
    return rows[0] ? this._mapRow(rows[0]) : null;
  }

  async updateApplicationState(applicationId, state, metadata = {}, context) {
    const existing = await this.getById(applicationId, context);
    if (!existing) throw new Error(`Application '${applicationId}' not found in current tenant`);

    const meta = {
      ...(existing.metadata || {}),
      artifacts: { ...(existing.artifacts || {}), ...(metadata.artifacts || {}) },
      stateHistory: [
        ...(existing.stateHistory || []),
        { state, timestamp: new Date().toISOString(), reason: metadata.reason || "State update" },
      ],
    };

    if (metadata.pause_reason) meta.pause_reason = metadata.pause_reason;
    if (metadata.paused_at) meta.paused_at = metadata.paused_at;
    if (metadata.skip_reason) meta.skip_reason = metadata.skip_reason;
    if (metadata.last_message) meta.last_message = metadata.last_message;
    if (metadata.outcome) meta.outcome = metadata.outcome;

    const params = [
      applicationId,
      context.tenantId,
      context.userId,
      state,
      metadata.matchScore ?? metadata.match_score ?? null,
      metadata.eligibilityStatus ?? metadata.eligibility_status ?? null,
      metadata.submitted_at ?? metadata.applied_at ?? null,
      JSON.stringify(meta),
    ];
    try {
      await this.client.query(
        `UPDATE applications SET
           state = $4,
           match_score = COALESCE($5, match_score),
           eligibility_status = COALESCE($6, eligibility_status),
           applied_at = COALESCE($7, applied_at),
           metadata = $8::jsonb,
           updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND deleted_at IS NULL`,
        params
      );
    } catch (err) {
      const msg = String(err?.message || err);
      if (/chk_app_state|check constraint/i.test(msg) && state !== "FAILED") {
        params[3] = "FAILED";
        meta.last_message = meta.last_message || msg;
        meta.outcome = meta.outcome || `failed — ${msg}`;
        params[7] = JSON.stringify(meta);
        await this.client.query(
          `UPDATE applications SET
             state = $4,
             match_score = COALESCE($5, match_score),
             eligibility_status = COALESCE($6, eligibility_status),
             applied_at = COALESCE($7, applied_at),
             metadata = $8::jsonb,
             updated_at = NOW()
           WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND deleted_at IS NULL`,
          params
        );
      } else {
        throw err;
      }
    }
    return this.getById(applicationId, context);
  }

  async getMetrics(userId, tenantId) {
    const apps = await this.findMany({}, { userId, tenantId });
    return {
      total: apps.length,
      eligible: apps.filter((a) => a.eligibilityStatus === "ELIGIBLE" || a.state === "ELIGIBLE").length,
      rejected: apps.filter((a) => a.state === "REJECTED" || a.eligibilityStatus === "NOT_ELIGIBLE").length,
      strongMatches: apps.filter((a) => (a.matchScore || 0) >= 80).length,
      prepared: apps.filter((a) =>
        ["APPLICATION_READY", "CV_GENERATED", "PREPARED", "DRY_RUN", "READY", "SELECTED"].includes(a.state)
      ).length,
      submitted: apps.filter(
        (a) => ["SUBMITTED", "APPLIED"].includes(a.state) && a.dry_run !== true && a.submitted_at
      ).length,
      failed: apps.filter((a) => ["ERROR", "FAILED", "PAUSED", "BLOCKED"].includes(a.state)).length,
      interviews: apps.filter((a) => a.state === "INTERVIEWING").length,
      responses: apps.filter((a) => ["OFFER"].includes(a.state)).length,
    };
  }

  async deleteApplication(applicationId, context) {
    const { rowCount } = await this.client.query(
      `UPDATE applications SET deleted_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND deleted_at IS NULL`,
      [applicationId, context.tenantId, context.userId]
    );
    return rowCount > 0;
  }

  async deleteUserApplications(userId, tenantId) {
    const { rowCount } = await this.client.query(
      `UPDATE applications SET deleted_at = NOW()
       WHERE user_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [userId, tenantId]
    );
    return rowCount;
  }
}
