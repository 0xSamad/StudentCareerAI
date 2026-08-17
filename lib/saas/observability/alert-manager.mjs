/**
 * alert-manager.mjs — Threshold-Based Failure & Anomaly Alert Manager
 *
 * Evaluates metrics snapshots and generates actionable alerts on:
 * - High failure rate (>10%)
 * - Source portal outages
 * - Dead-letter queue spikes
 * - Stalled or crashed workers
 */

export const AlertSeverity = Object.freeze({
  INFO: "INFO",
  WARNING: "WARNING",
  CRITICAL: "CRITICAL",
});

export class AlertManager {
  constructor() {
    this.activeAlerts = [];
  }

  /**
   * Evaluate a telemetry snapshot against operational thresholds.
   *
   * @param {object} snapshot - From MetricsTracker.getSnapshot()
   * @param {object} [workerHealth=null] - From WorkerHeartbeatMonitor.getWorkerHealth()
   * @returns {Array<object>} Array of active alerts
   */
  evaluate(snapshot, workerHealth = null) {
    const alerts = [];
    const now = new Date().toISOString();

    // 1. Application Success Rate Alert
    if (snapshot.applications.attempts >= 5 && snapshot.applications.successRatePercent < 90.0) {
      alerts.push({
        id: `alert_app_fail_rate_${Date.now()}`,
        severity: AlertSeverity.WARNING,
        title: "Application Failure Rate Elevated",
        message: `Success rate is ${snapshot.applications.successRatePercent}% with ${snapshot.applications.failed} failures across ${snapshot.applications.attempts} attempts.`,
        timestamp: now,
      });
    }

    // 2. Dead Letter Queue Alert
    if (snapshot.queue && snapshot.queue.deadLetter > 0) {
      alerts.push({
        id: `alert_dlq_${Date.now()}`,
        severity: AlertSeverity.CRITICAL,
        title: "Dead-Letter Queue Contains Failed Jobs",
        message: `${snapshot.queue.deadLetter} jobs have exceeded max retries and entered dead-letter state.`,
        timestamp: now,
      });
    }

    // 3. Stalled Worker Alert
    if (workerHealth && workerHealth.stalledCount > 0) {
      alerts.push({
        id: `alert_stalled_workers_${Date.now()}`,
        severity: AlertSeverity.CRITICAL,
        title: "Unresponsive Workers Detected",
        message: `${workerHealth.stalledCount} worker(s) have missed heartbeats (>60s) and may be frozen.`,
        timestamp: now,
      });
    }

    // 4. Source Outage Alert
    if (snapshot.failures.sourcesBySource) {
      for (const [source, count] of Object.entries(snapshot.failures.sourcesBySource)) {
        if (count >= 3) {
          alerts.push({
            id: `alert_source_${source}_${Date.now()}`,
            severity: AlertSeverity.WARNING,
            title: `ATS Source '${source}' Degraded`,
            message: `Encountered ${count} consecutive failures while querying ${source} portal.`,
            timestamp: now,
          });
        }
      }
    }

    this.activeAlerts = alerts;
    return alerts;
  }
}
