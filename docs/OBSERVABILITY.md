# StudentCareer AI — Production Observability, Telemetry & Auto-Recovery Guide

## 1. Executive Summary

In **StudentCareer AI**, observability is built-in across all service tiers. The system provides:
- **JSON-Structured Logging** with automatic redaction of sensitive candidate PII, passwords, and tokens.
- **12-Dimension Telemetry Tracking** measuring agent runs, portal scrape failures, eligibility decisions, AI completions, browser executions, API latency histograms, and application success rates.
- **Worker Heartbeat Monitoring** tracking distributed worker liveness.
- **Threshold-Based Failure Alerts** surfacing dead-letter spikes and portal outages.
- **Automated Safe Recovery** detecting unresponsive workers, re-queueing orphaned jobs, and recycling browser sandboxes.
- **Admin System Health View** (`/admin/health`).

---

## 2. Structured JSON Logging Architecture

All service logs are formatted as single-line JSON objects with standardized severity levels (`DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`):

```json
{
  "timestamp": "2026-08-11T19:10:00.000Z",
  "level": "INFO",
  "message": "Application package generated successfully",
  "component": "ApplicationWorkerService",
  "tenantId": "tenant_lums",
  "userId": "user_ali_123",
  "jobId": "job_1770808000_a1b2c3",
  "metadata": {
    "opportunityId": "careem_ai_1",
    "matchScore": 95,
    "credentials": "***REDACTED***"
  },
  "pid": 4812
}
```

### Zero-Secret Redaction Invariant
All logs pass through `Sanitizer.sanitize()`. Fields matching passwords, hashes, salts, session tokens, reset tokens, API keys, cookies, and authorization headers are masked as `***REDACTED***`.

---

## 3. The 12-Dimension Telemetry Catalog

| Dimension | Tracked Counters & Gauges | Description |
|---|---|---|
| **1. Agent Runs** | `total`, `succeeded`, `failed`, `avgDurationMs` | Lifetime autonomous agent execution cycles |
| **2. Source Failures** | `total`, `bySource` (Greenhouse, Ashby, Lever, Interamt) | Portal scrape outages and upstream rate limits |
| **3. Opportunities Discovered**| `totalDiscovered`, `bySource` | Portal ingest counters |
| **4. Eligibility Decisions** | `eligible`, `ineligible` | Pre-flight qualification gate ratio |
| **5. AI Failures** | `ai_failures_total` | LLM timeouts, parsing errors, or rate limits |
| **6. CV Tailoring Failures** | `cv_generation_failures_total` | Schema mismatches or fabrication gate flags |
| **7. Browser Failures** | `browser_failures_total` | Sandboxed automation timeouts or challenge stops |
| **8. Application Outcomes** | `attempts`, `succeeded`, `failed` | Application package submission results |
| **9. Queue Depth** | `queued`, `processing`, `deadLetter` | Background job backlog metrics |
| **10. Worker Health** | `healthyCount`, `stalledCount` | Active vs frozen worker heartbeats |
| **11. API Latency** | `p50Ms`, `p95Ms`, `p99Ms` | Sliding-window HTTP request latency percentiles |
| **12. Success Rate** | `successRatePercent` (%) | Net application conversion efficiency |

---

## 4. Worker Heartbeat & Alert Management

### Heartbeat Pulse
Every worker process sends periodic heartbeats (`workerId`, `timestamp`, `status`, `activeJobId`, `memoryRssMb`). If a worker does not pulse within **60 seconds**, it is flagged as `STALLED`.

### Alert Thresholds (`AlertManager`)

| Alert Rule | Condition | Severity | Action |
|---|---|---|---|
| **Elevated Failure Rate** | Success rate < 90% across $\ge 5$ attempts | `WARNING` | Notify admin dashboard |
| **Dead-Letter Spikes** | DLQ count > 0 | `CRITICAL` | Alert on exhausted retries |
| **Stalled Worker** | Worker missed heartbeat > 60s | `CRITICAL` | Trigger Auto-Recovery |
| **Source Degradation** | Portal failed $\ge 3$ consecutive sweeps | `WARNING` | Flag portal in telemetry |

---

## 5. Automated Safe Self-Healing

The `AutoRecoveryEngine` runs periodic health sweeps:

1. **Stalled Worker Recovery:** When a worker is unresponsive, its active in-flight job is reset from `PROCESSING` $\rightarrow$ `QUEUED` so a healthy worker can resume it immediately.
2. **Ephemeral Sandbox GC:** Automatically deletes temporary browser profile directories whose TTL (>5 min) has elapsed.
3. **Worker Recycling:** Resets crashed browser worker instances back to clean initial states.

---

## 6. Endpoints & Admin Health UI

- **Liveness:** `GET /healthz`
- **Readiness:** `GET /readyz`
- **Telemetry Snapshot:** `GET /api/admin/health`
- **Live Admin UI:** `https://app.studentcareer.ai/admin/health`
