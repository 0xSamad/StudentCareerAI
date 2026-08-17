/**
 * scheduler-service.mjs — Multi-Tenant Task & Scan Scheduler
 *
 * Implements ISchedulerService with tenant-isolated task timers,
 * decoupling scheduling from execution by enqueuing jobs into the JobQueue.
 */

import { ISchedulerService } from "./scheduler-interface.mjs";

export class SchedulerService extends ISchedulerService {
  constructor({ jobQueue } = {}) {
    super();
    this.jobQueue = jobQueue || null;
    this.tasks = new Map(); // taskId -> taskRecord
  }

  /**
   * Schedule a periodic task that creates a background job in the queue.
   */
  scheduleJobTask(name, jobType, intervalMs, payload = {}, context = {}) {
    const handler = async (taskCtx) => {
      if (this.jobQueue) {
        return this.jobQueue.enqueueJob(jobType, payload, { priority: 50 }, taskCtx);
      }
    };
    return this.scheduleTask(name, intervalMs, handler, context);
  }

  scheduleTask(name, intervalMs, handler, context = {}) {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const taskRecord = {
      id: taskId,
      name,
      intervalMs,
      handler,
      context,
      runsCount: 0,
      lastRunAt: null,
      active: true,
      timer: null,
    };

    // Only start timer if intervalMs is positive
    if (intervalMs > 0) {
      taskRecord.timer = setInterval(async () => {
        try {
          taskRecord.runsCount += 1;
          taskRecord.lastRunAt = new Date().toISOString();
          await handler(taskRecord.context);
        } catch (err) {
          console.error(`[SchedulerService] Task '${name}' failed:`, err.message);
        }
      }, intervalMs);
    }

    this.tasks.set(taskId, taskRecord);
    return taskId;
  }

  cancelTask(taskId) {
    const record = this.tasks.get(taskId);
    if (record) {
      if (record.timer) clearInterval(record.timer);
      record.active = false;
      this.tasks.delete(taskId);
      return true;
    }
    return false;
  }

  async triggerTask(taskId, context = {}) {
    const record = this.tasks.get(taskId);
    if (!record) throw new Error(`Task '${taskId}' not found`);

    record.runsCount += 1;
    record.lastRunAt = new Date().toISOString();
    return record.handler({ ...record.context, ...context });
  }

  stopAll() {
    for (const record of this.tasks.values()) {
      if (record.timer) clearInterval(record.timer);
    }
    this.tasks.clear();
  }
}
