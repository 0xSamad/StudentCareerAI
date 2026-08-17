/**
 * scheduler-interface.mjs — Distributed Scheduler Contracts
 *
 * Defines contracts for scheduled background sweeps and queue processing.
 */

export class ISchedulerService {
  scheduleTask(name, cronOrIntervalMs, handler, context) {
    throw new Error("Method not implemented");
  }

  cancelTask(taskId) {
    throw new Error("Method not implemented");
  }

  async triggerTask(taskId, context) {
    throw new Error("Method not implemented");
  }
}
