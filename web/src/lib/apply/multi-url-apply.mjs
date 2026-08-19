/**
 * Multi-URL apply — a thin batch layer around the existing single-URL pipeline.
 * Each URL is an independent job. One failure or CAPTCHA never fails siblings.
 * Does not change in-app Apply or POST /api/opportunities/apply.
 */

import { generateJobDocuments } from "./url-apply-documents.mjs";
import { applyNotificationHub, buildActionRequiredCard } from "./apply-notifications.mjs";
import { buildHitlSnapshot, indexUserAnswers, saveHitlSnapshot, waitUntilHumanChallengeCleared } from "./hitl-state.mjs";
import {
  applyQualityToOutcome,
  classifyApplyError,
  formatActionRequiredEmail,
  formatCompletionEmail,
  persistManagedBatches,
  resetManagedBatchHydration,
  restoreManagedBatches,
  withRetry,
  withTimeout,
} from "./application-manager.mjs";

export const MAX_URL_APPLY_JOBS = 12;

export const URL_APPLY_PHASE = Object.freeze({
  PENDING: "PENDING",
  FETCHING_JOB: "FETCHING_JOB",
  JOB_ANALYZED: "JOB_ANALYZED",
  GENERATING_DOCUMENTS: "GENERATING_DOCUMENTS",
  READY_TO_APPLY: "READY_TO_APPLY",
  APPLYING: "RUNNING",
  RUNNING: "RUNNING",
  WAITING_FOR_USER: "WAITING_FOR_USER",
  CAPTCHA_REQUIRED: "CAPTCHA_REQUIRED",
  INFORMATION_REQUIRED: "INFORMATION_REQUIRED",
  LOGIN_REQUIRED: "LOGIN_REQUIRED",
  EMAIL_VERIFICATION_REQUIRED: "EMAIL_VERIFICATION_REQUIRED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
});

/** Map conceptual phases onto existing applications.state CHECK values. */
export function phaseToQueueState(phase) {
  switch (phase) {
    case URL_APPLY_PHASE.PENDING:
      return "SELECTED";
    case URL_APPLY_PHASE.FETCHING_JOB:
      return "ANALYZING";
    case URL_APPLY_PHASE.JOB_ANALYZED:
      return "MATCHED";
    case URL_APPLY_PHASE.GENERATING_DOCUMENTS:
      return "CV_PREPARATION";
    case URL_APPLY_PHASE.READY_TO_APPLY:
      return "READY";
    case URL_APPLY_PHASE.APPLYING:
    case URL_APPLY_PHASE.RUNNING:
      return "APPLYING";
    case URL_APPLY_PHASE.WAITING_FOR_USER:
    case URL_APPLY_PHASE.CAPTCHA_REQUIRED:
    case URL_APPLY_PHASE.INFORMATION_REQUIRED:
    case URL_APPLY_PHASE.LOGIN_REQUIRED:
    case URL_APPLY_PHASE.EMAIL_VERIFICATION_REQUIRED:
      return "REQUIRES_USER_INPUT";
    case URL_APPLY_PHASE.COMPLETED:
      return "DRY_RUN_COMPLETED";
    case URL_APPLY_PHASE.FAILED:
      return "FAILED";
    default:
      return "SELECTED";
  }
}

export function progressForPhase(phase) {
  switch (phase) {
    case URL_APPLY_PHASE.PENDING:
      return 8;
    case URL_APPLY_PHASE.FETCHING_JOB:
      return 18;
    case URL_APPLY_PHASE.JOB_ANALYZED:
      return 38;
    case URL_APPLY_PHASE.GENERATING_DOCUMENTS:
      return 58;
    case URL_APPLY_PHASE.READY_TO_APPLY:
      return 70;
    case URL_APPLY_PHASE.APPLYING:
    case URL_APPLY_PHASE.RUNNING:
      return 82;
    case URL_APPLY_PHASE.WAITING_FOR_USER:
    case URL_APPLY_PHASE.CAPTCHA_REQUIRED:
    case URL_APPLY_PHASE.INFORMATION_REQUIRED:
    case URL_APPLY_PHASE.LOGIN_REQUIRED:
    case URL_APPLY_PHASE.EMAIL_VERIFICATION_REQUIRED:
      return 90;
    case URL_APPLY_PHASE.COMPLETED:
    case URL_APPLY_PHASE.FAILED:
      return 100;
    default:
      return 8;
  }
}

export function phaseLabel(phase) {
  switch (phase) {
    case URL_APPLY_PHASE.PENDING:
      return "Queued";
    case URL_APPLY_PHASE.FETCHING_JOB:
      return "Reading the job posting";
    case URL_APPLY_PHASE.JOB_ANALYZED:
      return "Job analyzed";
    case URL_APPLY_PHASE.GENERATING_DOCUMENTS:
      return "Generating tailored documents";
    case URL_APPLY_PHASE.READY_TO_APPLY:
      return "Ready to apply";
    case URL_APPLY_PHASE.APPLYING:
    case URL_APPLY_PHASE.RUNNING:
      return "Running";
    case URL_APPLY_PHASE.WAITING_FOR_USER:
      return "Waiting for you";
    case URL_APPLY_PHASE.CAPTCHA_REQUIRED:
      return "CAPTCHA Required";
    case URL_APPLY_PHASE.INFORMATION_REQUIRED:
      return "Your input is required";
    case URL_APPLY_PHASE.LOGIN_REQUIRED:
      return "Sign-in required";
    case URL_APPLY_PHASE.EMAIL_VERIFICATION_REQUIRED:
      return "Email verification required";
    case URL_APPLY_PHASE.COMPLETED:
      return "Completed";
    case URL_APPLY_PHASE.FAILED:
      return "Failed";
    default:
      return String(phase || "Queued").replaceAll("_", " ");
  }
}

export function isTerminalPhase(phase) {
  return phase === URL_APPLY_PHASE.COMPLETED || phase === URL_APPLY_PHASE.FAILED;
}

export function isWaitingPhase(phase) {
  return (
    phase === URL_APPLY_PHASE.WAITING_FOR_USER ||
    phase === URL_APPLY_PHASE.CAPTCHA_REQUIRED ||
    phase === URL_APPLY_PHASE.INFORMATION_REQUIRED ||
    phase === URL_APPLY_PHASE.LOGIN_REQUIRED ||
    phase === URL_APPLY_PHASE.EMAIL_VERIFICATION_REQUIRED
  );
}

const ISSUE_CODES = (issues) =>
  (Array.isArray(issues) ? issues : []).map((issue) => String(issue?.code || issue?.level || "").toLowerCase());

export function classifyLiveOutcome(live = {}) {
  const issues = Array.isArray(live.issues) ? live.issues : [];
  const codes = ISSUE_CODES(issues);
  const blob = [live.message, ...issues.map((issue) => issue?.message || issue?.code || "")]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (codes.includes("captcha-present") || codes.includes("bot-challenge") || /\bcaptcha\b/.test(blob)) {
    return {
      phase: URL_APPLY_PHASE.CAPTCHA_REQUIRED,
      pauseReason: "CAPTCHA",
      message: live.message || "CAPTCHA is on this form — complete it in the application window. Nothing was submitted.",
    };
  }
  if (codes.some((code) => ["login-wall", "nav-google"].includes(code)) || /\b(sign in to apply|create (an )?account to apply|sign-in required)\b/.test(blob)) {
    return {
      phase: URL_APPLY_PHASE.LOGIN_REQUIRED,
      pauseReason: "LOGIN",
      message: live.message || "This listing needs you to sign in. We never invent a password. Nothing was submitted.",
    };
  }
  if (
    codes.includes("email-verification") ||
    /\b(verify your email|verification code|one[- ]time code|\botp\b|\bmfa\b|\b2fa\b|check your (email|inbox))\b/.test(blob)
  ) {
    return {
      phase: URL_APPLY_PHASE.EMAIL_VERIFICATION_REQUIRED,
      pauseReason: "EMAIL_VERIFICATION",
      message: live.message || "This employer needs email or MFA verification. Enter the code yourself in the application window.",
    };
  }
  if (codes.includes("expired") || /posting is closed|no longer accepting/.test(blob)) {
    return {
      phase: URL_APPLY_PHASE.FAILED,
      pauseReason: "EXPIRED",
      message: live.message || "This posting is closed.",
    };
  }
  if (Array.isArray(live.waitingFields) && live.waitingFields.length) {
    return {
      phase: URL_APPLY_PHASE.INFORMATION_REQUIRED,
      pauseReason: "INFORMATION_REQUIRED",
      message: live.message || "Some fields need you — we did not guess. Nothing was submitted.",
    };
  }
  if (Number(live.filledCount) > 0) {
    return {
      phase: URL_APPLY_PHASE.COMPLETED,
      pauseReason: "REVIEW",
      message: live.message || "Fields were filled. You still submit in the application window.",
    };
  }
  if (codes.some((code) => ["no-form", "listing-page"].includes(code))) {
    return {
      phase: URL_APPLY_PHASE.WAITING_FOR_USER,
      pauseReason: codes.includes("listing-page") ? "LISTING_PAGE" : "NO_FORM",
      message: live.message || "The application window is open. Continue the Apply form yourself — nothing was submitted.",
    };
  }
  return {
    phase: URL_APPLY_PHASE.WAITING_FOR_USER,
    pauseReason: "REVIEW",
    message: live.message || "The application window is open on this application. You still submit.",
  };
}

export function parseUrlApplyInputs(raw) {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out = [];
  for (const item of list) {
    if (typeof item === "string") {
      const url = String(item || "").trim();
      if (!url) continue;
      out.push({ url, company: "", role: "", jdText: "" });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const url = String(item.url || item.sourceUrl || item.source_url || "").trim();
    if (!url) continue;
    out.push({
      url,
      company: String(item.company || "").trim(),
      role: String(item.role || item.title || "").trim(),
      jdText: String(item.jdText || item.description || "").trim(),
    });
  }
  return out.slice(0, MAX_URL_APPLY_JOBS);
}

const BATCHES = (globalThis.__coUrlApplyBatches ??= new Map());

function getRawBatch(batchId) {
  restoreManagedBatches(BATCHES);
  return BATCHES.get(String(batchId || ""));
}

export function publicJob(job) {
  if (!job) return null;
  const fields = job.fields || { extracted: [], completed: [], pending: [] };
  return {
    id: job.id,
    index: job.index,
    url: job.url,
    company: job.company || "",
    role: job.role || "",
    phase: job.phase,
    dbState: job.dbState || phaseToQueueState(job.phase),
    progress: job.progress ?? progressForPhase(job.phase),
    message: job.message || phaseLabel(job.phase),
    label: phaseLabel(job.phase),
    error: job.error || null,
    logs: job.logs || [],
    issues: job.issues || [],
    fields: {
      extracted: fields.extracted || [],
      completed: fields.completed || [],
      pending: fields.pending || [],
      extractedCount: (fields.extracted || []).length,
      completedCount: (fields.completed || []).length,
      pendingCount: (fields.pending || []).length,
    },
    files: job.files || {},
    quality: job.quality || null,
    sessionId: job.sessionId || null,
    opportunityId: job.opportunityId || null,
    applicationId: job.applicationId || null,
    captcha: Boolean(job.captcha),
    stages: job.stages || [],
    waitingFields: job.waitingFields || [],
    snapshot: job.snapshot || null,
    actionRequired: isWaitingPhase(job.phase) ? buildActionRequiredCard(job) : null,
    currentStage: (job.stages || []).find((row) => row.status !== "complete")?.name || (job.stages || []).at(-1)?.name || phaseLabel(job.phase),
    preview: null,
    pauseReason: job.pauseReason || null,
    claimedBy: job.claimedBy || null,
    localChrome: job.claimedBy === "local-chrome" || job.pauseReason === "LOCAL_CHROME",
    qualityGate: job.qualityGate || null,
    errorClass: job.errorClass || null,
    tone: job.phase === URL_APPLY_PHASE.FAILED ? "failed" : job.phase === URL_APPLY_PHASE.COMPLETED ? "done" : isWaitingPhase(job.phase) ? "waiting" : "running",
    reviewPath: job.files?.reviewPath || null,
    descriptionPreview: String(job.description || "").slice(0, 280),
  };
}

export function publicBatch(batch) {
  if (!batch) return null;
  const jobs = (batch.jobs || []).map(publicJob);
  const running = jobs.filter((job) => !isTerminalPhase(job.phase) && !isWaitingPhase(job.phase)).length;
  return {
    id: batch.id,
    status: batch.status,
    createdAt: batch.createdAt,
    jobs,
    summary: {
      total: jobs.length,
      completed: jobs.filter((job) => job.phase === URL_APPLY_PHASE.COMPLETED).length,
      failed: jobs.filter((job) => job.phase === URL_APPLY_PHASE.FAILED).length,
      waiting: jobs.filter((job) => isWaitingPhase(job.phase)).length,
      running,
    },
  };
}

export function createUrlApplyBatch(inputs, { userId = "", tenantId = "" } = {}) {
  const parsed = parseUrlApplyInputs(inputs);
  if (!parsed.length) {
    const err = new Error("Add at least one job URL.");
    err.status = 400;
    throw err;
  }
  const batch = {
    id: `urlbatch-${crypto.randomUUID()}`,
    userId: String(userId || ""),
    tenantId: String(tenantId || ""),
    status: "running",
    createdAt: Date.now(),
    jobs: parsed.map((input, index) => ({
      id: `urljob-${crypto.randomUUID()}`,
      index: index + 1,
      url: input.url,
      company: input.company,
      role: input.role,
      jdText: input.jdText,
      phase: URL_APPLY_PHASE.PENDING,
      dbState: phaseToQueueState(URL_APPLY_PHASE.PENDING),
      progress: progressForPhase(URL_APPLY_PHASE.PENDING),
      message: "Application created",
      logs: [{ at: Date.now(), message: `Application #${index + 1} created` }],
      error: null,
      issues: [],
      fields: { extracted: [], completed: [], pending: [] },
      files: {},
      quality: null,
      documents: null,
      normalizedJob: null,
      sessionId: null,
      opportunityId: null,
      applicationId: null,
      captcha: false,
      description: "",
      pauseReason: null,
      stages: [],
      waitingFields: [],
      userAnswers: {},
      snapshot: null,
      notifiedPhase: null,
    })),
  };
  BATCHES.set(batch.id, batch);
  persistManagedBatches(BATCHES);
  return publicBatch(batch);
}

export function getUrlApplyBatch(batchId, { userId } = {}) {
  const batch = getRawBatch(batchId);
  if (!batch) return null;
  if (userId && batch.userId && batch.userId !== userId) return null;
  return publicBatch(batch);
}

export function updateUrlApplyJob(batchId, jobId, patch) {
  const batch = getRawBatch(batchId);
  if (!batch) return null;
  const job = batch.jobs.find((row) => row.id === jobId);
  if (!job) return null;
  const next = { ...job, ...patch };
  if (patch.phase) {
    next.dbState = patch.dbState || phaseToQueueState(patch.phase);
    if (patch.progress == null) next.progress = progressForPhase(patch.phase);
    if (!patch.message) next.message = phaseLabel(patch.phase);
  }
  if ((patch.phase === URL_APPLY_PHASE.RUNNING || next.phase === URL_APPLY_PHASE.RUNNING) && next.fields) {
    const extracted = (next.fields.extracted || []).length;
    const completed = (next.fields.completed || []).length;
    if (extracted > 0 && patch.progress == null) {
      next.progress = Math.min(99, 70 + Math.round((completed / extracted) * 29));
    }
  }
  if (patch.log) {
    next.logs = [...(job.logs || []), { at: Date.now(), message: String(patch.log) }];
    delete next.log;
  }
  const idx = batch.jobs.findIndex((row) => row.id === jobId);
  if (isWaitingPhase(next.phase)) {
    next.snapshot = buildHitlSnapshot(next, batch.id);
    saveHitlSnapshot(next, batch.id);
  }
  batch.jobs[idx] = next;
  persistManagedBatches(BATCHES);
  const allDone = batch.jobs.every((row) => isTerminalPhase(row.phase) || isWaitingPhase(row.phase));
  if (allDone) batch.status = "settled";
  return publicJob(next);
}

let chromeTail = Promise.resolve();

/** Opens may serialize; fills run at the same time on separate Chrome tabs. */
export function withChromeLock(fn) {
  return Promise.resolve().then(fn);
}

export function withSerializedChromeLock(fn) {
  const run = chromeTail.then(
    () => fn(),
    () => fn(),
  );
  chromeTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function fieldNames(steps = [], ok) {
  return (steps || [])
    .filter((step) => (ok == null ? true : Boolean(step.ok) === ok))
    .map((step) => String(step.label || step.fieldId || "").trim())
    .filter(Boolean);
}

async function persistPhase(job, deps = {}, extra = {}) {
  if (!job || typeof deps.persistApplicationState !== "function" || !job.applicationId) return;
  try {
    await deps.persistApplicationState(job, extra);
  } catch {
    /* queue persist is best-effort */
  }
}

function siblingCompanies(batchId, jobId) {
  const batch = getRawBatch(batchId);
  if (!batch) return [];
  return batch.jobs
    .filter((row) => row.id !== jobId)
    .map((row) => String(row.company || "").trim())
    .filter(Boolean);
}

function currentJob(batchId, jobId) {
  return getRawBatch(batchId)?.jobs?.find((row) => row.id === jobId) || null;
}

function bufferToBase64(buf) {
  if (!buf) return "";
  return Buffer.from(buf).toString("base64");
}

function packLocalChromePayload(deps = {}) {
  return {
    profile: deps.profile || null,
    cvText: deps.cvText || "",
    githubToken: deps.githubToken || "",
    originalFilename: deps.originalFilename || "",
    originalMime: deps.originalMime || "",
    originalBase64: bufferToBase64(deps.originalBuffer),
  };
}

function workPayload(batch, job, action, extra = {}) {
  const packed = job.localPayload || packLocalChromePayload(batch.deps || {});
  return {
    action,
    batchId: batch.id,
    jobId: job.id,
    url: job.url,
    company: job.company,
    role: job.role,
    description: job.description || job.jdText || "",
    documents: job.documents,
    files: {
      stem: job.files?.stem || "",
      cvName: job.files?.cvName || "",
      coverName: job.files?.coverName || "",
      cvPath: job.files?.cvPath || "",
      coverPath: job.files?.coverPath || "",
    },
    sessionId: job.sessionId || null,
    userAnswers: job.userAnswers || {},
    ...packed,
    ...extra,
  };
}

export function takeLocalChromeWork(userId, { busyJobId = "" } = {}) {
  restoreManagedBatches(BATCHES);
  const uid = String(userId || "");
  if (!uid) return null;
  for (const batch of BATCHES.values()) {
    if (String(batch.userId || "") !== uid) continue;
    for (const job of batch.jobs || []) {
      if (busyJobId && job.id !== busyJobId) continue;
      if (!job.pendingResume) continue;
      const resume = job.pendingResume;
      job.pendingResume = null;
      persistManagedBatches(BATCHES);
      return workPayload(batch, job, "continue", { resume });
    }
  }
  if (busyJobId) return null;
  for (const batch of BATCHES.values()) {
    if (String(batch.userId || "") !== uid) continue;
    for (const job of batch.jobs || []) {
      if (job.pauseReason !== "LOCAL_CHROME") continue;
      if (job.phase !== URL_APPLY_PHASE.WAITING_FOR_USER && job.phase !== URL_APPLY_PHASE.READY_TO_APPLY) continue;
      updateUrlApplyJob(batch.id, job.id, {
        phase: URL_APPLY_PHASE.RUNNING,
        claimedBy: "local-chrome",
        pauseReason: "LOCAL_CHROME",
        message: "Opening Chrome on your computer",
        log: "Opening Chrome on your computer",
      });
      return workPayload(batch, currentJob(batch.id, job.id), "fill");
    }
  }
  return null;
}

async function finalizeLiveFill(batchId, jobId, live, deps = {}) {
  const job = currentJob(batchId, jobId) || {};
  const patch = (partial) => updateUrlApplyJob(batchId, jobId, partial);
  const outcome = applyQualityToOutcome(job, live || {}, classifyLiveOutcome(live || {}));
  const steps = live?.steps || [];
  patch({
    phase: outcome.phase,
    pauseReason: outcome.pauseReason,
    message: outcome.message,
    error: outcome.phase === URL_APPLY_PHASE.FAILED ? outcome.message : null,
    captcha: outcome.phase === URL_APPLY_PHASE.CAPTCHA_REQUIRED,
    sessionId: live?.sessionId || job.sessionId || null,
    issues: live?.issues || [],
    stages: live?.stages || job.stages || [],
    waitingFields: live?.waitingFields || [],
    qualityGate: outcome.qualityGate || null,
    claimedBy: job.claimedBy || null,
    fields: {
      extracted: fieldNames(steps).length ? fieldNames(steps) : job.fields?.extracted || [],
      completed: fieldNames(steps, true).length ? fieldNames(steps, true) : job.fields?.completed || [],
      pending: fieldNames(steps, false).length ? fieldNames(steps, false) : job.fields?.pending || [],
    },
    files: {
      ...(job.files || {}),
      reviewPath: live?.reviewPath || job.files?.reviewPath,
      attachedAs: live?.attachedAs || null,
      cvPath: live?.cvPath || job.files?.cvPath || null,
      coverPath: live?.coverPath || job.files?.coverPath || null,
      cvName: job.files?.cvName,
      coverName: job.files?.coverName,
      job_id: jobId,
    },
    log: outcome.message,
  });
  await persistPhase(currentJob(batchId, jobId), deps, {
    reason: outcome.pauseReason,
    last_message: outcome.message,
    pause_reason: outcome.pauseReason,
  });
  notifyIfPaused(batchId, jobId, deps);
  notifyIfCompleted(batchId, jobId, deps);
  if (outcome.phase === URL_APPLY_PHASE.CAPTCHA_REQUIRED && deps.watchCaptcha !== false) {
    scheduleCaptchaWatch(batchId, jobId, deps);
  }
  return getUrlApplyBatch(batchId);
}

export async function applyLocalChromeLiveResult(userId, batchId, jobId, live) {
  const batch = getRawBatch(batchId);
  if (!batch || String(batch.userId || "") !== String(userId || "")) return null;
  if (!currentJob(batchId, jobId)) return null;
  return finalizeLiveFill(batchId, jobId, live, { ...(batch.deps || {}), watchCaptcha: false });
}

async function waitForLocalChromeFill(batchId, jobId, deps = {}) {
  const job = currentJob(batchId, jobId);
  if (!job) return null;
  const patch = (partial) => updateUrlApplyJob(batchId, jobId, partial);
  if (job.pauseReason !== "LOCAL_CHROME") {
    patch({
      phase: URL_APPLY_PHASE.WAITING_FOR_USER,
      pauseReason: "LOCAL_CHROME",
      claimedBy: null,
      message: "Start Chrome on this computer — a real window will open so you can solve CAPTCHAs.",
      log: "Waiting for Chrome on your computer",
      localPayload: packLocalChromePayload(deps),
    });
  }
  const sleep = deps.sleepFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + (deps.localChromeWaitMs || 45 * 60 * 1000);
  while (Date.now() < deadline) {
    const latest = currentJob(batchId, jobId);
    if (!latest) return getUrlApplyBatch(batchId);
    if (isTerminalPhase(latest.phase)) return getUrlApplyBatch(batchId);
    if (isWaitingPhase(latest.phase) && latest.pauseReason !== "LOCAL_CHROME") {
      return getUrlApplyBatch(batchId);
    }
    await sleep(deps.localChromePollMs || 1000);
  }
  patch({
    phase: URL_APPLY_PHASE.FAILED,
    error: "Chrome on your computer did not connect. In the StudentCareer AI folder run: npm run apply:chrome",
    log: "Local Chrome helper did not connect",
  });
  return getUrlApplyBatch(batchId);
}

export async function extractUrlApplyJob(batchId, jobId, deps = {}) {
  const job = currentJob(batchId, jobId);
  if (!job) return null;
  const patch = (partial) => updateUrlApplyJob(batchId, jobId, partial);
  const extractJob = deps.extractExternalJob;
  const normalize = deps.normalizeApplyUrl || ((value) => String(value || "").trim());
  const guess = deps.guessListingFromUrl || (() => ({ company: "", role: "" }));
  const listingUrl = deps.listingUrl || {};

  patch({
    phase: URL_APPLY_PHASE.FETCHING_JOB,
    log: "Fetching job information",
  });

  let url = normalize(job.url);
  if (!/^https?:\/\//i.test(url)) {
    patch({
      phase: URL_APPLY_PHASE.FAILED,
      error: "Paste a full job URL (https://…).",
      log: "Invalid URL",
    });
    return getUrlApplyBatch(batchId);
  }

  if (typeof listingUrl.isUnresolvedAggregatorUrl === "function" && listingUrl.isUnresolvedAggregatorUrl(url)) {
    if (typeof listingUrl.resolveListingUrl === "function") {
      url = await listingUrl.resolveListingUrl(url);
    }
  }
  if (typeof listingUrl.isCredibleListingUrl === "function" && !listingUrl.isCredibleListingUrl(url)) {
    patch({
      phase: URL_APPLY_PHASE.FAILED,
      error: "This listing does not have a real job URL.",
      url,
      log: "Rejected non-job URL",
    });
    return getUrlApplyBatch(batchId);
  }

  patch({ url, log: "Extracting company, role, and description" });
  const extracted = await extractJob({
    url,
    pastedDescription: job.jdText,
    companyHint: job.company,
    roleHint: job.role,
  });
  let company = extracted?.job?.company || job.company;
  let role = extracted?.job?.title || extracted?.job?.role || job.role;
  let jdText = extracted?.job?.description || job.jdText || "";
  if (!company || !role) {
    const guessed = guess(url);
    company = company || guessed.company;
    role = role || guessed.role;
  }

  patch({
    company,
    role,
    description: jdText,
    url,
    normalizedJob: extracted?.job || null,
    phase: URL_APPLY_PHASE.JOB_ANALYZED,
    log: `Analyzed ${company || "company"} — ${role || "role"}`,
  });

  if (!extracted?.hasDescription) {
    patch({
      phase: URL_APPLY_PHASE.INFORMATION_REQUIRED,
      error:
        extracted?.warning ||
        "Unable to extract the full job description. Paste it to generate a tailored CV.",
      log: "Waiting for job description",
    });
    await persistPhase(currentJob(batchId, jobId), deps, { reason: "INFORMATION_REQUIRED" });
    return getUrlApplyBatch(batchId);
  }

  if (typeof deps.persistOpportunity === "function") {
    try {
      const persisted = await deps.persistOpportunity({ url, company, role, jdText, job: extracted.job });
      if (persisted?.opportunityId) patch({ opportunityId: persisted.opportunityId });
      if (persisted?.applicationId) patch({ applicationId: persisted.applicationId });
    } catch {
      /* persist is secondary */
    }
  }
  return getUrlApplyBatch(batchId);
}

export async function generateUrlApplyDocuments(batchId, jobId, deps = {}) {
  const job = currentJob(batchId, jobId);
  if (!job || job.phase === URL_APPLY_PHASE.FAILED) {
    return getUrlApplyBatch(batchId);
  }
  if (job.phase === URL_APPLY_PHASE.INFORMATION_REQUIRED && !job.description && !job.jdText) {
    return getUrlApplyBatch(batchId);
  }
  const patch = (partial) => updateUrlApplyJob(batchId, jobId, partial);
  patch({
    phase: URL_APPLY_PHASE.GENERATING_DOCUMENTS,
    log: "Generating tailored CV and cover letter from the existing engine",
  });
  await persistPhase(currentJob(batchId, jobId), deps);

  const generate = deps.generateJobDocuments || generateJobDocuments;
  const pack = await generate({
    jobId,
    job: {
      ...(job.normalizedJob || {}),
      company: job.company,
      title: job.role,
      role: job.role,
      description: job.description,
      url: job.url,
    },
    profile: deps.profile,
    masterCv: deps.cvText,
    foreignCompanies: siblingCompanies(batchId, jobId),
    matchingConfig: deps.matchingConfig,
    callAIFn: deps.callAIFn,
    root: deps.root,
    loaders: deps.loaders,
    tailorDocuments: deps.tailorUrlApplyDocuments,
    originalBuffer: deps.originalBuffer || null,
    originalFilename: deps.originalFilename || "",
    originalMime: deps.originalMime || "",
    githubProjects: deps.githubProjects || [],
    fetchGitHubEvidence: deps.fetchGitHubEvidence || null,
    githubToken: deps.githubToken || "",
  });

  const quality = pack?.quality || { ok: false, checks: [] };
  const leak = (quality.leaked || []).length > 0;
  if (leak || !pack?.usedExistingEngine || !quality.ok) {
    const reason = leak
      ? `Rejected documents: another company's name leaked (${(quality.leaked || []).join(", ")})`
      : quality.checks?.find((c) => !c.ok)?.detail || "Document quality check failed";
    if (leak || !pack?.coverLetter || !pack?.cvText) {
      patch({
        phase: URL_APPLY_PHASE.FAILED,
        error: reason,
        quality,
        files: pack?.files || {},
        log: reason,
      });
      await persistPhase(currentJob(batchId, jobId), deps, { reason });
      return getUrlApplyBatch(batchId);
    }
  }

  const reviewPath = `/apply/review?company=${encodeURIComponent(job.company || "")}&role=${encodeURIComponent(job.role || "")}&job=${encodeURIComponent(jobId)}`;
  patch({
    phase: URL_APPLY_PHASE.READY_TO_APPLY,
    documents: {
      cvText: pack.cvText,
      cvHtml: pack.cvHtml,
      coverLetter: pack.coverLetter,
      coverHtml: pack.coverHtml,
    },
    files: {
      ...pack.files,
      reviewPath,
      cvName: pack.files?.cvName,
      coverName: pack.files?.coverName,
      job_id: jobId,
    },
    quality,
    log: `Saved ${pack.files?.cvName} and ${pack.files?.coverName}`,
  });
  return getUrlApplyBatch(batchId);
}

export async function fillUrlApplyJob(batchId, jobId, deps = {}) {
  const job = currentJob(batchId, jobId);
  if (!job || job.phase === URL_APPLY_PHASE.FAILED) {
    return getUrlApplyBatch(batchId);
  }
  if (isWaitingPhase(job.phase) && job.pauseReason !== "LOCAL_CHROME") {
    return getUrlApplyBatch(batchId);
  }
  if (!job.documents && !job.description) {
    return getUrlApplyBatch(batchId);
  }
  if (deps.useLocalChrome) {
    return waitForLocalChromeFill(batchId, jobId, deps);
  }
  const patch = (partial) => updateUrlApplyJob(batchId, jobId, partial);
  const liveApply = deps.runStudentCareerLiveApply;
  const lock = deps.withChromeLock || withChromeLock;

  patch({
    phase: URL_APPLY_PHASE.RUNNING,
    log: "Opening a Chrome tab and filling attested fields (never submitting)",
  });
  await persistPhase(currentJob(batchId, jobId), deps);

  const live = await lock(() =>
    liveApply({
      url: job.url,
      profile: deps.profile,
      company: job.company,
      cvText: deps.cvText,
      role: job.role,
      jdText: job.description,
      prebuiltDocuments: job.documents,
      artifactKey: job.id,
      artifactStem: job.files?.stem,
      useFormAgent: true,
      originalBuffer: deps.originalBuffer,
      originalFilename: deps.originalFilename || "",
      originalMime: deps.originalMime || "",
      fetchGitHubEvidence: deps.fetchGitHubEvidence,
      githubToken: deps.githubToken || "",
      onSessionOpen: (sessionId) => {
        patch({
          sessionId,
          phase: URL_APPLY_PHASE.RUNNING,
          log: "Chrome tab opened — filling empty fields",
        });
      },
      onFillProgress: (info) => {
        const extracted = info?.extracted || [];
        const completed = info?.completed || [];
        const pending = info?.pending || [];
        const prev = currentJob(batchId, jobId);
        const grew = completed.length !== (prev?.fields?.completed || []).length;
        patch({
          phase: URL_APPLY_PHASE.RUNNING,
          sessionId: info?.sessionId || prev?.sessionId,
          fields: { extracted, completed, pending },
          ...(grew ? { log: info?.log || `Filled ${completed.length} field${completed.length === 1 ? "" : "s"}` } : {}),
        });
      },
    }),
  );

  return finalizeLiveFill(batchId, jobId, live, deps);
}

function notifyIfPaused(batchId, jobId, deps = {}) {
  const batch = getRawBatch(batchId);
  const job = currentJob(batchId, jobId);
  if (!batch || !job || !isWaitingPhase(job.phase)) return;
  if (job.notifiedPhase === job.phase) return;
  updateUrlApplyJob(batchId, jobId, { notifiedPhase: job.phase });
  const hub = deps.notifyHub || applyNotificationHub();
  const card = buildActionRequiredCard(job);
  const email = formatActionRequiredEmail(job);
  void hub.notify(
    {
      kind: card.kind,
      title: email.subject,
      body: email.body,
      heading: card.heading,
      jobId: job.id,
      batchId,
      metadata: { phase: job.phase, url: job.url, pauseReason: job.pauseReason, progress: job.progress },
    },
    { userId: batch.userId, tenantId: batch.tenantId },
  );
}

function notifyIfCompleted(batchId, jobId, deps = {}) {
  const batch = getRawBatch(batchId);
  const job = currentJob(batchId, jobId);
  if (!batch || !job || job.phase !== URL_APPLY_PHASE.COMPLETED) return;
  if (job.notifiedPhase === URL_APPLY_PHASE.COMPLETED) return;
  updateUrlApplyJob(batchId, jobId, { notifiedPhase: URL_APPLY_PHASE.COMPLETED });
  const hub = deps.notifyHub || applyNotificationHub();
  const email = formatCompletionEmail(job);
  void hub.notify(
    {
      kind: email.kind,
      title: email.subject,
      body: email.body,
      heading: `${job.role} — ${job.company}`,
      jobId: job.id,
      batchId,
      metadata: { phase: job.phase, url: job.url, progress: 100 },
    },
    { userId: batch.userId, tenantId: batch.tenantId },
  );
}

function scheduleCaptchaWatch(batchId, jobId, deps = {}) {
  if (deps.watchCaptcha === false) return;
  const job = currentJob(batchId, jobId);
  if (!job?.sessionId) return;
  const stillBlocked =
    typeof deps.captchaStillPresent === "function"
      ? () => deps.captchaStillPresent(job.sessionId)
      : null;
  if (!stillBlocked) return;
  const isUsable = typeof deps.sessionUsable === "function" ? () => deps.sessionUsable(job.sessionId) : undefined;
  void waitUntilHumanChallengeCleared({
    stillBlocked,
    isUsable,
    intervalMs: deps.captchaPollMs || 4000,
    timeoutMs: deps.captchaTimeoutMs || 20 * 60 * 1000,
    sleepFn: deps.sleepFn,
  }).then((result) => {
    if (!result?.cleared) return;
    const latest = currentJob(batchId, jobId);
    if (!latest || latest.phase !== URL_APPLY_PHASE.CAPTCHA_REQUIRED) return;
    return resumeUrlApplyJob(batchId, jobId, { captchaCleared: true }, deps);
  });
}

export async function openUrlApplySession(batchId, jobId, deps = {}) {
  const job = currentJob(batchId, jobId);
  if (!job) return null;
  const merged = { ...(getRawBatch(batchId)?.deps || {}), ...deps };
  let focused = false;
  if (job.sessionId && typeof merged.focusSession === "function") {
    await merged.focusSession(job.sessionId).catch(() => {});
    focused = true;
  }
  return { ok: true, url: job.url, sessionId: job.sessionId, focused };
}

export async function resumeUrlApplyJob(batchId, jobId, resolution = {}, deps = {}) {
  const batch = getRawBatch(batchId);
  const merged = { ...(batch?.deps || {}), ...deps };
  const job = currentJob(batchId, jobId);
  if (!job) return null;
  const patch = (partial) => updateUrlApplyJob(batchId, jobId, partial);
  const local = Boolean(merged.useLocalChrome || job.claimedBy === "local-chrome" || job.pauseReason === "LOCAL_CHROME");

  if (resolution.jdText) {
    patch({
      jdText: resolution.jdText,
      description: resolution.jdText,
      phase: URL_APPLY_PHASE.JOB_ANALYZED,
      error: null,
      log: "Job description provided",
    });
    await generateUrlApplyDocuments(batchId, jobId, merged);
    await fillUrlApplyJob(batchId, jobId, merged);
    return getUrlApplyBatch(batchId);
  }

  if (job.phase === URL_APPLY_PHASE.COMPLETED) {
    return getUrlApplyBatch(batchId);
  }

  const indexed = indexUserAnswers(resolution.answers || job.userAnswers);
  if (indexed.list.length) {
    patch({
      userAnswers: { ...(job.userAnswers || {}), ...indexed.byId },
      log: "Saved your answer",
    });
  }

  if (local) {
    patch({
      pendingResume: {
        captchaCleared: Boolean(resolution.captchaCleared),
        answers: resolution.answers || [],
      },
      message: resolution.captchaCleared
        ? "Continuing in the application window"
        : "Sent to the application window",
      log: "Resume queued for the application window",
    });
    return getUrlApplyBatch(batchId);
  }

  if (job.phase === URL_APPLY_PHASE.CAPTCHA_REQUIRED && job.sessionId && typeof merged.captchaStillPresent === "function") {
    const still = await merged.captchaStillPresent(job.sessionId);
    if (still && resolution.captchaCleared !== true) {
      patch({
        message: "CAPTCHA is still on the page. Complete it in the application window — we will not bypass it.",
        log: "CAPTCHA still present",
      });
      return getUrlApplyBatch(batchId);
    }
  }

  const continueFn = merged.continueLiveApply || merged.runStudentCareerLiveApply;
  if (typeof continueFn !== "function") {
    patch({ message: "Saved. Open Chrome to continue.", log: "No live session to resume" });
    return getUrlApplyBatch(batchId);
  }

  patch({
    phase: URL_APPLY_PHASE.RUNNING,
    error: null,
    log: "Resuming from saved application state",
  });
  const lock = merged.withChromeLock || withChromeLock;
  const live = await lock(() =>
    continueFn({
      sessionId: job.sessionId,
      url: job.url,
      profile: merged.profile,
      company: job.company,
      cvText: merged.cvText,
      role: job.role,
      jdText: job.description,
      prebuiltDocuments: job.documents,
      artifactKey: job.id,
      artifactStem: job.files?.stem,
      userAnswers: indexed,
      cvPath: job.files?.cvPath,
      coverPath: job.files?.coverPath,
      useFormAgent: true,
      onFillProgress: (info) => {
        const extracted = info?.extracted || [];
        const completed = info?.completed || [];
        const pending = info?.pending || [];
        const prev = currentJob(batchId, jobId);
        const grew = completed.length !== (prev?.fields?.completed || []).length;
        patch({
          phase: URL_APPLY_PHASE.RUNNING,
          sessionId: info?.sessionId || job.sessionId,
          fields: { extracted, completed, pending },
          ...(grew ? { log: info?.log || `Filled ${completed.length} field${completed.length === 1 ? "" : "s"}` } : {}),
        });
      },
    }),
  );
  const outcome = applyQualityToOutcome(currentJob(batchId, jobId) || job, live || {}, classifyLiveOutcome(live || {}));
  const steps = live?.steps || [];
  patch({
    phase: outcome.phase,
    pauseReason: outcome.pauseReason,
    message: outcome.message,
    error: outcome.phase === URL_APPLY_PHASE.FAILED ? outcome.message : null,
    captcha: outcome.phase === URL_APPLY_PHASE.CAPTCHA_REQUIRED,
    sessionId: live?.sessionId || job.sessionId,
    issues: live?.issues || [],
    stages: live?.stages || job.stages || [],
    waitingFields: live?.waitingFields || [],
    qualityGate: outcome.qualityGate || null,
    fields: {
      extracted: fieldNames(steps).length ? fieldNames(steps) : job.fields?.extracted || [],
      completed: fieldNames(steps, true).length ? fieldNames(steps, true) : job.fields?.completed || [],
      pending: fieldNames(steps, false),
    },
    log: outcome.message,
  });
  await persistPhase(currentJob(batchId, jobId), merged, {
    reason: outcome.pauseReason,
    last_message: outcome.message,
    pause_reason: outcome.pauseReason,
  });
  notifyIfPaused(batchId, jobId, merged);
  notifyIfCompleted(batchId, jobId, merged);
  if (outcome.phase === URL_APPLY_PHASE.CAPTCHA_REQUIRED) {
    scheduleCaptchaWatch(batchId, jobId, merged);
  }
  return getUrlApplyBatch(batchId);
}

/**
 * Run one URL through extract → isolated documents → live-fill.
 * Callers inject engines so this file does not rewrite them.
 */
export async function runIndependentUrlApplyJob(batchId, jobId, deps = {}) {
  if (!currentJob(batchId, jobId)) return null;
  try {
    await extractUrlApplyJob(batchId, jobId, deps);
    await generateUrlApplyDocuments(batchId, jobId, deps);
    await fillUrlApplyJob(batchId, jobId, deps);
  } catch (err) {
    const message = err instanceof Error ? err.message : "This application failed.";
    updateUrlApplyJob(batchId, jobId, {
      phase: URL_APPLY_PHASE.FAILED,
      error: message,
      log: message,
    });
    await persistPhase(currentJob(batchId, jobId), deps, { reason: message });
  }
  return getUrlApplyBatch(batchId);
}

/**
 * Extract all jobs (so sibling company names exist for isolation), then
 * generate documents and fill Chrome per job in parallel. A job starts filling
 * as soon as its own documents are ready — it does not wait for siblings.
 * One headed Chrome tab per URL. A thrown job never rejects the batch.
 */
export async function runUrlApplyBatch(batchId, deps = {}) {
  const batch = getRawBatch(batchId);
  if (!batch) return null;
  batch.deps = deps;
  const extractMs = deps.extractTimeoutMs || 45000;
  const generateMs = deps.generateTimeoutMs || 90000;
  const fillMs = deps.fillTimeoutMs || 45 * 60 * 1000;
  const attempts = deps.retryAttempts == null ? 2 : deps.retryAttempts;
  const runJobStep = async (jobId, label, fn, ms) => {
    const stepAttempts = /fill|apply/i.test(label) ? 1 : attempts;
    try {
      await withRetry(
        () => withTimeout(() => fn(), ms, label),
        { attempts: stepAttempts, delayMs: deps.retryDelayMs || 300, sleepFn: deps.sleepFn },
      );
    } catch (err) {
      const classified = classifyApplyError(err);
      updateUrlApplyJob(batchId, jobId, {
        phase: URL_APPLY_PHASE.FAILED,
        error: classified.message,
        errorClass: classified.class,
        log: `${label} failed (${classified.class})`,
      });
    }
  };
  await Promise.allSettled(
    batch.jobs.map((job) => runJobStep(job.id, "Fetch job", () => extractUrlApplyJob(batchId, job.id, deps), extractMs)),
  );
  await Promise.allSettled(
    batch.jobs.map((job) =>
      runJobStep(
        job.id,
        "Generate and fill",
        async () => {
          await generateUrlApplyDocuments(batchId, job.id, deps);
          await fillUrlApplyJob(batchId, job.id, deps);
        },
        generateMs + fillMs,
      ),
    ),
  );
  const latest = getRawBatch(batchId);
  if (latest) latest.status = "settled";
  persistManagedBatches(BATCHES);
  return getUrlApplyBatch(batchId);
}

export function resetUrlApplyBatchesForTests() {
  BATCHES.clear();
  chromeTail = Promise.resolve();
  resetManagedBatchHydration();
}
