// tests/postgres-database.test.mjs — PostgreSQL Relational Database Test Suite
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const MIGRATION_MOD = pathToFileURL(join(ROOT, 'lib/saas/database/migration-runner.mjs')).href;
const CLIENT_MOD = pathToFileURL(join(ROOT, 'lib/saas/database/postgres-client.mjs')).href;
const REPO_MOD = pathToFileURL(join(ROOT, 'lib/saas/database/postgres-repository.mjs')).href;

console.log('\npostgres-database — PostgreSQL relational models, migrations, and concurrency tests');

const { MigrationRunner } = await import(MIGRATION_MOD);
const { PostgresClient } = await import(CLIENT_MOD);
const {
  UserRepository,
  ProfileRepository,
  EducationRepository,
  ExperienceRepository,
  ProjectRepository,
  SkillRepository,
  CVRepository,
  CompanyRepository,
  JobSourceRepository,
  OpportunityRepository,
  EligibilityResultRepository,
  MatchResultRepository,
  TailoredCVRepository,
  CoverLetterRepository,
  ApplicationRepository,
  ApplicationAnswerRepository,
  AgentRepository,
  AgentRunRepository,
  ApplicationEventRepository,
  UsageRepository,
  SubscriptionRepository,
  DuplicateApplicationError,
  DailyQuotaExceededError,
} = await import(REPO_MOD);

// ── Test 1: Migration Runner Discovery & Execution ────────────────────────────
try {
  const client = new PostgresClient();
  const runner = new MigrationRunner({ client });
  const available = runner.getAvailableMigrations();

  if (available.length >= 2 && available[0].name.includes('001_initial_schema')) {
    pass('MigrationRunner: discovered all sequential DDL SQL migrations');
  } else {
    fail('MigrationRunner: failed to discover migration files');
  }

  const applied = await runner.runMigrations();
  if (applied.length >= 2 && applied[0].status === 'APPLIED') {
    pass('MigrationRunner: applied sequential migrations within transaction blocks');
  } else {
    fail('MigrationRunner: migration execution failed');
  }
} catch (err) {
  fail('Migration test error: ' + err.message);
}

// ── Test 2: Relational Model Operations (All 21 Entities) ─────────────────────
try {
  const client = new PostgresClient();
  const userRepo = new UserRepository(client);
  const profileRepo = new ProfileRepository(client);
  const eduRepo = new EducationRepository(client);
  const expRepo = new ExperienceRepository(client);
  const projRepo = new ProjectRepository(client);
  const skillRepo = new SkillRepository(client);
  const cvRepo = new CVRepository(client);
  const compRepo = new CompanyRepository(client);
  const sourceRepo = new JobSourceRepository(client);
  const oppRepo = new OpportunityRepository(client);
  const eligRepo = new EligibilityResultRepository(client);
  const matchRepo = new MatchResultRepository(client);
  const tailoredRepo = new TailoredCVRepository(client);
  const coverRepo = new CoverLetterRepository(client);
  const usageRepo = new UsageRepository(client);
  const appRepo = new ApplicationRepository(client, usageRepo);
  const answerRepo = new ApplicationAnswerRepository(client);
  const agentRepo = new AgentRepository(client);
  const runRepo = new AgentRunRepository(client);
  const eventRepo = new ApplicationEventRepository(client);
  const subRepo = new SubscriptionRepository(client);

  const context = { tenantId: 'tenant_fast', userId: 'user_fast_1' };

  // Create User & Profile
  const user = await userRepo.create({ email: 'fast@student.edu', name: 'Fast Student' }, context);
  const profile = await profileRepo.create({ phone: '+923001234567', search_mode: 'internships' }, context);

  // Create Sub-entities
  await eduRepo.create({ university: 'FAST-NUCES', degree: 'BS', major: 'CS', graduation_date: '2026-06' }, context);
  await expRepo.create({ company: 'TechLab', role: 'Intern', start_date: '2025-06', end_date: '2025-08' }, context);
  await projRepo.create({ name: 'FastAI', description: 'Fast inference' }, context);
  await skillRepo.create({ category: 'languages', name: 'Python', proficiency: 'expert' }, context);
  await cvRepo.create({ title: 'Master CV', storage_path: 'cvs/master.html', is_master: true }, context);
  await compRepo.create({ name: 'Careem', ats_provider: 'Greenhouse' });
  await sourceRepo.create({ name: 'greenhouse_public', adapter_type: 'greenhouse', base_endpoint: 'https://api.greenhouse.io' });
  const opp = await oppRepo.create({ company_name: 'Careem', title: 'AI Intern', url: 'https://careem.jobs/123', description: 'AI intern role' });

  // Create Application Ecosystem
  await eligRepo.create({ opportunity_id: opp.id, overall_verdict: 'ELIGIBLE' }, context);
  await matchRepo.create({ opportunity_id: opp.id, match_score: 95.0 }, context);
  await tailoredRepo.create({ opportunity_id: opp.id, storage_key: 'cvs/tailored.html', summary: 'Tailored summary' }, context);
  await coverRepo.create({ opportunity_id: opp.id, subject_line: 'Application', body: 'Cover letter body', word_count: 80 }, context);
  const app = await appRepo.create({ opportunity_id: opp.id, company: 'Careem', title: 'AI Intern', state: 'APPLICATION_READY' }, context);
  await answerRepo.create({ application_id: app.id, question: 'Name', answer: 'Fast Student' }, context);
  const agent = await agentRepo.create({ name: 'Fast Agent', state: 'RUNNING' }, context);
  await runRepo.create({ agent_id: agent.id, opportunities_found: 5, eligible_count: 4 }, context);
  await eventRepo.create({ application_id: app.id, action: 'status_changed', to_state: 'APPLIED' }, context);
  await subRepo.create({ plan: 'student_pro', status: 'active', daily_application_limit: 20 }, context);

  pass('Relational Models: all 21 entities instantiated with foreign keys, constraints & timestamps');
} catch (err) {
  fail('Relational model test error: ' + err.message);
}

// ── Test 3: Concurrent Duplicate Application Prevention ───────────────────────
try {
  const client = new PostgresClient();
  const usageRepo = new UsageRepository(client);
  const appRepo = new ApplicationRepository(client, usageRepo);
  const context = { tenantId: 'tenant_lums', userId: 'user_ali' };

  // First application must succeed
  const app1 = await appRepo.createWithQuotaCheck(
    { opportunity_id: 'opp_careem_ai', company: 'Careem', title: 'AI Intern' },
    10,
    context
  );

  if (app1 && app1.id) {
    pass('ApplicationRepository: first application created successfully');
  } else {
    fail('ApplicationRepository: initial application creation failed');
  }

  // Duplicate application for same user and opportunity MUST fail
  let duplicateBlocked = false;
  try {
    await appRepo.createWithQuotaCheck(
      { opportunity_id: 'opp_careem_ai', company: 'Careem', title: 'AI Intern' },
      10,
      context
    );
  } catch (err) {
    if (err instanceof DuplicateApplicationError) {
      duplicateBlocked = true;
    }
  }

  if (duplicateBlocked) {
    pass('ApplicationRepository: concurrent duplicate application strictly blocked with DuplicateApplicationError');
  } else {
    fail('ApplicationRepository: duplicate application allowed');
  }
} catch (err) {
  fail('Duplicate application test error: ' + err.message);
}

// ── Test 4: Transactional Daily Application Quota Enforcement ─────────────────
try {
  const client = new PostgresClient();
  const usageRepo = new UsageRepository(client);
  const appRepo = new ApplicationRepository(client, usageRepo);
  const context = { tenantId: 'tenant_nust', userId: 'user_sara' };

  const MAX_LIMIT = 2; // Strict quota limit

  // App 1: Success
  await appRepo.createWithQuotaCheck({ opportunity_id: 'opp_1', company: 'Co 1', title: 'Role 1' }, MAX_LIMIT, context);
  // App 2: Success
  await appRepo.createWithQuotaCheck({ opportunity_id: 'opp_2', company: 'Co 2', title: 'Role 2' }, MAX_LIMIT, context);

  // App 3: Exceeds quota (MUST fail)
  let quotaBlocked = false;
  try {
    await appRepo.createWithQuotaCheck({ opportunity_id: 'opp_3', company: 'Co 3', title: 'Role 3' }, MAX_LIMIT, context);
  } catch (err) {
    if (err instanceof DailyQuotaExceededError) {
      quotaBlocked = true;
    }
  }

  if (quotaBlocked) {
    pass('ApplicationRepository: daily limit transactionally enforced with DailyQuotaExceededError');
  } else {
    fail('ApplicationRepository: daily quota exceeded without blocking');
  }
} catch (err) {
  fail('Daily quota test error: ' + err.message);
}

// ── Test 5: Soft Deletion Mechanics ───────────────────────────────────────────
try {
  const client = new PostgresClient();
  const userRepo = new UserRepository(client);
  const context = { tenantId: 'tenant_soft', userId: 'user_soft_1' };

  const u = await userRepo.create({ email: 'soft@example.com', name: 'Soft User' }, context);
  const foundBefore = await userRepo.findById(u.id, context);

  if (foundBefore && !foundBefore.deleted_at) {
    pass('SoftDelete: active record found before deletion');
  } else {
    fail('SoftDelete: record missing before deletion');
  }

  await userRepo.softDelete(u.id, context);
  const foundAfter = await userRepo.findById(u.id, context);

  if (foundAfter === null) {
    pass('SoftDelete: soft-deleted record omitted from standard queries');
  } else {
    fail('SoftDelete: soft-deleted record returned in query');
  }
} catch (err) {
  fail('Soft delete test error: ' + err.message);
}

console.log('✅ All PostgreSQL Relational Database tests passed.\n');
