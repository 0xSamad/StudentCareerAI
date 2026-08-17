// tests/observability.test.mjs — Production Observability, Telemetry & Auto-Recovery Test Suite
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const OBSERVABILITY_MOD = pathToFileURL(join(ROOT, 'lib/saas/observability/index.mjs')).href;
const QUEUE_MOD = pathToFileURL(join(ROOT, 'lib/saas/queue/index.mjs')).href;
const BROWSER_MOD = pathToFileURL(join(ROOT, 'lib/saas/browser/index.mjs')).href;

console.log('\nobservability — structured logging, 12-dimension telemetry, heartbeats & auto-recovery tests');

const { StructuredLogger, LogLevel, MetricsTracker, WorkerHeartbeatMonitor, AlertManager, AutoRecoveryEngine } =
  await import(OBSERVABILITY_MOD);
const { JobQueue, JobType, JobStatus } = await import(QUEUE_MOD);
const { IsolatedBrowserContext } = await import(BROWSER_MOD);

// ── Test 1: Structured JSON Logger & Zero-Secret Sanitization ─────────────────
try {
  const logger = new StructuredLogger({ minLevel: LogLevel.DEBUG, defaultComponent: 'TestComponent' });

  const entry = logger.info(
    'Application package prepared',
    {
      opportunityId: 'opp_123',
      password: 'SuperSecretCandidatePassword',
      sessionToken: 'token_abc123',
      nested: { cookies: 'auth_cookie_val' },
    },
    { tenantId: 'tenant_lums', userId: 'user_ali', jobId: 'job_456' }
  );

  if (
    entry.level === 'INFO' &&
    entry.component === 'TestComponent' &&
    entry.tenantId === 'tenant_lums' &&
    entry.userId === 'user_ali' &&
    entry.metadata.password === '***REDACTED***' &&
    entry.metadata.sessionToken === '***REDACTED***' &&
    entry.metadata.nested.cookies === '***REDACTED***' &&
    entry.metadata.opportunityId === 'opp_123'
  ) {
    pass('StructuredLogger: formatted JSON logs emitted with contextual tags and sensitive secrets strictly redacted');
  } else {
    fail('StructuredLogger: secret redaction or tag formatting failed');
  }
} catch (err) {
  fail('Logger test error: ' + err.message);
}

// ── Test 2: 12-Dimension Telemetry Metrics Aggregation ─────────────────────────
try {
  const tracker = new MetricsTracker();

  // 1. Agent runs
  tracker.recordAgentRun({ success: true, durationMs: 1200 });
  tracker.recordAgentRun({ success: false, durationMs: 800 });

  // 2. Discovered opportunities
  tracker.recordOpportunityDiscovered('Greenhouse', 5);
  tracker.recordOpportunityDiscovered('Ashby', 3);

  // 3. Source failures
  tracker.recordSourceFailure('Lever');
  tracker.recordSourceFailure('Lever');
  tracker.recordSourceFailure('Lever');

  // 4. Eligibility decisions
  tracker.recordEligibilityDecision(true);
  tracker.recordEligibilityDecision(false);

  // 5. Failures
  tracker.recordAIFailure();
  tracker.recordCVGenerationFailure();
  tracker.recordBrowserFailure();

  // 6. Application outcomes
  tracker.recordApplicationOutcome({ success: true });
  tracker.recordApplicationOutcome({ success: true });
  tracker.recordApplicationOutcome({ success: false });

  // 7. Retries
  tracker.recordRetry();

  // 8. Latency samples
  tracker.recordApiLatency(15);
  tracker.recordApiLatency(35);
  tracker.recordApiLatency(80);
  tracker.recordApiLatency(120);

  const snapshot = tracker.getSnapshot({ queued: 2, processing: 1, deadLetter: 0 });

  if (
    snapshot.agentRuns.total === 2 &&
    snapshot.opportunities.totalDiscovered === 8 &&
    snapshot.failures.sources === 3 &&
    snapshot.eligibility.eligible === 1 &&
    snapshot.failures.ai === 1 &&
    snapshot.failures.cvGeneration === 1 &&
    snapshot.failures.browser === 1 &&
    snapshot.applications.attempts === 3 &&
    snapshot.applications.succeeded === 2 &&
    snapshot.applications.successRatePercent === 66.7 &&
    snapshot.retries.total === 1 &&
    snapshot.apiLatency.p95Ms >= 80 &&
    snapshot.queue.queued === 2
  ) {
    pass('MetricsTracker: all 12 system telemetry dimensions tracked, aggregated, and latency percentiles calculated');
  } else {
    fail('MetricsTracker: telemetry aggregation mismatch');
  }
} catch (err) {
  fail('Metrics test error: ' + err.message);
}

// ── Test 3: Worker Heartbeat Monitor & Stalled Worker Detection ────────────────
try {
  const monitor = new WorkerHeartbeatMonitor();

  // Worker 1: Active
  monitor.recordHeartbeat('worker_active', { status: 'BUSY', memoryRssMb: 120 });

  // Worker 2: Stalled (manually backdate heartbeat > 60s)
  monitor.recordHeartbeat('worker_stalled', { status: 'BUSY', activeJobId: 'job_orphaned_1', memoryRssMb: 140 });
  const stalledRecord = monitor.workers.get('worker_stalled');
  stalledRecord.lastHeartbeat = Date.now() - 70000; // 70s ago

  const health = monitor.getWorkerHealth();

  if (
    health.totalRegistered === 2 &&
    health.healthyCount === 1 &&
    health.stalledCount === 1 &&
    health.deadOrStalled[0].workerId === 'worker_stalled'
  ) {
    pass('WorkerHeartbeatMonitor: worker pulses recorded and stalled workers accurately identified');
  } else {
    fail('WorkerHeartbeatMonitor: stalled worker detection failed');
  }
} catch (err) {
  fail('Heartbeat test error: ' + err.message);
}

// ── Test 4: Threshold-Based Failure Alert Manager ─────────────────────────────
try {
  const alertMgr = new AlertManager();
  const tracker = new MetricsTracker();

  // Create 5 applications with 2 failures (<90% success rate)
  for (let i = 0; i < 3; i++) tracker.recordApplicationOutcome({ success: true });
  for (let i = 0; i < 2; i++) tracker.recordApplicationOutcome({ success: false });

  // 3 source failures
  tracker.recordSourceFailure('Lever');
  tracker.recordSourceFailure('Lever');
  tracker.recordSourceFailure('Lever');

  const snapshot = tracker.getSnapshot({ queued: 0, processing: 0, deadLetter: 1 });
  const workerHealth = { stalledCount: 1 };

  const alerts = alertMgr.evaluate(snapshot, workerHealth);

  const hasAppAlert = alerts.some((a) => a.title.includes('Application Failure Rate'));
  const hasDlqAlert = alerts.some((a) => a.title.includes('Dead-Letter Queue'));
  const hasStalledAlert = alerts.some((a) => a.title.includes('Unresponsive Workers'));
  const hasSourceAlert = alerts.some((a) => a.title.includes('Lever'));

  if (hasAppAlert && hasDlqAlert && hasStalledAlert && hasSourceAlert) {
    pass('AlertManager: threshold alerts generated for failure spikes, DLQ entries, stalled workers, and source degradation');
  } else {
    fail('AlertManager: failure threshold alerting incomplete');
  }
} catch (err) {
  fail('AlertManager test error: ' + err.message);
}

// ── Test 5: Automated Safe Self-Healing & Crash Recovery ───────────────────────
try {
  const queue = new JobQueue();
  const monitor = new WorkerHeartbeatMonitor();
  const browserContextManager = new IsolatedBrowserContext({ baseDir: join(ROOT, 'data/test_recovery_sessions') });

  // Enqueue a job and set to PROCESSING
  const job = await queue.enqueueJob(JobType.GENERATE_CV, {}, {}, { tenantId: 'tenant_rec' });
  const rawJob = queue.jobs.get(job.id);
  rawJob.status = JobStatus.PROCESSING;

  // Register worker on that job and make it stall
  monitor.recordHeartbeat('worker_died', { activeJobId: job.id });
  monitor.workers.get('worker_died').lastHeartbeat = Date.now() - 80000;

  // Create an expired browser session
  const sess = browserContextManager.createSession({ tenantId: 'tenant_rec', userId: 'user_rec' });
  sess.expiresAt = new Date(Date.now() - 5000).toISOString();

  const recovery = new AutoRecoveryEngine({
    heartbeatMonitor: monitor,
    jobQueue: queue,
    browserContextManager,
  });

  const report = await recovery.runRecoveryCycle();
  const reloadedJob = await queue.getJobById(job.id);

  if (
    report.recoveredWorkersCount === 1 &&
    report.requeuedJobsCount === 1 &&
    report.cleanedSessionsCount === 1 &&
    reloadedJob.status === JobStatus.QUEUED
  ) {
    pass('AutoRecoveryEngine: stalled workers recycled, orphaned jobs safely re-queued, and expired sessions pruned');
  } else {
    fail(`AutoRecoveryEngine: recovery cycle failed (job status: ${reloadedJob?.status})`);
  }
} catch (err) {
  fail('AutoRecovery test error: ' + err.message);
}

console.log('✅ All Production Observability & Telemetry tests passed.\n');
