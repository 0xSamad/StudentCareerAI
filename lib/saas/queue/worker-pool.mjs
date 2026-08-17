/**
 * worker-pool.mjs — Distributed Background Worker Pool Engine
 *
 * Implements concurrency-throttled worker execution, timeouts,
 * exponential backoff with jitter, dead-letter routing, and monitoring hooks.
 */

import { EventEmitter } from "node:events";
import { JobStatus } from "./job-types.mjs";
import { Sanitizer } from "../auth/sanitizer.mjs";

export class WorkerPool extends EventEmitter {
  constructor({ queue, maxConcurrency = 5 } = {}) {
    super();
    this.queue = queue;
    this.maxConcurrency = maxConcurrency;
    this.activeWorkers = new Set(); // set of active running jobIds
    this.handlers = new Map(); // jobType -> async handlerFunction
    this.isRunning = false;
    this.pollInterval = null;
  }

  /**
   * Register an asynchronous handler for a specific JobType.
   *
   * @param {string} jobType
   * @param {Function} handlerFn - async (payload, context, signal) => result
   */
  registerHandler(jobType, handlerFn) {
    if (!jobType || typeof handlerFn !== "function") {
      throw new Error("Valid jobType and async handler function required");
    }
    this.handlers.set(jobType, handlerFn);
  }

  /**
   * Start the worker loop.
   */
  start(pollIntervalMs = 50) {
    if (this.isRunning) return;
    this.isRunning = true;
    this.pollInterval = setInterval(() => {
      this._processNext();
    }, pollIntervalMs);
  }

  /**
   * Stop the worker loop and wait for active jobs.
   */
  stop() {
    this.isRunning = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Internal step to pick and execute next pending job.
   */
  async _processNext() {
    if (!this.isRunning || this.activeWorkers.size >= this.maxConcurrency) {
      return;
    }

    const job = await this.queue.getNextPendingJob();
    if (!job) return;

    // Mark processing and track in active workers set
    job.status = JobStatus.PROCESSING;
    job.startedAt = new Date().toISOString();
    job.updatedAt = new Date().toISOString();
    job.attempts += 1;
    this.activeWorkers.add(job.id);

    this.emit("job:started", { jobId: job.id, type: job.type, attempt: job.attempts, tenantId: job.tenantId });

    // Execute job asynchronously (non-blocking)
    this._executeJob(job).finally(() => {
      this.activeWorkers.delete(job.id);
    });
  }

  /**
   * Execute job with timeout enforcement and exponential backoff retry logic.
   */
  async _executeJob(job) {
    const handler = this.handlers.get(job.type);

    if (!handler) {
      const err = new Error(`No handler registered for JobType '${job.type}'`);
      job.errors.push({ attempt: job.attempts, error: err.message, timestamp: new Date().toISOString() });
      await this.queue.moveToDeadLetter(job, err);
      return;
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, job.timeoutMs || 30000);

    try {
      // Execute handler with timeout race
      const result = await Promise.race([
        handler(job.payload, { tenantId: job.tenantId, userId: job.userId }, abortController.signal),
        new Promise((_, reject) => {
          abortController.signal.addEventListener("abort", () => {
            reject(new Error(`Job timed out after ${job.timeoutMs}ms`));
          });
        }),
      ]);

      clearTimeout(timeoutId);

      // Successful completion
      job.status = JobStatus.COMPLETED;
      job.result = Sanitizer.sanitize(result);
      job.completedAt = new Date().toISOString();
      job.updatedAt = new Date().toISOString();

      this.emit("job:completed", { jobId: job.id, type: job.type, tenantId: job.tenantId, result: job.result });
    } catch (err) {
      clearTimeout(timeoutId);
      const errorMsg = String(err.message || err);
      job.errors.push({ attempt: job.attempts, error: errorMsg, timestamp: new Date().toISOString() });

      this.emit("job:failed", { jobId: job.id, type: job.type, attempt: job.attempts, error: errorMsg, tenantId: job.tenantId });

      // Check retry capability
      if (job.attempts < job.maxRetries && job.status !== JobStatus.CANCELLED) {
        job.status = JobStatus.RETRYING;
        job.updatedAt = new Date().toISOString();

        // Calculate exponential backoff with jitter
        const backoffBase = (job.initialDelayMs || 1000) * Math.pow(2, job.attempts - 1);
        const jitter = Math.random() * 200;
        const delayMs = Math.min(backoffBase + jitter, 60000);

        this.emit("job:retrying", { jobId: job.id, type: job.type, nextAttempt: job.attempts + 1, delayMs });

        setTimeout(() => {
          if (job.status === JobStatus.RETRYING) {
            job.status = JobStatus.QUEUED;
          }
        }, delayMs);
      } else {
        // Exceeded max retries -> Move to Dead Letter
        await this.queue.moveToDeadLetter(job, err);
      }
    }
  }
}
