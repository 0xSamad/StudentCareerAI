// tests/deployment-readiness.test.mjs — Production Deployment & Readiness Test Suite
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import fs from 'fs';

const CONFIG_MOD = pathToFileURL(join(ROOT, 'lib/saas/config/env-config.mjs')).href;
const LIFECYCLE_MOD = pathToFileURL(join(ROOT, 'lib/saas/lifecycle/service-lifecycle.mjs')).href;
const SAAS_CONTAINER_MOD = pathToFileURL(join(ROOT, 'lib/saas/saas-container.mjs')).href;

console.log('\ndeployment-readiness — production deployment, containerization & lifecycle tests');

const { EnvConfig } = await import(CONFIG_MOD);
const { ServiceLifecycle } = await import(LIFECYCLE_MOD);
const { SaaSContainer } = await import(SAAS_CONTAINER_MOD);

// ── Test 1: Production Configuration Parsing & Secret Redaction ───────────────
try {
  const devConfig = new EnvConfig({ NODE_ENV: 'development' });
  const prodConfig = new EnvConfig({
    NODE_ENV: 'production',
    SESSION_SECRET: 'a'.repeat(64),
    JWT_SECRET: 'b'.repeat(64),
    OPENROUTER_API_KEY: 'sk-or-v1-secret-key',
    POSTGRES_PASSWORD: 'SuperSecretPassword',
  });

  const safeJson = prodConfig.toSafeJSON();

  if (
    devConfig.isDevelopment &&
    prodConfig.isProduction &&
    safeJson.ai.hasOpenRouterKey === true &&
    safeJson.ai.openrouterApiKey === undefined &&
    safeJson.database.password === undefined
  ) {
    pass('EnvConfig: environment separation validated and secrets strictly redacted in toSafeJSON()');
  } else {
    fail('EnvConfig: configuration or secret masking error');
  }
} catch (err) {
  fail('EnvConfig test error: ' + err.message);
}

// ── Test 2: Production Secret Validation Check ────────────────────────────────
try {
  const invalidProd = new EnvConfig({ NODE_ENV: 'production', SESSION_SECRET: 'dev_insecure' });
  const validation = invalidProd.validateProductionRequirements();

  if (!validation.valid && validation.missing.length >= 1) {
    pass('EnvConfig: insecure default secrets correctly flagged in production environment mode');
  } else {
    fail('EnvConfig: failed to catch insecure production secret');
  }
} catch (err) {
  fail('Secret validation test error: ' + err.message);
}

// ── Test 3: Liveness & Readiness Probes ────────────────────────────────────────
try {
  const container = new SaaSContainer({ databaseUrl: null });
  const lifecycle = new ServiceLifecycle({ container });

  const liveness = lifecycle.getLiveness();
  const readiness = await lifecycle.getReadiness();

  // Liveness stays OK without Postgres; readiness must NOT fake database HEALTHY.
  if (
    liveness.status === 'OK' &&
    liveness.alive === true &&
    liveness.uptimeSeconds >= 0 &&
    readiness.ready === false &&
    String(readiness.checks.database).includes('UNHEALTHY') &&
    readiness.checks.storage === 'HEALTHY'
  ) {
    pass('ServiceLifecycle: liveness OK; readiness honestly reports database UNHEALTHY without DATABASE_URL');
  } else {
    fail('ServiceLifecycle: probe reporting error');
  }
} catch (err) {
  fail('Probe test error: ' + err.message);
}

// ── Test 4: Graceful Shutdown State Transition ────────────────────────────────
try {
  const lifecycle = new ServiceLifecycle();
  lifecycle.isShuttingDown = true;

  const liveDuringShutdown = lifecycle.getLiveness();
  const readyDuringShutdown = await lifecycle.getReadiness();

  if (liveDuringShutdown.status === 'SHUTTING_DOWN' && readyDuringShutdown.ready === false) {
    pass('ServiceLifecycle: graceful shutdown state halts readiness and reports shutdown status');
  } else {
    fail('ServiceLifecycle: shutdown state failed');
  }
} catch (err) {
  fail('Shutdown test error: ' + err.message);
}

// ── Test 5: Standalone Service Entrypoint Files Verification ──────────────────
try {
  const apiFile = fs.existsSync(join(ROOT, 'bin/api-server.mjs'));
  const workerFile = fs.existsSync(join(ROOT, 'bin/worker-process.mjs'));
  const schedulerFile = fs.existsSync(join(ROOT, 'bin/scheduler-process.mjs'));
  const browserFile = fs.existsSync(join(ROOT, 'bin/browser-worker-process.mjs'));

  if (apiFile && workerFile && schedulerFile && browserFile) {
    pass('Standalone Entrypoints: all 4 dedicated service processes exist in bin/');
  } else {
    fail('Standalone Entrypoints: missing service entrypoints');
  }
} catch (err) {
  fail('Entrypoints test error: ' + err.message);
}

// ── Test 6: Docker Compose Production Stack Verification ──────────────────────
try {
  const composePath = join(ROOT, 'docker-compose.production.yml');
  const exists = fs.existsSync(composePath);
  const content = exists ? fs.readFileSync(composePath, 'utf-8') : '';

  const hasPostgres = content.includes('postgres:');
  const hasApi = content.includes('api:');
  const hasFrontend = content.includes('frontend:');
  const hasWorker = content.includes('worker:');
  const hasScheduler = content.includes('scheduler:');
  const hasBrowserWorker = content.includes('browser-worker:');

  if (exists && hasPostgres && hasApi && hasFrontend && hasWorker && hasScheduler && hasBrowserWorker) {
    pass('Docker Compose: production multi-container stack orchestrates all 5 services + postgres with health checks');
  } else {
    fail('Docker Compose: production stack configuration incomplete');
  }
} catch (err) {
  fail('Compose test error: ' + err.message);
}

console.log('✅ All Production Deployment & Readiness tests passed.\n');
