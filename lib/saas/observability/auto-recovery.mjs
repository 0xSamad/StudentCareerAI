/**
 * auto-recovery.mjs — Automated Safe Self-Healing & Crash Recovery
 *
 * Implements:
 * - Stalled worker detection and automatic process recycling
 * - Orphaned job re-queueing (transition from PROCESSING to QUEUED)
 * - Ephemeral browser session garbage collection
 */

import { JobStatus } from "../queue/job-types.mjs";

export class AutoRecoveryEngine {
  constructor({ heartbeatMonitor, jobQueue, browserContextManager, logger } = {}) {
    this.heartbeatMonitor = heartbeatMonitor;
    this.jobQueue = jobQueue;
    this.browserContextManager = browserContextManager;
    this.logger = logger;
  }

  /**
   * Run a self-healing audit cycle.
   *
   * @returns {Promise<{ recoveredWorkersCount: number, requeuedJobsCount: number, cleanedSessionsCount: number }>}
   */
  async runRecoveryCycle() {
    let recoveredWorkersCount = 0;
    let requeuedJobsCount = 0;
    let cleanedSessionsCount = 0;

    // 1. Recover Stalled Workers & Orphaned Jobs
    if (this.heartbeatMonitor && this.jobQueue) {
      const health = this.heartbeatMonitor.getWorkerHealth();
      for (const stalled of health.deadOrStalled) {
        if (stalled.activeJobId) {
          const job = await this.jobQueue.getJobById(stalled.activeJobId);
          if (job && job.status === JobStatus.PROCESSING) {
            // Re-queue the orphaned job for another worker
            const rawJob = this.jobQueue.jobs.get(job.id);
            if (rawJob) {
              rawJob.status = JobStatus.QUEUED;
              rawJob.updatedAt = new Date().toISOString();
              requeuedJobsCount++;

              if (this.logger) {
                this.logger.warn(
                  `[AutoRecovery] Re-queued orphaned job '${job.id}' from stalled worker '${stalled.workerId}'`
                );
              }
            }
          }
        }

        // Remove stalled worker from monitor
        this.heartbeatMonitor.removeWorker(stalled.workerId);
        recoveredWorkersCount++;
      }
    }

    // 2. Clean Expired Ephemeral Browser Sandboxes
    if (this.browserContextManager) {
      cleanedSessionsCount = this.browserContextManager.cleanExpiredSessions();
    }

    return {
      recoveredWorkersCount,
      requeuedJobsCount,
      cleanedSessionsCount,
      timestamp: new Date().toISOString(),
    };
  }
}
