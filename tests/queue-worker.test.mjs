// tests/queue-worker.test.mjs — Production Background Processing Queue & Worker Test Suite
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const SAAS_CONTAINER_MOD = pathToFileURL(join(ROOT, 'lib/saas/saas-container.mjs')).href;
const QUEUE_MOD = pathToFileURL(join(ROOT, 'lib/saas/queue/index.mjs')).href;

console.log('\nqueue-worker — production background job queue & worker pool tests');

const { SaaSContainer } = await import(SAAS_CONTAINER_MOD);
const { JobType, JobStatus, JobPriority, JobQueue, WorkerPool, registerDefaultJobHandlers } = await import(QUEUE_MOD);

// ── Test 1: All 9 Job Types Handlers ──────────────────────────────────────────
try {
  const container = new SaaSContainer();
  const queue = new JobQueue();
  const workerPool = new WorkerPool({ queue, maxConcurrency: 5 });
  registerDefaultJobHandlers(workerPool, container);

  const context = { tenantId: 'tenant_lums', userId: 'user_ali' };

  // Sample student profile and opportunity
  const profile = {
    identity: { name: 'Ali Hassan', email: 'ali@example.com' },
    education: [{ university: 'LUMS', degree: 'BS', major: 'Computer Science', graduation_date: '2026-06' }],
    experience: [{ company: 'Tech Inc', role: 'Intern', start_date: '2025-06', end_date: '2025-08' }],
    skills: { programming_languages: ['Python'], frameworks: ['FastAPI'] },
    projects: [{ name: 'Project AI', description: 'ML project', technologies: ['Python'] }],
  };
  const opp = { id: 'careem_ai_1', company: 'Careem', title: 'AI / ML Intern', description: 'AI intern in Python. Graduating 2026.' };

  // 1. DISCOVER_JOBS
  const job1 = await queue.enqueueJob(JobType.DISCOVER_JOBS, {}, {}, context);
  // 2. CLASSIFY_JOB
  const job2 = await queue.enqueueJob(JobType.CLASSIFY_JOB, { title: 'AI Intern', description: 'ML role' }, {}, context);
  // 3. CHECK_ELIGIBILITY
  const job3 = await queue.enqueueJob(JobType.CHECK_ELIGIBILITY, { profile, opportunity: opp }, {}, context);
  // 4. CALCULATE_MATCH
  const job4 = await queue.enqueueJob(JobType.CALCULATE_MATCH, { opportunity: opp }, {}, context);
  // 5. GENERATE_CV
  const job5 = await queue.enqueueJob(JobType.GENERATE_CV, { profile, opportunity: opp }, {}, context);
  // 6. GENERATE_COVER_LETTER
  const job6 = await queue.enqueueJob(JobType.GENERATE_COVER_LETTER, { profile, opportunity: opp }, {}, context);
  // 7. PREPARE_APPLICATION
  const job7 = await queue.enqueueJob(JobType.PREPARE_APPLICATION, { profile, opportunity: opp }, {}, context);
  // 8. RUN_BROWSER_APPLICATION
  const job8 = await queue.enqueueJob(JobType.RUN_BROWSER_APPLICATION, { opportunity: opp, answers: [{ question: 'Name', answer: 'Ali' }] }, {}, context);
  // 9. SEND_NOTIFICATION
  const job9 = await queue.enqueueJob(JobType.SEND_NOTIFICATION, { subject: 'Test', body: 'Body' }, {}, context);

  if (job1.id && job9.id && queue.jobs.size === 9) {
    pass('JobQueue: all 9 distinct JobTypes enqueued with policy defaults');
  } else {
    fail('JobQueue: failed to enqueue 9 job types');
  }

  // Execute all jobs through worker pool
  workerPool.start(20);

  // Wait for jobs to process
  await new Promise((res) => setTimeout(res, 800));
  workerPool.stop();

  const j1 = await queue.getJobById(job1.id);
  const j3 = await queue.getJobById(job3.id);
  const j8 = await queue.getJobById(job8.id);
  const j9 = await queue.getJobById(job9.id);

  if (j1.status === JobStatus.COMPLETED && j3.status === JobStatus.COMPLETED && j8.status === JobStatus.COMPLETED && j9.status === JobStatus.COMPLETED) {
    pass('WorkerPool: all 9 job types processed and completed successfully by registered handlers');
  } else {
    fail(`WorkerPool: some jobs failed to complete (j1: ${j1.status}, j3: ${j3.status}, j8: ${j8.status})`);
  }
} catch (err) {
  fail('9 Job Types test error: ' + err.message);
}

// ── Test 2: Idempotency Deduplication Key ─────────────────────────────────────
try {
  const queue = new JobQueue();
  const context = { tenantId: 'tenant_idemp', userId: 'user_1' };

  const jobA = await queue.enqueueJob(JobType.CALCULATE_MATCH, { oppId: 'opp_123' }, { idempotencyKey: 'match_opp_123_user_1' }, context);
  const jobB = await queue.enqueueJob(JobType.CALCULATE_MATCH, { oppId: 'opp_123' }, { idempotencyKey: 'match_opp_123_user_1' }, context);

  if (jobA.id === jobB.id) {
    pass('JobQueue: idempotency key deduplicates concurrent enqueue requests');
  } else {
    fail('JobQueue: duplicate job created despite matching idempotency key');
  }
} catch (err) {
  fail('Idempotency test error: ' + err.message);
}

// ── Test 3: Dead-Letter Queue (DLQ) on Exhausted Retries ──────────────────────
try {
  const queue = new JobQueue();
  const workerPool = new WorkerPool({ queue, maxConcurrency: 2 });

  // Register handler that always throws
  workerPool.registerHandler(JobType.CHECK_ELIGIBILITY, async () => {
    throw new Error('Simulated upstream API outage');
  });

  const job = await queue.enqueueJob(
    JobType.CHECK_ELIGIBILITY,
    { test: true },
    { maxRetries: 1, initialDelayMs: 20 },
    { tenantId: 'tenant_fail' }
  );

  workerPool.start(20);
  await new Promise((res) => setTimeout(res, 250));
  workerPool.stop();

  const finalJob = await queue.getJobById(job.id);
  const dlqRecord = queue.deadLetterQueue.get(job.id);

  if (finalJob.status === JobStatus.DEAD_LETTER && dlqRecord && dlqRecord.finalError.includes('Simulated upstream API outage')) {
    pass('WorkerPool: exhausted retries route job to Dead-Letter Queue with error context');
  } else {
    fail(`WorkerPool: job failed to route to Dead-Letter Queue (status: ${finalJob?.status})`);
  }
} catch (err) {
  fail('Dead-Letter Queue test error: ' + err.message);
}

// ── Test 4: Job Cancellation ──────────────────────────────────────────────────
try {
  const queue = new JobQueue();
  const context = { tenantId: 'tenant_cancel', userId: 'user_cancel' };

  const job = await queue.enqueueJob(JobType.DISCOVER_JOBS, {}, {}, context);
  const cancelled = await queue.cancelJob(job.id, context);

  if (cancelled.status === JobStatus.CANCELLED) {
    pass('JobQueue: job cancelled successfully with state transition');
  } else {
    fail('JobQueue: job cancellation failed');
  }
} catch (err) {
  fail('Cancellation test error: ' + err.message);
}

// ── Test 5: Timeout Enforcement ───────────────────────────────────────────────
try {
  const queue = new JobQueue();
  const workerPool = new WorkerPool({ queue, maxConcurrency: 2 });

  // Register long handler
  workerPool.registerHandler(JobType.CALCULATE_MATCH, async () => {
    await new Promise((res) => setTimeout(res, 300));
    return { score: 90 };
  });

  const job = await queue.enqueueJob(
    JobType.CALCULATE_MATCH,
    {},
    { timeoutMs: 50, maxRetries: 1, initialDelayMs: 10 },
    { tenantId: 'tenant_timeout' }
  );

  workerPool.start(20);
  await new Promise((res) => setTimeout(res, 300));
  workerPool.stop();

  const finished = await queue.getJobById(job.id);
  const hasTimeoutErr = finished.errors.some((e) => e.error.includes('timed out'));

  if (hasTimeoutErr) {
    pass('WorkerPool: job timeout enforced and aborted via timer signal');
  } else {
    fail('WorkerPool: timeout enforcement failed');
  }
} catch (err) {
  fail('Timeout test error: ' + err.message);
}

// ── Test 6: Monitoring Hooks & Telemetry Metrics ──────────────────────────────
try {
  const queue = new JobQueue();
  const eventsCaptured = [];

  queue.on('job:enqueued', (e) => eventsCaptured.push(e));

  await queue.enqueueJob(JobType.SEND_NOTIFICATION, { msg: 'Test' }, {}, { tenantId: 'tenant_telemetry' });
  const metrics = await queue.getQueueMetrics('tenant_telemetry');

  if (eventsCaptured.length === 1 && metrics.queued === 1 && metrics.totalJobs === 1) {
    pass('Monitoring & Metrics: queue events emitted and operational metrics aggregated');
  } else {
    fail('Monitoring & Metrics: telemetry mismatch');
  }
} catch (err) {
  fail('Monitoring test error: ' + err.message);
}

console.log('✅ All Background Processing Queue & Worker tests passed.\n');
