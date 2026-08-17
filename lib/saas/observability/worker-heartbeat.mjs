/**
 * worker-heartbeat.mjs — Distributed Worker Heartbeat & Health Monitor
 *
 * Tracks worker pulse, detects unresponsive workers (>60s missed heartbeat),
 * and reports worker pool operational health.
 */

const HEARTBEAT_TIMEOUT_MS = 60 * 1000; // 60s without heartbeat is considered dead/stalled

export class WorkerHeartbeatMonitor {
  constructor() {
    this.workers = new Map(); // workerId -> { lastHeartbeat, status, activeJobId, memoryRssMb }
  }

  /**
   * Record a heartbeat ping from a worker process.
   */
  recordHeartbeat(workerId, { status = "ACTIVE", activeJobId = null, memoryRssMb = 0 } = {}) {
    const now = Date.now();
    this.workers.set(workerId, {
      workerId,
      status,
      activeJobId,
      memoryRssMb,
      lastHeartbeat: now,
      lastHeartbeatIso: new Date(now).toISOString(),
    });
  }

  /**
   * Check status of all registered workers.
   */
  getWorkerHealth() {
    const now = Date.now();
    const healthy = [];
    const deadOrStalled = [];

    for (const [id, record] of this.workers.entries()) {
      if (now - record.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
        deadOrStalled.push({ ...record, isStalled: true });
      } else {
        healthy.push({ ...record, isStalled: false });
      }
    }

    return {
      totalRegistered: this.workers.size,
      healthyCount: healthy.length,
      stalledCount: deadOrStalled.length,
      healthy,
      deadOrStalled,
      timestamp: new Date().toISOString(),
    };
  }

  removeWorker(workerId) {
    this.workers.delete(workerId);
  }
}
