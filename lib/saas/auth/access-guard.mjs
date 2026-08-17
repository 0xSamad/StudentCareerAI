/**
 * access-guard.mjs — Service-Layer Authorization & Access Control Guard
 *
 * Enforces strict user and tenant boundaries at the API and service layer.
 * A user can NEVER access another user's profile, CV, applications,
 * generated documents, API credentials, browser sessions, agent config, or job history.
 */

export class UnauthorizedError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthorizedError";
    this.status = 401;
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Access denied: you do not have permission to access this resource") {
    super(message);
    this.name = "ForbiddenError";
    this.status = 403;
  }
}

export class AccessGuard {
  /**
   * Universal access assertion.
   *
   * @param {object} callingContext - { userId, tenantId, role }
   * @param {object} resource - Resource containing { userId, tenantId } or { ownerId, tenantId }
   * @param {string} resourceType - Name of the resource for error reporting
   * @returns {boolean}
   * @throws {UnauthorizedError|ForbiddenError}
   */
  static assertAccess(callingContext, resource, resourceType = "resource") {
    if (!callingContext || !callingContext.userId || !callingContext.tenantId) {
      throw new UnauthorizedError(`Authentication required to access ${resourceType}`);
    }

    if (!resource) {
      throw new ForbiddenError(`${resourceType} not found or inaccessible`);
    }

    const resourceTenantId = resource.tenantId;
    const resourceUserId = resource.userId || resource.ownerId;

    // 1. Tenant Boundary Check
    if (resourceTenantId && resourceTenantId !== "global" && resourceTenantId !== callingContext.tenantId) {
      throw new ForbiddenError(`Cross-tenant access forbidden on ${resourceType}`);
    }

    // 2. Tenant Admin Privilege (Admins can view resources within their tenant)
    if (callingContext.role === "admin" && resourceTenantId === callingContext.tenantId) {
      return true;
    }

    // 3. User Ownership Check
    if (resourceUserId && resourceUserId !== callingContext.userId) {
      throw new ForbiddenError(`Cross-user access forbidden on ${resourceType}: resource belongs to another user`);
    }

    return true;
  }

  /**
   * Verify access to a Student Profile.
   */
  static canAccessProfile(callingContext, profile) {
    return this.assertAccess(callingContext, profile, "student profile");
  }

  /**
   * Verify access to a Master CV or Tailored CV.
   */
  static canAccessCV(callingContext, cv) {
    return this.assertAccess(callingContext, cv, "CV artifact");
  }

  /**
   * Verify access to an Application record.
   */
  static canAccessApplication(callingContext, application) {
    return this.assertAccess(callingContext, application, "application record");
  }

  /**
   * Verify access to a Generated Document (PDF, Cover Letter, Answers).
   */
  static canAccessDocument(callingContext, document) {
    return this.assertAccess(callingContext, document, "generated document");
  }

  /**
   * Verify access to an API Credential or Key.
   */
  static canAccessApiKey(callingContext, apiKeyRecord) {
    return this.assertAccess(callingContext, apiKeyRecord, "API credential");
  }

  /**
   * Verify access to a Browser Session or Execution Trace.
   */
  static canAccessBrowserSession(callingContext, browserSession) {
    return this.assertAccess(callingContext, browserSession, "browser session");
  }

  /**
   * Verify access to Agent Configuration & Automation Settings.
   */
  static canAccessAgentConfig(callingContext, agentConfig) {
    return this.assertAccess(callingContext, agentConfig, "agent configuration");
  }

  /**
   * Verify access to Job Discovery History and Telemetry.
   */
  static canAccessHistory(callingContext, historyRecord) {
    return this.assertAccess(callingContext, historyRecord, "job history");
  }
}
