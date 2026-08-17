/**
 * application-orchestrator.mjs — Autonomous apply orchestration.
 *
 * Canonical pipeline (hard gate first, then match, then knowledge):
 *
 *   JOB/INTERNSHIP → Eligibility → (NO: STOP) → Matching Engine
 *     → Candidate Knowledge Retrieval
 *     → CV Intelligence (reuse/tailor) ∥ Cover Letter AI (required/optional)
 *     → Application Agent → ATS → Semantic Form Analysis
 *     → Candidate Data Retrieval → Validation
 *     → SAFE: SUBMIT → Tracker  |  BLOCKED: USER INPUT
 */

import { checkEligibility, parseRequirements, NOT_ELIGIBLE, ELIGIBLE } from "../eligibility-engine.mjs";
import { scoreOpportunity } from "../match-engine.mjs";
import { generateApplicationContent } from "../application-generator.mjs";
import { tailorCV } from "../cv-tailor.mjs";
import { analyzeCvForOpportunity, wrapMasterCvHtml } from "./cv/cv-analysis.mjs";
import { analyzeCoverLetterRequirement } from "./cover-letter/cover-letter-requirement.mjs";
import { overlayIntelligenceOnProfile } from "./knowledge/intelligence-profile.mjs";
import { CONTEXT_PURPOSE } from "./knowledge/candidate-context-builder.mjs";
import { verifyPostingLiveness } from "./opportunity-ingest.mjs";
import { classifyApplicationField, isSensitiveIntent, FIELD_INTENT } from "./application-agent/field-classifier.mjs";
import { enrichFieldsFromAtsAdapter } from "./application-agent/ats-adapters.mjs";
import { resolveFieldFromKnowledge } from "./application-agent/knowledge-resolver.mjs";
import { EVIDENCE_STATUS } from "./knowledge/document-types.mjs";
import {
  runApplicationAgent,
  detectATS,
  SESSION_STATUS,
  canSafelySubmit,
  detectSecurityObstacles,
} from "../application-agent.mjs";
import {
  WORKFLOW_STATUS,
  SKIP_REASON,
  deadlineHasPassed,
  findDuplicateApplication,
  summarizeWorkflowOutcome,
  summarizeBatch,
  readAutoApply,
  heuristicMatch,
  launchApplyPage,
  applyBrowserHeaded,
  revealApplyWindow,
  keepHeadedBrowser,
  makeCallAIFn,
  STEP,
  APPLY_USER_AGENT,
} from "./application-workflow-core.mjs";

export const USER_STAGE = Object.freeze({
  ANALYZING: "Analyzing...",
  PREPARING_CV: "Preparing CV...",
  PREPARING_COVER_LETTER: "Preparing cover letter...",
  OPENING: "Opening application...",
  FILLING: "Filling application...",
  WAITING: "Waiting for verification...",
  SUBMITTED: "Submitted ✓",
  READY: "Ready to Apply",
  PAUSED: "Paused — needs you",
  SKIPPED: "Skipped",
  FAILED: "Failed",
  SELECTED: "Selected",
});

export function userFacingStage(state, { pause_reason, submitted_at } = {}) {
  if (submitted_at) return USER_STAGE.SUBMITTED;
  const s = String(state || "");
  if (s === "ANALYZING") return USER_STAGE.ANALYZING;
  if (s === "CV_PREPARATION") return USER_STAGE.PREPARING_CV;
  if (s === "COVER_LETTER_PREPARATION") return USER_STAGE.PREPARING_COVER_LETTER;
  if (s === "APPLICATION_PREPARATION") return USER_STAGE.OPENING;
  if (s === "APPLYING") return USER_STAGE.FILLING;
  if (s === "REQUIRES_USER_INPUT" || s === "PAUSED") {
    const p = String(pause_reason || "").toUpperCase();
    if (p === "CAPTCHA" || p === "MFA") return USER_STAGE.WAITING;
    return USER_STAGE.PAUSED;
  }
  if (s === "SUBMITTED" || s === "APPLIED") return USER_STAGE.SUBMITTED;
  if (s === "SKIPPED" || s === "NOT_ELIGIBLE") return USER_STAGE.SKIPPED;
  if (s === "FAILED" || s === "ERROR") return USER_STAGE.FAILED;
  if (s === "READY" || s === "APPLICATION_READY" || s === "DRY_RUN") return USER_STAGE.READY;
  if (s === "SELECTED") return USER_STAGE.SELECTED;
  return s.replaceAll("_", " ") || USER_STAGE.SELECTED;
}

export async function retrySafely(fn, { attempts = 2, delayMs = 150, label = "operation" } = {}) {
  let last = null;
  const n = Math.max(1, attempts);
  for (let i = 0; i < n; i += 1) {
    try {
      return await fn(i);
    } catch (err) {
      last = err;
      if (i < n - 1 && delayMs) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  const wrapped = last instanceof Error ? last : new Error(String(last || `${label} failed`));
  wrapped.retriesExhausted = true;
  wrapped.retryLabel = label;
  throw wrapped;
}

export function applyEligibilitySafety({ deterministic, aiHint = null } = {}) {
  const report = deterministic || {};
  const blocking = report.blocking_failures || [];
  if (report.overall === NOT_ELIGIBLE || blocking.length) {
    return {
      verdict: NOT_ELIGIBLE,
      overall: NOT_ELIGIBLE,
      reasons: blocking,
      report,
      overridden: Boolean(aiHint && aiHint !== NOT_ELIGIBLE),
      overrideReason: `Deterministic gate: mandatory requirement failed. AI eligibility ignored.`,
    };
  }
  return {
    verdict: report.overall || ELIGIBLE,
    overall: report.overall || ELIGIBLE,
    reasons: [],
    report,
    overridden: false,
    overrideReason: null,
  };
}

export function applySubmitSafety({ session, liveSubmit = false, aiWantsSubmit = false } = {}) {
  const obstacles = session?.security_obstacles || [];
  const pause = String(session?.pause_reason || "").toUpperCase();
  if (pause === "CAPTCHA" || obstacles.includes("CAPTCHA")) {
    return {
      ok: false,
      status: WORKFLOW_STATUS.REQUIRES_USER_INPUT,
      pause_reason: "CAPTCHA",
      reason: "CAPTCHA present — never bypass. PAUSE.",
      overridden: aiWantsSubmit === true,
    };
  }
  if (pause === "MFA" || obstacles.includes("MFA")) {
    return {
      ok: false,
      status: WORKFLOW_STATUS.REQUIRES_USER_INPUT,
      pause_reason: "MFA",
      reason: "MFA present — never bypass. PAUSE.",
      overridden: aiWantsSubmit === true,
    };
  }
  if (pause === "AUTH" || obstacles.includes("AUTH_WALL")) {
    return {
      ok: false,
      status: WORKFLOW_STATUS.REQUIRES_USER_INPUT,
      pause_reason: "AUTH",
      reason: "Authentication wall — never bypass. PAUSE.",
      overridden: aiWantsSubmit === true,
    };
  }
  const unanswered = session?.unanswered_fields || [];
  if (unanswered.some((u) => u.sensitive || u.field?.required || u.requires_user_input)) {
    return {
      ok: false,
      status: WORKFLOW_STATUS.REQUIRES_USER_INPUT,
      pause_reason: session?.pause_reason || "UNKNOWN_REQUIRED",
      reason: "Required or unknown information — PAUSE. Do not fabricate an answer.",
      overridden: aiWantsSubmit === true,
    };
  }
  const gate = canSafelySubmit(session, { liveSubmit });
  if (!gate.ok) {
    return { ok: false, status: WORKFLOW_STATUS.READY, reason: gate.reason, overridden: aiWantsSubmit === true };
  }
  return { ok: true, status: WORKFLOW_STATUS.SUBMITTED, reason: "Safety checks passed" };
}

export function applyKnowledgeSafety({ claim, evidenceStatus = null, verified = false } = {}) {
  const status = String(evidenceStatus || "").toUpperCase();
  if (verified === true || status === EVIDENCE_STATUS.GROUNDED || status === "GROUNDED") {
    return { status: EVIDENCE_STATUS.GROUNDED, claim, accepted: true };
  }
  return {
    status: EVIDENCE_STATUS.UNKNOWN,
    claim,
    accepted: false,
    reason: `UNKNOWN: no candidate evidence for "${claim || "this claim"}". AI assertion ignored.`,
  };
}

function wrapAi(fn) {
  if (typeof fn !== "function") return null;
  return async (...args) => retrySafely(() => fn(...args), { attempts: 2, delayMs: 120, label: "ai" });
}

export class ApplicationOrchestrator {
  constructor(options = {}) {
    this.options = options;
    this.opportunity = options.opportunity || {};
    this.profile = options.profile || {};
    this.profileForDocs = null;
    this.cvText = options.cvText || "";
    this.container = options.container || null;
    this.authContext = options.authContext || null;
    this.autoApply = options.autoApply === true;
    this.skipBrowser = options.skipBrowser === true;
    this.existingApplications = options.existingApplications || [];
    this.applicationId = options.applicationId || null;
    this.onStep = options.onStep || null;
    this.onQueueState = options.onQueueState || null;
    this.onProgress = options.onProgress || null;
    this.page = options.page || null;
    this.now = options.now || new Date();
    this.verifyLivenessFn =
      options.verifyLivenessFn ||
      (typeof this.opportunity.verifyLivenessFn === "function"
        ? this.opportunity.verifyLivenessFn
        : verifyPostingLiveness);
    this.launchBrowserFn = options.launchBrowserFn || launchApplyPage;
    this.callAIFn = wrapAi(options.callAIFn || makeCallAIFn(this.container, this.authContext));
    this.aiEligibilityHint = options.aiEligibilityHint || null;
    this.aiWantsSubmit = options.aiWantsSubmit === true;
    this.steps = [];
    this.requirements = null;
  }

  async emit(state, extra = {}) {
    if (typeof this.onQueueState === "function") await this.onQueueState(state, extra);
    if (typeof this.onProgress === "function") {
      await this.onProgress(userFacingStage(state, extra), { state, ...extra });
    }
  }

  async log(def, result, detail) {
    const entry = { step: def.n, name: def.name, result, detail: detail || null, at: new Date().toISOString() };
    this.steps.push(entry);
    if (typeof this.onStep === "function") await this.onStep(entry);
    return entry;
  }

  finish(status, extra = {}) {
    const submittedAt = extra.submitted_at || null;
    const honestStatus =
      status === WORKFLOW_STATUS.SUBMITTED && !submittedAt ? WORKFLOW_STATUS.READY : status;
    return {
      ok: honestStatus !== WORKFLOW_STATUS.FAILED,
      processed: honestStatus !== WORKFLOW_STATUS.FAILED,
      status: honestStatus,
      skipReason: extra.skipReason || null,
      pause_reason: extra.pause_reason || null,
      reason: extra.reason || null,
      message: extra.reason || null,
      submitted: honestStatus === WORKFLOW_STATUS.SUBMITTED,
      submitted_at: submittedAt,
      dry_run: !submittedAt,
      steps: this.steps,
      artifacts: extra.artifacts || {},
      eligibility_status: extra.eligibility_status || null,
      match_score: extra.match_score ?? null,
      company: this.opportunity?.company || null,
      title: this.opportunity?.title || this.opportunity?.role || null,
      opportunityId: this.opportunity?.id || null,
      applicationId: this.applicationId,
      stageLabel: userFacingStage(honestStatus, extra),
      outcome: summarizeWorkflowOutcome({
        status: honestStatus,
        reason: extra.reason,
        skipReason: extra.skipReason,
        pause_reason: extra.pause_reason,
      }),
    };
  }

  async processApplication() {
    const opportunity = this.opportunity;
    try {
      const gate = await this.verifyOpportunity();
      if (gate) return gate;

      await this.emit("ANALYZING");
      const eligibility = await this.analyzeEligibility();
      if (eligibility.verdict === NOT_ELIGIBLE) {
        await this.log(
          STEP.ELIGIBILITY,
          "FAIL",
          eligibility.overrideReason || eligibility.reasons.join("; ") || "NOT_ELIGIBLE"
        );
        return this.finish(WORKFLOW_STATUS.SKIPPED, {
          skipReason: SKIP_REASON.NOT_ELIGIBLE,
          reason: `Ineligible: ${eligibility.reasons.join("; ") || "requirements not met"}`,
          eligibility_status: NOT_ELIGIBLE,
        });
      }
      await this.log(STEP.ELIGIBILITY, "PASS", eligibility.verdict);

      // Matching Engine — only after ELIGIBLE. Knowledge does not feed the score.
      const matchResult = await this.analyzeMatch({
        profile: this.profile,
        eligibility,
        knowledgeContext: null,
      });

      const knowledgeContext = await this.buildCandidateContext();
      this.profileForDocs = overlayIntelligenceOnProfile(this.profile, knowledgeContext);

      const docs = await this.prepareDocuments({ eligibility, matchResult, knowledgeContext });
      const artifacts = docs.artifacts;

      await this.emit("READY", { artifacts });
      await this.emit("APPLYING");

      const browser = await this.launchBrowser();
      const applyPage = browser.applyPage;
      await this.log(STEP.DETECT_ATS, "PASS", detectATS(opportunity.url));

      const mockFields = Array.isArray(opportunity.application_fields) ? opportunity.application_fields : [];
      if (!applyPage && mockFields.length === 0) {
        await this.log(STEP.ANALYZE_FORM, "SKIP", "No live form opened — package prepared without browser fill");
        await this.log(STEP.FILL_FIELDS, "SKIP", "Form fill deferred until a live page is available");
        await this.log(STEP.ASK_USER, "SKIP", "No live fields to inspect");
        await this.log(STEP.VALIDATE, "PASS", "Application package validated; live form not filled");
        await this.log(
          STEP.SUBMIT,
          "SKIP",
          this.autoApply ? "Cannot submit without a live form" : "AUTO_APPLY is off — not submitted"
        );
        await this.log(STEP.RECORD, "PASS", "READY (not submitted)");
        return this.recordResult(
          this.finish(WORKFLOW_STATUS.READY, {
            reason: this.autoApply
              ? "Prepared but not submitted — live form was not opened."
              : "Prepared in DRY_RUN. AUTO_APPLY is off — nothing was submitted.",
            artifacts,
            eligibility_status: eligibility.verdict,
            match_score: matchResult.match_score,
          })
        );
      }

      try {
        const form = await this.analyzeForm({ page: applyPage, platform: detectATS(opportunity.url) });
        const filled = await this.fillForm({
          page: applyPage,
          applicationRecord: docs.appRecord,
          sourceFacts: docs.tailoredRecord?.source_facts || null,
          form,
        });
        const validation = await this.validateApplication(filled.session);
        artifacts.agentSession = filled.session?.toJSON ? filled.session.toJSON() : filled.session;

        if (!validation.ok && validation.status === WORKFLOW_STATUS.REQUIRES_USER_INPUT) {
          await this.log(STEP.SUBMIT, "PAUSE", validation.reason);
          await this.log(STEP.RECORD, "PASS", validation.pause_reason || "REQUIRES_USER_INPUT");
          return this.recordResult(
            this.finish(WORKFLOW_STATUS.REQUIRES_USER_INPUT, {
              reason: validation.reason,
              pause_reason: validation.pause_reason,
              artifacts,
              eligibility_status: eligibility.verdict,
              match_score: matchResult.match_score,
            })
          );
        }

        const submitted = await this.submitApplication(filled.session, validation);
        if (submitted.submitted) {
          await this.log(STEP.SUBMIT, "PASS", "Submitted");
          await this.log(STEP.RECORD, "PASS", `SUBMITTED at ${submitted.submitted_at}`);
          return this.recordResult(
            this.finish(WORKFLOW_STATUS.SUBMITTED, {
              reason: submitted.reason,
              submitted_at: submitted.submitted_at,
              artifacts,
              eligibility_status: eligibility.verdict,
              match_score: matchResult.match_score,
            })
          );
        }

        await this.log(STEP.SUBMIT, "SKIP", submitted.reason);
        await this.log(STEP.RECORD, "PASS", "READY (not submitted)");
        return this.recordResult(
          this.finish(WORKFLOW_STATUS.READY, {
            reason: submitted.reason,
            artifacts,
            eligibility_status: eligibility.verdict,
            match_score: matchResult.match_score,
          })
        );
      } finally {
        if (browser.ownedBrowser) {
          const headed = browser.applyPage?.__careerOpsHeaded === true || applyBrowserHeaded();
          if (headed && browser.applyPage) {
            await revealApplyWindow(browser.applyPage);
            keepHeadedBrowser(browser.ownedBrowser);
          } else {
            await browser.ownedBrowser.close().catch(() => {});
          }
        }
      }
    } catch (err) {
      await this.log(STEP.RECORD, "FAIL", err.message);
      return this.recordResult(this.finish(WORKFLOW_STATUS.FAILED, { reason: err.message }));
    }
  }

  async verifyOpportunity() {
    const opportunity = this.opportunity;
    if (!opportunity?.url) {
      await this.log(STEP.VERIFY_EXISTS, "FAIL", "Missing application URL");
      return this.finish(WORKFLOW_STATUS.FAILED, { reason: "Missing application URL" });
    }

    let liveness;
    try {
      liveness = await this.verifyLivenessFn(opportunity.url);
    } catch (err) {
      liveness = { verified: false, status: "uncertain", reason: err.message };
    }
    if (liveness?.status === "expired") {
      await this.log(STEP.VERIFY_EXISTS, "FAIL", liveness.reason || "Posting expired");
      return this.finish(WORKFLOW_STATUS.SKIPPED, {
        skipReason: SKIP_REASON.CLOSED,
        reason: liveness.reason || "Opportunity is no longer live",
      });
    }
    await this.log(
      STEP.VERIFY_EXISTS,
      liveness?.verified ? "PASS" : "CONTINUE",
      liveness?.reason || (liveness?.verified ? "Posting is live" : "Liveness uncertain — continuing")
    );

    const requirements = parseRequirements(opportunity.description || "");
    this.requirements = requirements;
    const deadline = deadlineHasPassed(opportunity, requirements, this.now);
    if (deadline.passed) {
      await this.log(STEP.VERIFY_DEADLINE, "FAIL", `Deadline ${deadline.deadline} has passed`);
      return this.finish(WORKFLOW_STATUS.SKIPPED, {
        skipReason: SKIP_REASON.DEADLINE_PASSED,
        reason: `Application deadline ${deadline.deadline} has passed`,
      });
    }
    await this.log(
      STEP.VERIFY_DEADLINE,
      "PASS",
      deadline.deadline ? `Deadline ${deadline.deadline} is still open` : "No deadline specified"
    );

    const dup = findDuplicateApplication(opportunity, this.existingApplications, this.applicationId);
    if (dup) {
      await this.log(STEP.VERIFY_DUPLICATE, "FAIL", `Already submitted (${dup.id})`);
      return this.finish(WORKFLOW_STATUS.SKIPPED, {
        skipReason: SKIP_REASON.DUPLICATE,
        reason: `Duplicate application already submitted for ${opportunity.company} — ${opportunity.title || opportunity.role}`,
      });
    }
    await this.log(STEP.VERIFY_DUPLICATE, "PASS", "No submitted duplicate found");
    return null;
  }

  async analyzeEligibility(profile = this.profile, requirements = this.requirements) {
    const req = requirements || parseRequirements(this.opportunity.description || "");
    const deterministic = checkEligibility(profile, req);
    return applyEligibilitySafety({ deterministic, aiHint: this.aiEligibilityHint });
  }

  async buildCandidateContext() {
    const { container, authContext, opportunity } = this;
    let knowledgeContext = null;
    if (container?.candidateContextBuilder && authContext) {
      try {
        knowledgeContext = await container.candidateContextBuilder.build(opportunity, authContext, {
          purpose: CONTEXT_PURPOSE.APPLICATION_AGENT,
        });
        await this.log(STEP.CONTEXT, "PASS", `${(knowledgeContext?.evidencePackets || []).length} evidence packet(s)`);
      } catch (err) {
        await this.log(STEP.CONTEXT, "CONTINUE", `Knowledge unavailable: ${err.message}`);
      }
    } else if (container?.candidateKnowledgeService && authContext) {
      try {
        knowledgeContext = await container.candidateKnowledgeService.getCandidateContextForOpportunity(
          opportunity,
          authContext,
          { purpose: CONTEXT_PURPOSE.APPLICATION_AGENT }
        );
        await this.log(STEP.CONTEXT, "PASS", `${(knowledgeContext?.evidencePackets || []).length} evidence packet(s)`);
      } catch (err) {
        await this.log(STEP.CONTEXT, "CONTINUE", `Knowledge unavailable: ${err.message}`);
      }
    } else {
      await this.log(STEP.CONTEXT, "CONTINUE", "No candidate knowledge service — continuing with profile/CV");
    }
    return knowledgeContext;
  }

  async analyzeMatch({ profile, eligibility, knowledgeContext }) {
    const aiFn = this.callAIFn;
    let matchResult;
    if (aiFn) {
      try {
        matchResult = await retrySafely(
          () => scoreOpportunity({ profile, opportunity: this.opportunity, eligibility, callAIFn: aiFn }),
          { attempts: 2, delayMs: 120, label: "match-ai" }
        );
      } catch {
        matchResult = heuristicMatch(profile, this.opportunity, eligibility, knowledgeContext);
      }
    } else {
      matchResult = heuristicMatch(profile, this.opportunity, eligibility, knowledgeContext);
    }
    await this.log(STEP.MATCH, "PASS", `Score ${matchResult.match_score} (${matchResult.tier || "n/a"})`);
    return matchResult;
  }

  async analyzeCV({ eligibility, matchResult, knowledgeContext }) {
    return analyzeCvForOpportunity({
      profile: this.profileForDocs || this.profile,
      cvText: this.cvText,
      opportunity: this.opportunity,
      eligibility,
      matchResult,
      knowledgeContext,
    });
  }

  async prepareCoverLetter({ eligibility, matchResult }) {
    const profile = this.profileForDocs || this.profile;
    const letterNeed = analyzeCoverLetterRequirement({ opportunity: this.opportunity, profile });
    await this.log(STEP.ANALYZE_LETTER, "PASS", `${letterNeed.requirement}: ${letterNeed.reason}`);
    let coverLetterRecord = null;
    let coverLetterDecision = null;
    if (this.container?.coverLetterDecisionEngine && this.authContext) {
      const clDecision = await this.container.coverLetterDecisionEngine.decideAndPrepare({
        profile,
        opportunity: this.opportunity,
        matchResult,
        eligibility,
        cvText: this.cvText,
        callAIFn: this.callAIFn,
        applicationId: this.applicationId,
        context: this.authContext,
      });
      coverLetterRecord = clDecision.record;
      coverLetterDecision = {
        ...clDecision.analysis,
        generated: clDecision.generated,
        skipped: clDecision.skipped,
        rejected: clDecision.rejected || false,
      };
      await this.log(
        STEP.GENERATE_LETTER,
        clDecision.generated ? "PASS" : "SKIP",
        clDecision.skipped ? clDecision.analysis?.reason || "Cover letter not needed" : "Cover letter generated"
      );
    } else if (letterNeed.requirement === "NOT_NEEDED") {
      coverLetterRecord = { skipped: true, requirement: "NOT_NEEDED", body: null };
      await this.log(STEP.GENERATE_LETTER, "SKIP", "Cover letter not needed");
    } else {
      await this.log(STEP.GENERATE_LETTER, "SKIP", "Cover letter engine unavailable — not invented");
      coverLetterRecord = { skipped: true, requirement: letterNeed.requirement, body: null };
    }
    return { letterNeed, coverLetterRecord, coverLetterDecision };
  }

  async prepareCV({ eligibility, matchResult, knowledgeContext }) {
    const profile = this.profileForDocs || this.profile;
    const cvAnalysis = await this.analyzeCV({ eligibility, matchResult, knowledgeContext });
    await this.log(STEP.ANALYZE_CV, "PASS", cvAnalysis.cvSuitable ? "Master CV already suitable" : "Tailoring may help");

    let tailoredRecord = null;
    let cvDecision = null;
    if (this.container?.cvDecisionEngine && this.authContext) {
      const decision = await this.container.cvDecisionEngine.decideAndPrepare({
        profile,
        cvText: this.cvText,
        opportunity: this.opportunity,
        eligibility,
        matchResult,
        callAIFn: this.callAIFn,
        applicationId: this.applicationId,
        context: this.authContext,
      });
      tailoredRecord = decision.record;
      cvDecision = {
        ...decision.analysis,
        reusedMaster: decision.reusedMaster,
        regenerated: decision.regenerated,
        rejectedTailor: decision.rejectedTailor || false,
        changesMade: decision.changesMade,
        reasonForChanges: decision.reasonForChanges,
      };
      if (decision.reusedMaster) {
        await this.log(STEP.REUSE_CV, "PASS", decision.reasonForChanges || "Reused master CV");
        await this.log(STEP.TAILOR_CV, "SKIP", "Tailoring not beneficial");
      } else {
        await this.log(STEP.REUSE_CV, "SKIP", "Master CV not sufficient");
        await this.log(STEP.TAILOR_CV, "PASS", decision.reasonForChanges || "Tailored CV generated");
      }
    } else if (cvAnalysis.shouldRegenerate && this.callAIFn) {
      await this.log(STEP.REUSE_CV, "SKIP", "Master CV not sufficient");
      try {
        tailoredRecord = await retrySafely(
          () =>
            tailorCV({
              profile,
              cvText: this.cvText,
              opportunity: this.opportunity,
              eligibility,
              matchResult,
              callAIFn: this.callAIFn,
            }),
          { attempts: 2, delayMs: 120, label: "cv-ai" }
        );
        await this.log(STEP.TAILOR_CV, "PASS", "Tailored CV generated");
      } catch (err) {
        tailoredRecord = { tailored_html: wrapMasterCvHtml(this.cvText, profile), reused_master: true };
        await this.log(STEP.TAILOR_CV, "CONTINUE", `Tailor AI failed — reused master: ${err.message}`);
      }
    } else {
      tailoredRecord = {
        tailored_html: wrapMasterCvHtml(this.cvText, profile),
        reused_master: true,
        source_facts: null,
      };
      await this.log(STEP.REUSE_CV, "PASS", "Reused master CV");
      await this.log(STEP.TAILOR_CV, "SKIP", "Tailoring not beneficial or AI unavailable");
    }
    return { cvAnalysis, tailoredRecord, cvDecision };
  }

  async prepareDocuments({ eligibility, matchResult, knowledgeContext }) {
    await this.emit("CV_PREPARATION");
    await this.emit("COVER_LETTER_PREPARATION");
    const [cvPack, cover] = await Promise.all([
      this.prepareCV({ eligibility, matchResult, knowledgeContext }),
      this.prepareCoverLetter({ eligibility, matchResult }),
    ]);
    const { cvAnalysis, tailoredRecord, cvDecision } = cvPack;
    await this.emit("APPLICATION_PREPARATION");

    const profile = this.profileForDocs || this.profile;
    let appRecord = null;
    if (this.callAIFn) {
      try {
        appRecord = await retrySafely(
          () =>
            generateApplicationContent({
              profile,
              cvText: this.cvText,
              opportunity: this.opportunity,
              tailoredCV: tailoredRecord,
              matchResult,
              eligibility,
              questions: this.opportunity.questions || [],
              callAIFn: this.callAIFn,
              candidateKnowledgeService: this.container?.candidateKnowledgeService,
              cvDecisionEngine: this.container?.cvDecisionEngine,
              coverLetterDecisionEngine: this.container?.coverLetterDecisionEngine,
              coverLetter: cover.coverLetterRecord,
              skipCoverLetter: cover.coverLetterDecision
                ? !cover.coverLetterDecision.generated
                : Boolean(cover.coverLetterRecord?.skipped),
              authContext: this.authContext,
            }),
          { attempts: 2, delayMs: 120, label: "answers-ai" }
        );
      } catch (err) {
        await this.log(STEP.GENERATE_LETTER, "CONTINUE", `Application answers unavailable: ${err.message}`);
      }
    }
    if (!appRecord) {
      appRecord = {
        tailored_cv: tailoredRecord,
        cover_letter: cover.coverLetterRecord,
        cover_letter_decision: cover.coverLetterDecision,
        application_answers: [],
        pending_questions: [],
        requires_user_input: false,
      };
    }
    if (!appRecord.tailored_cv && tailoredRecord) appRecord.tailored_cv = tailoredRecord;
    if (cvDecision) appRecord.cv_decision = cvDecision;
    if (cover.coverLetterRecord) appRecord.cover_letter = cover.coverLetterRecord;
    if (cover.coverLetterDecision) appRecord.cover_letter_decision = cover.coverLetterDecision;

    return {
      cvAnalysis,
      tailoredRecord,
      cvDecision,
      ...cover,
      appRecord,
      artifacts: {
        applicationRecord: appRecord,
        tailored_cv: tailoredRecord,
        cvDecision,
        cover_letter: cover.coverLetterRecord,
        coverLetterDecision: cover.coverLetterDecision,
        knowledgeContext: knowledgeContext
          ? { packetCount: (knowledgeContext.evidencePackets || []).length }
          : null,
      },
    };
  }

  async launchBrowser() {
    const shouldSkip = this.skipBrowser === true || process.env.CAREER_OPS_SKIP_BROWSER === "1";
    let ownedBrowser = null;
    let applyPage = this.page;
    if (!applyPage && this.opportunity.url && !shouldSkip) {
      try {
        const launched = await retrySafely(() => this.launchBrowserFn(this.opportunity.url), {
          attempts: 2,
          delayMs: 200,
          label: "browser",
        });
        ownedBrowser = launched.browser;
        applyPage = launched.applyPage;
        await this.log(STEP.OPEN_URL, "PASS", this.opportunity.url);
      } catch (err) {
        await this.log(STEP.OPEN_URL, "CONTINUE", `Could not open page after retry: ${err.message}`);
      }
    } else if (applyPage) {
      await this.log(STEP.OPEN_URL, "PASS", "Using provided page");
    } else {
      await this.log(STEP.OPEN_URL, "SKIP", "Browser skipped — package prepared without live form fill");
    }
    return { ownedBrowser, applyPage };
  }

  async analyzeForm({ page = null, platform = "generic" } = {}) {
    const fields = Array.isArray(this.opportunity.application_fields) ? this.opportunity.application_fields : [];
    let classified = fields.map((f) => {
      const c = classifyApplicationField(f);
      return { ...f, ...c, questionText: c.questionText || f.label || f.name };
    });
    if (page) {
      classified = await enrichFieldsFromAtsAdapter(this.opportunity.url, classified, platform);
    }
    await this.log(STEP.ANALYZE_FORM, "PASS", `Semantic form analysis: ${classified.length} field(s)${page ? " (live page)" : ""}`);
    return { fields: classified, platform, page };
  }

  async fillForm({ page, applicationRecord, sourceFacts, form }) {
    if (page) {
      const agentSession = await runApplicationAgent({
        opportunity: this.opportunity,
        applicationRecord,
        page,
        sourceFacts,
        profile: this.profileForDocs || this.profile,
        liveSubmit: this.autoApply === true,
        candidateKnowledgeService: this.container?.candidateKnowledgeService,
        authContext: this.authContext,
        callAIFn: this.callAIFn,
      });
      await this.log(
        STEP.FILL_FIELDS,
        "PASS",
        `Candidate data retrieval: ${(agentSession.fill_log || []).filter((f) => /fill/i.test(f.action)).length} fill action(s)`
      );
      const unanswered = agentSession.unanswered_fields || [];
      if (unanswered.length) {
        await this.log(STEP.ASK_USER, "PAUSE", unanswered.map((u) => u.field?.label || u.intent || u.category).join("; "));
      } else {
        await this.log(STEP.ASK_USER, "PASS", "No critical missing information");
      }
      return { session: agentSession };
    }

    const mappings = [];
    for (const field of form?.fields || []) {
      const classification = classifyApplicationField(field);
      const sensitive = classification.isSensitive || isSensitiveIntent(classification.intent);
      if (sensitive) {
        mappings.push({
          field,
          classification,
          requires_user_input: true,
          sensitive: true,
          evidenceStatus: "UNKNOWN",
          rationale: "Sensitive — UNKNOWN, never guessed.",
        });
        continue;
      }
      const resolved = await resolveFieldFromKnowledge({
        field,
        classification,
        profile: this.profileForDocs || this.profile,
        applicationRecord,
        sourceFacts,
        opportunity: this.opportunity,
        candidateKnowledgeService: this.container?.candidateKnowledgeService,
        authContext: this.authContext,
      });
      const knowledge = applyKnowledgeSafety({ claim: resolved.answer, evidenceStatus: resolved.evidenceStatus });
      const required = field.required === true;
      const fileHandled =
        Boolean(resolved.fileIntent) ||
        classification.intent === FIELD_INTENT.CV_UPLOAD ||
        classification.intent === FIELD_INTENT.COVER_LETTER_UPLOAD ||
        classification.intent === FIELD_INTENT.FILE_UPLOAD;
      const mustPause = !fileHandled && required && (resolved.requires_user_input || !knowledge.accepted);
      mappings.push({ ...resolved, field, classification, requires_user_input: mustPause, sensitive: false });
    }
    await this.log(STEP.FILL_FIELDS, "PASS", `Candidate data retrieval: ${mappings.filter((m) => m.answer).length} mapped without a live page`);
    const unanswered = mappings.filter((m) => m.requires_user_input);
    if (unanswered.length) await this.log(STEP.ASK_USER, "PAUSE", unanswered.map((u) => u.field?.label).join("; "));
    else await this.log(STEP.ASK_USER, "PASS", "No critical missing information");
    return {
      session: {
        status: unanswered.length ? SESSION_STATUS.REQUIRES_USER_INPUT : SESSION_STATUS.READY_TO_SUBMIT,
        dry_run: true,
        unanswered_fields: unanswered,
        fields: mappings,
        fill_log: mappings.filter((m) => m.answer).map((m) => ({ action: "would fill", field: m.field?.label })),
        pause_reason: unanswered.some((u) => u.classification?.isSensitive)
          ? "SENSITIVE"
          : unanswered.length
            ? "UNKNOWN_REQUIRED"
            : null,
        security_obstacles: [],
      },
    };
  }

  async validateApplication(session) {
    if (this.page?.content) {
      const html = await this.page.content();
      const detected = detectSecurityObstacles(html);
      const obstacles = Array.isArray(detected?.obstacles) ? detected.obstacles : [];
      session.security_obstacles = [...new Set([...(session.security_obstacles || []), ...obstacles])];
      if (obstacles.includes("CAPTCHA") && !session.pause_reason) session.pause_reason = "CAPTCHA";
      if (obstacles.includes("MFA") && !session.pause_reason) session.pause_reason = "MFA";
      if (obstacles.includes("Authentication Barrier") && !session.pause_reason) session.pause_reason = "AUTH";
    }
    const safety = applySubmitSafety({
      session,
      liveSubmit: this.autoApply === true,
      aiWantsSubmit: this.aiWantsSubmit,
    });
    await this.log(STEP.VALIDATE, safety.ok ? "PASS" : "BLOCK", safety.reason);
    return safety;
  }

  async submitApplication(session, validation) {
    if (validation.status === WORKFLOW_STATUS.REQUIRES_USER_INPUT) {
      return { submitted: false, reason: validation.reason, pause_reason: validation.pause_reason };
    }
    if (session?.status === SESSION_STATUS.SUBMITTED && session.dry_run !== true && validation.ok && this.autoApply) {
      return { submitted: true, submitted_at: new Date().toISOString(), reason: session.status_reason };
    }
    return {
      submitted: false,
      reason: this.autoApply
        ? validation.reason || session?.status_reason || "Submit blocked by safety checks"
        : "Prepared in DRY_RUN. AUTO_APPLY is off — nothing was submitted.",
    };
  }

  recordResult(result) {
    return result;
  }

  async processBatch(items = []) {
    const results = [];
    for (const item of items) {
      const opportunity = item.opportunity || item;
      let result;
      try {
        const orch = new ApplicationOrchestrator({
          ...this.options,
          opportunity,
          skipBrowser: item.skipBrowser ?? this.skipBrowser,
          existingApplications: this.existingApplications.length ? this.existingApplications : items,
          applicationId: item.applicationId || item.id || null,
          onQueueState: item.onQueueState || this.onQueueState,
          page: item.page || null,
          now: item.now || this.now,
          verifyLivenessFn: item.verifyLivenessFn || this.verifyLivenessFn,
          launchBrowserFn: item.launchBrowserFn || this.launchBrowserFn,
          aiEligibilityHint: item.aiEligibilityHint,
          aiWantsSubmit: item.aiWantsSubmit,
          callAIFn: item.callAIFn || this.options.callAIFn,
        });
        result = await orch.processApplication();
      } catch (err) {
        result = {
          ok: false,
          processed: false,
          status: WORKFLOW_STATUS.FAILED,
          reason: err.message,
          submitted: false,
          submitted_at: null,
          dry_run: true,
          steps: [],
          company: opportunity?.company,
          title: opportunity?.title || opportunity?.role,
          opportunityId: opportunity?.id,
          applicationId: item.applicationId || item.id || null,
          outcome: `failed — ${err.message}`,
        };
      }
      results.push(result);
    }
    const summary = summarizeBatch(results);
    return {
      processed: results.length,
      results,
      submitted: results.some((r) => r.status === WORKFLOW_STATUS.SUBMITTED),
      submittedCount: summary.submitted,
      message: summary.headline,
      summary,
    };
  }
}

export async function runApplicationWorkflow(opts = {}) {
  return new ApplicationOrchestrator(opts).processApplication();
}

export async function runApplicationBatch(opts = {}) {
  return new ApplicationOrchestrator(opts).processBatch(opts.items || []);
}

export {
  WORKFLOW_STATUS,
  SKIP_REASON,
  deadlineHasPassed,
  findDuplicateApplication,
  summarizeWorkflowOutcome,
  summarizeBatch,
  readAutoApply,
  STEP,
  APPLY_USER_AGENT,
};
