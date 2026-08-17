# StudentCareer AI — Production Background Processing Architecture

## 1. Executive Summary

In production **StudentCareer AI**, the web and API gateway processes are strictly decoupled from long-running background tasks. Scraping public ATS feeds, multi-dimension LLM matching, CV tailoring, and browser automation run asynchronously within a distributed **Job Queue & Worker Pool Architecture**.

---

## 2. Queue & Worker Topology

```
┌───────────────────────────┐         ┌────────────────────────────────────────────────────────┐
│     API / WEB PROCESS     │         │               BACKGROUND WORKER POOL                   │
├───────────────────────────┤         ├────────────────────────────────────────────────────────┤
│ • Receives user requests  │         │ • Concurrency-controlled event loop (Max N workers)    │
│ • Validates payload & auth│         │ • Exponential backoff retries with randomized jitter   │
│ • Enqueues job in queue   │         │ • Timeout enforcement via AbortController              │
│ • Returns 202 Accepted    │         │ • Dead-Letter Queue (DLQ) routing on max retries       │
└─────────────┬─────────────┘         └───────────────────────────▲────────────────────────────┘
              │                                                   │
              ▼                                                   │
┌─────────────────────────────────────────────────────────────────┴────────────────────────────┐
│                                 PERSISTENT MULTI-TENANT JOB QUEUE                            │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ 1. DISCOVER_JOBS             4. CALCULATE_MATCH             7. PREPARE_APPLICATION           │
│ 2. CLASSIFY_JOB              5. GENERATE_CV                 8. RUN_BROWSER_APPLICATION       │
│ 3. CHECK_ELIGIBILITY         6. GENERATE_COVER_LETTER       9. SEND_NOTIFICATION             │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. The 9 Background Job Types & Operational Policies

| Job Type | Default Timeout | Max Retries | Priority | Description & Bound Service Tier |
|---|---|---|---|---|
| `DISCOVER_JOBS` | 120s | 3 | Normal (50) | Multi-source public ATS portal discovery sweeps |
| `CLASSIFY_JOB` | 30s | 3 | Normal (50) | Classifies opportunity as `INTERNSHIP` vs `JOB` |
| `CHECK_ELIGIBILITY` | 15s | 2 | High (80) | Pre-flight academic & work authorization hard gate |
| `CALCULATE_MATCH` | 30s | 3 | Normal (50) | 6-dimension student fit evaluation & scoring |
| `GENERATE_CV` | 60s | 3 | High (80) | Tailored CV synthesis with 0% fabrication contract |
| `GENERATE_COVER_LETTER` | 45s | 3 | Normal (50) | Tailored STAR cover letter generation |
| `PREPARE_APPLICATION` | 60s | 3 | High (80) | High-confidence Q&A generation & artifact packaging |
| `RUN_BROWSER_APPLICATION`| 180s | 2 | Critical (100)| Browser automation in Safe DRY-RUN sandbox |
| `SEND_NOTIFICATION` | 15s | 5 | High (80) | In-app, webhook, and email notification delivery |

---

## 4. Worker Resilience & Failure Mitigations

### A. Exponential Backoff with Jitter
Failed jobs are automatically retried with randomized jitter to prevent thundering herds:
$$\text{Delay} = \min\left(\text{InitialDelay} \times 2^{\text{attempts} - 1} + \text{RandomJitter}(0..200\text{ms}), 60000\text{ms}\right)$$

### B. Idempotency Keys
Jobs enqueued with an `idempotencyKey` check the persistent state table before insertion. If an identical job is already queued or completed for that tenant, the existing job record is returned immediately.

### C. Dead-Letter Queue (DLQ)
Jobs that fail after exhausting `maxRetries` transition to the `DEAD_LETTER` state. The job payload, attempt history, and error stack are preserved in the DLQ for diagnostic review.

### D. Timeouts & Task Cancellation
- **Timeouts:** Every job runs within an `AbortController` timeout race. If the timeout threshold is exceeded, the task is terminated and flagged for retry.
- **Cancellation:** In-flight or pending jobs can be cancelled on-demand via `jobQueue.cancelJob(jobId, context)`.

### E. Concurrency Limiting
Each worker pool enforces a configurable `maxConcurrency` limit (e.g. 5 concurrent tasks) ensuring system resources and API rate limits are never exceeded.

---

## 5. Scheduler Integration

The `SchedulerService` creates and enqueues jobs in the `JobQueue` rather than executing long-running tasks synchronously:

```javascript
schedulerService.scheduleJobTask(
  "Hourly Greenhouse Sweep",
  JobType.DISCOVER_JOBS,
  3600000,
  { options: { sources: ["greenhouse"] } },
  { tenantId: "tenant_lums" }
);
```

---

## 6. Monitoring Hooks & Telemetry Events

The `JobQueue` and `WorkerPool` emit real-time operational events:

```javascript
workerPool.on("job:started", ({ jobId, type, attempt }) => console.log(`Job ${jobId} started`));
workerPool.on("job:completed", ({ jobId, type, result }) => console.log(`Job ${jobId} completed`));
workerPool.on("job:retrying", ({ jobId, delayMs }) => console.log(`Job ${jobId} retrying in ${delayMs}ms`));
workerPool.on("job:failed", ({ jobId, error }) => console.error(`Job ${jobId} failed: ${error}`));
workerPool.on("job:dead_letter", ({ jobId, error }) => console.error(`Job ${jobId} moved to DLQ: ${error}`));
```

Query queue health metrics via `jobQueue.getQueueMetrics(tenantId)`:
```json
{
  "totalJobs": 42,
  "queued": 2,
  "processing": 3,
  "completed": 35,
  "failed": 1,
  "deadLetter": 1,
  "cancelled": 0,
  "timestamp": "2026-08-11T18:40:00.000Z"
}
```
