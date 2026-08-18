/**
 * Application Manager — integration helpers around the existing URL-apply pipeline.
 * Does not replace in-app Apply, tailorCV, generateCoverLetter, or fillSession.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function withTimeout(fn, ms, label = "operation") {
  const budget = Math.max(50, Number(ms) || 0);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${budget}ms`)), budget);
    Promise.resolve()
      .then(fn)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export async function withRetry(fn, { attempts = 2, delayMs = 250, sleepFn } = {}) {
  const sleep = sleepFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let last;
  for (let i = 0; i < Math.max(1, attempts); i++) {
    try {
      return await fn(i);
    } catch (err) {
      last = err;
      const classified = classifyApplyError(err);
      if (!classified.retryable || i === attempts - 1) throw err;
      await sleep(delayMs);
    }
  }
  throw last;
}

export function classifyApplyError(err) {
  const message = err instanceof Error ? err.message : String(err || "");
  const blob = message.toLowerCase();
  if (/timed out/.test(blob)) return { class: "TIMEOUT", retryable: true, message };
  if (/econnreset|enotfound|etimedout|network|fetch failed|socket/.test(blob)) {
    return { class: "NETWORK", retryable: true, message };
  }
  if (/captcha|bot-challenge/.test(blob)) return { class: "CAPTCHA", retryable: false, message };
  if (/invalid url|not a real job/.test(blob)) return { class: "INVALID_URL", retryable: false, message };
  return { class: "UNKNOWN", retryable: true, message };
}

function includesToken(hay, value) {
  const token = String(value || "").trim().toLowerCase();
  if (!token) return false;
  return String(hay || "").toLowerCase().includes(token);
}

/**
 * Final checklist before COMPLETED. Never auto-submits.
 * Failures keep the job waiting/reviewing instead of claiming success.
 */
export function qualityGateApplication(job = {}, live = {}) {
  const company = String(job.company || live.company || "").trim();
  const role = String(job.role || live.role || "").trim();
  const cv = `${job.documents?.cvText || ""} ${job.files?.cvName || ""}`;
  const cover = `${job.documents?.coverLetter || ""} ${job.files?.coverName || ""}`;
  const waiting = Array.isArray(live.waitingFields) ? live.waitingFields : job.waitingFields || [];
  const requiredWaiting = waiting.filter((row) => row?.required || /required/i.test(row?.reason || ""));
  const issues = Array.isArray(live.issues) ? live.issues : job.issues || [];
  const captcha = Boolean(job.captcha) || issues.some((issue) => /captcha/i.test(`${issue?.code || ""} ${issue?.message || ""}`));
  const checks = [
    { id: "company", ok: Boolean(company), detail: company || "Company missing" },
    { id: "role", ok: Boolean(role), detail: role || "Role missing" },
    { id: "cv", ok: Boolean(String(job.documents?.cvText || job.files?.cvName || "").trim()), detail: job.files?.cvName || "Tailored CV missing" },
    { id: "cover", ok: Boolean(String(job.documents?.coverLetter || job.files?.coverName || "").trim()), detail: job.files?.coverName || "Cover letter missing" },
    { id: "cv-company", ok: !company || includesToken(cv, company), detail: "CV matches company" },
    { id: "cover-company", ok: !company || includesToken(cover, company), detail: "Cover letter matches company" },
    { id: "files", ok: Boolean(job.files?.cvName || live.cvPath), detail: "CV file attached" },
    { id: "required-fields", ok: requiredWaiting.length === 0, detail: requiredWaiting[0]?.label || "Required fields handled" },
    { id: "no-captcha", ok: !captcha, detail: captcha ? "CAPTCHA still outstanding" : "No CAPTCHA outstanding" },
    { id: "no-user-action", ok: waiting.length === 0, detail: waiting[0]?.label || "No user action outstanding" },
  ];
  return {
    ok: checks.every((check) => check.ok),
    checks,
    failed: checks.filter((check) => !check.ok),
  };
}

export function applyQualityToOutcome(job, live, outcome) {
  if (!outcome || outcome.phase !== "COMPLETED") return { ...outcome, qualityGate: null };
  const gate = qualityGateApplication(job, live);
  if (gate.ok) return { ...outcome, qualityGate: gate, submitted: false };
  return {
    phase: "WAITING_FOR_USER",
    pauseReason: "QUALITY",
    message: `Review needed: ${gate.failed[0]?.detail || "quality check"}. Nothing was submitted.`,
    qualityGate: gate,
  };
}

export function formatActionRequiredEmail(job = {}) {
  const company = job.company || "this company";
  const role = job.role || "this role";
  const reason =
    job.phase === "CAPTCHA_REQUIRED"
      ? "CAPTCHA required."
      : job.phase === "INFORMATION_REQUIRED"
        ? job.waitingFields?.[0]?.label
          ? `Information required: ${job.waitingFields[0].label}`
          : "Information required."
        : job.phase === "LOGIN_REQUIRED"
          ? "Sign-in required."
          : job.phase === "EMAIL_VERIFICATION_REQUIRED"
            ? "Email verification required."
            : job.message || "Your attention is required.";
  const progress = job.progress ?? 0;
  return {
    subject: "StudentCareer AI — Action Required",
    body: [
      "Your application for:",
      "",
      `${role} — ${company}`,
      "",
      "requires your attention.",
      "",
      "Reason:",
      reason,
      "",
      "Completed:",
      `${progress}%`,
      "",
      "[Open Application]",
      job.url || "",
      "",
      "Nothing was submitted.",
    ].join("\n"),
    kind: "action_required",
  };
}

export function formatCompletionEmail(job = {}) {
  const company = job.company || "this company";
  const role = job.role || "this role";
  return {
    subject: "StudentCareer AI — Application Completed",
    body: [
      "Your application for:",
      "",
      `${role} — ${company}`,
      "",
      "has been completed.",
      "",
      "Fields were filled from your verified profile. You still submit in Chrome if you want to send it.",
    ].join("\n"),
    kind: "application_completed",
  };
}

let BATCH_PERSIST = "";
let BATCHES_HYDRATED = false;

export function setBatchPersistPath(filePath = "") {
  BATCH_PERSIST = String(filePath || "");
  BATCHES_HYDRATED = false;
}

function serializableBatch(batch) {
  return {
    id: batch.id,
    userId: batch.userId,
    tenantId: batch.tenantId,
    status: batch.status,
    createdAt: batch.createdAt,
    jobs: (batch.jobs || []).map((job) => ({
      ...job,
      preview: undefined,
      documents: job.documents
        ? {
            cvText: String(job.documents.cvText || "").slice(0, 40000),
            cvHtml: String(job.documents.cvHtml || "").slice(0, 40000),
            coverLetter: String(job.documents.coverLetter || "").slice(0, 20000),
            coverHtml: String(job.documents.coverHtml || "").slice(0, 20000),
          }
        : null,
    })),
  };
}

export function persistManagedBatches(batches) {
  if (!BATCH_PERSIST) return;
  try {
    mkdirSync(dirname(BATCH_PERSIST), { recursive: true });
    const rows = [...batches.values()].map(serializableBatch);
    writeFileSync(BATCH_PERSIST, JSON.stringify(rows, null, 2));
  } catch {
    /* optional */
  }
}

export function resetManagedBatchHydration() {
  BATCHES_HYDRATED = false;
}

export function restoreManagedBatches(batches) {
  if (BATCHES_HYDRATED || !BATCH_PERSIST || !existsSync(BATCH_PERSIST)) return 0;
  BATCHES_HYDRATED = true;
  try {
    const rows = JSON.parse(readFileSync(BATCH_PERSIST, "utf8"));
    if (!Array.isArray(rows)) return 0;
    let n = 0;
    for (const row of rows) {
      if (!row?.id || batches.has(row.id)) continue;
      batches.set(row.id, { ...row, deps: null });
      n += 1;
    }
    return n;
  } catch {
    return 0;
  }
}
