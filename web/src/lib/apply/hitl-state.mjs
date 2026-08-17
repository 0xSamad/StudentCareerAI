/**
 * Persistent pause/resume snapshots for URL applications.
 * Does not store secrets. CAPTCHA is recorded as a pause, never solved.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const STORE = (globalThis.__coHitlSnapshots ??= new Map());
let PERSIST_PATH = "";

export function setHitlPersistPath(filePath = "") {
  PERSIST_PATH = String(filePath || "");
}

export function loadHitlPersist() {
  if (!PERSIST_PATH || !existsSync(PERSIST_PATH)) return;
  try {
    const data = JSON.parse(readFileSync(PERSIST_PATH, "utf8"));
    if (!data || typeof data !== "object") return;
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object") STORE.set(key, value);
    }
  } catch {
    /* ignore corrupt cache */
  }
}

function saveHitlPersist() {
  if (!PERSIST_PATH) return;
  try {
    mkdirSync(dirname(PERSIST_PATH), { recursive: true });
    writeFileSync(PERSIST_PATH, JSON.stringify(Object.fromEntries(STORE), null, 2));
  } catch {
    /* disk is optional */
  }
}

export function snapshotKey(job = {}, batchId = "") {
  return String(job.applicationId || job.id || `${batchId}:${job.url || ""}`);
}

export function buildHitlSnapshot(job = {}, batchId = "") {
  const stages = Array.isArray(job.stages) ? job.stages : [];
  const current = stages.find((row) => row.status !== "complete") || stages[stages.length - 1] || null;
  return {
    applicationId: job.applicationId || job.id,
    jobId: job.id,
    batchId,
    currentStage: current?.name || job.phase || "",
    currentUrl: job.url || "",
    completedStages: stages.filter((row) => row.status === "complete").map((row) => row.name),
    completedFields: job.fields?.completed || [],
    pendingFields: (job.waitingFields || []).map((row) => ({
      fieldId: row.fieldId,
      label: row.label,
      reason: row.reason || "",
    })),
    generatedCV: job.files?.cvName || job.files?.cvPath || null,
    generatedCoverLetter: job.files?.coverName || job.files?.coverPath || null,
    status: job.phase,
    sessionId: job.sessionId || null,
    pauseReason: job.pauseReason || null,
    userAnswers: job.userAnswers || {},
    savedAt: new Date().toISOString(),
  };
}

export function saveHitlSnapshot(job, batchId = "") {
  if (!job?.id) return null;
  const snap = buildHitlSnapshot(job, batchId);
  STORE.set(snapshotKey(job, batchId), snap);
  saveHitlPersist();
  return snap;
}

export function getHitlSnapshot(job, batchId = "") {
  return STORE.get(snapshotKey(job, batchId)) || null;
}

export function indexUserAnswers(raw) {
  const byId = {};
  const byLabel = {};
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? Object.entries(raw).map(([fieldId, value]) => ({ fieldId, value }))
      : [];
  for (const row of list) {
    if (!row || row.value == null || String(row.value).trim() === "") continue;
    const value = String(row.value).trim();
    if (row.fieldId) byId[String(row.fieldId)] = value;
    if (row.label) byLabel[String(row.label).trim().toLowerCase()] = value;
  }
  return { byId, byLabel, list };
}

/**
 * Poll until the human challenge is gone. Never clicks the widget.
 * `stillBlocked` should only observe the page (captcha iframe still visible).
 */
export async function waitUntilHumanChallengeCleared({
  stillBlocked,
  isUsable,
  intervalMs = 4000,
  timeoutMs = 20 * 60 * 1000,
  sleepFn,
} = {}) {
  if (typeof stillBlocked !== "function") {
    return { cleared: false, reason: "no-observer" };
  }
  const sleep = sleepFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const blocked = await stillBlocked();
    if (!blocked) {
      const usable = typeof isUsable === "function" ? await isUsable() : true;
      return { cleared: true, usable: Boolean(usable) };
    }
    await sleep(intervalMs);
  }
  return { cleared: false, reason: "timeout" };
}

export function resetHitlStateForTests() {
  STORE.clear();
  PERSIST_PATH = "";
}
