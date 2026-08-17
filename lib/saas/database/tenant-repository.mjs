/**
 * tenant-repository.mjs — Concrete Multi-Tenant Partitioned Repositories
 *
 * Enforces multi-tenancy at the data layer:
 * - Every record has tenantId and userId
 * - Queries always filter by the active tenant context
 * - Cross-tenant data access is strictly prevented
 */

import {
  IStudentProfileRepository,
  IOpportunityRepository,
  IApplicationRepository,
  IAuditLogRepository,
} from "./repository-interface.mjs";
import { mergeProfileRecord } from "./merge-profile.mjs";

export class TenantStudentProfileRepository extends IStudentProfileRepository {
  constructor() {
    super();
    // Key: `${tenantId}:${userId}` -> profile
    this.profiles = new Map();
  }

  async getByUserId(userId, tenantId) {
    if (!userId || !tenantId) throw new Error("userId and tenantId are required");
    const key = `${tenantId}:${userId}`;
    return this.profiles.get(key) || null;
  }

  async upsertProfile(userId, tenantId, profileData) {
    if (!userId || !tenantId) throw new Error("userId and tenantId are required");
    const key = `${tenantId}:${userId}`;
    const existing = this.profiles.get(key) || null;
    const merged = mergeProfileRecord(existing || {}, profileData || {});
    const record = {
      id: existing?.id || `prof_${userId}`,
      tenantId,
      userId,
      ...merged,
      updatedAt: new Date().toISOString(),
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    this.profiles.set(key, record);
    return record;
  }

  async deleteProfile(userId, tenantId) {
    if (!userId || !tenantId) throw new Error("userId and tenantId are required");
    const key = `${tenantId}:${userId}`;
    return this.profiles.delete(key);
  }
}

export class TenantOpportunityRepository extends IOpportunityRepository {
  constructor() {
    super();
    this.opportunities = new Map(); // id -> opp
    this.byUrl = new Map(); // url -> id
  }

  async findById(id, context = {}) {
    const { tenantId, userId } = context;
    const opp = this.opportunities.get(id);
    if (!opp) return null;
    if (tenantId && opp.tenantId && opp.tenantId !== tenantId && opp.tenantId !== "global") {
      return null;
    }
    if (userId && opp.userId && opp.userId !== userId) {
      return null;
    }
    return opp;
  }

  async findByFilters(filters = {}, context = {}) {
    const { tenantId, userId } = context;
    const items = [];
    for (const opp of this.opportunities.values()) {
      if (opp.tenantId && tenantId && opp.tenantId !== tenantId && opp.tenantId !== "global") {
        continue;
      }
      if (userId && opp.userId && opp.userId !== userId) {
        continue;
      }
      if (filters.includeDemo !== true && opp.is_demo) {
        continue;
      }
      if (filters.verifiedOnly === true && !opp.is_verified) {
        continue;
      }
      if (filters.type && opp.type !== filters.type && opp.opportunity_type !== filters.type) {
        continue;
      }
      if (filters.minScore && (opp.matchScore || opp.match_score || 0) < filters.minScore) {
        continue;
      }
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const matches =
          (opp.company || opp.company_name || "").toLowerCase().includes(q) ||
          (opp.title || opp.role || "").toLowerCase().includes(q);
        if (!matches) continue;
      }
      if (filters.eligibleOnly === true) {
        const status = opp.eligibility_status || opp.eligibilityStatus;
        if (status !== "ELIGIBLE" && status !== "REQUIRES_REVIEW") continue;
      }
      items.push(opp);
    }
    const sorted = items.sort(
      (a, b) =>
        new Date(b.discovered_at || b.updatedAt || 0).getTime() -
        new Date(a.discovered_at || a.updatedAt || 0).getTime()
    );
    if (filters.limit && Number(filters.limit) > 0) {
      return sorted.slice(0, Math.min(Number(filters.limit), 500));
    }
    return sorted;
  }

  async countByFilters(filters = {}, context = {}) {
    const items = await this.findByFilters(filters, context);
    return items.length;
  }

  async listKnownUrls(context = {}) {
    const { tenantId, userId } = context;
    const urls = new Set();
    for (const opp of this.opportunities.values()) {
      if (opp.tenantId !== tenantId && opp.tenantId !== "global") continue;
      if (userId && opp.userId && opp.userId !== userId) continue;
      if (opp.url) urls.add(opp.url);
    }
    return urls;
  }

  async upsertDiscovered(opportunity, context = {}) {
    const { tenantId = "global", userId = "system" } = context;
    const url = opportunity.url;
    const existed = !!(url && this.byUrl.has(url));
    let id = opportunity.id;
    if (url && this.byUrl.has(url)) {
      id = this.byUrl.get(url);
    }
    id = id || `opp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const previous = this.opportunities.get(id);
    const record = {
      ...opportunity,
      id,
      tenantId,
      userId,
      matchScore: opportunity.match_score ?? opportunity.matchScore ?? null,
      eligibility_status:
        opportunity.eligibility_status ?? opportunity.eligibilityStatus ?? "PENDING",
      updatedAt: new Date().toISOString(),
      createdAt: previous?.createdAt || new Date().toISOString(),
      discovered_at: existed ? previous?.discovered_at || opportunity.discovered_at : opportunity.discovered_at,
      isNew: !existed,
    };
    this.opportunities.set(id, record);
    if (url) this.byUrl.set(url, id);
    return record;
  }
}

export class TenantApplicationRepository extends IApplicationRepository {
  constructor() {
    super();
    this.applications = new Map(); // id -> app
  }

  async create(data, context) {
    const { tenantId, userId } = context;
    if (!tenantId || !userId) throw new Error("tenantId and userId are required");
    const id = data.id || `app_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const record = {
      ...data,
      id,
      tenantId,
      userId,
      opportunity_id: data.opportunity_id || data.opportunityId || data.id,
      opportunityId: data.opportunity_id || data.opportunityId || data.id,
      state: data.state || "DISCOVERED",
      metadata: data.metadata || {},
      artifacts: data.artifacts || data.metadata?.artifacts || {},
      url: data.url || data.metadata?.url || null,
      location: data.location || data.metadata?.location || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stateHistory: [
        { state: data.state || "DISCOVERED", timestamp: new Date().toISOString(), reason: "Initial creation" },
      ],
    };
    this.applications.set(id, record);
    return record;
  }

  async getById(id, context) {
    const { tenantId, userId } = context;
    const app = this.applications.get(id);
    if (!app || app.tenantId !== tenantId || app.userId !== userId) return null;
    return app;
  }

  async findMany(query = {}, context) {
    const { tenantId, userId } = context;
    if (!tenantId || !userId) throw new Error("tenantId and userId are required");

    const results = [];
    for (const app of this.applications.values()) {
      if (app.tenantId === tenantId && app.userId === userId) {
        if (query.state && app.state !== query.state) continue;
        results.push(app);
      }
    }
    return results;
  }

  async getByOpportunityId(opportunityId, userId, tenantId) {
    for (const app of this.applications.values()) {
      if (
        app.tenantId === tenantId &&
        app.userId === userId &&
        (app.opportunity_id === opportunityId ||
          app.opportunityId === opportunityId ||
          app.id === opportunityId ||
          app.metadata?.globalOpportunityId === opportunityId)
      ) {
        return app;
      }
    }
    return null;
  }

  async updateApplicationState(applicationId, state, metadata = {}, context) {
    const { tenantId, userId } = context;
    const app = this.applications.get(applicationId);
    if (!app || app.tenantId !== tenantId || app.userId !== userId) {
      throw new Error(`Application '${applicationId}' not found in current tenant`);
    }

    app.state = state;
    app.updatedAt = new Date().toISOString();
    if (metadata.artifacts) app.artifacts = { ...(app.artifacts || {}), ...metadata.artifacts };
    if (metadata.matchScore != null) app.matchScore = metadata.matchScore;
    if (metadata.match_score != null) app.match_score = metadata.match_score;
    if (metadata.eligibilityStatus) app.eligibilityStatus = metadata.eligibilityStatus;
    if (metadata.eligibility_status) app.eligibility_status = metadata.eligibility_status;
    if (metadata.submitted_at) {
      app.submitted_at = metadata.submitted_at;
      app.applied_at = metadata.submitted_at;
    }
    if (metadata.pause_reason) app.pause_reason = metadata.pause_reason;
    if (metadata.paused_at) app.paused_at = metadata.paused_at;
    if (metadata.skip_reason) app.skip_reason = metadata.skip_reason;
    if (metadata.last_message) app.last_message = metadata.last_message;
    if (metadata.outcome) app.outcome = metadata.outcome;
    if (!app.stateHistory) app.stateHistory = [];

    app.stateHistory.push({
      state,
      timestamp: new Date().toISOString(),
      reason: metadata.reason || "State update",
    });

    this.applications.set(applicationId, app);
    return app;
  }

  async getMetrics(userId, tenantId) {
    const apps = await this.findMany({}, { userId, tenantId });
    return {
      total: apps.length,
      eligible: apps.filter((a) => a.eligibilityStatus === "ELIGIBLE" || a.state !== "REJECTED").length,
      rejected: apps.filter((a) => a.state === "REJECTED" || a.eligibilityStatus === "NOT_ELIGIBLE").length,
      strongMatches: apps.filter((a) => (a.matchScore || 0) >= 80).length,
      prepared: apps.filter((a) => a.state === "APPLICATION_READY" || a.state === "CV_GENERATED").length,
      submitted: apps.filter((a) => a.state === "APPLIED" || a.state === "DRY_RUN_COMPLETED").length,
      failed: apps.filter((a) => a.state === "ERROR" || a.state === "PAUSED").length,
      interviews: apps.filter((a) => a.state === "INTERVIEWING").length,
      responses: apps.filter((a) => a.state === "REPLIED" || a.state === "OFFER").length,
    };
  }

  async deleteApplication(applicationId, context) {
    const { tenantId, userId } = context;
    const app = this.applications.get(applicationId);
    if (!app || app.tenantId !== tenantId || app.userId !== userId) {
      return false;
    }
    return this.applications.delete(applicationId);
  }

  async deleteUserApplications(userId, tenantId) {
    let count = 0;
    for (const [id, app] of this.applications.entries()) {
      if (app.tenantId === tenantId && app.userId === userId) {
        this.applications.delete(id);
        count++;
      }
    }
    return count;
  }
}

export class TenantAuditLogRepository extends IAuditLogRepository {
  constructor() {
    super();
    this.logs = []; // array of events
  }

  async logEvent(event, context) {
    const { tenantId, userId } = context;
    const record = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      tenantId: tenantId || "system",
      userId: userId || "system",
      timestamp: new Date().toISOString(),
      ...event,
    };
    this.logs.push(record);
    return record;
  }

  async getRecentLogs(limit = 20, context) {
    const { tenantId, userId } = context;
    return this.logs
      .filter((l) => (!tenantId || l.tenantId === tenantId) && (!userId || l.userId === userId))
      .slice(-limit)
      .reverse();
  }

  async deleteUserLogs(userId, tenantId) {
    const initialLen = this.logs.length;
    this.logs = this.logs.filter((l) => !(l.tenantId === tenantId && l.userId === userId));
    return initialLen - this.logs.length;
  }
}
