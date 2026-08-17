/**
 * cv-decision-engine.mjs — Decide whether to reuse the master CV or tailor it.
 *
 * Pipeline: master CV + candidate knowledge + JD + eligibility + match → analysis.
 * Regenerates only when changes would significantly improve relevance.
 * Claim validation is required before a tailored version is accepted.
 */

import { tailorCV, validateAgainstSourceFacts, extractSourceFacts, FabricationError } from "../../cv-tailor.mjs";
import { analyzeCvForOpportunity, mergeVerifiedKnowledgeIntoProfile, wrapMasterCvHtml } from "./cv-analysis.mjs";
import { MemoryCvVersionStore } from "./cv-version-store.mjs";

function requireContext(context = {}) {
  if (!context.tenantId || !context.userId) throw new Error("tenantId and userId are required");
  return context;
}

function reusedRecord({ profile, cvText, opportunity, analysis }) {
  return {
    opportunity_id: opportunity.id || opportunity.url || null,
    opportunity_title: opportunity.title || opportunity.role || null,
    opportunity_company: opportunity.company || null,
    tailored_at: new Date().toISOString(),
    reused_master: true,
    regenerated: false,
    original_cv: cvText,
    tailored_html: wrapMasterCvHtml(cvText, profile),
    tailored_draft: null,
    tailoring_notes: analysis.reason,
    changes_made: [],
    reason_for_changes: analysis.reason,
    cvSuitable: analysis.cvSuitable,
    recommendedChanges: analysis.recommendedChanges,
    riskLevel: analysis.riskLevel,
    validation_result: "CLEAN",
    validation_violations: [],
    validation_flagged: [],
  };
}

export class CvDecisionEngine {
  constructor({
    versionStore,
    candidateKnowledgeService,
    storageService,
    tailorFn = tailorCV,
  } = {}) {
    this.versionStore = versionStore || new MemoryCvVersionStore();
    this.candidateKnowledgeService = candidateKnowledgeService || null;
    this.storageService = storageService || null;
    this.tailorFn = tailorFn;
  }

  analyze(input) {
    return analyzeCvForOpportunity(input);
  }

  /**
   * Analyze, optionally tailor, validate claims, store versions.
   */
  async decideAndPrepare({
    profile,
    cvText = "",
    opportunity,
    eligibility = null,
    matchResult = null,
    matchingConfig,
    callAIFn,
    applicationId = null,
    context = {},
  } = {}) {
    requireContext(context);
    const { tenantId, userId } = context;

    let knowledgeContext = null;
    if (this.candidateKnowledgeService) {
      try {
        knowledgeContext = await this.candidateKnowledgeService.getCandidateContextForOpportunity(opportunity, context, {
          purpose: "cv",
        });
      } catch {
        knowledgeContext = null;
      }
    }

    const analysis = analyzeCvForOpportunity({
      profile,
      cvText,
      opportunity,
      eligibility,
      matchResult,
      knowledgeContext,
    });

    const masterVersion = await this.versionStore.saveVersion({
      tenantId,
      userId,
      applicationId,
      opportunityId: opportunity.id || null,
      kind: "MASTER",
      cvText,
      cvHtml: wrapMasterCvHtml(cvText, profile),
      decision: analysis,
      changes: [],
      reason: "Master CV snapshot at decision time.",
      validation: { result: "N/A" },
    });

    if (!analysis.shouldRegenerate) {
      const record = reusedRecord({ profile, cvText, opportunity, analysis });
      const reused = await this.versionStore.saveVersion({
        tenantId,
        userId,
        applicationId,
        opportunityId: opportunity.id || null,
        kind: "REUSED",
        cvText,
        cvHtml: record.tailored_html,
        decision: analysis,
        changes: [],
        reason: analysis.reason,
        validation: { result: "CLEAN", reusedMaster: true },
      });
      return {
        analysis,
        record,
        reusedMaster: true,
        regenerated: false,
        versions: [reused, masterVersion],
        originalCv: cvText,
        tailoredCv: cvText,
        changesMade: [],
        reasonForChanges: analysis.reason,
      };
    }

    const augmentedProfile = mergeVerifiedKnowledgeIntoProfile(profile, knowledgeContext);
    let tailored;
    try {
      tailored = await this.tailorFn({
        profile: augmentedProfile,
        cvText,
        opportunity,
        eligibility,
        matchResult,
        matchingConfig,
        callAIFn,
      });
    } catch (err) {
      if (err instanceof FabricationError || err?.name === "FabricationError") {
        await this.versionStore.saveVersion({
          tenantId,
          userId,
          applicationId,
          opportunityId: opportunity.id || null,
          kind: "REJECTED",
          cvText: "",
          decision: analysis,
          changes: analysis.recommendedChanges,
          reason: err.message,
          validation: { result: "REJECTED", violations: err.violations || [] },
        });
        const record = reusedRecord({ profile, cvText, opportunity, analysis: { ...analysis, riskLevel: "HIGH", reason: "Tailored CV rejected: fabricated claims. Master CV kept." } });
        record.validation_result = "REJECTED";
        record.validation_violations = err.violations || [];
        return {
          analysis: { ...analysis, riskLevel: "HIGH" },
          record,
          reusedMaster: true,
          regenerated: false,
          rejectedTailor: true,
          originalCv: cvText,
          tailoredCv: cvText,
          changesMade: [],
          reasonForChanges: "Tailored CV failed claim validation. Master CV was kept.",
        };
      }
      throw err;
    }

    const sourceFacts = extractSourceFacts(augmentedProfile, cvText);
    const draftValidation = tailored.tailored_draft
      ? validateAgainstSourceFacts(tailored.tailored_draft, sourceFacts)
      : { result: tailored.validation_result || "CLEAN", violations: tailored.validation_violations || [], flagged: [] };

    if (draftValidation.result === "REJECTED") {
      await this.versionStore.saveVersion({
        tenantId,
        userId,
        applicationId,
        opportunityId: opportunity.id || null,
        kind: "REJECTED",
        cvText: JSON.stringify(tailored.tailored_draft || {}),
        decision: analysis,
        changes: analysis.recommendedChanges,
        reason: "Claim validation rejected the tailored CV.",
        validation: draftValidation,
      });
      const record = reusedRecord({
        profile,
        cvText,
        opportunity,
        analysis: { ...analysis, reason: "Tailored CV failed claim validation. Master CV kept." },
      });
      return {
        analysis,
        record,
        reusedMaster: true,
        regenerated: false,
        rejectedTailor: true,
        originalCv: cvText,
        tailoredCv: cvText,
        changesMade: [],
        reasonForChanges: record.reason_for_changes,
      };
    }

    if (this.candidateKnowledgeService) {
      const claim = tailored.tailored_draft || tailored.tailored_html || "";
      const grounded = await this.candidateKnowledgeService.validateGeneratedClaim(claim, context);
      if (grounded.status === "REJECTED") {
        await this.versionStore.saveVersion({
          tenantId,
          userId,
          applicationId,
          opportunityId: opportunity.id || null,
          kind: "REJECTED",
          cvText: JSON.stringify(claim).slice(0, 8000),
          decision: analysis,
          changes: analysis.recommendedChanges,
          reason: "Knowledge claim validation rejected the tailored CV.",
          validation: grounded,
        });
        const record = reusedRecord({
          profile,
          cvText,
          opportunity,
          analysis: { ...analysis, reason: "Tailored CV failed knowledge grounding. Master CV kept." },
        });
        return {
          analysis,
          record,
          reusedMaster: true,
          regenerated: false,
          rejectedTailor: true,
          originalCv: cvText,
          tailoredCv: cvText,
          changesMade: [],
          reasonForChanges: record.reason_for_changes,
        };
      }
    }

    const changesMade = [
      ...analysis.recommendedChanges.filter((c) => !/^No regeneration|^UNKNOWN skills|^Do not tailor/.test(c)),
      tailored.tailoring_notes || tailored.tailored_draft?.tailoring_notes || null,
    ].filter(Boolean);

    const record = {
      ...tailored,
      reused_master: false,
      regenerated: true,
      original_cv: cvText,
      cvSuitable: analysis.cvSuitable,
      recommendedChanges: analysis.recommendedChanges,
      riskLevel: analysis.riskLevel,
      changes_made: changesMade,
      reason_for_changes: analysis.reason,
      validation_result: draftValidation.result,
      validation_violations: draftValidation.violations,
      validation_flagged: draftValidation.flagged,
    };

    const stored = await this.versionStore.saveVersion({
      tenantId,
      userId,
      applicationId,
      opportunityId: opportunity.id || null,
      kind: "TAILORED",
      cvText: JSON.stringify(tailored.tailored_draft || { html: tailored.tailored_html }),
      cvHtml: tailored.tailored_html,
      decision: analysis,
      changes: changesMade,
      reason: analysis.reason,
      validation: draftValidation,
    });

    if (this.storageService && tailored.tailored_html) {
      try {
        await this.storageService.saveFile(
          `cvs/${opportunity.id || stored.id}_tailored.html`,
          tailored.tailored_html,
          { kind: "TAILORED", company: opportunity.company },
          context
        );
      } catch {
        // Storage is optional.
      }
    }

    return {
      analysis,
      record,
      reusedMaster: false,
      regenerated: true,
      versions: [stored, masterVersion],
      originalCv: cvText,
      tailoredCv: tailored.tailored_html,
      changesMade,
      reasonForChanges: analysis.reason,
    };
  }

  async listVersions(context, query) {
    requireContext(context);
    return this.versionStore.listVersions(context, query);
  }
}
