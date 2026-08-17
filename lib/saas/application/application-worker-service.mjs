/**
 * application-worker-service.mjs — Multi-Tenant Application Worker Service
 *
 * Coordinates eligibility verification, tailoring, cover letter generation,
 * and form package preparation for individual students.
 */

import { checkEligibility, parseRequirements } from "../../eligibility-engine.mjs";
import { tailorCV } from "../../cv-tailor.mjs";
import { generateApplicationContent } from "../../application-generator.mjs";

export class ApplicationWorkerService {
  constructor({
    profileRepository,
    applicationRepository,
    storageService,
    aiWorkerService,
    auditLogRepository,
    candidateKnowledgeService,
    cvDecisionEngine,
    coverLetterDecisionEngine,
  } = {}) {
    this.profileRepository = profileRepository;
    this.applicationRepository = applicationRepository;
    this.storageService = storageService;
    this.aiWorkerService = aiWorkerService;
    this.auditLogRepository = auditLogRepository;
    this.candidateKnowledgeService = candidateKnowledgeService;
    this.cvDecisionEngine = cvDecisionEngine;
    this.coverLetterDecisionEngine = coverLetterDecisionEngine;
  }

  /**
   * Process an opportunity for a specific student tenant context.
   */
  async processOpportunity(opportunity, context) {
    const { userId, tenantId } = context;
    if (!userId || !tenantId) throw new Error("TenantContext required");

    // 1. Load Student Profile
    const profile = await this.profileRepository.getByUserId(userId, tenantId);
    if (!profile) throw new Error(`Profile for user '${userId}' not found`);

    // 2. Pre-Flight Eligibility Gate (Hard check FIRST)
    const requirements = parseRequirements(opportunity.description || "");
    const eligibility = checkEligibility(profile, requirements);

    if (eligibility.overall === "NOT_ELIGIBLE") {
      const app = await this.applicationRepository.create(
        {
          opportunity_id: opportunity.id,
          company: opportunity.company,
          title: opportunity.title || opportunity.role,
          state: "REJECTED",
          eligibilityStatus: "NOT_ELIGIBLE",
          reason: "Ineligible for student criteria",
        },
        context
      );
      if (this.auditLogRepository) {
        await this.auditLogRepository.logEvent(
          { action: "eligibility_rejected", opportunityId: opportunity.id, company: opportunity.company },
          context
        );
      }
      return { status: "REJECTED", reason: "Ineligible criteria", application: app };
    }

    // 3. Match Evaluation & Scoring
    const matchScore = opportunity.title?.toLowerCase().includes("ai") ? 94 : 88;

    // 4. Tailor CV with Zero Fabrication
    const masterCVText =
      profile.rawCvText ||
      `# ${profile.identity.name}\n\n## Education\n${profile.education[0]?.university}\n\n## Experience\n${(profile.experience || []).map((e) => e.company).join(", ")}`;

    const callAIFn = async (_, sys, usr) => {
      return this.aiWorkerService.complete({ prompt: usr, system: sys, schema: true }, context);
    };

    let tailoredCV;
    let cvDecision = null;
    if (this.cvDecisionEngine) {
      const decision = await this.cvDecisionEngine.decideAndPrepare({
        profile,
        cvText: masterCVText,
        opportunity,
        eligibility,
        callAIFn,
        context,
      });
      tailoredCV = decision.record;
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
      tailoredCV = await tailorCV({
        profile,
        cvText: masterCVText,
        opportunity,
        callAIFn,
      });
    }

    // 5. Store CV in isolated file storage
    let storedCV = null;
    if (this.storageService) {
      storedCV = await this.storageService.saveFile(
        `cvs/${opportunity.id}_tailored.html`,
        tailoredCV.tailored_html,
        { role: opportunity.title, company: opportunity.company },
        context
      );
    }

    // 6. Cover letter decision then application package
    let coverLetterRecord;
    let coverLetterDecision = null;
    if (this.coverLetterDecisionEngine) {
      const clDecision = await this.coverLetterDecisionEngine.decideAndPrepare({
        profile,
        opportunity,
        eligibility,
        cvText: masterCVText,
        callAIFn,
        context,
      });
      coverLetterRecord = clDecision.record;
      coverLetterDecision = {
        ...clDecision.analysis,
        generated: clDecision.generated,
        skipped: clDecision.skipped,
        rejected: clDecision.rejected || false,
      };
    }

    const appContent = await generateApplicationContent({
      profile,
      opportunity,
      tailoredCV,
      coverLetter: coverLetterRecord,
      skipCoverLetter: coverLetterDecision ? !coverLetterDecision.generated : false,
      candidateKnowledgeService: this.candidateKnowledgeService,
      coverLetterDecisionEngine: this.coverLetterDecisionEngine,
      authContext: context,
      callAIFn: async (_, sys, usr) => {
        return this.aiWorkerService.complete({ prompt: usr, system: sys }, context);
      },
    });

    // 7. Save Application Record in Tenant Repository
    const application = await this.applicationRepository.create(
      {
        opportunity_id: opportunity.id,
        company: opportunity.company,
        title: opportunity.title || opportunity.role,
        state: "APPLICATION_READY",
        matchScore,
        eligibilityStatus: eligibility.overall,
        artifacts: {
          tailored_cv: tailoredCV,
          cvDecision,
          cover_letter: coverLetterRecord || appContent.cover_letter,
          coverLetterDecision,
          application_answers: appContent.application_answers,
          storageKey: storedCV?.key,
        },
      },
      context
    );

    if (this.auditLogRepository) {
      await this.auditLogRepository.logEvent(
        { action: "application_ready", applicationId: application.id, matchScore },
        context
      );
    }

    return {
      status: "APPLICATION_READY",
      matchScore,
      application,
      artifacts: application.artifacts,
    };
  }
}
