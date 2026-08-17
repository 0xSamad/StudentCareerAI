/**
 * saas-container.mjs — Production SaaS Dependency Injection Container
 *
 * Unites all core service tiers of StudentCareer AI into an enterprise-ready,
 * fully testable, observable, privacy-compliant, and pluggable service architecture.
 */

import { AuthService } from "./auth/auth-service.mjs";
import { TenantContext } from "./auth/tenant-context.mjs";
import { AccessGuard, UnauthorizedError, ForbiddenError } from "./auth/access-guard.mjs";
import { Sanitizer } from "./auth/sanitizer.mjs";
import { PasswordHasher } from "./auth/password-hasher.mjs";
import {
  TenantStudentProfileRepository,
  TenantOpportunityRepository,
  TenantApplicationRepository,
  TenantAuditLogRepository,
} from "./database/tenant-repository.mjs";
import {
  PgStudentProfileRepository,
  PgOpportunityRepository,
  PgApplicationRepository,
} from "./database/pg-domain-repositories.mjs";
import { PostgresClient } from "./database/postgres-client.mjs";
import { MemoryOpportunityStore, PgOpportunityStore } from "./opportunity-store/index.mjs";
import {
  MemoryDiscoveryStateStore,
  PgDiscoveryStateStore,
  MemorySourceCache,
  PgSourceCache,
  loadRefreshPolicy,
} from "./discovery-engine/index.mjs";
import { PgUserStore } from "./database/pg-user-store.mjs";
import { FileUserStore } from "./database/file-user-store.mjs";
import { LocalStorageService } from "./storage/local-storage.mjs";
import { JobDiscoveryService } from "./discovery/discovery-service.mjs";
import { AIWorkerService } from "./ai/ai-worker-service.mjs";
import { ApplicationWorkerService } from "./application/application-worker-service.mjs";
import { BrowserWorkerPool } from "./browser/browser-worker-pool.mjs";
import { NotificationService } from "./notifications/notification-service.mjs";
import { SchedulerService } from "./scheduler/scheduler-service.mjs";
import { JobQueue } from "./queue/job-queue.mjs";
import { WorkerPool } from "./queue/worker-pool.mjs";
import { registerDefaultJobHandlers } from "./queue/job-handlers.mjs";
import { JobType, JobStatus, JobPriority } from "./queue/job-types.mjs";
import {
  StructuredLogger,
  MetricsTracker,
  WorkerHeartbeatMonitor,
  AlertManager,
  AutoRecoveryEngine,
} from "./observability/index.mjs";
import { DataPrivacyService } from "./privacy/index.mjs";
import { CandidateKnowledgeService, MemoryKnowledgeStore, PgKnowledgeStore } from "./knowledge/index.mjs";
import { ApplicationOrchestrator } from "./application-orchestrator.mjs";
import { MemoryIntelligenceStore, PgIntelligenceStore } from "./knowledge/intelligence-store.mjs";
import { CandidateIntelligenceService } from "./knowledge/candidate-intelligence-service.mjs";
import { CandidateContextBuilder } from "./knowledge/candidate-context-builder.mjs";
import { CvDecisionEngine, MemoryCvVersionStore, PgCvVersionStore } from "./cv/index.mjs";
import {
  CoverLetterDecisionEngine,
  MemoryCoverLetterVersionStore,
  PgCoverLetterVersionStore,
} from "./cover-letter/index.mjs";

export {
  AccessGuard,
  UnauthorizedError,
  ForbiddenError,
  Sanitizer,
  PasswordHasher,
  TenantContext,
  JobType,
  JobStatus,
  JobPriority,
  JobQueue,
  WorkerPool,
  StructuredLogger,
  MetricsTracker,
  WorkerHeartbeatMonitor,
  AlertManager,
  AutoRecoveryEngine,
  DataPrivacyService,
};

function resolveUserStore(postgresClient, options) {
  if (options.userStore !== undefined) return options.userStore;
  if (!postgresClient.isMock) return new PgUserStore(postgresClient);
  // Offline fallback only when DATABASE_URL is unset (local CLI tests)
  if (process.env.NODE_ENV === "production") return null;
  if (process.env.AUTH_STORE === "file") return new FileUserStore();
  return null;
}

export class SaaSContainer {
  constructor(options = {}) {
    // 1. Observability & Logging
    this.logger = options.logger || new StructuredLogger();
    this.metricsTracker = options.metricsTracker || new MetricsTracker();
    this.heartbeatMonitor = options.heartbeatMonitor || new WorkerHeartbeatMonitor();
    this.alertManager = options.alertManager || new AlertManager();

    // 2. Database & Repositories
    this.postgresClient =
      options.postgresClient ||
      new PostgresClient({
        connectionString: options.databaseUrl !== undefined ? options.databaseUrl : process.env.DATABASE_URL || null,
      });
    this.userStore = resolveUserStore(this.postgresClient, options);

    const usePgRepos = !this.postgresClient.isMock && !options.profileRepository;
    this.profileRepository =
      options.profileRepository ||
      (usePgRepos ? new PgStudentProfileRepository(this.postgresClient) : new TenantStudentProfileRepository());
    this.opportunityRepository =
      options.opportunityRepository ||
      (usePgRepos ? new PgOpportunityRepository(this.postgresClient) : new TenantOpportunityRepository());
    this.applicationRepository =
      options.applicationRepository ||
      (usePgRepos ? new PgApplicationRepository(this.postgresClient) : new TenantApplicationRepository());
    // Global Opportunity Store — canonical, deduplicated persistence for every
    // discovered listing (docs/OPPORTUNITY_STORAGE.md). Shared across users.
    this.opportunityStore =
      options.opportunityStore ||
      (!this.postgresClient.isMock
        ? new PgOpportunityStore(this.postgresClient)
        : new MemoryOpportunityStore());
    // Per-source incremental discovery state (docs/INCREMENTAL_DISCOVERY.md):
    // lastSuccessfulFetchAt, cursors, published-at anchors, rate-limit resets.
    this.discoveryStateStore =
      options.discoveryStateStore ||
      (!this.postgresClient.isMock
        ? new PgDiscoveryStateStore(this.postgresClient)
        : new MemoryDiscoveryStateStore());
    this.sourceCache =
      options.sourceCache ||
      (!this.postgresClient.isMock ? new PgSourceCache(this.postgresClient) : new MemorySourceCache());
    this.discoveryRefreshPolicy = options.discoveryRefreshPolicy || loadRefreshPolicy(options.repoRoot);
    this.auditLogRepository = options.auditLogRepository || new TenantAuditLogRepository();

    // Per-user settings & agent state (in-process; PG-backed later)
    this.settingsStore = options.settingsStore || new Map();
    this.agentStateStore = options.agentStateStore || new Map();
    this.notificationStore = options.notificationStore || new Map();

    // 3. Authentication & Tenancy
    this.authService =
      options.authService ||
      new AuthService({
        userRepository: this.profileRepository,
        userStore: this.userStore,
      });

    // 4. Storage
    this.storageService = options.storageService || new LocalStorageService({ baseDir: options.storageDir || "data/storage" });

    // 4b. Candidate Knowledge Base (documents → chunks → grounded facts)
    this.knowledgeStore =
      options.knowledgeStore ||
      (usePgRepos ? new PgKnowledgeStore(this.postgresClient) : new MemoryKnowledgeStore());
    this.candidateKnowledgeService =
      options.candidateKnowledgeService ||
      new CandidateKnowledgeService({
        store: this.knowledgeStore,
        profileRepository: this.profileRepository,
        storageService: this.storageService,
      });

    this.cvVersionStore =
      options.cvVersionStore ||
      (usePgRepos ? new PgCvVersionStore(this.postgresClient) : new MemoryCvVersionStore());
    this.cvDecisionEngine =
      options.cvDecisionEngine ||
      new CvDecisionEngine({
        versionStore: this.cvVersionStore,
        candidateKnowledgeService: this.candidateKnowledgeService,
        storageService: this.storageService,
      });

    this.coverLetterVersionStore =
      options.coverLetterVersionStore ||
      (usePgRepos ? new PgCoverLetterVersionStore(this.postgresClient) : new MemoryCoverLetterVersionStore());
    this.coverLetterDecisionEngine =
      options.coverLetterDecisionEngine ||
      new CoverLetterDecisionEngine({
        versionStore: this.coverLetterVersionStore,
        candidateKnowledgeService: this.candidateKnowledgeService,
      });

    this.intelligenceStore =
      options.intelligenceStore ||
      (usePgRepos ? new PgIntelligenceStore(this.postgresClient) : new MemoryIntelligenceStore());
    this.candidateIntelligenceService =
      options.candidateIntelligenceService ||
      new CandidateIntelligenceService({
        store: this.intelligenceStore,
        knowledgeService: this.candidateKnowledgeService,
        profileRepository: this.profileRepository,
        applicationRepository: this.applicationRepository,
        cvVersionStore: this.cvVersionStore,
        coverLetterVersionStore: this.coverLetterVersionStore,
        logger: this.logger,
      });
    this.candidateContextBuilder =
      options.candidateContextBuilder ||
      new CandidateContextBuilder({
        knowledgeService: this.candidateKnowledgeService,
        intelligenceService: this.candidateIntelligenceService,
      });
    if (typeof this.candidateKnowledgeService.setIntelligence === "function") {
      this.candidateKnowledgeService.setIntelligence({
        intelligenceService: this.candidateIntelligenceService,
        contextBuilder: this.candidateContextBuilder,
      });
    }

    this.createOrchestrator = (opts = {}) =>
      new ApplicationOrchestrator({
        container: this,
        ...opts,
      });

    // 5. Job Discovery
    this.discoveryService = options.discoveryService || new JobDiscoveryService({
      opportunityRepository: this.opportunityRepository,
      // Opt-in only: never inject demo jobs into production discovery.
      includeDemoSources: options.includeDemoSources === true || process.env.ALLOW_DEMO_JOB_SOURCES === "true",
    });

    // 6. AI Workers
    this.aiWorkerService = options.aiWorkerService || new AIWorkerService();

    // 7. Application Workers
    this.applicationWorkerService =
      options.applicationWorkerService ||
      new ApplicationWorkerService({
        profileRepository: this.profileRepository,
        applicationRepository: this.applicationRepository,
        storageService: this.storageService,
        aiWorkerService: this.aiWorkerService,
        auditLogRepository: this.auditLogRepository,
        candidateKnowledgeService: this.candidateKnowledgeService,
        cvDecisionEngine: this.cvDecisionEngine,
        coverLetterDecisionEngine: this.coverLetterDecisionEngine,
      });

    // 8. Browser Worker Pool
    this.browserWorkerPool = options.browserWorkerPool || new BrowserWorkerPool({ maxWorkers: options.maxBrowserWorkers || 5 });

    // 9. Notifications
    this.notificationService = options.notificationService || new NotificationService();

    // 10. Job Queue & Worker Pool Subsystem
    this.jobQueue = options.jobQueue || new JobQueue();
    this.workerPool = options.workerPool || new WorkerPool({ queue: this.jobQueue, maxConcurrency: options.maxConcurrency || 5 });
    registerDefaultJobHandlers(this.workerPool, this);

    // 11. Scheduler
    this.schedulerService = options.schedulerService || new SchedulerService({ jobQueue: this.jobQueue });

    // 12. Auto-Recovery Engine
    this.autoRecoveryEngine =
      options.autoRecoveryEngine ||
      new AutoRecoveryEngine({
        heartbeatMonitor: this.heartbeatMonitor,
        jobQueue: this.jobQueue,
        browserContextManager: this.browserWorkerPool.contextManager,
        logger: this.logger,
      });

    // 13. Data Privacy & GDPR/CCPA Service
    this.dataPrivacyService =
      options.dataPrivacyService ||
      new DataPrivacyService({
        profileRepository: this.profileRepository,
        applicationRepository: this.applicationRepository,
        auditLogRepository: this.auditLogRepository,
        authService: this.authService,
        storageService: this.storageService,
        candidateKnowledgeService: this.candidateKnowledgeService,
        candidateIntelligenceService: this.candidateIntelligenceService,
        logger: this.logger,
      });
  }

  /**
   * Helper to execute a full autonomous cycle within a tenant context.
   */
  async runTenantAutonomousCycle(context) {
    const startTime = Date.now();
    return TenantContext.run(context, async () => {
      const { tenantId, userId } = context;

      // 1. Discover opportunities
      const discovered = await this.discoveryService.discoverAll({}, context);
      this.metricsTracker.recordOpportunityDiscovered("ats_sweep", discovered.length);

      // 2. Process each discovered opportunity
      const results = [];
      for (const opp of discovered) {
        const processResult = await this.applicationWorkerService.processOpportunity(opp, context);

        if (processResult.status === "APPLICATION_READY") {
          // 3. Acquire browser worker for dry-run validation
          const worker = await this.browserWorkerPool.acquireWorker(context);
          try {
            const browserResult = await worker.executeApplication(
              {
                opportunity: opp,
                answers: processResult.artifacts?.application_answers || [],
                autoSubmit: false, // SAFE DRY-RUN
              },
              context
            );

            // 4. Notify student
            await this.notificationService.notify(
              {
                subject: `Application Prepared for ${opp.company}`,
                body: `Tailored package created for ${opp.title}. Score: ${processResult.matchScore}%`,
                metadata: { opportunityId: opp.id, status: browserResult.status },
              },
              context
            );

            this.metricsTracker.recordApplicationOutcome({ success: true });
            results.push({ opportunity: opp, processResult, browserResult });
          } catch (err) {
            this.metricsTracker.recordBrowserFailure();
            this.metricsTracker.recordApplicationOutcome({ success: false });
            throw err;
          } finally {
            await this.browserWorkerPool.releaseWorker(worker);
          }
        } else {
          results.push({ opportunity: opp, processResult });
        }
      }

      this.metricsTracker.recordAgentRun({ success: true, durationMs: Date.now() - startTime });

      // Return updated metrics
      const metrics = await this.applicationRepository.getMetrics(userId, tenantId);
      return { totalProcessed: discovered.length, results, metrics };
    });
  }
}

// Global default container instance for shared runtime
let defaultContainer = null;

export function getSaaSContainer(options) {
  if (!defaultContainer || options) {
    defaultContainer = new SaaSContainer(options);
  }
  return defaultContainer;
}

/** Reset singleton (e.g. after env change in dev). */
export function resetSaaSContainer() {
  defaultContainer = null;
}
