/**
 * scan-job-runner.mjs — In-process background scan jobs.
 * Survives Next.js HMR via globalThis so a Refresh scan can return immediately
 * while Pakistan Top 100 + International Top 100 + Adzuna keep running.
 */

function store() {
  if (!globalThis.__careerOpsScanJobs) {
    globalThis.__careerOpsScanJobs = new Map();
  }
  return globalThis.__careerOpsScanJobs;
}

export function getScanJob(userId) {
  if (!userId) return null;
  return store().get(String(userId)) || null;
}

export function publicScanJob(job) {
  if (!job) return { status: "idle", running: false };
  return {
    ok: job.status !== "failed",
    running: job.status === "running",
    status: job.status,
    jobId: job.id,
    message: job.message,
    progress: job.progress || null,
    result: job.result || null,
    error: job.error || null,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || null,
  };
}

export function startScanJob({ userId, run }) {
  const key = String(userId);
  const existing = store().get(key);
  if (existing?.status === "running") return existing;

  const job = {
    id: `scan_${Date.now()}`,
    userId: key,
    status: "running",
    message: "Scanning 100 Pakistan + 100 international career sites and Adzuna…",
    progress: { phase: "starting" },
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    error: null,
  };
  store().set(key, job);

  Promise.resolve()
    .then(() => run(job))
    .then((result) => {
      job.status = "complete";
      job.result = result || null;
      job.message = result?.message || "Scan complete. Listings are saved.";
      job.finishedAt = new Date().toISOString();
    })
    .catch((err) => {
      job.status = "failed";
      job.error = err?.message || String(err);
      job.message = job.error;
      job.finishedAt = new Date().toISOString();
    });

  return job;
}
