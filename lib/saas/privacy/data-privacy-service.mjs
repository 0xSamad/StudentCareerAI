/**
 * data-privacy-service.mjs — GDPR & CCPA Data Rights, Privacy & Deletion Engine
 *
 * Implements:
 * - GDPR Data Portability (Export full user data to machine-readable JSON)
 * - Selective CV Deletion (Wipes master CV & generated tailored artifacts)
 * - Selective Application History Deletion (Wipes tracked applications & Q&A answers)
 * - Permanent Account Deletion (Wipes credentials, profile, documents, sessions, and files)
 * - Automated Data Retention Purging
 */

import { AccessGuard } from "../auth/access-guard.mjs";
import { Sanitizer } from "../auth/sanitizer.mjs";

export class DataPrivacyService {
  constructor({
    profileRepository,
    applicationRepository,
    auditLogRepository,
    authService,
    storageService,
    candidateKnowledgeService,
    candidateIntelligenceService,
    logger,
  } = {}) {
    this.profileRepository = profileRepository;
    this.applicationRepository = applicationRepository;
    this.auditLogRepository = auditLogRepository;
    this.authService = authService;
    this.storageService = storageService;
    this.candidateKnowledgeService = candidateKnowledgeService;
    this.candidateIntelligenceService = candidateIntelligenceService;
    this.logger = logger;
  }

  /**
   * Export all candidate data in machine-readable JSON format (GDPR Article 20).
   *
   * @param {object} context - { tenantId, userId, role }
   * @returns {Promise<object>} Complete candidate data archive
   */
  async exportUserData(context) {
    const { tenantId, userId } = context;
    if (!userId || !tenantId) throw new Error("Authentication context required for data export");

    // 1. Fetch Profile & Qualifications
    const profile = await this.profileRepository.getByUserId(userId, tenantId);
    if (!profile) {
      throw new Error(`Profile not found for user '${userId}' in tenant '${tenantId}'`);
    }

    // Access authorization check
    AccessGuard.assertAccess(context, profile, "Profile");

    // 2. Fetch Applications & Answers
    const applications = await this.applicationRepository.findMany({}, context);

    // 3. Fetch Audit Logs
    const auditLogs = await this.auditLogRepository.getRecentLogs(100, context);

    let knowledge;
    try {
      knowledge =
        this.candidateKnowledgeService && typeof this.candidateKnowledgeService.listKnowledge === "function"
          ? Sanitizer.sanitize(await this.candidateKnowledgeService.listKnowledge({ tenantId, userId }))
          : undefined;
    } catch {
      knowledge = undefined;
    }

    let intelligence;
    try {
      intelligence =
        this.candidateIntelligenceService &&
        typeof this.candidateIntelligenceService.getIntelligenceProfile === "function"
          ? Sanitizer.sanitize(await this.candidateIntelligenceService.getIntelligenceProfile({ tenantId, userId }))
          : undefined;
    } catch {
      intelligence = undefined;
    }

    const exportPayload = {
      exportVersion: "2.0",
      exportTimestamp: new Date().toISOString(),
      tenantId,
      userId,
      profile: Sanitizer.sanitize(profile),
      applications: Sanitizer.sanitize(applications),
      auditEvents: Sanitizer.sanitize(auditLogs),
      knowledge,
      intelligence,
      legalNotice: "This data export contains all personal and career records processed by StudentCareer AI.",
    };

    if (this.logger) {
      this.logger.info("User data export generated", { userId, tenantId }, context);
    }

    return exportPayload;
  }

  /**
   * Delete Master CV and all generated tailored resume files.
   *
   * @param {object} context - { tenantId, userId }
   */
  async deleteCV(context) {
    const { tenantId, userId } = context;
    const profile = await this.profileRepository.getByUserId(userId, tenantId);
    if (!profile) throw new Error("Profile not found");

    AccessGuard.assertAccess(context, profile, "CV");

    // Clear CV fields from profile
    profile.rawCvText = null;
    profile.cv = null;
    profile.cvParsed = null;
    profile.updatedAt = new Date().toISOString();
    await this.profileRepository.upsertProfile(userId, tenantId, profile);

    // Delete generated CV storage directory
    if (this.storageService && typeof this.storageService.deleteDirectory === "function") {
      await this.storageService.deleteDirectory("cvs", context);
    }

    // Log deletion event
    await this.auditLogRepository.logEvent(
      { action: "CV_DELETED", details: "Master and tailored CV files deleted by user" },
      context
    );

    if (this.logger) {
      this.logger.info("User CV and tailored artifacts deleted", { userId }, context);
    }

    return { success: true, message: "CV and tailored artifacts permanently deleted" };
  }

  /**
   * Delete all tracked applications, form answers, and cover letter artifacts.
   *
   * @param {object} context - { tenantId, userId }
   */
  async deleteApplicationHistory(context) {
    const { tenantId, userId } = context;
    const profile = await this.profileRepository.getByUserId(userId, tenantId);
    if (profile) {
      AccessGuard.assertAccess(context, profile, "Application");
    }

    // Purge applications in repository
    const deletedCount = await this.applicationRepository.deleteUserApplications(userId, tenantId);

    // Delete applications storage directory
    if (this.storageService && typeof this.storageService.deleteDirectory === "function") {
      await this.storageService.deleteDirectory("applications", context);
    }

    // Log deletion event
    await this.auditLogRepository.logEvent(
      { action: "APPLICATIONS_PURGED", details: `Purged ${deletedCount} application records` },
      context
    );

    if (this.logger) {
      this.logger.info("Application history purged", { userId, deletedCount }, context);
    }

    return { success: true, deletedApplicationsCount: deletedCount };
  }

  /**
   * Permanently delete user account, credentials, profile, applications, and storage.
   *
   * @param {string} targetUserId
   * @param {object} context - { tenantId, userId, role }
   */
  async deleteUserAccount(targetUserId, context) {
    const { tenantId } = context;

    // Check authorization: only the user themselves or tenant admin can delete
    AccessGuard.assertAccess(context, { userId: targetUserId, tenantId }, "Profile");

    // 1. Delete Application History & Artifacts
    await this.deleteApplicationHistory({ tenantId, userId: targetUserId });

    // 2. Delete Student Profile
    await this.profileRepository.deleteProfile(targetUserId, tenantId);

    // 3. Delete Entire User Storage Sandbox
    if (this.storageService && typeof this.storageService.deleteUserStorage === "function") {
      await this.storageService.deleteUserStorage({ tenantId, userId: targetUserId });
    }

    if (this.candidateKnowledgeService && typeof this.candidateKnowledgeService.deleteUserData === "function") {
      try {
        await this.candidateKnowledgeService.deleteUserData({ tenantId, userId: targetUserId });
      } catch {
        /* continue erasure */
      }
    }
    if (this.candidateIntelligenceService && typeof this.candidateIntelligenceService.deleteUserData === "function") {
      try {
        await this.candidateIntelligenceService.deleteUserData({ tenantId, userId: targetUserId });
      } catch {
        /* continue erasure */
      }
    }

    // 4. Revoke Sessions & Delete Auth User Record
    if (this.authService) {
      this.authService.users.delete(targetUserId);
      for (const [token, session] of this.authService.sessions.entries()) {
        if (session.userId === targetUserId) {
          this.authService.sessions.delete(token);
        }
      }
    }

    // 5. Delete User Audit Logs
    await this.auditLogRepository.deleteUserLogs(targetUserId, tenantId);

    if (this.logger) {
      this.logger.info("User account and all associated data permanently deleted", { targetUserId, tenantId }, context);
    }

    return {
      success: true,
      message: `User account '${targetUserId}' and all associated personal data permanently eradicated.`,
      deletedAt: new Date().toISOString(),
    };
  }
}
