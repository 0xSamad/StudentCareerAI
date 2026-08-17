/**
 * candidate-intelligence-service.mjs — Long-term Candidate Intelligence.
 *
 * Learns only from user-provided feedback, trusted documents, or explicit
 * confirmation. AI-generated text is never persisted as an authoritative fact.
 */

import { AccessGuard } from "../auth/access-guard.mjs";
import { Sanitizer } from "../auth/sanitizer.mjs";
import { AUTHORITY, FEEDBACK_KIND, ANSWER_VERDICT, attributedValue, isAuthoritative } from "./authority.mjs";
import {
  emptyIntelligenceProfile,
  mergeIntelligenceProfiles,
  profileFromTrustedStudentRecord,
  factsToIntelligenceSlice,
  applyRoleCorrection,
} from "./intelligence-profile.mjs";
import { MemoryIntelligenceStore } from "./intelligence-store.mjs";
import { nowIso } from "./fact-shape.mjs";

function requireContext(context = {}) {
  if (!context.tenantId || !context.userId) {
    throw new Error("tenantId and userId are required");
  }
  return context;
}

function summaryOfText(text, max = 80) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function applicationSummary(app) {
  return {
    id: app.id,
    company: app.company || null,
    title: app.title || app.role || null,
    state: app.state || null,
    opportunityId: app.opportunity_id || app.opportunityId || null,
    createdAt: app.createdAt || app.created_at || null,
    authority: AUTHORITY.USER_SUPPLIED,
    source: { kind: "application-record", label: "Previous application" },
  };
}

function cvSummary(row) {
  return {
    id: row.id,
    kind: row.kind,
    opportunityId: row.opportunityId || null,
    applicationId: row.applicationId || null,
    createdAt: row.createdAt,
    authority: row.kind === "MASTER" ? AUTHORITY.TRUSTED_DOCUMENT : AUTHORITY.GENERATED,
    source: { kind: row.kind === "MASTER" ? "trusted_document" : "generated", label: `CV ${row.kind}` },
    charCount: String(row.cvText || "").length,
  };
}

function coverLetterSummary(row) {
  return {
    id: row.id,
    kind: row.kind,
    jobId: row.jobId || null,
    applicationId: row.applicationId || null,
    createdAt: row.createdAt,
    authority: row.kind === "EDITED" ? AUTHORITY.USER_SUPPLIED : AUTHORITY.GENERATED,
    source: {
      kind: row.kind === "EDITED" ? "user_supplied" : "generated",
      label: `Cover letter ${row.kind}`,
    },
    skipped: row.kind === "SKIPPED",
  };
}

export class CandidateIntelligenceService {
  constructor({
    store,
    knowledgeService,
    profileRepository,
    applicationRepository,
    cvVersionStore,
    coverLetterVersionStore,
    logger,
  } = {}) {
    this.store = store || new MemoryIntelligenceStore();
    this.knowledgeService = knowledgeService || null;
    this.profileRepository = profileRepository || null;
    this.applicationRepository = applicationRepository || null;
    this.cvVersionStore = cvVersionStore || null;
    this.coverLetterVersionStore = coverLetterVersionStore || null;
    this.logger = logger || null;
  }

  async _loadSnapshot(context) {
    const row = await this.store.getProfile(context);
    return row?.profile ? mergeIntelligenceProfiles(emptyIntelligenceProfile(), row.profile) : emptyIntelligenceProfile();
  }

  async _persist(profile, context) {
    profile.updatedAt = nowIso();
    await this.store.saveProfile({
      tenantId: context.tenantId,
      userId: context.userId,
      profile,
    });
    return profile;
  }

  async _event(context, payload) {
    return this.store.saveEvent({
      tenantId: context.tenantId,
      userId: context.userId,
      authority: AUTHORITY.USER_SUPPLIED,
      ...payload,
    });
  }

  /**
   * Full Candidate Intelligence Profile for this user. Does not dump document bodies.
   */
  async getIntelligenceProfile(context = {}) {
    requireContext(context);
    AccessGuard.assertAccess(context, { userId: context.userId, tenantId: context.tenantId }, "IntelligenceProfile");

    let profile = await this._loadSnapshot(context);

    if (this.profileRepository) {
      try {
        const student = await this.profileRepository.getByUserId(context.userId, context.tenantId);
        if (student) {
          profile = mergeIntelligenceProfiles(profileFromTrustedStudentRecord(student), profile);
        }
      } catch {
        /* profile store optional */
      }
    }

    if (this.knowledgeService?.store?.listFacts) {
      try {
        const facts = await this.knowledgeService.store.listFacts(context);
        profile = mergeIntelligenceProfiles(factsToIntelligenceSlice(facts), profile);
      } catch {
        /* knowledge optional */
      }
    }

    if (this.applicationRepository?.findMany) {
      try {
        const apps = await this.applicationRepository.findMany({}, context);
        profile.previousApplications = (apps || []).slice(0, 50).map(applicationSummary);
      } catch {
        profile.previousApplications = profile.previousApplications || [];
      }
    }

    if (this.cvVersionStore?.listVersions) {
      try {
        const versions = await this.cvVersionStore.listVersions(context, {});
        profile.previousCvs = (versions || []).slice(0, 40).map(cvSummary);
      } catch {
        profile.previousCvs = profile.previousCvs || [];
      }
    }

    if (this.coverLetterVersionStore?.listVersions) {
      try {
        const versions = await this.coverLetterVersionStore.listVersions(context, {});
        profile.previousCoverLetters = (versions || []).slice(0, 40).map(coverLetterSummary);
      } catch {
        profile.previousCoverLetters = profile.previousCoverLetters || [];
      }
    }

    const events = await this.store.listEvents(context, { limit: 200 });
    profile.userCorrections = events
      .filter((e) => e.kind === FEEDBACK_KIND.CORRECTION || e.kind === FEEDBACK_KIND.PREFERENCE)
      .map((e) => ({
        id: e.id,
        field: e.field,
        previousValue: e.previousValue,
        newValue: e.newValue,
        opportunityId: e.opportunityId,
        authority: e.authority,
        timestamp: e.createdAt,
      }));
    profile.userApprovedAnswers = events
      .filter((e) => e.kind === FEEDBACK_KIND.ANSWER_APPROVED || e.kind === FEEDBACK_KIND.ANSWER_CORRECTED)
      .map((e) => ({
        id: e.id,
        question: e.question,
        answer: e.correctedAnswer || e.newValue,
        proposed: e.proposedAnswer,
        verdict: e.verdict,
        opportunityId: e.opportunityId,
        authority: AUTHORITY.USER_SUPPLIED,
        timestamp: e.createdAt,
      }));
    profile.userRejectedAnswers = events
      .filter((e) => e.kind === FEEDBACK_KIND.ANSWER_REJECTED || e.kind === FEEDBACK_KIND.ANSWER_CORRECTED)
      .map((e) => ({
        id: e.id,
        question: e.question,
        proposed: e.proposedAnswer,
        answer: e.proposedAnswer,
        verdict: ANSWER_VERDICT.REJECTED,
        opportunityId: e.opportunityId,
        authority: AUTHORITY.GENERATED,
        timestamp: e.createdAt,
      }));
    profile.interviewInformation = events
      .filter((e) => e.kind === FEEDBACK_KIND.INTERVIEW_NOTE)
      .map((e) => ({
        id: e.id,
        company: e.company,
        notes: e.newValue,
        opportunityId: e.opportunityId,
        authority: AUTHORITY.USER_SUPPLIED,
        timestamp: e.createdAt,
      }));

    return profile;
  }

  /**
   * User saved their profile / CV. Treat structured fields as USER_SUPPLIED.
   * Does not ingest AI-generated application text.
   */
  async syncFromTrustedProfile(studentProfile, context = {}) {
    requireContext(context);
    const current = await this._loadSnapshot(context);
    const trusted = profileFromTrustedStudentRecord(studentProfile, { authority: AUTHORITY.USER_SUPPLIED });
    const merged = mergeIntelligenceProfiles(current, trusted);
    await this._event(context, { kind: FEEDBACK_KIND.PROFILE_SYNC, field: "profile" });
    return this._persist(merged, context);
  }

  /**
   * User corrected a proposed value (e.g. "Python developer" → "Machine Learning Engineer").
   */
  async recordUserCorrection(
    { field = "preferred_role", previousValue, newValue, opportunityId = null, company = null } = {},
    context = {}
  ) {
    requireContext(context);
    const neu = String(newValue || "").trim();
    if (!neu) throw new Error("newValue is required for a user correction");

    const current = await this._loadSnapshot(context);
    let next = current;
    const fieldKey = String(field || "preferred_role");
    if (fieldKey === "preferred_role" || fieldKey === "target_role" || fieldKey === "target_roles") {
      next = applyRoleCorrection(current, previousValue, neu, { field: fieldKey, opportunityId });
    } else if (fieldKey === "preferred_industry" || fieldKey === "target_industries") {
      next.preferredIndustries = [
        attributedValue(neu, {
          authority: AUTHORITY.USER_SUPPLIED,
          source: { kind: "user-correction", label: "User correction" },
          evidence: previousValue ? `Corrected from "${previousValue}"` : null,
        }),
        ...(next.preferredIndustries || []).filter(
          (x) => String(x.value || "").toLowerCase() !== String(previousValue || "").toLowerCase()
        ),
      ];
      next.userCorrections = [
        { field: fieldKey, previousValue, newValue: neu, opportunityId, authority: AUTHORITY.USER_SUPPLIED, timestamp: nowIso() },
        ...(next.userCorrections || []),
      ];
    } else if (fieldKey === "location" || fieldKey === "locations") {
      next.locations = [
        attributedValue(neu, {
          authority: AUTHORITY.USER_SUPPLIED,
          source: { kind: "user-correction", label: "User correction" },
        }),
        ...(next.locations || []).filter(
          (x) => String(x.value || "").toLowerCase() !== String(previousValue || "").toLowerCase()
        ),
      ];
    } else {
      next.userCorrections = [
        { field: fieldKey, previousValue, newValue: neu, opportunityId, authority: AUTHORITY.USER_SUPPLIED, timestamp: nowIso() },
        ...(next.userCorrections || []),
      ];
    }

    await this._event(context, {
      kind: FEEDBACK_KIND.CORRECTION,
      field: fieldKey,
      previousValue: previousValue || null,
      newValue: neu,
      opportunityId,
      company,
    });
    await this._persist(next, context);
    await this._syncPreferredRolesToStudentProfile(next, context);

    if (this.logger) {
      this.logger.info(
        "User correction recorded",
        Sanitizer.sanitize({ field: fieldKey, userId: context.userId, tenantId: context.tenantId }),
        context
      );
    }
    return next;
  }

  async _syncPreferredRolesToStudentProfile(intel, context) {
    if (!this.profileRepository?.getByUserId || !this.profileRepository?.upsertProfile) return;
    try {
      const student = await this.profileRepository.getByUserId(context.userId, context.tenantId);
      if (!student) return;
      const roles = (intel.preferredRoles || [])
        .filter((r) => isAuthoritative(r.authority))
        .map((r) => r.value)
        .filter(Boolean);
      if (!roles.length) return;
      const preferences = { ...(student.preferences || {}), target_roles: roles };
      await this.profileRepository.upsertProfile(context.userId, context.tenantId, { ...student, preferences });
    } catch {
      /* optional */
    }
  }

  /**
   * User approved, rejected, or corrected an application answer.
   * The AI draft is never stored as a fact. The corrected answer is USER_SUPPLIED.
   */
  async recordAnswerFeedback(
    { question, proposed = null, corrected = null, verdict, opportunityId = null, company = null } = {},
    context = {}
  ) {
    requireContext(context);
    const q = String(question || "").trim();
    if (!q) throw new Error("question is required");
    const v = String(verdict || "").toUpperCase();
    if (!Object.values(ANSWER_VERDICT).includes(v)) {
      throw new Error("verdict must be APPROVED, REJECTED, or CORRECTED");
    }

    let kind = FEEDBACK_KIND.ANSWER_APPROVED;
    if (v === ANSWER_VERDICT.REJECTED) kind = FEEDBACK_KIND.ANSWER_REJECTED;
    if (v === ANSWER_VERDICT.CORRECTED) kind = FEEDBACK_KIND.ANSWER_CORRECTED;

    const userAnswer = v === ANSWER_VERDICT.REJECTED ? null : String(corrected || proposed || "").trim();
    if (v !== ANSWER_VERDICT.REJECTED && !userAnswer) {
      throw new Error("corrected/approved answer text is required");
    }

    await this._event(context, {
      kind,
      field: "application_answer",
      question: q,
      proposedAnswer: proposed || null,
      correctedAnswer: v === ANSWER_VERDICT.REJECTED ? null : userAnswer,
      newValue: v === ANSWER_VERDICT.REJECTED ? null : userAnswer,
      previousValue: proposed || null,
      verdict: v,
      opportunityId,
      company,
      authority: AUTHORITY.USER_SUPPLIED,
    });

    const current = await this._loadSnapshot(context);
    if (v === ANSWER_VERDICT.REJECTED) {
      current.userRejectedAnswers = [
        {
          question: q,
          proposed,
          authority: AUTHORITY.GENERATED,
          timestamp: nowIso(),
        },
        ...(current.userRejectedAnswers || []),
      ];
    } else {
      current.userApprovedAnswers = [
        {
          question: q,
          answer: userAnswer,
          proposed,
          verdict: v,
          authority: AUTHORITY.USER_SUPPLIED,
          timestamp: nowIso(),
        },
        ...(current.userApprovedAnswers || []),
      ];
      if (v === ANSWER_VERDICT.CORRECTED && proposed) {
        current.userRejectedAnswers = [
          { question: q, proposed, authority: AUTHORITY.GENERATED, timestamp: nowIso() },
          ...(current.userRejectedAnswers || []),
        ];
      }
    }
    return this._persist(current, context);
  }

  /**
   * Interview notes are stored only when the user supplies them.
   */
  async recordInterviewInformation(
    { company, notes, opportunityId = null, round = null } = {},
    context = {}
  ) {
    requireContext(context);
    const text = String(notes || "").trim();
    const co = String(company || "").trim();
    if (!text) throw new Error("Interview notes must be supplied by the user");
    if (!co) throw new Error("company is required");

    await this._event(context, {
      kind: FEEDBACK_KIND.INTERVIEW_NOTE,
      field: "interview",
      newValue: text,
      company: co,
      opportunityId,
      metadata: { round },
      authority: AUTHORITY.USER_SUPPLIED,
    });
    const current = await this._loadSnapshot(context);
    current.interviewInformation = [
      {
        company: co,
        notes: text,
        opportunityId,
        round,
        authority: AUTHORITY.USER_SUPPLIED,
        timestamp: nowIso(),
      },
      ...(current.interviewInformation || []),
    ];
    return this._persist(current, context);
  }

  /**
   * Explicit user confirmation of an AI-generated statement. Without this,
   * generated text remains GENERATED.
   */
  async confirmGenerated({ field, value, opportunityId = null } = {}, context = {}) {
    requireContext(context);
    const v = String(value || "").trim();
    if (!v) throw new Error("value is required to confirm a generated statement");
    await this._event(context, {
      kind: FEEDBACK_KIND.CONFIRMATION,
      field: field || "claim",
      newValue: v,
      opportunityId,
      authority: AUTHORITY.USER_CONFIRMED,
    });
    const current = await this._loadSnapshot(context);
    if (field === "preferred_role" || field === "target_role") {
      current.preferredRoles = [
        attributedValue(v, {
          authority: AUTHORITY.USER_CONFIRMED,
          source: { kind: "user-confirmed", label: "User confirmed" },
        }),
        ...(current.preferredRoles || []),
      ];
    }
    current.userCorrections = [
      {
        field: field || "claim",
        previousValue: null,
        newValue: v,
        opportunityId,
        authority: AUTHORITY.USER_CONFIRMED,
        timestamp: nowIso(),
      },
      ...(current.userCorrections || []),
    ];
    return this._persist(current, context);
  }

  /**
   * Refuse to ingest AI-generated application/CV/cover-letter text as a fact.
   */
  refuseGeneratedAsFact(kind, text) {
    return {
      accepted: false,
      authority: AUTHORITY.GENERATED,
      kind,
      reason: "AI-generated information remains generated until the user supplies, extracts from a trusted document, or explicitly confirms it.",
      preview: summaryOfText(text),
    };
  }

  async deleteUserData(context = {}) {
    requireContext(context);
    if (typeof this.store.deleteUserData === "function") {
      await this.store.deleteUserData(context);
    }
  }
}
