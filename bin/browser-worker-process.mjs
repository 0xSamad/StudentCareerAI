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

lifecycle.setupGracefulShutdown();
