#!/usr/bin/env node
/**
 * browser-worker-process.mjs — Production Standalone Browser Worker
 *
 * Dedicated browser worker process managing isolated ephemeral sandboxes.
 */

import { getSaaSContainer } from "../lib/saas/saas-container.mjs";
import { EnvConfig } from "../lib/saas/config/env-config.mjs";
import { ServiceLifecycle } from "../lib/saas/lifecycle/service-lifecycle.mjs";

const config = new EnvConfig();
const container = getSaaSContainer();
const lifecycle = new ServiceLifecycle({ container });

console.log(`[BrowserWorkerProcess] Starting isolated browser automation worker (${config.nodeEnv})...`);

// Keep the process alive and consume queued RUN_BROWSER_APPLICATION jobs.
container.workerPool.start(50);

container.workerPool.on("job:started", (e) =>
  console.log(`[BrowserWorker] Job ${e.jobId} (${e.type}) started (attempt ${e.attempt})`)
);
container.workerPool.on("job:completed", (e) =>
  console.log(`[BrowserWorker] Job ${e.jobId} (${e.type}) completed successfully`)
);
container.workerPool.on("job:failed", (e) =>
  console.error(`[BrowserWorker] Job ${e.jobId} (${e.type}) failed: ${e.error}`)
);
container.workerPool.on("job:dead_letter", (e) =>
  console.error(`[BrowserWorker] Job ${e.jobId} moved to DEAD_LETTER: ${e.error}`)
);

lifecycle.setupGracefulShutdown({
  workerPool: container.workerPool,
});

console.log("[BrowserWorkerProcess] Worker loop running.");
