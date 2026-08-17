export type ScanResult = {
  ok: boolean;
  status: number;
  data: Record<string, any>;
};

export type ScanHooks = {
  onProgress?: (message: string) => void;
  onPartial?: () => void;
};

const POLL_MS = 2000;
const MAX_WAIT_MS = 240_000;

function parseScanBody(text: string, fallbackError: string) {
  if (!text) {
    return { ok: false, error: fallbackError };
  }
  try {
    return JSON.parse(text);
  } catch {
    return {
      ok: false,
      error:
        "Scan was cut off before a full result came back. Tap Refresh — any listings already saved will still show.",
    };
  }
}

async function readScanResponse(res: Response, fallbackError: string) {
  const text = await res.text();
  const data = parseScanBody(text, fallbackError);
  return { ok: Boolean(res.ok && data.ok !== false && data.status !== "failed"), status: res.status, data };
}

export async function getOpportunityScanStatus(): Promise<ScanResult> {
  const res = await fetch("/api/opportunities/scan", { method: "GET" });
  return readScanResponse(res, "Could not read scan status.");
}

export async function watchOpportunityScan(hooks: ScanHooks = {}): Promise<ScanResult> {
  const started = Date.now();
  let last: ScanResult | null = null;
  while (Date.now() - started < MAX_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    last = await getOpportunityScanStatus();
    const message = last.data?.message || last.data?.progress?.message;
    if (message) hooks.onProgress?.(message);
    hooks.onPartial?.();
    if (!last.data?.running) {
      const result = last.data?.result || {};
      return {
        ok: last.ok && last.data?.status !== "failed",
        status: last.status,
        data: {
          ...last.data,
          ...result,
          message: last.data?.message || result.message,
          error: last.data?.error || result.error,
        },
      };
    }
  }
  return {
    ok: true,
    status: 202,
    data: {
      ok: true,
      running: true,
      message:
        "Scan is still running in the background. Saved listings stay in your feed — tap Refresh to load new ones.",
    },
  };
}

export async function runOpportunityScan(
  body: Record<string, unknown> = {},
  hooks: ScanHooks = {}
): Promise<ScanResult> {
  const res = await fetch("/api/opportunities/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const started = await readScanResponse(
    res,
    "Scan did not start. Tap Refresh to load anything already saved, then try Refresh scan again."
  );
  if (started.data?.message) hooks.onProgress?.(started.data.message);
  if (started.data?.servedFromCache || started.data?.refreshAllowed === false) {
    return started;
  }
  if (started.data?.running) {
    hooks.onPartial?.();
    return watchOpportunityScan(hooks);
  }
  return started;
}
