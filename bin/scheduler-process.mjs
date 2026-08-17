#!/usr/bin/env node
/**
 * scheduler-process.mjs — Production Standalone Cron Scheduler
 *
 * Runs scheduled periodic job discovery and assessment sweeps into the JobQueue.
 */

import { getSaaSContainer } from "../lib/saas/saas-container.mjs";
import { EnvConfig } from "../lib/saas/config/env-config.mjs";
import { ServiceLifecycle } from "../lib/saas/lifecycle/service-lifecycle.mjs";
import { JobType } from "../lib/saas/queue/job-types.mjs";

const config = new EnvConfig();
const container = getSaaSContainer();
const lifecycle = new ServiceLifecycle({ container });

console.log(`[SchedulerProcess] Starting cron scheduler daemon (${config.nodeEnv})...`);

// Schedule hourly opportunity discovery sweep
container.schedulerService.scheduleJobTask(
  "Hourly Discovery Sweep",
  JobType.DISCOVER_JOBS,
  3600000, // 1 hour
  { options: { sources: ["greenhouse", "ashby", "lever"] } },
  { tenantId: "global", userId: "system_scheduler" }
);

// Schedule daily notification summary
container.schedulerService.scheduleJobTask(
  "Daily Notification Digest",
  JobType.SEND_NOTIFICATION,
  86400000, // 24 hours
  { subject: "Daily Digest", body: "Daily application activity summary" },
  { tenantId: "global", userId: "system_scheduler" }
);

lifecycle.setupGracefulShutdown({
  cleanupFns: [() => container.schedulerService.stopAll()],
});
