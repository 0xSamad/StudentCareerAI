/**
 * cover-letter-decision-engine.mjs — Decide whether a cover letter is needed,
 * generate only when required/recommended (or optional with attested benefit),
 * and validate every factual claim before accepting it.
 */

import { generateCoverLetter } from "../../application-generator.mjs";
import { extractSourceFacts, validateAgainstSourceFacts } from "../../cv-tailor.mjs";
import { analyzeCvForOpportunity } from "../cv/cv-analysis.mjs";
import {
  analyzeCoverLetterRequirement,
  attestedTokensFrom,
  studentGoalsFromProfile,
} from "./cover-letter-requirement.mjs";
import { isGenericCoverLetter } from "./generic-detector.mjs";
import { MemoryCoverLetterVersionStore } from "./cover-letter-version-store.mjs";

function requireContext(context = {}) {
  if (!context.tenantId || !context.userId) throw new Error("tenantId and userId are required");
  return context;
}

function jobIdOf(opportunity = {}) {
  return opportunity.id || opportunity.opportunity_id || opportunity.url || null;
}

function collectSourceEvidence({ knowledgeContext, profile, analysis }) {
  const evidence = [];
  for (const p of knowledgeContext?.evidencePackets || []) {
    evidence.push({
      kind: "chunk",
      text: String(p.text || p.snippet || "").slice(0, 600),
      source: p.source || p.documentId || null,
    });
  }
  for (const s of knowledgeContext?.matchingSkills || []) {
    if (s.status === "GROUNDED" && s.skill) {
      evidence.push({ kind: "skill", value: s.skill, status: "GROUNDED" });
    }
  }
  for (const name of analysis.relevantProjects || []) {
    evidence.push({ kind: "project", value: name });
  }
  for (const name of analysis.relevantExperience || []) {
    evidence.push({ kind: "experience", value: name });
  }
  for (const g of studentGoalsFromProfile(profile, knowledgeContext)) {
    evidence.push({ kind: "goal", value: g });
  }
  return evidence.slice(0, 24);
}

function skippedRecord({ opportunity, analysis, generatedAt }) {
  return {
    jobId: jobIdOf(opportunity),
    version: 1,
    generatedAt,
    coverLetter: null,
    subject_line: null,
    body: null,
    sourceEvidence: [],
    requirement: analysis.requirement,
    skipped: true,
    generated: false,
    reason: analysis.reason,
    signals: analysis.signals,
    word_count: 0,
    confidence: 1,
    validation_result: "N/A",
  };
}

export class CoverLetterDecisionEngine {
  constructor({
    versionStore,
    candidateKnowledgeService,
    generateFn = generateCoverLetter,
  } = {}) {
    this.versionStore = versionStore || new MemoryCoverLetterVersionStore();
    this.candidateKnowledgeService = candidateKnowledgeService || null;
    this.generateFn = generateFn;
  }

  analyze(input) {
    return analyzeCoverLetterRequirement(input);
  }

  /**
   * Analyze requirement, optionally generate, validate claims, store version.
   */
  async decideAndPrepare({
    profile,
    opportunity,
    matchResult = null,
    eligibility = null,
    cvText = "",
    cvAnalysis = null,
    callAIFn,
    matchingConfig,
    applicationId = null,
    context = {},
  } = {}) {
    requireContext(context);
    const { tenantId, userId } = context;
    const jobId = jobIdOf(opportunity);
    const generatedAt = new Date().toISOString();

    let knowledgeContext = null;
    if (this.candidateKnowledgeService) {
      try {
        knowledgeContext = await this.candidateKnowledgeService.getCandidateContextForOpportunity(opportunity, context, {
          purpose: "cover_letter",
        });
      } catch {
        knowledgeContext = null;
      }
    }

    const cv = cvAnalysis || analyzeCvForOpportunity({
      profile,
      cvText,
      opportunity,
      eligibility,
      matchResult,
      knowledgeContext,
    });

    const analysis = analyzeCoverLetterRequirement({
      opportunity,
      profile,
      knowledgeContext,
      cvAnalysis: cv,
      matchResult,
    });

    if (!analysis.shouldGenerate) {
      const stored = await this.versionStore.saveVersion({
        tenantId,
        userId,
        applicationId,
        jobId,
        kind: "SKIPPED",
        coverLetter: null,
        sourceEvidence: [],
        requirement: analysis.requirement,
        reason: analysis.reason,
        validation: { result: "SKIPPED" },
        generatedAt,
      });
      return {
        analysis,
        record: { ...skippedRecord({ opportunity, analysis, generatedAt }), version: stored.version },
        generated: false,
        skipped: true,
        version: stored,
      };
    }

    const evidencePackets = knowledgeContext?.evidencePackets || [];
    const sourceEvidence = collectSourceEvidence({ knowledgeContext, profile, analysis });
    const attestedTokens = attestedTokensFrom({ profile, knowledgeContext, cvAnalysis: cv });

    let letter;
    try {
      letter = await this.generateFn({
        profile,
        opportunity,
        matchResult,
        callAIFn,
        matchingConfig,
        evidencePackets,
        relevantExperience: analysis.relevantExperience,
        relevantProjects: analysis.relevantProjects,
        goals: analysis.goals,
        company: opportunity.company,
        position: opportunity.title || opportunity.role,
      });
    } catch (err) {
      await this.versionStore.saveVersion({
        tenantId,
        userId,
        applicationId,
        jobId,
        kind: "REJECTED",
        coverLetter: null,
        sourceEvidence,
        requirement: analysis.requirement,
        reason: err.message,
        validation: { result: "REJECTED", error: err.message },
        generatedAt,
      });
      return {
        analysis,
        record: skippedRecord({
          opportunity,
          analysis: { ...analysis, reason: `Cover letter generation failed: ${err.message}` },
          generatedAt,
        }),
        generated: false,
        skipped: true,
        rejected: true,
      };
    }

    const generic = isGenericCoverLetter(letter.body, { opportunity, attestedTokens });
    if (generic.generic) {
      await this.versionStore.saveVersion({
        tenantId,
        userId,
        applicationId,
        jobId,
        kind: "REJECTED",
        coverLetter: letter.body,
        subjectLine: letter.subject_line,
        sourceEvidence,
        requirement: analysis.requirement,
        reason: generic.reason,
        validation: { result: "REJECTED", generic: true, attestedHits: generic.attestedHits },
        generatedAt,
      });
      return {
        analysis: { ...analysis, reason: generic.reason },
        record: skippedRecord({
          opportunity,
          analysis: { ...analysis, reason: generic.reason },
          generatedAt,
        }),
        generated: false,
        skipped: true,
        rejected: true,
        generic: true,
      };
    }

    const sourceFacts = extractSourceFacts(profile, cvText);
    const draftValidation = validateAgainstSourceFacts(letter.body, sourceFacts);
    if (draftValidation.result === "REJECTED") {
      await this.versionStore.saveVersion({
        tenantId,
        userId,
        applicationId,
        jobId,
        kind: "REJECTED",
        coverLetter: letter.body,
        subjectLine: letter.subject_line,
        sourceEvidence,
        requirement: analysis.requirement,
        reason: "Claim validation rejected the cover letter.",
        validation: draftValidation,
        generatedAt,
      });
      return {
        analysis: { ...analysis, reason: "Cover letter failed claim validation. Nothing was stored as the application letter." },
        record: skippedRecord({
          opportunity,
          analysis: { ...analysis, reason: "Cover letter failed claim validation. It was not used." },
          generatedAt,
        }),
        generated: false,
        skipped: true,
        rejected: true,
      };
    }

    if (this.candidateKnowledgeService) {
      try {
        const listed = await this.candidateKnowledgeService.listKnowledge(context);
        if ((listed.documents || []).length > 0) {
          const grounded = await this.candidateKnowledgeService.validateGeneratedClaim(letter.body, context);
          if (grounded.status === "REJECTED") {
            await this.versionStore.saveVersion({
              tenantId,
              userId,
              applicationId,
              jobId,
              kind: "REJECTED",
              coverLetter: letter.body,
              sourceEvidence,
              requirement: analysis.requirement,
              reason: "Knowledge claim validation rejected the cover letter.",
              validation: grounded,
              generatedAt,
            });
            return {
              analysis: { ...analysis, reason: "Cover letter failed knowledge grounding. It was not used." },
              record: skippedRecord({
                opportunity,
                analysis: { ...analysis, reason: "Cover letter failed knowledge grounding. It was not used." },
                generatedAt,
              }),
              generated: false,
              skipped: true,
              rejected: true,
            };
          }
          letter.grounding = {
            status: grounded.status,
            unknownClaims: grounded.unknownClaims,
            violations: grounded.violations,
          };
        }
      } catch {
        // Knowledge validation is additive; source-fact checks already ran.
      }
    }

    const record = {
      jobId,
      version: 1,
      generatedAt: letter.generated_at || generatedAt,
      coverLetter: letter.body,
      subject_line: letter.subject_line,
      body: letter.body,
      sourceEvidence,
      requirement: analysis.requirement,
      skipped: false,
      generated: true,
      reason: analysis.reason,
      signals: analysis.signals,
      word_count: letter.word_count,
      confidence: letter.confidence,
      grounding: letter.grounding || null,
      validation_result: draftValidation.result,
      validation_violations: draftValidation.violations || [],
      attestedHits: generic.attestedHits,
    };

    const stored = await this.versionStore.saveVersion({
      tenantId,
      userId,
      applicationId,
      jobId,
      kind: "GENERATED",
      coverLetter: letter.body,
      subjectLine: letter.subject_line,
      sourceEvidence,
      requirement: analysis.requirement,
      reason: analysis.reason,
      validation: draftValidation,
      generatedAt: record.generatedAt,
    });
    record.version = stored.version;

    return {
      analysis,
      record,
      generated: true,
      skipped: false,
      version: stored,
    };
  }

  async saveEdit({
    body,
    subjectLine = null,
    opportunity = {},
    applicationId = null,
    analysis = {},
    sourceEvidence = [],
    context = {},
  } = {}) {
    requireContext(context);
    const generatedAt = new Date().toISOString();
    const stored = await this.versionStore.saveVersion({
      tenantId: context.tenantId,
      userId: context.userId,
      applicationId,
      jobId: jobIdOf(opportunity),
      kind: "EDITED",
      coverLetter: body,
      subjectLine,
      sourceEvidence,
      requirement: analysis.requirement || null,
      reason: "Edited by the student.",
      validation: { result: "EDITED" },
      generatedAt,
    });
    return {
      record: {
        jobId: stored.jobId,
        version: stored.version,
        generatedAt,
        coverLetter: body,
        subject_line: subjectLine,
        body,
        sourceEvidence,
        requirement: analysis.requirement || null,
        skipped: false,
        generated: true,
        edited: true,
        reason: "Edited by the student.",
      },
      version: stored,
    };
  }

  async listVersions(context, query) {
    requireContext(context);
    return this.versionStore.listVersions(context, query);
  }
}
