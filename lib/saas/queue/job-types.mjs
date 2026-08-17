/**
 * job-types.mjs — Background Processing Job Types, Statuses & Policies
 *
 * Defines the 9 specialized background job types with standard timeouts,
 * retry policies, and priority tiers.
 */

export const JobType = Object.freeze({
  DISCOVER_JOBS: "DISCOVER_JOBS",
  CLASSIFY_JOB: "CLASSIFY_JOB",
  CHECK_ELIGIBILITY: "CHECK_ELIGIBILITY",
  CALCULATE_MATCH: "CALCULATE_MATCH",
  GENERATE_CV: "GENERATE_CV",
  GENERATE_COVER_LETTER: "GENERATE_COVER_LETTER",
  PREPARE_APPLICATION: "PREPARE_APPLICATION",
  RUN_BROWSER_APPLICATION: "RUN_BROWSER_APPLICATION",
  SEND_NOTIFICATION: "SEND_NOTIFICATION",
});

export const JobStatus = Object.freeze({
  QUEUED: "QUEUED",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  RETRYING: "RETRYING",
  DEAD_LETTER: "DEAD_LETTER",
  CANCELLED: "CANCELLED",
});

export const JobPriority = Object.freeze({
  LOW: 10,
  NORMAL: 50,
  HIGH: 80,
  CRITICAL: 100,
});

export const DEFAULT_JOB_POLICIES = Object.freeze({
  [JobType.DISCOVER_JOBS]: {
    timeoutMs: 120000,
    maxRetries: 3,
    initialDelayMs: 2000,
    priority: JobPriority.NORMAL,
  },
  [JobType.CLASSIFY_JOB]: {
    timeoutMs: 30000,
    maxRetries: 3,
    initialDelayMs: 1000,
    priority: JobPriority.NORMAL,
  },
  [JobType.CHECK_ELIGIBILITY]: {
    timeoutMs: 15000,
    maxRetries: 2,
    initialDelayMs: 500,
    priority: JobPriority.HIGH,
  },
  [JobType.CALCULATE_MATCH]: {
    timeoutMs: 30000,
    maxRetries: 3,
    initialDelayMs: 1000,
    priority: JobPriority.NORMAL,
  },
  [JobType.GENERATE_CV]: {
    timeoutMs: 60000,
    maxRetries: 3,
    initialDelayMs: 2000,
    priority: JobPriority.HIGH,
  },
  [JobType.GENERATE_COVER_LETTER]: {
    timeoutMs: 45000,
    maxRetries: 3,
    initialDelayMs: 1500,
    priority: JobPriority.NORMAL,
  },
  [JobType.PREPARE_APPLICATION]: {
    timeoutMs: 60000,
    maxRetries: 3,
    initialDelayMs: 2000,
    priority: JobPriority.HIGH,
  },
  [JobType.RUN_BROWSER_APPLICATION]: {
    timeoutMs: 180000,
    maxRetries: 2,
    initialDelayMs: 5000,
    priority: JobPriority.CRITICAL,
  },
  [JobType.SEND_NOTIFICATION]: {
    timeoutMs: 15000,
    maxRetries: 5,
    initialDelayMs: 500,
    priority: JobPriority.HIGH,
  },
});
