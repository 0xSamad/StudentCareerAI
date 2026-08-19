"use client";

export const APPLY_CENTER_ID = "application-center";
export const APPLY_BATCH_EVENT = "sc:apply-batch";
const APPLY_BATCH_ID_KEY = "sc:apply-batch-id";

export function adoptApplyBatch(batch: { id?: string } | null | undefined) {
  if (!batch?.id || typeof window === "undefined") return;
  try {
    sessionStorage.setItem(APPLY_BATCH_ID_KEY, batch.id);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new CustomEvent(APPLY_BATCH_EVENT, { detail: batch }));
  window.setTimeout(() => {
    document.getElementById(APPLY_CENTER_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 200);
}

export function readAdoptedApplyBatchId() {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(APPLY_BATCH_ID_KEY) || "";
  } catch {
    return "";
  }
}
