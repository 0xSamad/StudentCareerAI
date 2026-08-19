"use client";

export function applyWatchExpected() {
  const flag = String(process.env.NEXT_PUBLIC_APPLY_LIVE_WINDOW || "").trim().toLowerCase();
  if (flag === "true" || flag === "1") return true;
  if (flag === "false" || flag === "0") return false;
  return process.env.NODE_ENV === "production";
}

export const APPLY_WATCH_NAME = "scai-apply-window";
export const APPLY_WATCH_FEATURES =
  "popup=yes,width=1320,height=900,menubar=no,toolbar=no,location=no,status=no";

export function openBlankApplyWatchWindow() {
  if (!applyWatchExpected()) return null;
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

export function finishApplyLaunch(
  data: { batch?: { id?: string }; batchId?: string; liveWindow?: boolean },
  watcher?: Window | null,
): { ok: boolean; live: boolean; error?: string; message: string } {
  const batchId = String(data.batch?.id || data.batchId || "").trim();
  const live = data.liveWindow === true || (data.liveWindow !== false && applyWatchExpected());
  if (live) {
    if (!batchId || !showApplyWatchWindow(batchId, watcher)) {
      closeApplyWatchWindow(watcher);
      return {
        ok: false,
        live: true,
        error: "Allow pop-ups for StudentCareer AI so the application window can open.",
        message: "",
      };
    }
    return {
      ok: true,
      live: true,
      message: "Application window opened. Watch it fill, and complete Location or CAPTCHA there if asked. Nothing is submitted for you.",
    };
  }
  closeApplyWatchWindow(watcher);
  return {
    ok: true,
    live: false,
    message: "Chrome opened on this computer. Attach files, Google Drive, and CAPTCHA in that window. Nothing is submitted for you.",
  };
}
