"use client";

export const APPLY_WATCH_NAME = "scai-apply-window";
export const APPLY_WATCH_FEATURES =
  "popup=yes,width=1320,height=900,menubar=no,toolbar=no,location=no,status=no";

export function openBlankApplyWatchWindow() {
  const watcher = window.open("about:blank", APPLY_WATCH_NAME, APPLY_WATCH_FEATURES);
  if (watcher) {
    try {
      watcher.document.write(
        "<title>StudentCareer AI</title><p style='font-family:sans-serif;padding:24px'>Opening the application window…</p>",
      );
    } catch {
      /* popup document may be locked */
    }
  }
  return watcher;
}

export function showApplyWatchWindow(batchId: string, existing?: Window | null) {
  const url = `/apply/live/${encodeURIComponent(batchId)}`;
  if (existing && !existing.closed) {
    existing.location.replace(url);
    existing.focus();
    return existing;
  }
  return window.open(url, APPLY_WATCH_NAME, APPLY_WATCH_FEATURES);
}

export function closeApplyWatchWindow(existing?: Window | null) {
  try {
    existing?.close();
  } catch {
    /* ignore */
  }
}
