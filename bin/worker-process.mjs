#!/usr/bin/env node
/**
 * worker-process.mjs — Production Standalone Background Queue Worker
 *
 * Runs the background worker pool processing asynchronous jobs from the JobQueue.
 */

import { getSaaSContainer } from "../lib/saas/saas-container.mjs";
import { EnvConfig } from "../lib/saas/config/env-config.mjs";
import { ServiceLifecycle } from "../lib/saas/lifecycle/service-lifecycle.mjs";

const config = new EnvConfig();
const container = getSaaSContainer();
const lifecycle = new ServiceLifecycle({ container });

console.log(`[WorkerProcess] Starting background worker pool (${config.nodeEnv})...`);

// Start worker pool event loop
container.workerPool.start(50);

// Attach monitoring listeners
container.workerPool.on("job:started", (e) => console.log(`[Worker] Job ${e.jobId} (${e.type}) started (attempt ${e.attempt})`));
container.workerPool.on("job:completed", (e) => console.log(`[Worker] Job ${e.jobId} (${e.type}) completed successfully`));
container.workerPool.on("job:failed", (e) => console.error(`[Worker] Job ${e.jobId} (${e.type}) failed: ${e.error}`));
container.workerPool.on("job:dead_letter", (e) => console.error(`[Worker] Job ${e.jobId} moved to DEAD_LETTER: ${e.error}`));

lifecycle.setupGracefulShutdown({
  workerPool: container.workerPool,
});
