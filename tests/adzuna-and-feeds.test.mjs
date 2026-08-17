import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const ADZUNA = pathToFileURL(join(ROOT, 'lib/saas/adzuna-discovery.mjs')).href;
const FEED = pathToFileURL(join(ROOT, 'lib/saas/opportunity-feed.mjs')).href;

console.log('\nadzuna-and-feeds — config gating and internships vs jobs split');

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function checkTrue(label, actual) {
  if (actual) pass(label);
  else fail(`${label} — expected truthy, got ${JSON.stringify(actual)}`);
}

const savedId = process.env.ADZUNA_APP_ID;
const savedKey = process.env.ADZUNA_APP_KEY;
delete process.env.ADZUNA_APP_ID;
delete process.env.ADZUNA_APP_KEY;

const { adzunaConfig } = await import(ADZUNA);
const { matchesOpportunityFeed, distinctCompanyCount } = await import(FEED);

{
  delete process.env.ADZUNA_APP_ID;
  delete process.env.ADZUNA_APP_KEY;
  const missing = adzunaConfig(join(ROOT, 'this-dir-does-not-exist'));
  check('Missing both credentials disables Adzuna', missing.enabled, false);
}

{
  process.env.ADZUNA_APP_ID = 'test-app-id';
  delete process.env.ADZUNA_APP_KEY;
  const missingKey = adzunaConfig(join(ROOT, 'this-dir-does-not-exist'));
  check('Missing app key disables Adzuna', missingKey.enabled, false);
  check('Missing app key reason', missingKey.reason, 'missing_app_key');
}

{
  process.env.ADZUNA_APP_ID = 'test-app-id';
  process.env.ADZUNA_APP_KEY = 'test-app-key';
  const ok = adzunaConfig(join(ROOT, 'this-dir-does-not-exist'));
  check('Both credentials enable Adzuna', ok.enabled, true);
  checkTrue('Enabled config does not expose a skip reason', ok.reason == null);
}

checkTrue(
  'Intern title belongs on internships feed',
  matchesOpportunityFeed({ title: 'Software Intern', opportunity_type: 'JOB' }, 'INTERNSHIP')
);
checkTrue(
  'Junior CS belongs on internships feed',
  matchesOpportunityFeed({ title: 'Junior Backend Engineer', type: 'JOB' }, 'INTERNSHIP')
);
check(
  'Intern title is not a Jobs listing',
  matchesOpportunityFeed({ title: 'Software Intern', opportunity_type: 'INTERNSHIP' }, 'JOB'),
  false
);
checkTrue(
  'Software Engineer belongs on Jobs feed',
  matchesOpportunityFeed({ title: 'Software Engineer', opportunity_type: 'JOB' }, 'JOB')
);
check(
  'Company count is distinct',
  distinctCompanyCount([
    { company: 'Careem' },
    { company: 'Careem' },
    { company_name: 'Systems Limited' },
    { company: 'IBM' },
  ]),
  3
);

if (savedId) process.env.ADZUNA_APP_ID = savedId;
else delete process.env.ADZUNA_APP_ID;
if (savedKey) process.env.ADZUNA_APP_KEY = savedKey;
else delete process.env.ADZUNA_APP_KEY;
