import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const TENANT = pathToFileURL(join(ROOT, 'lib/saas/database/tenant-repository.mjs')).href;
const INGEST = pathToFileURL(join(ROOT, 'lib/saas/opportunity-ingest.mjs')).href;
const JOBS = pathToFileURL(join(ROOT, 'lib/saas/scan-job-runner.mjs')).href;
const PK = pathToFileURL(join(ROOT, 'lib/saas/pakistan-company-discovery.mjs')).href;
const INTL = pathToFileURL(join(ROOT, 'lib/saas/international-company-discovery.mjs')).href;

console.log('\nopportunity-persist-and-scan — save listings, skip known URLs, background jobs');

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function checkTrue(label, actual) {
  if (actual) pass(label);
  else fail(`${label} — expected truthy, got ${JSON.stringify(actual)}`);
}

const { TenantOpportunityRepository } = await import(TENANT);
const { saveDiscoveredListing } = await import(INGEST);
const { startScanJob, getScanJob, publicScanJob } = await import(JOBS);
const { loadPakistanCompanies } = await import(PK);
const { loadInternationalCompanies } = await import(INTL);

{
  const pk = loadPakistanCompanies(ROOT);
  const intl = loadInternationalCompanies(ROOT);
  checkTrue('Pakistan Top 100 list has at least 90 official career sites', pk.length >= 90);
  checkTrue('International Top 100 list has at least 90 official career sites', intl.length >= 90);
}

{
  const repo = new TenantOpportunityRepository();
  const ctx = { tenantId: 'tenant_persist', userId: 'user_persist' };
  const first = await repo.upsertDiscovered(
    {
      url: 'https://careers.example.com/jobs/intern-1',
      title: 'Software Intern',
      company: 'Careem',
      opportunity_type: 'INTERNSHIP',
    },
    ctx
  );
  check('First upsert is new', first.isNew, true);
  const second = await repo.upsertDiscovered(
    {
      url: 'https://careers.example.com/jobs/intern-1',
      title: 'Software Intern',
      company: 'Careem',
      opportunity_type: 'INTERNSHIP',
    },
    ctx
  );
  check('Second upsert of the same URL is not new', second.isNew, false);
  const urls = await repo.listKnownUrls(ctx);
  checkTrue('Known URL set includes the saved listing', urls.has('https://careers.example.com/jobs/intern-1'));
  const listed = await repo.findByFilters({ limit: 10 }, ctx);
  check('Saved listing remains after a second scan-style upsert', listed.length, 1);
}

{
  const repo = new TenantOpportunityRepository();
  const ctx = { tenantId: 'tenant_skip', userId: 'user_skip' };
  const knownUrls = new Set(['https://careers.example.com/jobs/known']);
  const skipped = await saveDiscoveredListing({
    rawOpportunity: {
      url: 'https://careers.example.com/jobs/known',
      title: 'Backend Intern',
      company: 'Systems Limited',
      market: 'NATIONAL',
    },
    opportunityRepository: repo,
    authContext: ctx,
    profile: { identity: { name: 'Test Student' } },
    knownUrls,
  });
  check('Known URL is skipped without a new insert', skipped.isNew, false);
  const listed = await repo.findByFilters({}, ctx);
  check('Skipped known URL is not written again', listed.length, 0);

  const created = await saveDiscoveredListing({
    rawOpportunity: {
      url: 'https://careers.example.com/jobs/fresh',
      title: 'Backend Intern',
      company: 'Systems Limited',
      market: 'NATIONAL',
    },
    opportunityRepository: repo,
    authContext: ctx,
    profile: { identity: { name: 'Test Student' } },
    knownUrls,
  });
  check('Fresh URL is saved as new', created.isNew, true);
  checkTrue('Fresh URL is remembered for the next scan', knownUrls.has('https://careers.example.com/jobs/fresh'));
}

{
  const userId = `scan_user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  let runs = 0;
  const job1 = startScanJob({
    userId,
    run: async () => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { message: 'done', newCount: 2 };
    },
  });
  const job2 = startScanJob({
    userId,
    run: async () => {
      runs += 1;
      return { message: 'should not run' };
    },
  });
  check('Second start reuses the running job', job1.id, job2.id);
  checkTrue('Public job reports running', publicScanJob(job1).running === true);
  await new Promise((resolve) => setTimeout(resolve, 80));
  check('Background runner executed once', runs, 1);
  const done = getScanJob(userId);
  check('Job completes with saved result', done.status, 'complete');
  check('Completed job is no longer running', publicScanJob(done).running, false);
}
