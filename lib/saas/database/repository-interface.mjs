/**
 * repository-interface.mjs — Multi-Tenant Database Repository Interfaces
 *
 * Defines abstract data contracts for all SaaS entity domains.
 */

export class IRepository {
  async findById(id, context) { throw new Error("Method not implemented"); }
  async findMany(query, context) { throw new Error("Method not implemented"); }
  async create(data, context) { throw new Error("Method not implemented"); }
  async update(id, updates, context) { throw new Error("Method not implemented"); }
  async delete(id, context) { throw new Error("Method not implemented"); }
}

export class IStudentProfileRepository extends IRepository {
  async getByUserId(userId, tenantId) { throw new Error("Method not implemented"); }
  async upsertProfile(userId, tenantId, profileData) { throw new Error("Method not implemented"); }
}

export class IOpportunityRepository extends IRepository {
  async findByFilters(filters, context) { throw new Error("Method not implemented"); }
  async upsertDiscovered(opportunity, context) { throw new Error("Method not implemented"); }
  async listKnownUrls(context) { throw new Error("Method not implemented"); }
}

export class IApplicationRepository extends IRepository {
  async getByOpportunityId(opportunityId, userId, tenantId) { throw new Error("Method not implemented"); }
  async updateApplicationState(applicationId, state, metadata, context) { throw new Error("Method not implemented"); }
  async getMetrics(userId, tenantId) { throw new Error("Method not implemented"); }
}

export class IAuditLogRepository extends IRepository {
  async logEvent(event, context) { throw new Error("Method not implemented"); }
  async getRecentLogs(limit, context) { throw new Error("Method not implemented"); }
}
