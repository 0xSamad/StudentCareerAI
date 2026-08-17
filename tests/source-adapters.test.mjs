// tests/source-adapters.test.mjs — CareerOS Source Adapters Test Suite
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const MOD = pathToFileURL(join(ROOT, 'lib/source-adapters.mjs')).href;
console.log('\nsource-adapters — normalization, country inference, dedup');

const {
  inferCountry,
  inferRemote,
  normalizeOpportunity,
  normalizeUrl,
  fuzzyKey,
  deduplicateOpportunities,
  processDiscoveredJobs,
  mergeMultipleSources,
} = await import(MOD);

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Country Inference — Pakistan
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n  1. Country inference — Pakistan cities and markers');

check('Karachi → Pakistan', inferCountry('Karachi, Pakistan'), 'Pakistan');
check('Lahore → Pakistan', inferCountry('Lahore'), 'Pakistan');
check('Islamabad → Pakistan', inferCountry('Islamabad Capital Territory'), 'Pakistan');
check('Rawalpindi → Pakistan', inferCountry('Rawalpindi, Punjab'), 'Pakistan');
check('Faisalabad → Pakistan', inferCountry('Faisalabad'), 'Pakistan');
check('Peshawar → Pakistan', inferCountry('Peshawar, KPK'), 'Pakistan');
check('Quetta → Pakistan', inferCountry('Quetta, Balochistan'), 'Pakistan');
check('Multan → Pakistan', inferCountry('Multan'), 'Pakistan');
check('Sialkot → Pakistan', inferCountry('Sialkot, Punjab, Pakistan'), 'Pakistan');
check('"Pakistan" in string → Pakistan', inferCountry('Remote, Pakistan'), 'Pakistan');
check('Abbottabad → Pakistan', inferCountry('Abbottabad'), 'Pakistan');
check('Gilgit → Pakistan', inferCountry('Gilgit-Baltistan'), 'Pakistan');
check('Wah Cantt → Pakistan', inferCountry('Wah Cantt'), 'Pakistan');

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Country Inference — International
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n  2. Country inference — international cities');

check('San Francisco → US', inferCountry('San Francisco, CA'), 'United States');
check('Seattle → US', inferCountry('Seattle, WA'), 'United States');
check('New York → US', inferCountry('New York City'), 'United States');
check('London → UK', inferCountry('London, UK'), 'United Kingdom');
check('Berlin → Germany', inferCountry('Berlin, Germany'), 'Germany');
check('Toronto → Canada', inferCountry('Toronto, ON'), 'Canada');
check('Dubai → UAE', inferCountry('Dubai'), 'UAE');
check('Bangalore → India', inferCountry('Bangalore, Karnataka'), 'India');
check('Singapore → Singapore', inferCountry('Singapore'), 'Singapore');
check('Tokyo → Japan', inferCountry('Tokyo, Japan'), 'Japan');
check('Sydney → Australia', inferCountry('Sydney, NSW'), 'Australia');
check('Paris → France', inferCountry('Paris'), 'France');
check('Amsterdam → Netherlands', inferCountry('Amsterdam'), 'Netherlands');
check('"USA" keyword → US', inferCountry('Remote, USA'), 'United States');

// Edge cases
check('Empty string → null', inferCountry(''), null);
check('null → null', inferCountry(null), null);
check('undefined → null', inferCountry(undefined), null);
check('Unknown city → null', inferCountry('Timbuktu'), null);

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Remote Detection
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n  3. Remote detection');

check('"Remote" location → true', inferRemote('Remote'), true);
check('"Fully Remote" → true', inferRemote('Fully Remote'), true);
check('"Remote, US" → true', inferRemote('Remote, US'), true);
check('"Work from home" → true', inferRemote('Work from home'), true);
check('"WFH" → true', inferRemote('WFH'), true);
check('"Remote position" in title → true', inferRemote('', 'Remote Software Engineer'), true);
check('"Telecommute" → true', inferRemote('Telecommute'), true);
check('"100% remote" → true', inferRemote('100% remote'), true);
check('"On-site only" → false', inferRemote('On-site only'), false);
check('"No remote" → false', inferRemote('No remote'), false);
check('"In-office required" → false', inferRemote('In-office required'), false);
check('"Karachi" → null (unknown)', inferRemote('Karachi'), null);
check('Empty → null', inferRemote(''), null);
check('"Remote-first" → true', inferRemote('Remote-first'), true);

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Normalize Opportunity
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n  4. Normalize opportunity — schema completeness');

{
  const raw = {
    title: 'Software Engineering Intern',
    url: 'https://boards.greenhouse.io/openai/jobs/12345',
    company: 'OpenAI',
    location: 'San Francisco, CA',
    description: 'Summer 2027 internship. Must be currently enrolled in a BS/MS program.',
    postedAt: Date.parse('2026-08-01'),
  };

  const norm = normalizeOpportunity(raw, 'greenhouse', 'https://boards-api.greenhouse.io/v1/boards/openai/jobs');

  check('source is set', norm.source, 'greenhouse');
  check('source_url is set', norm.source_url, 'https://boards-api.greenhouse.io/v1/boards/openai/jobs');
  check('company preserved', norm.company, 'OpenAI');
  check('title preserved', norm.title, 'Software Engineering Intern');
  check('location preserved', norm.location, 'San Francisco, CA');
  check('description preserved', typeof norm.description, 'string');
  check('country inferred → US', norm.country, 'United States');
  check('remote is null (office role)', norm.remote, null);
  check('opportunity_type classified', norm.opportunity_type, 'INTERNSHIP');
  check('classification_confidence exists', typeof norm.classification_confidence, 'string');
  check('classification_reason exists', typeof norm.classification_reason, 'string');
  check('posted_date is ISO', norm.posted_date, '2026-08-01');
  check('deadline is null (not in source)', norm.deadline, null);
  check('application_url matches url', norm.application_url, raw.url);
  check('url preserved', norm.url, raw.url);
}

{
  // Pakistan opportunity
  const raw = {
    title: 'Data Science Intern',
    url: 'https://apply.workable.com/10pearls/j/ABC123/',
    company: '10Pearls',
    location: 'Karachi, Pakistan',
    description: 'Summer internship for undergraduate students.',
  };

  const norm = normalizeOpportunity(raw, 'workable', 'https://apply.workable.com/10pearls');
  check('PK company: country → Pakistan', norm.country, 'Pakistan');
  check('PK company: source → workable', norm.source, 'workable');
  check('PK company: opportunity_type → INTERNSHIP', norm.opportunity_type, 'INTERNSHIP');
}

{
  // Remote opportunity
  const raw = {
    title: 'Remote ML Engineer',
    url: 'https://jobs.ashbyhq.com/anthropic/xyz',
    company: 'Anthropic',
    location: 'Remote',
    description: '5+ years experience. Competitive salary. 401k.',
  };

  const norm = normalizeOpportunity(raw, 'ashby', 'https://jobs.ashbyhq.com/anthropic');
  check('Remote opportunity: remote → true', norm.remote, true);
  check('Remote opportunity: opportunity_type → JOB', norm.opportunity_type, 'JOB');
}

{
  // Missing fields (edge case)
  const raw = { title: '', url: '', company: '' };
  const norm = normalizeOpportunity(raw, 'unknown', '');
  check('Empty input: source → unknown', norm.source, 'unknown');
  check('Empty input: title → empty', norm.title, '');
  check('Empty input: country → null', norm.country, null);
  check('Empty input: remote → null', norm.remote, null);
  check('Empty input: posted_date → null', norm.posted_date, null);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. URL Normalization
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n  5. URL normalization');

check('Strips trailing slash', normalizeUrl('https://example.com/jobs/'), normalizeUrl('https://example.com/jobs'));
check('Strips UTM params', normalizeUrl('https://example.com/jobs?utm_source=google'), normalizeUrl('https://example.com/jobs'));
check('Strips gh_jid param', normalizeUrl('https://boards.greenhouse.io/openai/jobs/123?gh_jid=123'), normalizeUrl('https://boards.greenhouse.io/openai/jobs/123'));
check('Lowercases', normalizeUrl('https://EXAMPLE.COM/Jobs'), normalizeUrl('https://example.com/Jobs'));
check('Preserves meaningful params', normalizeUrl('https://example.com/jobs?id=123') !== normalizeUrl('https://example.com/jobs'), true);
check('Empty string → empty', normalizeUrl(''), '');
check('null → empty', normalizeUrl(null), '');

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Fuzzy Key
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n  6. Fuzzy dedup key');

check('Same title+company → same key', fuzzyKey('Software Engineer', 'Google'), fuzzyKey('Software Engineer', 'Google'));
check('Case insensitive', fuzzyKey('Software ENGINEER', 'GOOGLE'), fuzzyKey('software engineer', 'google'));
check('Strips punctuation', fuzzyKey('Software Engineer — AI/ML', 'Google, Inc.'), fuzzyKey('Software Engineer  AIML', 'Google Inc'));
check('Different title → different key', fuzzyKey('Software Engineer', 'Google') !== fuzzyKey('Data Scientist', 'Google'), true);
check('Different company → different key', fuzzyKey('SWE', 'Google') !== fuzzyKey('SWE', 'Meta'), true);

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Deduplication
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n  7. Deduplication');

{
  const opps = [
    normalizeOpportunity({ title: 'SWE Intern', url: 'https://example.com/1', company: 'Acme' }, 'src1', ''),
    normalizeOpportunity({ title: 'SWE Intern', url: 'https://example.com/1', company: 'Acme' }, 'src2', ''),  // exact URL dup
    normalizeOpportunity({ title: 'SWE Intern', url: 'https://other.com/jobs/1', company: 'Acme' }, 'src3', ''),  // fuzzy dup
    normalizeOpportunity({ title: 'Data Analyst', url: 'https://example.com/2', company: 'Beta' }, 'src1', ''),  // unique
  ];

  const { unique, duplicates } = deduplicateOpportunities(opps);
  check('Dedup: 4 inputs → 2 unique', unique.length, 2);
  check('Dedup: 2 duplicates', duplicates.length, 2);
  check('Dedup: first unique is SWE Intern', unique[0].title, 'SWE Intern');
  check('Dedup: second unique is Data Analyst', unique[1].title, 'Data Analyst');
}

{
  // No duplicates
  const opps = [
    normalizeOpportunity({ title: 'Role A', url: 'https://a.com/1', company: 'A' }, 'src1', ''),
    normalizeOpportunity({ title: 'Role B', url: 'https://b.com/1', company: 'B' }, 'src2', ''),
  ];
  const { unique, duplicates } = deduplicateOpportunities(opps);
  check('No dups: 2 unique', unique.length, 2);
  check('No dups: 0 duplicates', duplicates.length, 0);
}

{
  // URL normalization dedup (trailing slash difference)
  const opps = [
    normalizeOpportunity({ title: 'SWE', url: 'https://example.com/jobs/123', company: 'X' }, 'src1', ''),
    normalizeOpportunity({ title: 'SWE', url: 'https://example.com/jobs/123/', company: 'X' }, 'src2', ''),
  ];
  const { unique } = deduplicateOpportunities(opps);
  check('Trailing slash dedup: 1 unique', unique.length, 1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. processDiscoveredJobs — Full Pipeline
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n  8. processDiscoveredJobs — full pipeline');

{
  const rawJobs = [
    { title: 'Software Intern', url: 'https://greenhouse.io/1', company: 'OpenAI', location: 'San Francisco', description: 'Summer internship for students.' },
    { title: 'Software Intern', url: 'https://greenhouse.io/1', company: 'OpenAI', location: 'San Francisco', description: 'Summer internship for students.' },
    { title: 'ML Engineer', url: 'https://greenhouse.io/2', company: 'OpenAI', location: 'Remote', description: '3+ years experience. 401k. Stock options.' },
  ];

  const result = processDiscoveredJobs(rawJobs, 'greenhouse', 'https://boards-api.greenhouse.io/v1/boards/openai/jobs');
  check('Pipeline: stats.total is 3', result.stats.total, 3);
  check('Pipeline: stats.unique is 2', result.stats.unique, 2);
  check('Pipeline: stats.duplicates is 1', result.stats.duplicates, 1);
  check('Pipeline: first opp is INTERNSHIP', result.opportunities[0].opportunity_type, 'INTERNSHIP');
  check('Pipeline: second opp is JOB', result.opportunities[1].opportunity_type, 'JOB');
  check('Pipeline: second opp remote → true', result.opportunities[1].remote, true);
}

{
  // Empty input
  const result = processDiscoveredJobs([], 'test', '');
  check('Empty jobs → 0 unique', result.stats.unique, 0);
}

{
  // Non-array input
  const result = processDiscoveredJobs(null, 'test', '');
  check('Null jobs → 0 unique', result.stats.unique, 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. mergeMultipleSources — Cross-source Dedup
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n  9. mergeMultipleSources — cross-source dedup');

{
  const batch1 = {
    source: 'greenhouse',
    opportunities: [
      normalizeOpportunity({ title: 'SWE Intern', url: 'https://greenhouse.io/1', company: 'Acme' }, 'greenhouse', ''),
      normalizeOpportunity({ title: 'ML Intern', url: 'https://greenhouse.io/2', company: 'Acme' }, 'greenhouse', ''),
    ],
  };
  const batch2 = {
    source: 'ashby',
    opportunities: [
      normalizeOpportunity({ title: 'SWE Intern', url: 'https://ashby.com/1', company: 'Acme' }, 'ashby', ''),  // fuzzy dup of batch1[0]
      normalizeOpportunity({ title: 'QA Engineer', url: 'https://ashby.com/2', company: 'Beta' }, 'ashby', ''),  // unique
    ],
  };

  const result = mergeMultipleSources([batch1, batch2]);
  check('Cross-source: 3 unique (1 fuzzy dup removed)', result.opportunities.length, 3);
  check('Cross-source: 1 duplicate', result.duplicates.length, 1);
  check('Cross-source: stats.by_source.greenhouse is 2', result.stats.by_source.greenhouse, 2);
  check('Cross-source: stats.by_source.ashby is 2', result.stats.by_source.ashby, 2);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Pakistan-specific Real-world Scenarios
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n  10. Pakistan-specific real-world scenarios');

{
  // Careem internship in Karachi
  const norm = normalizeOpportunity({
    title: 'Software Engineering Intern',
    url: 'https://boards.greenhouse.io/careem/jobs/999',
    company: 'Careem',
    location: 'Karachi, Sindh, Pakistan',
    description: 'Join our summer internship program. Must be currently enrolled.',
  }, 'greenhouse', 'https://boards-api.greenhouse.io/v1/boards/careem/jobs');

  check('Careem: country → Pakistan', norm.country, 'Pakistan');
  check('Careem: opportunity_type → INTERNSHIP', norm.opportunity_type, 'INTERNSHIP');
  check('Careem: source → greenhouse', norm.source, 'greenhouse');
}

{
  // 10Pearls job in Islamabad
  const norm = normalizeOpportunity({
    title: 'Senior Full Stack Developer',
    url: 'https://apply.workable.com/10pearls/j/ABC/',
    company: '10Pearls',
    location: 'Islamabad, Pakistan',
    description: '5+ years experience. Competitive salary. Health insurance.',
  }, 'workable', 'https://apply.workable.com/10pearls');

  check('10Pearls: country → Pakistan', norm.country, 'Pakistan');
  check('10Pearls: opportunity_type → JOB', norm.opportunity_type, 'JOB');
}

{
  // NVIDIA remote internship
  const norm = normalizeOpportunity({
    title: 'Deep Learning Intern — Summer 2027',
    url: 'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/1234',
    company: 'NVIDIA',
    location: 'Remote',
    description: 'Pursuing a degree in CS or related field. Currently enrolled. GPA 3.0 minimum.',
  }, 'workday', 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite');

  check('NVIDIA: remote → true', norm.remote, true);
  check('NVIDIA: opportunity_type → INTERNSHIP', norm.opportunity_type, 'INTERNSHIP');
  check('NVIDIA: source → workday', norm.source, 'workday');
}

{
  // Amazon Pakistan search result
  const norm = normalizeOpportunity({
    title: 'SDE Intern',
    url: 'https://www.amazon.jobs/en/jobs/123456/sde-intern',
    company: 'Amazon',
    location: 'Lahore, Punjab, Pakistan',
    description: '',
  }, 'amazon', 'https://www.amazon.jobs/en/search.json');

  check('Amazon PK: country → Pakistan', norm.country, 'Pakistan');
  check('Amazon PK: opportunity_type → INTERNSHIP', norm.opportunity_type, 'INTERNSHIP');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Done
// ═══════════════════════════════════════════════════════════════════════════════

