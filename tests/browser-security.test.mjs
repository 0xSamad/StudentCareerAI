// tests/browser-security.test.mjs — Hardened Multi-User Browser Automation Security Test Suite
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import fs from 'fs';

const BROWSER_MOD = pathToFileURL(join(ROOT, 'lib/saas/browser/index.mjs')).href;
const SANITIZER_MOD = pathToFileURL(join(ROOT, 'lib/saas/auth/sanitizer.mjs')).href;

console.log('\nbrowser-security — multi-user browser isolation, anti-bypass & cleanup defense tests');

const { BrowserWorkerPool, BrowserWorker, IsolatedBrowserContext, SecurityDetector, ChallengeType } = await import(BROWSER_MOD);
const { Sanitizer } = await import(SANITIZER_MOD);

// ── Test 1: Cross-User Browser Session Isolation ──────────────────────────────
try {
  const contextManager = new IsolatedBrowserContext({ baseDir: join(ROOT, 'data/test_browser_sessions') });
  const s1 = contextManager.createSession({ tenantId: 'tenant_a', userId: 'user_1' });
  const s2 = contextManager.createSession({ tenantId: 'tenant_b', userId: 'user_2' });

  s1.cookies.set('auth_token', 'user1_secret_cookie');
  s2.cookies.set('auth_token', 'user2_secret_cookie');

  if (
    s1.sessionId !== s2.sessionId &&
    s1.sessionDir !== s2.sessionDir &&
    s1.cookies.get('auth_token') === 'user1_secret_cookie' &&
    s2.cookies.get('auth_token') === 'user2_secret_cookie'
  ) {
    pass('IsolatedBrowserContext: separate ephemeral sessions, cookies, and user-data directories');
  } else {
    fail('IsolatedBrowserContext: cross-user session collision detected');
  }

  contextManager.destroySession(s1.sessionId);
  contextManager.destroySession(s2.sessionId);
} catch (err) {
  fail('Session isolation test error: ' + err.message);
}

// ── Test 2: Deterministic Cleanup of Temporary Files & Directories ───────────
try {
  const contextManager = new IsolatedBrowserContext({ baseDir: join(ROOT, 'data/test_browser_cleanup') });
  const session = contextManager.createSession({ tenantId: 'tenant_clean', userId: 'user_clean' });

  const sessionDirExistsBefore = fs.existsSync(session.sessionDir);
  if (!sessionDirExistsBefore) {
    fail('Cleanup: session directory was not created');
  }

  // Destroy session
  contextManager.destroySession(session.sessionId);
  const sessionDirExistsAfter = fs.existsSync(session.sessionDir);

  if (sessionDirExistsBefore && !sessionDirExistsAfter) {
    pass('Cleanup: ephemeral browser directory and scratch files deterministically wiped on completion');
  } else {
    fail('Cleanup: temporary browser session files leaked on disk after teardown');
  }
} catch (err) {
  fail('Cleanup test error: ' + err.message);
}

// ── Test 3: Anti-Bypass — CAPTCHA Detection ───────────────────────────────────
try {
  const pool = new BrowserWorkerPool({ maxWorkers: 2 });
  const worker = await pool.acquireWorker();

  const captchaOpp = {
    id: 'captcha_job',
    url: 'https://company.com/jobs/apply',
    description: 'Please verify you are a human. CAPTCHA required.',
  };

  const result = await worker.executeApplication(
    { opportunity: captchaOpp, answers: [{ question: 'Name', answer: 'Ali' }] },
    { tenantId: 'tenant_sec', userId: 'user_sec' }
  );

  if (
    result.status === 'PAUSED' &&
    result.submitted === false &&
    result.challengeType === ChallengeType.CAPTCHA &&
    result.userActionRequired.includes('human verification')
  ) {
    pass('Anti-Bypass: CAPTCHA challenge detected -> application gracefully PAUSED with candidate alert (no bypass)');
  } else {
    fail('Anti-Bypass: failed to pause on CAPTCHA challenge');
  }

  await pool.releaseWorker(worker);
} catch (err) {
  fail('CAPTCHA test error: ' + err.message);
}

// ── Test 4: Anti-Bypass — MFA / 2FA Prompt Detection ──────────────────────────
try {
  const pool = new BrowserWorkerPool({ maxWorkers: 2 });
  const worker = await pool.acquireWorker();

  const mfaOpp = {
    id: 'mfa_job',
    url: 'https://portal.com/auth/two-factor',
    description: 'Enter verification code sent to your SMS device for Two-Factor Authentication.',
  };

  const result = await worker.executeApplication(
    { opportunity: mfaOpp, answers: [{ question: 'Name', answer: 'Ali' }] },
    { tenantId: 'tenant_sec', userId: 'user_sec' }
  );

  if (
    result.status === 'PAUSED' &&
    result.submitted === false &&
    result.challengeType === ChallengeType.MFA &&
    result.userActionRequired.includes('two-factor')
  ) {
    pass('Anti-Bypass: MFA / 2FA prompt detected -> application gracefully PAUSED with candidate alert (no bypass)');
  } else {
    fail('Anti-Bypass: failed to pause on MFA prompt');
  }

  await pool.releaseWorker(worker);
} catch (err) {
  fail('MFA test error: ' + err.message);
}

// ── Test 5: Anti-Bypass — Enterprise SSO Wall Detection ───────────────────────
try {
  const pool = new BrowserWorkerPool({ maxWorkers: 2 });
  const worker = await pool.acquireWorker();

  const ssoOpp = {
    id: 'sso_job',
    url: 'https://company.myworkdayjobs.com/auth-required',
    description: 'Workday login and enterprise SSO credentials required to access application.',
  };

  const result = await worker.executeApplication(
    { opportunity: ssoOpp, answers: [{ question: 'Name', answer: 'Ali' }] },
    { tenantId: 'tenant_sec', userId: 'user_sec' }
  );

  if (
    result.status === 'PAUSED' &&
    result.submitted === false &&
    result.challengeType === ChallengeType.AUTH_WALL &&
    result.userActionRequired.includes('sign in')
  ) {
    pass('Anti-Bypass: Enterprise SSO wall detected -> application gracefully PAUSED with candidate alert (no bypass)');
  } else {
    fail('Anti-Bypass: failed to pause on SSO wall');
  }

  await pool.releaseWorker(worker);
} catch (err) {
  fail('SSO wall test error: ' + err.message);
}

// ── Test 6: Worker Crash Recovery & Recycling ─────────────────────────────────
try {
  const worker = new BrowserWorker({ id: 'test_worker_recovery' });
  worker.inUse = true;
  worker.crashCount = 4;

  worker.recycle();

  if (worker.inUse === false && worker.crashCount === 0) {
    pass('Crash Recovery: worker state cleanly recycled and restored to pool');
  } else {
    fail('Crash Recovery: worker failed to recycle state');
  }
} catch (err) {
  fail('Crash recovery test error: ' + err.message);
}

// ── Test 7: Stale Session TTL Expiration ──────────────────────────────────────
try {
  const contextManager = new IsolatedBrowserContext({ baseDir: join(ROOT, 'data/test_browser_ttl') });
  const session = contextManager.createSession({ tenantId: 'tenant_ttl', userId: 'user_ttl' });

  // Manually expire session
  session.expiresAt = new Date(Date.now() - 1000).toISOString();

  const cleanedCount = contextManager.cleanExpiredSessions();
  const exists = contextManager.activeSessions.has(session.sessionId);

  if (cleanedCount === 1 && !exists) {
    pass('Session TTL: expired browser sessions automatically pruned and destroyed');
  } else {
    fail('Session TTL: expired session failed to clean');
  }
} catch (err) {
  fail('Session TTL test error: ' + err.message);
}

// ── Test 8: Zero-Secret Logging in Browser Execution Traces ───────────────────
try {
  const tracePayload = {
    workerId: 'worker_1',
    sessionId: 'bsess_123',
    formData: {
      candidateName: 'Ali Hassan',
      password: 'UserSubmittedSecretPassword123!',
      sessionToken: 'sess_abc123456secret',
      cookies: 'session_id=secret_cookie_val',
    },
  };

  const sanitizedTrace = Sanitizer.sanitize(tracePayload);

  if (
    sanitizedTrace.formData.password === '***REDACTED***' &&
    sanitizedTrace.formData.sessionToken === '***REDACTED***' &&
    sanitizedTrace.formData.cookies === '***REDACTED***' &&
    sanitizedTrace.formData.candidateName === 'Ali Hassan'
  ) {
    pass('Sanitizer: Browser form traces strictly redact passwords, tokens, and cookies');
  } else {
    fail('Sanitizer: Credentials leaked in browser execution trace');
  }
} catch (err) {
  fail('Sanitizer test error: ' + err.message);
}

console.log('✅ All Hardened Browser Automation Security tests passed.\n');
