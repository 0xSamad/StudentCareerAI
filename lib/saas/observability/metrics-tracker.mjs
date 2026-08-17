/**
 * metrics-tracker.mjs — Comprehensive Production Metrics & Telemetry Aggregator
 *
 * Tracks 12 system telemetry dimensions:
 * - Agent runs
 * - Source failures
 * - Opportunities discovered
 * - Eligibility decisions
 * - AI failures
 * - CV generation failures
 * - Browser failures
 * - Application failures
 * - Queue depth
 * - Worker health
 * - API latency (p50, p95, p99)
 * - Application success rate
 * - Retry metrics
 */

export class MetricsTracker {
  constructor() {
    this.counters = {
      agent_runs_total: 0,
      agent_runs_succeeded: 0,
      agent_runs_failed: 0,
      opportunities_discovered_total: 0,
      opportunities_by_source: {}, // source -> count
      eligibility_eligible_total: 0,
      eligibility_ineligible_total: 0,
      source_failures_total: 0,
      source_failures_by_source: {}, // source -> count
      ai_failures_total: 0,
      cv_generation_failures_total: 0,
      browser_failures_total: 0,
      application_attempts_total: 0,
      application_success_total: 0,
      application_failures_total: 0,
      retries_total: 0,
    };

    this.latencySamples = []; // Array of latency numbers in ms (sliding window max 1000)
    this.agentDurations = []; // Array of agent duration in ms
  }

  // 1. Agent Runs
  recordAgentRun({ success, durationMs }) {
    this.counters.agent_runs_total++;
    if (success) this.counters.agent_runs_succeeded++;
    else this.counters.agent_runs_failed++;
    if (durationMs) {
      this.agentDurations.push(durationMs);
      if (this.agentDurations.length > 500) this.agentDurations.shift();
    }
  }

  // 2. Discovered Opportunities
  recordOpportunityDiscovered(source = "unknown", count = 1) {
    this.counters.opportunities_discovered_total += count;
    this.counters.opportunities_by_source[source] = (this.counters.opportunities_by_source[source] || 0) + count;
  }

  // 3. Source Failures
  recordSourceFailure(source = "unknown") {
    this.counters.source_failures_total++;
    this.counters.source_failures_by_source[source] = (this.counters.source_failures_by_source[source] || 0) + 1;
  }

  // 4. Eligibility Decisions
  recordEligibilityDecision(isEligible) {
    if (isEligible) this.counters.eligibility_eligible_total++;
    else this.counters.eligibility_ineligible_total++;
  }

  // 5. Failure Trackers
  recordAIFailure() {
    this.counters.ai_failures_total++;
  }

  recordCVGenerationFailure() {
    this.counters.cv_generation_failures_total++;
  }

  recordBrowserFailure() {
    this.counters.browser_failures_total++;
  }

  // 6. Application Outcomes
  recordApplicationOutcome({ success }) {
    this.counters.application_attempts_total++;
    if (success) this.counters.application_success_total++;
    else this.counters.application_failures_total++;
  }

  // 7. Retries
  recordRetry() {
    this.counters.retries_total++;
  }

  // 8. API Latency Sampling
  recordApiLatency(durationMs) {
    if (typeof durationMs === "number" && durationMs >= 0) {
      this.latencySamples.push(durationMs);
      if (this.latencySamples.length > 1000) {
        this.latencySamples.shift();
      }
    }
  }

  _calculatePercentile(array, percentile) {
    if (array.length === 0) return 0;
    const sorted = [...array].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return Math.round(sorted[Math.max(0, index)]);
  }

  /**
   * Get unified system telemetry snapshot.
   */
  getSnapshot(queueMetrics = null) {
    const totalApps = this.counters.application_attempts_total;
    const successRate = totalApps > 0 ? ((this.counters.application_success_total / totalApps) * 100).toFixed(1) : "100.0";

    return {
      timestamp: new Date().toISOString(),
      agentRuns: {
        total: this.counters.agent_runs_total,
        succeeded: this.counters.agent_runs_succeeded,
        failed: this.counters.agent_runs_failed,
        avgDurationMs:
          this.agentDurations.length > 0
            ? Math.round(this.agentDurations.reduce((a, b) => a + b, 0) / this.agentDurations.length)
            : 0,
      },
      opportunities: {
        totalDiscovered: this.counters.opportunities_discovered_total,
        bySource: this.counters.opportunities_by_source,
      },
      eligibility: {
        eligible: this.counters.eligibility_eligible_total,
        ineligible: this.counters.eligibility_ineligible_total,
      },
      failures: {
        sources: this.counters.source_failures_total,
        sourcesBySource: this.counters.source_failures_by_source,
        ai: this.counters.ai_failures_total,
        cvGeneration: this.counters.cv_generation_failures_total,
        browser: this.counters.browser_failures_total,
        applications: this.counters.application_failures_total,
      },
      applications: {
        attempts: this.counters.application_attempts_total,
        succeeded: this.counters.application_success_total,
        failed: this.counters.application_failures_total,
        successRatePercent: parseFloat(successRate),
      },
      retries: {
        total: this.counters.retries_total,
      },
      apiLatency: {
        samplesCount: this.latencySamples.length,
        p50Ms: this._calculatePercentile(this.latencySamples, 50),
        p95Ms: this._calculatePercentile(this.latencySamples, 95),
        p99Ms: this._calculatePercentile(this.latencySamples, 99),
      },
      queue: queueMetrics || { queued: 0, processing: 0, deadLetter: 0 },
    };
  }
}
