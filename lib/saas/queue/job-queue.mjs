/**
 * job-queue.mjs — Multi-Tenant Persistent Background Job Queue
 *
 * Implements persistent job queueing, idempotency keys, priority scheduling,
 * dead-letter queueing, cancellation, and queue telemetry metrics.
 */

import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { JobType, JobStatus, JobPriority, DEFAULT_JOB_POLICIES } from "./job-types.mjs";
import { Sanitizer } from "../auth/sanitizer.mjs";

export class JobQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.jobs = new Map(); // jobId -> jobRecord
    this.idempotencyMap = new Map(); // `${tenantId}:${idempotencyKey}` -> jobId
    this.deadLetterQueue = new Map(); // jobId -> deadLetterRecord
  }

  /**
   * Enqueue a new background job.
   *
   * @param {string} type - From JobType enum
   * @param {object} payload - Job input parameters
   * @param {object} [options={}] - { priority, idempotencyKey, maxRetries, timeoutMs }
   * @param {object} context - { tenantId, userId }
   * @returns {Promise<object>} Job record
   */
  async enqueueJob(type, payload = {}, options = {}, context = {}) {
    const tenantId = context.tenantId || "default";
    const userId = context.userId || "system";

    if (!JobType[type]) {
      throw new Error(`Invalid JobType: '${type}'`);
    }

    // 1. Idempotency Check
    if (options.idempotencyKey) {
      const idKey = `${tenantId}:${options.idempotencyKey}`;
      const existingJobId = this.idempotencyMap.get(idKey);
      if (existingJobId) {
        const existing = this.jobs.get(existingJobId);
        if (existing && existing.status !== JobStatus.FAILED && existing.status !== JobStatus.CANCELLED) {
          return Sanitizer.sanitize(existing);
        }
      }
    }

    const policy = DEFAULT_JOB_POLICIES[type] || {};
    const jobId = `job_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
    const now = new Date().toISOString();

    const job = {
      id: jobId,
      type,
      tenantId,
      userId,
      payload: Sanitizer.sanitize(payload),
      status: JobStatus.QUEUED,
      priority: options.priority || policy.priority || JobPriority.NORMAL,
      maxRetries: options.maxRetries !== undefined ? options.maxRetries : policy.maxRetries || 3,
      timeoutMs: options.timeoutMs || policy.timeoutMs || 30000,
      initialDelayMs: policy.initialDelayMs || 1000,
      attempts: 0,
      errors: [],
      result: null,
      idempotencyKey: options.idempotencyKey || null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    };

    this.jobs.set(jobId, job);

    if (options.idempotencyKey) {
      this.idempotencyMap.set(`${tenantId}:${options.idempotencyKey}`, jobId);
    }

    this.emit("job:enqueued", { jobId: job.id, type: job.type, tenantId: job.tenantId, priority: job.priority });
    return Sanitizer.sanitize(job);
  }

  /**
   * Fetch the next available pending job, sorted by priority (descending) and creation time.
   */
  async getNextPendingJob() {
    const pending = [];
    for (const job of this.jobs.values()) {
      if (job.status === JobStatus.QUEUED || job.status === JobStatus.RETRYING) {
        pending.push(job);
      }
    }

    if (pending.length === 0) return null;

    // Sort by priority (higher first), then by creation date (FIFO)
    pending.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

    return pending[0];
  }

  /**
   * Cancel an enqueued or running job.
   */
  async cancelJob(jobId, context = {}) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job '${jobId}' not found`);

    if (context.tenantId && job.tenantId !== context.tenantId && job.tenantId !== "global") {
      throw new Error(`Unauthorized to cancel job '${jobId}' in another tenant`);
    }

    if (job.status === JobStatus.COMPLETED) {
      throw new Error(`Cannot cancel completed job '${jobId}'`);
    }

    job.status = JobStatus.CANCELLED;
    job.updatedAt = new Date().toISOString();
    this.emit("job:cancelled", { jobId: job.id, type: job.type, tenantId: job.tenantId });
    return Sanitizer.sanitize(job);
  }

  /**
   * Move an exhausted failed job to Dead-Letter Queue.
   */
  async moveToDeadLetter(job, finalError) {
    job.status = JobStatus.DEAD_LETTER;
    job.updatedAt = new Date().toISOString();
    job.completedAt = new Date().toISOString();

    const deadLetterRecord = {
      jobId: job.id,
      type: job.type,
      tenantId: job.tenantId,
      userId: job.userId,
      payload: job.payload,
      attempts: job.attempts,
      errors: job.errors,
      finalError: finalError ? String(finalError.message || finalError) : "Max retries exceeded",
      deadLetteredAt: new Date().toISOString(),
    };

    this.deadLetterQueue.set(job.id, deadLetterRecord);
    this.emit("job:dead_letter", { jobId: job.id, type: job.type, tenantId: job.tenantId, error: deadLetterRecord.finalError });
    return Sanitizer.sanitize(deadLetterRecord);
  }

  /**
   * Retrieve a job record.
   */
  async getJobById(jobId, context = {}) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    if (context.tenantId && job.tenantId !== context.tenantId && job.tenantId !== "global") {
      return null;
    }
    return Sanitizer.sanitize(job);
  }

  /**
   * Get queue health and operational metrics.
   */
  async getQueueMetrics(tenantId = null) {
    let queued = 0;
    let processing = 0;
    let completed = 0;
    let failed = 0;
    let retrying = 0;
    let deadLetter = 0;
    let cancelled = 0;

    for (const job of this.jobs.values()) {
      if (tenantId && job.tenantId !== tenantId && job.tenantId !== "global") continue;

      if (job.status === JobStatus.QUEUED) queued++;
      else if (job.status === JobStatus.PROCESSING) processing++;
      else if (job.status === JobStatus.COMPLETED) completed++;
      else if (job.status === JobStatus.FAILED) failed++;
      else if (job.status === JobStatus.RETRYING) retrying++;
      else if (job.status === JobStatus.DEAD_LETTER) deadLetter++;
      else if (job.status === JobStatus.CANCELLED) cancelled++;
    }

    return {
      totalJobs: queued + processing + completed + failed + retrying + deadLetter + cancelled,
      queued,
      processing,
      completed,
      failed,
      retrying,
      deadLetter: this.deadLetterQueue.size,
      cancelled,
      activeDeadLetterCount: deadLetter,
      timestamp: new Date().toISOString(),
    };
  }
}
