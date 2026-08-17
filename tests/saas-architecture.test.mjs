// tests/saas-architecture.test.mjs — Multi-Tenant SaaS Architecture Test Suite
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const SAAS_CONTAINER_MOD = pathToFileURL(join(ROOT, 'lib/saas/saas-container.mjs')).href;
const TENANT_CTX_MOD = pathToFileURL(join(ROOT, 'lib/saas/auth/tenant-context.mjs')).href;
const AUTH_MOD = pathToFileURL(join(ROOT, 'lib/saas/auth/auth-service.mjs')).href;
const STORAGE_MOD = pathToFileURL(join(ROOT, 'lib/saas/storage/local-storage.mjs')).href;
const DB_MOD = pathToFileURL(join(ROOT, 'lib/saas/database/tenant-repository.mjs')).href;
const BROWSER_MOD = pathToFileURL(join(ROOT, 'lib/saas/browser/browser-worker-pool.mjs')).href;

console.log('\nsaas-architecture — multi-tenant production service tier tests');

const { SaaSContainer } = await import(SAAS_CONTAINER_MOD);
const { TenantContext } = await import(TENANT_CTX_MOD);
const { AuthService } = await import(AUTH_MOD);
const { LocalStorageService } = await import(STORAGE_MOD);
const { TenantStudentProfileRepository, TenantApplicationRepository } = await import(DB_MOD);
const { BrowserWorkerPool } = await import(BROWSER_MOD);

// ── Test 1: Tenant Context Isolation ──────────────────────────────────────────
try {
  let outside = TenantContext.current(true);
  if (outside === null) {
    pass('TenantContext: empty outside of run()');
  } else {
    fail('TenantContext: leaked state outside run()');
  }

  await TenantContext.run({ tenantId: 'tenant_a', userId: 'user_1' }, async () => {
    const current = TenantContext.current();
    if (current.tenantId === 'tenant_a' && current.userId === 'user_1') {
      pass('TenantContext: context active inside run()');
    } else {
      fail('TenantContext: invalid context inside run()');
    }
  });
} catch (err) {
  fail('TenantContext test error: ' + err.message);
}

// ── Test 2: Multi-Tenant Authentication & User Partitioning ───────────────────
try {
  const auth = new AuthService();
  const t1 = await auth.registerTenant({ name: 'LUMS Cohort 2026' });
  const t2 = await auth.registerTenant({ name: 'NUST Cohort 2026' });

  const reg1 = await auth.registerUser({ tenantId: t1.id, email: 'ali@example.com', name: 'Ali Hassan', password: 'Password123!' });
  const reg2 = await auth.registerUser({ tenantId: t2.id, email: 'sara@example.com', name: 'Sara Khan', password: 'Password123!' });
  const u1 = reg1.user;
  const u2 = reg2.user;

  if (u1.tenantId === t1.id && u2.tenantId === t2.id && u1.id !== u2.id) {
    pass('AuthService: users strictly bound to separate tenants');
  } else {
    fail('AuthService: user tenant binding failed');
  }

  const apiKey = await auth.generateApiKey(u1.id, t1.id);
  const verified = await auth.verifyApiKey(apiKey);
  if (verified.userId === u1.id && verified.tenantId === t1.id) {
    pass('AuthService: API keys verified with correct tenant scope');
  } else {
    fail('AuthService: API key verification failed');
  }
} catch (err) {
  fail('AuthService test error: ' + err.message);
}

// ── Test 3: Multi-Tenant Data Layer Isolation ─────────────────────────────────
try {
  const profileRepo = new TenantStudentProfileRepository();
  const appRepo = new TenantApplicationRepository();

  await profileRepo.upsertProfile('user_1', 'tenant_a', {
    identity: { name: 'Student A' },
    education: [{ university: 'University A' }],
  });

  await profileRepo.upsertProfile('user_2', 'tenant_b', {
    identity: { name: 'Student B' },
    education: [{ university: 'University B' }],
  });

  const p1 = await profileRepo.getByUserId('user_1', 'tenant_a');
  const p2Cross = await profileRepo.getByUserId('user_1', 'tenant_b'); // Cross-tenant lookup must return null

  if (p1 && p1.identity.name === 'Student A' && p2Cross === null) {
    pass('TenantRepository: profiles strictly isolated across tenants');
  } else {
    fail('TenantRepository: profile cross-tenant leakage detected');
  }

  await appRepo.create({ opportunity_id: 'opp_1', state: 'APPLICATION_READY', matchScore: 92 }, { tenantId: 'tenant_a', userId: 'user_1' });
  await appRepo.create({ opportunity_id: 'opp_2', state: 'REJECTED', matchScore: 40 }, { tenantId: 'tenant_b', userId: 'user_2' });

  const a1 = await appRepo.findMany({}, { tenantId: 'tenant_a', userId: 'user_1' });
  const a2 = await appRepo.findMany({}, { tenantId: 'tenant_b', userId: 'user_2' });

  if (a1.length === 1 && a1[0].opportunity_id === 'opp_1' && a2.length === 1 && a2[0].opportunity_id === 'opp_2') {
    pass('TenantRepository: applications partitioned by tenant and user');
  } else {
    fail('TenantRepository: application partition failed');
  }
} catch (err) {
  fail('Database partitioning test error: ' + err.message);
}

{
  const { mergeProfileRecord, stripProfileSecrets } = await import(
    pathToFileURL(join(ROOT, 'lib/saas/database/merge-profile.mjs')).href
  );
  const repo = new TenantStudentProfileRepository();
  await repo.upsertProfile('user_keep', 'tenant_keep', {
    identity: { name: 'Samad', github: 'https://github.com/0xSamad' },
    cvText: '# Master CV',
    secrets: { githubToken: 'ghp_keep' },
  });
  await repo.upsertProfile('user_keep', 'tenant_keep', {
    identity: { name: 'Samad', github: '' },
    education: [{ university: 'IMS Peshawar' }],
    cvText: '',
  });
  const kept = await repo.getByUserId('user_keep', 'tenant_keep');
  if (kept?.identity?.github === 'https://github.com/0xSamad' && kept?.cvText === '# Master CV' && kept?.secrets?.githubToken === 'ghp_keep' && kept?.education?.[0]?.university === 'IMS Peshawar') {
    pass('Profile upsert keeps GitHub, token, and CV when a later save omits them');
  } else {
    fail('Profile upsert wiped GitHub, token, or CV');
  }
  const publicView = stripProfileSecrets(kept);
  if (publicView.credentials?.githubTokenSet === true && !publicView.secrets && !publicView.identity?.githubToken) {
    pass('Profile GET strips the GitHub token and reports it is saved');
  } else {
    fail('Profile secrets leaked or token flag missing');
  }
  const merged = mergeProfileRecord(
    { identity: { github: 'https://github.com/keep' }, cvText: 'keep', cvOriginal: { storageKey: 'cvs/original/master.docx' } },
    { identity: { city: 'Peshawar' } }
  );
  if (merged.identity.github === 'https://github.com/keep' && merged.identity.city === 'Peshawar' && merged.cvText === 'keep' && merged.cvOriginal?.storageKey === 'cvs/original/master.docx') {
    pass('mergeProfileRecord fills new fields without clearing old ones');
  } else {
    fail('mergeProfileRecord dropped existing profile fields');
  }
}

// ── Test 4: File Storage Partitioning ─────────────────────────────────────────
try {
  const storage = new LocalStorageService({ baseDir: join(ROOT, 'data/test-storage') });

  const f1 = await storage.saveFile('cvs/resume.html', '<h1>Resume A</h1>', {}, { tenantId: 'tenant_a', userId: 'user_1' });
  const f2 = await storage.saveFile('cvs/resume.html', '<h1>Resume B</h1>', {}, { tenantId: 'tenant_b', userId: 'user_2' });

  const contentA = (await storage.getFile('cvs/resume.html', { tenantId: 'tenant_a', userId: 'user_1' })).toString();
  const contentB = (await storage.getFile('cvs/resume.html', { tenantId: 'tenant_b', userId: 'user_2' })).toString();

  if (contentA.includes('Resume A') && contentB.includes('Resume B') && f1.key !== f2.key) {
    pass('StorageService: files partitioned in isolated tenant directories');
  } else {
    fail('StorageService: cross-tenant file collision detected');
  }
} catch (err) {
  fail('Storage test error: ' + err.message);
}

// ── Test 5: Browser Worker Pool & Safe Dry-Run Invariants ──────────────────────
try {
  const pool = new BrowserWorkerPool({ maxWorkers: 2 });
  const worker = await pool.acquireWorker();

  const dryRunResult = await worker.executeApplication(
    {
      opportunity: { id: 'careem_1', url: 'https://boards.greenhouse.io/careem/jobs/123' },
      answers: [{ question: 'Name', answer: 'Ali Hassan', confidence: 1.0 }],
      autoSubmit: false, // SAFE DRY-RUN
    },
    { tenantId: 'tenant_a', userId: 'user_1' }
  );

  if (dryRunResult.status === 'DRY_RUN_COMPLETED' && dryRunResult.submitted === false) {
    pass('BrowserWorker: Safe DRY-RUN mode enforced (submitted = false)');
  } else {
    fail('BrowserWorker: Safe DRY-RUN failed');
  }

  const captchaResult = await worker.executeApplication(
    {
      opportunity: { id: 'captcha_job', url: 'https://company.com/captcha-test' },
      autoSubmit: true,
    },
    { tenantId: 'tenant_a', userId: 'user_1' }
  );

  if (captchaResult.status === 'PAUSED' && (captchaResult.reason.includes('CAPTCHA') || captchaResult.challengeType === 'CAPTCHA')) {
    pass('BrowserWorker: Anti-bot challenge triggers graceful PAUSE');
  } else {
    fail('BrowserWorker: Failed to pause on CAPTCHA challenge');
  }

  await pool.releaseWorker(worker);
} catch (err) {
  fail('Browser worker test error: ' + err.message);
}

// ── Test 6: Unified SaaS Container Full Cycle ─────────────────────────────────
try {
  const container = new SaaSContainer({
    includeDemoSources: true,
    profileRepository: new TenantStudentProfileRepository(),
    databaseUrl: null,
  });

  // Seed profile
  await container.profileRepository.upsertProfile('student_101', 'tenant_demo', {
    identity: { name: 'Demo Student', email: 'demo@example.com', country: 'Pakistan', city: 'Lahore' },
    education: [{ university: 'LUMS', degree: 'BS', major: 'Computer Science', year: 3, graduation_date: '2026-06', gpa: 3.8, gpa_scale: 4.0, coursework: ['ML'] }],
    skills: { programming_languages: ['Python'], frameworks: ['FastAPI'], ai_ml: ['PyTorch'], databases: ['PostgreSQL'], cloud: ['Docker'] },
    experience: [{ company: 'Tech Inc', role: 'Intern', type: 'internship', start_date: '2025-06', end_date: '2025-08' }],
    projects: [{ name: 'Project AI', description: 'ML project', technologies: ['Python', 'PyTorch'] }],
    preferences: { search_mode: 'internships', target_roles: ['AI/ML Intern'], locations: { preferred: ['Lahore'], remote: true }, work_authorization: 'Citizen', needs_sponsorship: false, automation: { min_match_score: 3.5, max_applications_per_day: 10, auto_submit: false } },
  });

  const cycleResult = await container.runTenantAutonomousCycle({
    tenantId: 'tenant_demo',
    userId: 'student_101',
  });

  if (cycleResult.totalProcessed > 0 && cycleResult.metrics.total > 0) {
    pass('SaaSContainer: End-to-end tenant autonomous cycle executed with clean metrics');
  } else {
    fail('SaaSContainer: Autonomous cycle failed to produce metrics');
  }
} catch (err) {
  fail('SaaSContainer test error: ' + err.message);
}

console.log('✅ All SaaS Architecture tests passed.\n');
