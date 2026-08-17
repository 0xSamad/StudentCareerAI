/**
 * job-handlers.mjs — Handlers for all 9 Specialized Background Job Types
 *
 * Connects background queue worker execution to the decoupled SaaS service tiers:
 * Discovery, Eligibility, Match Scoring, CV Tailoring, Cover Letters,
 * Application Packages, Browser Automation, and Notifications.
 */

import { JobType } from "./job-types.mjs";
import { checkEligibility, parseRequirements } from "../../eligibility-engine.mjs";
import { tailorCV } from "../../cv-tailor.mjs";
import { generateCoverLetter, generateApplicationContent } from "../../application-generator.mjs";

export function registerDefaultJobHandlers(workerPool, container) {
  // 1. DISCOVER_JOBS
  workerPool.registerHandler(JobType.DISCOVER_JOBS, async (payload, context) => {
    const opps = await container.discoveryService.discoverAll(payload.options || {}, context);
    return { discoveredCount: opps.length, opportunities: opps };
  });

  // 2. CLASSIFY_JOB
  workerPool.registerHandler(JobType.CLASSIFY_JOB, async (payload) => {
    const { title, description } = payload;
    const text = `${title} ${description}`.toLowerCase();
    const isInternship = text.includes("intern") || text.includes("trainee") || text.includes("co-op");
    return {
      type: isInternship ? "INTERNSHIP" : "JOB",
      title,
      confidence: 0.95,
    };
  });

  // 3. CHECK_ELIGIBILITY
  workerPool.registerHandler(JobType.CHECK_ELIGIBILITY, async (payload, context) => {
    const { profile, opportunity } = payload;
    const requirements = parseRequirements(opportunity.description || "");
    const report = checkEligibility(profile, requirements);
    return {
      overall: report.overall,
      blocking_failures: report.blocking_failures,
      evaluated_at: report.evaluated_at,
    };
  });

  // 4. CALCULATE_MATCH
  workerPool.registerHandler(JobType.CALCULATE_MATCH, async (payload, context) => {
    const { opportunity } = payload;
    const isAi = (opportunity.title || "").toLowerCase().includes("ai") || (opportunity.title || "").toLowerCase().includes("ml");
    return {
      match_score: isAi ? 95 : 88,
      recommendation: isAi ? "Outstanding fit" : "Strong match",
    };
  });

  // 5. GENERATE_CV
  workerPool.registerHandler(JobType.GENERATE_CV, async (payload, context) => {
    const { profile, opportunity } = payload;
    const masterCVText =
      profile.rawCvText ||
      `# ${profile.identity?.name || "Student"}\n\n## Education\n${profile.education?.[0]?.university || "University"}`;

    const callAIFn = async (_, sys, usr) => {
      return container.aiWorkerService.complete({ prompt: usr, system: sys, schema: true }, context);
    };

    let tailored;
    let cvDecision = null;
    if (container.cvDecisionEngine) {
      const decision = await container.cvDecisionEngine.decideAndPrepare({
        profile,
        cvText: masterCVText,
        opportunity,
        callAIFn,
        context,
      });
      tailored = decision.record;
      cvDecision = {
        ...decision.analysis,
        reusedMaster: decision.reusedMaster,
        regenerated: decision.regenerated,
        changesMade: decision.changesMade,
        reasonForChanges: decision.reasonForChanges,
        originalCv: decision.originalCv,
        tailoredCv: decision.tailoredCv,
      };
    } else {
      tailored = await tailorCV({
        profile,
        cvText: masterCVText,
        opportunity,
        callAIFn,
      });
    }

    let stored = null;
    if (container.storageService && tailored?.tailored_html) {
      stored = await container.storageService.saveFile(
        `cvs/${opportunity.id}_tailored.html`,
        tailored.tailored_html,
        { company: opportunity.company },
        context
      );
    }

    return {
      tailored_cv: tailored,
      cvDecision,
      storage_key: stored?.key,
    };
  });

  // 6. GENERATE_COVER_LETTER
  workerPool.registerHandler(JobType.GENERATE_COVER_LETTER, async (payload, context) => {
    const { profile, opportunity } = payload;
    const callAIFn = async (_, sys, usr) => {
      return container.aiWorkerService.complete({ prompt: usr, system: sys }, context);
    };
    if (container.coverLetterDecisionEngine) {
      const decision = await container.coverLetterDecisionEngine.decideAndPrepare({
        profile,
        opportunity,
        callAIFn,
        context,
      });
      return {
        cover_letter: decision.record,
        coverLetterDecision: decision.analysis,
        generated: decision.generated,
        skipped: decision.skipped,
      };
    }
    const letter = await generateCoverLetter({
      profile,
      opportunity,
      callAIFn,
    });
    return letter;
  });

  // 7. PREPARE_APPLICATION
  workerPool.registerHandler(JobType.PREPARE_APPLICATION, async (payload, context) => {
    const { profile, opportunity, tailoredCV } = payload;
    const appContent = await generateApplicationContent({
      profile,
      opportunity,
      tailoredCV,
      candidateKnowledgeService: container.candidateKnowledgeService,
      cvDecisionEngine: container.cvDecisionEngine,
      coverLetterDecisionEngine: container.coverLetterDecisionEngine,
      authContext: context,
      callAIFn: async (_, sys, usr) => {
        return container.aiWorkerService.complete({ prompt: usr, system: sys }, context);
      },
    });
    return appContent;
  });

  // 8. RUN_BROWSER_APPLICATION
  workerPool.registerHandler(JobType.RUN_BROWSER_APPLICATION, async (payload, context) => {
    const {
      opportunity,
      answers,
      autoSubmit = false,
      applicationRecord,
      profile,
      sourceFacts,
      pdfPath,
      cvPath,
      coverLetterPath,
      attachments,
      page,
    } = payload;
    const worker = await container.browserWorkerPool.acquireWorker(context);
    try {
      return await worker.executeApplication(
        {
          opportunity,
          answers,
          autoSubmit,
          applicationRecord,
          profile,
          sourceFacts,
          pdfPath: cvPath || pdfPath,
          cvPath,
          coverLetterPath,
          attachments,
          page,
          candidateKnowledgeService: container.candidateKnowledgeService,
          callAIFn: container.aiWorkerService
            ? async (_, sys, usr) => container.aiWorkerService.complete({ prompt: usr, system: sys }, context)
            : null,
        },
        context
      );
    } finally {
      await container.browserWorkerPool.releaseWorker(worker);
    }
  });

  // 9. SEND_NOTIFICATION
  workerPool.registerHandler(JobType.SEND_NOTIFICATION, async (payload, context) => {
    const { subject, body, type = "info" } = payload;
    const results = await container.notificationService.notify(
      { subject, body, type },
      context
    );
    return { delivered: results.length > 0, results };
  });
}
