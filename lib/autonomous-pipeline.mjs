// lib/autonomous-pipeline.mjs — Autonomous Application Background Engine for CareerOS
// Manages the continuous 9-stage workflow with non-negotiable safety rules, state management, and audit logging.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { ApplicationManager, QUEUE_STATES } from './application-manager.mjs';
import { classifyOpportunity } from './classify-opportunity.mjs';
import { checkEligibility, parseRequirements } from './eligibility-engine.mjs';
import { scoreOpportunity as evaluateMatch } from './match-engine.mjs';
import { tailorCV } from './cv-tailor.mjs';
import { generateApplicationContent } from './application-generator.mjs';
import { runApplicationAgent, detectSecurityObstacles, SESSION_STATUS } from './application-agent.mjs';
import { withPipelineLock } from '../pipeline-lock.mjs';
import { normalizeOpportunity } from './source-adapters.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// ── Agent States Enum ─────────────────────────────────────────────────────────

export const AGENT_STATES = {
  RUNNING: 'RUNNING',
  PAUSED:  'PAUSED',
  STOPPED: 'STOPPED',
  ERROR:   'ERROR',
};

// ── Safe Defaults ─────────────────────────────────────────────────────────────

export const DEFAULT_CONFIG = {
  AUTONOMOUS_MODE: false,
  AUTO_SUBMIT: false,
  SKIP_BROWSER: false,
  MAX_APPLICATIONS_PER_DAY: 10,
  MIN_MATCH_SCORE: 70,
  REQUIRE_ELIGIBILITY: true,
  REQUIRE_CONFIDENT_ANSWERS: true,
  PAUSE_ON_ERROR: true,
  PAUSE_ON_CAPTCHA: true,
  PAUSE_ON_AUTH_FAILURE: true,
  PAUSE_ON_UNEXPECTED_FORM: true,
  PAUSE_ON_SENSITIVE_QUESTION: true,
};

const APPLY_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Open a real Playwright page for the apply engine (DRY_RUN and live).
 * Launch failure is non-fatal: the caller continues without a page.
 */
async function launchApplyPage(url) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ userAgent: APPLY_USER_AGENT });
    const applyPage = await context.newPage();
    await applyPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await applyPage.waitForTimeout(1500);
    return { browser, applyPage };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

export class AutonomousPipelineError extends Error {
  constructor(message, code = 'PIPELINE_ERROR') {
    super(message);
    this.name = 'AutonomousPipelineError';
    this.code = code;
  }
}

export function evaluateEligibility(opportunity, profile) {
  if (opportunity.eligibility_status) {
    return {
      verdict: opportunity.eligibility_status,
      reasons: opportunity.eligibility_status === 'NOT_ELIGIBLE' ? ['Work authorization or profile mismatch'] : [],
    };
  }
  const reqs = parseRequirements(opportunity.description || '');
  const report = checkEligibility(profile, reqs);
  return {
    verdict: report.overall,
    reasons: report.blocking_failures?.length > 0 ? report.blocking_failures : (report.unknowns || []),
    report,
  };
}

// ── Audit Log Engine ──────────────────────────────────────────────────────────

export class AutonomousAuditLog {
  constructor(logPath) {
    this.logPath = logPath;
    mkdirSync(dirname(logPath), { recursive: true });
    if (!existsSync(logPath)) {
      writeFileSync(logPath, JSON.stringify([], null, 2));
    }
  }

  async logEvent(type, payload = {}) {
    return withPipelineLock(this.logPath, async () => {
      let logs = [];
      try {
        const parsed = JSON.parse(readFileSync(this.logPath, 'utf-8'));
        logs = Array.isArray(parsed) ? parsed : [];
      } catch {
        logs = [];
      }

      const entry = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        ...payload,
        type,
      };

      logs.push(entry);
      writeFileSync(this.logPath, JSON.stringify(logs, null, 2));
      return entry;
    });
  }

  async getLogs(limit = 100) {
    return withPipelineLock(this.logPath, async () => {
      try {
        const logs = JSON.parse(readFileSync(this.logPath, 'utf-8'));
        return logs.slice(-limit);
      } catch {
        return [];
      }
    });
  }

  async clearLogs() {
    return withPipelineLock(this.logPath, async () => {
      writeFileSync(this.logPath, JSON.stringify([], null, 2));
      return [];
    });
  }
}

// ── Autonomous Pipeline Class ─────────────────────────────────────────────────

export class AutonomousPipeline {
  constructor(options = {}) {
    this.repoRoot = options.repoRoot || REPO_ROOT;
    this.dataDir = options.dataDir || join(this.repoRoot, 'data');
    this.statePath = options.statePath || join(this.dataDir, 'autonomous-state.json');
    this.auditPath = options.auditPath || join(this.dataDir, 'autonomous-audit.json');
    this.pipelineMdPath = options.pipelineMdPath || join(this.dataDir, 'pipeline.md');
    this.applicationsMdPath = options.applicationsMdPath || join(this.dataDir, 'applications.md');

    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.manager = options.manager || new ApplicationManager({
      dataDir: this.dataDir,
      internship_applications_per_day: this.config.MAX_APPLICATIONS_PER_DAY,
      job_applications_per_day: this.config.MAX_APPLICATIONS_PER_DAY,
      timezone: options.timezone || 'Asia/Karachi',
    });

    this.auditLog = new AutonomousAuditLog(this.auditPath);
    this.state = AGENT_STATES.STOPPED;
    this.pauseReason = null;
    this.currentJob = null;
    this.lastRunAt = null;

    this.candidateKnowledgeService = options.candidateKnowledgeService || null;
    this.cvDecisionEngine = options.cvDecisionEngine || null;
    this.coverLetterDecisionEngine = options.coverLetterDecisionEngine || null;
    this.authContext = options.authContext || null;

    mkdirSync(this.dataDir, { recursive: true });
    this.loadState();
  }

  // ── State Persistence ───────────────────────────────────────────────────────

  loadState() {
    if (existsSync(this.statePath)) {
      try {
        const raw = readFileSync(this.statePath, 'utf-8');
        const saved = JSON.parse(raw);
        this.state = saved.state || AGENT_STATES.STOPPED;
        this.pauseReason = saved.pauseReason || null;
        this.currentJob = saved.currentJob || null;
        this.lastRunAt = saved.lastRunAt || null;
        if (saved.config) {
          this.config = { ...DEFAULT_CONFIG, ...saved.config };
        }
      } catch {
        this.state = AGENT_STATES.STOPPED;
      }
    }
  }

  saveState() {
    const payload = {
      state: this.state,
      pauseReason: this.pauseReason,
      currentJob: this.currentJob,
      lastRunAt: this.lastRunAt,
      config: this.config,
      updated_at: new Date().toISOString(),
    };
    writeFileSync(this.statePath, JSON.stringify(payload, null, 2));
  }

  // ── CLI & Controls ──────────────────────────────────────────────────────────

  configure(newConfig = {}) {
    this.config = { ...this.config, ...newConfig };
    if (typeof this.config.MAX_APPLICATIONS_PER_DAY === 'number') {
      this.manager.limits = {
        internship: this.config.MAX_APPLICATIONS_PER_DAY,
        job: this.config.MAX_APPLICATIONS_PER_DAY,
      };
    }
    this.saveState();
    this.auditLog.logEvent('CONFIG_UPDATED', { config: this.config });
    return this.config;
  }

  async start() {
    if (!this.config.AUTONOMOUS_MODE) {
      throw new AutonomousPipelineError('Cannot start: AUTONOMOUS_MODE is disabled in configuration', 'MODE_DISABLED');
    }

    this.state = AGENT_STATES.RUNNING;
    this.pauseReason = null;
    this.lastRunAt = new Date().toISOString();
    this.saveState();
    await this.auditLog.logEvent('PIPELINE_STARTED', { config: this.config });
    return this.getStatus();
  }

  async pause(reason = 'User requested pause') {
    this.state = AGENT_STATES.PAUSED;
    this.pauseReason = reason;
    this.saveState();
    await this.auditLog.logEvent('PIPELINE_PAUSED', { reason });
    return this.getStatus();
  }

  async resume() {
    if (!this.config.AUTONOMOUS_MODE) {
      throw new AutonomousPipelineError('Cannot resume: AUTONOMOUS_MODE is disabled in configuration', 'MODE_DISABLED');
    }

    this.state = AGENT_STATES.RUNNING;
    this.pauseReason = null;
    this.saveState();
    await this.auditLog.logEvent('PIPELINE_RESUMED');
    return this.getStatus();
  }

  async stop() {
    this.state = AGENT_STATES.STOPPED;
    this.pauseReason = null;
    this.currentJob = null;
    this.saveState();
    await this.auditLog.logEvent('PIPELINE_STOPPED');
    return this.getStatus();
  }

  async restart() {
    this.pauseReason = null;
    this.currentJob = null;
    if (this.config.AUTONOMOUS_MODE) {
      this.state = AGENT_STATES.RUNNING;
      await this.auditLog.logEvent('PIPELINE_RESTARTED', { state: AGENT_STATES.RUNNING });
    } else {
      this.state = AGENT_STATES.STOPPED;
      await this.auditLog.logEvent('PIPELINE_RESTARTED', { state: AGENT_STATES.STOPPED });
    }
    this.saveState();
    return this.getStatus();
  }

  async getStatus() {
    const dailyStats = await this.manager.getStats();
    const queue = await this.manager.readQueue();
    const queueCounts = {
      total: queue.length,
      discovered: queue.filter(q => q.state === QUEUE_STATES.DISCOVERED).length,
      eligible: queue.filter(q => q.state === QUEUE_STATES.ELIGIBLE).length,
      prepared: queue.filter(q =>
        q.state === QUEUE_STATES.DRY_RUN ||
        q.state === QUEUE_STATES.PREPARED ||
        q.state === QUEUE_STATES.APPLICATION_READY
      ).length,
      // Real submissions only (legacy APPLIED counted only when not dry-run)
      applied: queue.filter(q =>
        (q.state === QUEUE_STATES.SUBMITTED || q.state === QUEUE_STATES.APPLIED) &&
        q.dry_run !== true
      ).length,
      dry_run: queue.filter(q => q.state === QUEUE_STATES.DRY_RUN || q.dry_run === true).length,
      requires_input: queue.filter(q => q.state === QUEUE_STATES.REQUIRES_USER_INPUT).length,
      failed: queue.filter(q => q.state === QUEUE_STATES.FAILED || q.state === QUEUE_STATES.BLOCKED).length,
    };

    return {
      state: this.state,
      pauseReason: this.pauseReason,
      config: this.config,
      currentJob: this.currentJob,
      lastRunAt: this.lastRunAt,
      dailyStats,
      queueCounts,
    };
  }

  // ── Discovery Engine ────────────────────────────────────────────────────────

  async discoverOpportunities() {
    const discovered = [];

    // 1. Read from data/pipeline.md if present
    if (existsSync(this.pipelineMdPath)) {
      try {
        const mdContent = readFileSync(this.pipelineMdPath, 'utf-8');
        const lines = mdContent.split('\n');
        for (const line of lines) {
          const m = line.match(/^\s*-\s*\[([ xX])\]\s*(.+)$/);
          if (!m || m[1].toLowerCase() === 'x') continue; // skip completed

          const parts = m[2].split('|').map(s => s.trim());
          if (parts.length >= 3 && parts[0]) {
            const rawOpp = {
              url: parts[0],
              company: parts[1],
              title: parts[2],
              location: parts[3] || '',
              source: 'pipeline.md',
            };
            const normalized = normalizeOpportunity(rawOpp, 'pipeline.md');
            discovered.push(normalized);
          }
        }
      } catch (err) {
        // Tolerant read
      }
    }

    // Add discovered items to queue
    const results = [];
    for (const opp of discovered) {
      const res = await this.manager.addToQueue(opp);
      results.push(res);
      if (res.added) {
        await this.auditLog.logEvent('OPPORTUNITY_DISCOVERED', {
          company: opp.company,
          title: opp.title,
          url: opp.url,
        });
      }
    }

    return { total: discovered.length, results };
  }

  // ── Core Autonomous Execution Cycle ────────────────────────────────────────

  async processOpportunity({
    rawOpportunity,
    profile,
    cvText = '',
    callAIFn = null,
    page = null,
    pdfPath = null,
    liveSubmit = false,
    allowWhenStopped = false,
    onQueueState = null,
  }) {
    const shouldSubmit = Boolean(liveSubmit || this.config.AUTO_SUBMIT);
    if (!liveSubmit && this.state !== AGENT_STATES.RUNNING && !allowWhenStopped) {
      return { processed: false, reason: `Pipeline is in ${this.state} state` };
    }
    const emitQueue = async (state, extra = {}) => {
      if (typeof onQueueState === 'function') {
        await onQueueState(state, extra);
      }
    };

    this.currentJob = rawOpportunity.title ? `${rawOpportunity.company} - ${rawOpportunity.title}` : rawOpportunity.url;
    this.saveState();

    try {
      // 1. DISCOVER / DEDUPLICATE
      let queueItem;
      if (rawOpportunity.id && rawOpportunity.state) {
        queueItem = rawOpportunity;
      } else {
        const addRes = await this.manager.addToQueue(rawOpportunity);
        if (addRes.duplicate) {
          if (addRes.item && [QUEUE_STATES.APPLIED, QUEUE_STATES.APPLYING].includes(addRes.item.state)) {
            await this.auditLog.logEvent('DUPLICATE_SKIPPED', { opportunity: rawOpportunity });
            this.currentJob = null;
            this.saveState();
            return { processed: false, reason: 'Duplicate application detected' };
          }
          queueItem = addRes.item || rawOpportunity;
        } else {
          queueItem = addRes.item;
        }
      }

      // 2. CLASSIFY
      const classified = {
        ...rawOpportunity,
        ...classifyOpportunity(rawOpportunity),
      };
      if (rawOpportunity.eligibility_status) {
        classified.eligibility_status = rawOpportunity.eligibility_status;
      }
      await this.manager.updateState(queueItem.id, QUEUE_STATES.ELIGIBILITY_CHECK);
      await emitQueue('ANALYZING');

      // 3. CHECK ELIGIBILITY
      const eligibility = evaluateEligibility(classified, profile);
      if (this.config.REQUIRE_ELIGIBILITY && eligibility.verdict === 'NOT_ELIGIBLE') {
        await this.manager.updateState(
          queueItem.id,
          QUEUE_STATES.NOT_ELIGIBLE,
          { eligibility_status: 'NOT_ELIGIBLE' },
          `Ineligible: ${eligibility.reasons.join('; ')}`
        );
        await this.auditLog.logEvent('INELIGIBLE_SKIPPED', {
          item_id: queueItem.id,
          reasons: eligibility.reasons,
        });
        this.currentJob = null;
        this.saveState();
        return { processed: false, reason: 'Ineligible opportunity' };
      }

      await this.manager.updateState(
        queueItem.id,
        QUEUE_STATES.ELIGIBLE,
        { eligibility_status: eligibility.verdict }
      );

      // 4. SCORE & MATCH
      let matchResult = null;
      try {
        matchResult = await evaluateMatch({ profile, opportunity: classified, eligibility, callAIFn });
      } catch (matchErr) {
        await this.manager.updateState(
          queueItem.id,
          QUEUE_STATES.REQUIRES_USER_INPUT,
          {
            match_error: matchErr.message,
            eligibility_status: eligibility?.verdict || null,
          }
        );
        await this.auditLog.logEvent('MATCH_FAILED', {
          item_id: queueItem.id,
          error: matchErr.message,
        });
        if (this.config.PAUSE_ON_ERROR) {
          await this.pause(`Match scoring failed: ${matchErr.message}`);
        }
        this.currentJob = null;
        this.saveState();
        return {
          processed: false,
          ok: false,
          status: QUEUE_STATES.REQUIRES_USER_INPUT,
          reason: `Match scoring failed: ${matchErr.message}`,
          dry_run: true,
          submitted: false,
          submitted_at: null,
        };
      }

      await this.manager.updateState(
        queueItem.id,
        QUEUE_STATES.MATCHED,
        { match_score: matchResult.match_score }
      );

      if (matchResult.match_score < this.config.MIN_MATCH_SCORE) {
        await this.auditLog.logEvent('MATCH_SCORE_TOO_LOW', {
          item_id: queueItem.id,
          score: matchResult.match_score,
          min_required: this.config.MIN_MATCH_SCORE,
        });
        this.currentJob = null;
        this.saveState();
        return { processed: false, reason: `Match score ${matchResult.match_score} below minimum ${this.config.MIN_MATCH_SCORE}` };
      }

      // 5. RANK & SELECT (Slot Reservation & Daily Limit Guard)
      if (queueItem.state !== QUEUE_STATES.SELECTED) {
        const slot = await this.manager.reserveSlot(classified.opportunity_type || queueItem.type);
        if (!slot.allowed) {
          await this.auditLog.logEvent('DAILY_LIMIT_REACHED', {
            type: slot.type,
            limit: slot.limit,
          });
          this.currentJob = null;
          this.saveState();
          return { processed: false, reason: slot.reason };
        }
        await this.manager.updateState(queueItem.id, QUEUE_STATES.SELECTED);
      }

      // 6. CV DECISION ENGINE (reuse master when already appropriate)
      await emitQueue('CV_PREPARATION');
      let tailoredRecord = null;
      let cvDecision = null;
      try {
        if (this.cvDecisionEngine && this.authContext) {
          const decision = await this.cvDecisionEngine.decideAndPrepare({
            profile,
            cvText,
            opportunity: classified,
            eligibility,
            matchResult,
            callAIFn,
            applicationId: queueItem.id,
            context: this.authContext,
          });
          cvDecision = {
            ...decision.analysis,
            reusedMaster: decision.reusedMaster,
            regenerated: decision.regenerated,
            rejectedTailor: decision.rejectedTailor || false,
            changesMade: decision.changesMade,
            reasonForChanges: decision.reasonForChanges,
            originalCv: decision.originalCv,
            tailoredCv: decision.tailoredCv,
          };
          tailoredRecord = decision.record;
        } else {
          tailoredRecord = await tailorCV({
            profile,
            cvText,
            opportunity: classified,
            eligibility,
            matchResult,
            callAIFn,
          });
        }
      } catch (tailorErr) {
        if (tailorErr.name === 'FabricationError') {
          await this.manager.updateState(queueItem.id, QUEUE_STATES.FAILED, {}, `Fabrication error: ${tailorErr.message}`);
          await this.auditLog.logEvent('FABRICATION_REJECTED', { violations: tailorErr.violations });
          this.currentJob = null;
          this.saveState();
          return { processed: false, reason: 'CV Tailoring rejected due to fabrication' };
        }
        throw tailorErr;
      }

      await this.manager.updateState(queueItem.id, QUEUE_STATES.CV_GENERATED, {
        artifacts: { tailored_cv: tailoredRecord, cvDecision },
      });

      // 7. COVER LETTER DECISION (skip when not required and no benefit)
      await emitQueue('COVER_LETTER_PREPARATION');
      let coverLetterRecord = undefined;
      let coverLetterDecision = null;
      if (this.coverLetterDecisionEngine && this.authContext) {
        const clDecision = await this.coverLetterDecisionEngine.decideAndPrepare({
          profile,
          opportunity: classified,
          matchResult,
          eligibility,
          cvText,
          callAIFn,
          applicationId: queueItem.id,
          context: this.authContext,
        });
        coverLetterRecord = clDecision.record;
        coverLetterDecision = {
          ...clDecision.analysis,
          generated: clDecision.generated,
          skipped: clDecision.skipped,
          rejected: clDecision.rejected || false,
        };
      }

      // 8. GENERATE APPLICATION CONTENT & CHECK SENSITIVE QUESTIONS
      await emitQueue('APPLICATION_PREPARATION');
      const appRecord = await generateApplicationContent({
        profile,
        cvText,
        opportunity: classified,
        tailoredCV: tailoredRecord,
        matchResult,
        questions: rawOpportunity.questions || classified.questions || [],
        callAIFn,
        candidateKnowledgeService: this.candidateKnowledgeService,
        cvDecisionEngine: this.cvDecisionEngine,
        coverLetterDecisionEngine: this.coverLetterDecisionEngine,
        coverLetter: coverLetterRecord,
        skipCoverLetter: coverLetterDecision ? !coverLetterDecision.generated : false,
        authContext: this.authContext,
      });

      if (!appRecord.tailored_cv && tailoredRecord) {
        appRecord.tailored_cv = tailoredRecord;
      }
      if (cvDecision) appRecord.cv_decision = cvDecision;
      if (coverLetterRecord !== undefined) appRecord.cover_letter = coverLetterRecord;
      if (coverLetterDecision) appRecord.cover_letter_decision = coverLetterDecision;

      // Safety Rule: Sensitive Question Guard
      const sensitivePending = appRecord.pending_questions?.filter(q => q.sensitive) || [];
      if (sensitivePending.length > 0 && this.config.PAUSE_ON_SENSITIVE_QUESTION) {
        await this.manager.updateState(queueItem.id, QUEUE_STATES.REQUIRES_USER_INPUT, {
          artifacts: { applicationRecord: appRecord, tailored_cv: tailoredRecord, cvDecision, cover_letter: coverLetterRecord, coverLetterDecision },
        }, 'Sensitive question encountered requiring manual user input');

        await this.pause(`Paused on sensitive question for ${queueItem.company}: ${sensitivePending[0].question}`);
        this.currentJob = null;
        this.saveState();
        return { processed: false, reason: 'Paused on sensitive question requiring user input' };
      }

      // Safety Rule: Require Confident Answers Guard
      if (this.config.REQUIRE_CONFIDENT_ANSWERS && appRecord.requires_user_input) {
        await this.manager.updateState(queueItem.id, QUEUE_STATES.REQUIRES_USER_INPUT, {
          artifacts: { applicationRecord: appRecord, tailored_cv: tailoredRecord, cvDecision, cover_letter: coverLetterRecord, coverLetterDecision },
        });
        await this.auditLog.logEvent('REQUIRES_USER_INPUT_FLAGGED', { item_id: queueItem.id });
        this.currentJob = null;
        this.saveState();
        return { processed: false, reason: 'Low confidence answers require user input' };
      }

      await this.manager.updateState(queueItem.id, QUEUE_STATES.APPLICATION_READY, {
        artifacts: { applicationRecord: appRecord, tailored_cv: tailoredRecord, cvDecision, cover_letter: coverLetterRecord, coverLetterDecision },
      });
      await emitQueue('READY', { artifacts: { applicationRecord: appRecord, tailored_cv: tailoredRecord, cvDecision, cover_letter: coverLetterRecord, coverLetterDecision } });

      // 8. APPLY (Browser Application Agent & Security Guards)
      // Open a real page for DRY_RUN and live so form extraction is not simulated.
      await this.manager.updateState(queueItem.id, QUEUE_STATES.APPLYING);
      await emitQueue('APPLYING');
      const isDryRun = !shouldSubmit;
      const skipBrowser =
        this.config.SKIP_BROWSER === true || process.env.CAREER_OPS_SKIP_BROWSER === '1';

      let ownedBrowser = null;
      let applyPage = page;
      if (!applyPage && classified.url && !skipBrowser) {
        try {
          const launched = await launchApplyPage(classified.url);
          ownedBrowser = launched.browser;
          applyPage = launched.applyPage;
        } catch (err) {
          ownedBrowser = null;
          applyPage = page;
          await this.auditLog.logEvent('BROWSER_LAUNCH_FAILED', {
            item_id: queueItem.id,
            error: err.message,
          });
        }
      }

      let pageContent = '';
      if (applyPage) {
        try { pageContent = await applyPage.content(); } catch { pageContent = ''; }
      }

      const secCheck = detectSecurityObstacles(pageContent);
      if (secCheck.hasSecurityObstacle) {
        const pauseCaptcha = secCheck.obstacles.includes('CAPTCHA') && this.config.PAUSE_ON_CAPTCHA;
        const pauseAuth =
          (secCheck.obstacles.includes('MFA') || secCheck.obstacles.includes('Authentication Barrier')) &&
          this.config.PAUSE_ON_AUTH_FAILURE;
        if (pauseCaptcha || pauseAuth) {
          if (ownedBrowser) await ownedBrowser.close().catch(() => {});
          const reason = pauseCaptcha ? 'CAPTCHA detected' : 'Authentication barrier detected';
          await this.manager.updateState(queueItem.id, QUEUE_STATES.FAILED, {}, reason);
          await this.pause(`Paused on ${pauseCaptcha ? 'CAPTCHA challenge' : 'Authentication barrier'} at ${classified.company}`);
          this.currentJob = null;
          this.saveState();
          return { processed: false, reason: pauseCaptcha ? 'Paused on CAPTCHA challenge' : 'Paused on Authentication barrier' };
        }
      }

      let agentSession;
      try {
        agentSession = await runApplicationAgent({
          opportunity: classified,
          applicationRecord: appRecord,
          pdfPath,
          page: applyPage,
          sourceFacts: tailoredRecord.source_facts,
          profile,
          liveSubmit: shouldSubmit,
          candidateKnowledgeService: this.candidateKnowledgeService,
          authContext: this.authContext,
          callAIFn,
        });
      } finally {
        if (ownedBrowser) await ownedBrowser.close().catch(() => {});
      }

      if (agentSession.status === SESSION_STATUS.PAUSED || agentSession.status === SESSION_STATUS.BLOCKED) {
        const pauseKind = agentSession.pause_reason || 'SECURITY';
        const shouldPause =
          (pauseKind === 'CAPTCHA' && this.config.PAUSE_ON_CAPTCHA) ||
          ((pauseKind === 'MFA' || pauseKind === 'Authentication Barrier') && this.config.PAUSE_ON_AUTH_FAILURE) ||
          (pauseKind === 'SENSITIVE_QUESTION' && this.config.PAUSE_ON_SENSITIVE_QUESTION) ||
          this.config.PAUSE_ON_ERROR;
        await this.manager.updateState(
          queueItem.id,
          QUEUE_STATES.REQUIRES_USER_INPUT,
          { artifacts: { agentSession: agentSession.toJSON() } },
          agentSession.status_reason
        );
        if (shouldPause) {
          await this.pause(agentSession.status_reason || `Paused by application agent (${pauseKind})`);
        }
        this.currentJob = null;
        this.saveState();
        return {
          processed: false,
          status: 'PAUSED',
          reason: agentSession.status_reason,
          session: agentSession,
        };
      }

      if (agentSession.status === SESSION_STATUS.REQUIRES_USER_INPUT && this.config.PAUSE_ON_UNEXPECTED_FORM) {
        await this.manager.updateState(queueItem.id, QUEUE_STATES.REQUIRES_USER_INPUT);
        await this.pause(`Paused on unexpected/unmapped form field at ${classified.company}`);
        this.currentJob = null;
        this.saveState();
        return { processed: false, reason: 'Paused on unexpected form field' };
      }

      // 9. TRACK & COMPLETE
      let finalState;
      let submittedAt = null;
      if (agentSession.status === SESSION_STATUS.SUBMITTED) {
        finalState = QUEUE_STATES.SUBMITTED;
        submittedAt = new Date().toISOString();
      } else if (agentSession.status === SESSION_STATUS.READY_TO_SUBMIT) {
        if (isDryRun) {
          finalState = QUEUE_STATES.DRY_RUN;
        } else {
          finalState = QUEUE_STATES.REQUIRES_USER_INPUT;
        }
      } else if (
        agentSession.status === SESSION_STATUS.REQUIRES_USER_INPUT ||
        agentSession.status === SESSION_STATUS.BLOCKED ||
        agentSession.status === SESSION_STATUS.PAUSED
      ) {
        finalState = QUEUE_STATES.REQUIRES_USER_INPUT;
      } else {
        finalState = QUEUE_STATES.FAILED;
      }

      await this.manager.updateState(queueItem.id, finalState, {
        artifacts: { agentSession: agentSession.toJSON() },
        dry_run: isDryRun,
        submitted_at: submittedAt,
      }, agentSession.status_reason);

      await this.auditLog.logEvent('APPLICATION_PROCESSED', {
        item_id: queueItem.id,
        company: classified.company,
        title: classified.title,
        status: finalState,
        dry_run: isDryRun,
        auto_submit: shouldSubmit,
        submitted: Boolean(submittedAt),
        submitted_at: submittedAt,
      });

      this.currentJob = null;
      this.lastRunAt = new Date().toISOString();
      this.saveState();
      return {
        processed: true,
        ok: finalState !== QUEUE_STATES.FAILED,
        item_id: queueItem.id,
        status: finalState,
        dry_run: isDryRun,
        submitted: Boolean(submittedAt),
        submitted_at: submittedAt,
        session: agentSession,
        artifacts: { applicationRecord: appRecord, agentSession: agentSession.toJSON(), tailored_cv: tailoredRecord, cvDecision, cover_letter: coverLetterRecord, coverLetterDecision },
        reason: agentSession.status_reason,
      };

    } catch (err) {
      await this.auditLog.logEvent('ERROR_ENCOUNTERED', { error: err.message, stack: err.stack });
      if (!liveSubmit && this.config.PAUSE_ON_ERROR) {
        this.state = AGENT_STATES.ERROR;
        await this.pause(`Error encountered: ${err.message}`);
      }
      this.currentJob = null;
      this.saveState();
      return { processed: false, error: err.message };
    }
  }

  // ── Continuous Cycle Execution ─────────────────────────────────────────────

  async runCycle({ profile = {}, cvText = '', maxItems = 5, callAIFn = null, page = null, pdfPath = null } = {}) {
    if (this.state !== AGENT_STATES.RUNNING) {
      return { cycleExecuted: false, reason: `Pipeline in ${this.state} state` };
    }

    // Step 1: Discover
    await this.discoverOpportunities();

    // Step 2: Select & Rank next candidates
    const selectedItems = await this.manager.selectNextItems(profile, maxItems);
    const results = [];

    for (const item of selectedItems) {
      if (this.state !== AGENT_STATES.RUNNING) {
        break;
      }
      const res = await this.processOpportunity({
        rawOpportunity: item,
        profile,
        cvText,
        callAIFn,
        page,
        pdfPath,
      });
      results.push(res);
    }

    return {
      cycleExecuted: true,
      itemsProcessed: results.length,
      results,
      status: await this.getStatus(),
    };
  }

  // ── Continuous Background Loop ─────────────────────────────────────────────

  async startContinuousLoop({
    intervalMs = 15000,
    profile = {},
    cvText = '',
    callAIFn = null,
    maxCycles = Infinity,
  } = {}) {
    let cyclesRun = 0;
    while (this.state === AGENT_STATES.RUNNING && cyclesRun < maxCycles) {
      try {
        await this.runCycle({ profile, cvText, maxItems: 5, callAIFn });
      } catch (err) {
        if (this.config.PAUSE_ON_ERROR) {
          this.state = AGENT_STATES.ERROR;
          await this.pause(`Loop error: ${err.message}`);
          break;
        }
      }

      cyclesRun++;
      if (this.state === AGENT_STATES.RUNNING && cyclesRun < maxCycles) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }
  }
}
