import { pass, fail } from './helpers.mjs';
import { isAllowedTargetListing, isPakistanTarget, isRemoteListing, targetGeoRank, cleanListingTitle, isGarbageTitle } from '../lib/saas/listing-quality.mjs';

console.log('\nlisting-quality — Pakistan + remote only');

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

check(
  'Hyderabad Telangana is not treated as Pakistan',
  isAllowedTargetListing({
    title: 'Sr Associate Data Engineer',
    url: 'https://www.adzuna.in/details/5842749104',
    location: 'Hyderabad, Telangana',
  }),
  false
);

check('Pakistan intern is allowed',
  isAllowedTargetListing({
    title: 'Software Intern',
    url: 'https://jobs.jazz.com.pk/job/software-intern-islamabad',
    location: 'Islamabad, Pakistan',
    market: 'NATIONAL',
  }),
  true
);

check(
  'Remote intern with no country is allowed',
  isAllowedTargetListing({
    title: 'Remote Software Intern',
    url: 'https://boards.greenhouse.io/acme/jobs/123',
    location: 'Remote',
    remote: true,
  }),
  true
);

check(
  'Singapore on-site is rejected',
  isAllowedTargetListing({
    title: 'Software Engineer',
    url: 'https://boards.greenhouse.io/acme/jobs/99',
    location: 'Singapore',
    market: 'INTERNATIONAL',
  }),
  false
);

check(
  'China on-site is rejected',
  isAllowedTargetListing({
    title: 'Backend Intern',
    url: 'https://jobs.lever.co/acme/abcd',
    location: 'Shanghai, China',
  }),
  false
);

check(
  'Remote Singapore office role is rejected',
  isAllowedTargetListing({
    title: 'Remote Software Engineer - Singapore',
    url: 'https://boards.greenhouse.io/acme/jobs/12',
    location: 'Singapore (Remote)',
    remote: true,
  }),
  false
);

check('Pakistan ranks ahead of remote', targetGeoRank({ location: 'Lahore, Pakistan', market: 'NATIONAL' }) < targetGeoRank({ location: 'Remote', remote: true }), true);
check('isPakistanTarget uses NATIONAL market', isPakistanTarget({ market: 'NATIONAL', location: '' }), true);
check('isRemoteListing reads title', isRemoteListing({ title: 'WFH Data Intern', location: '' }), true);

check(
  'PepsiCo Indeed scrape title is cleaned',
  cleanListingTitle('\n Indeed \n \n \n \n Pepsico Indeed Link'),
  'Pepsico'
);
check('PepsiCo Indeed scrape title is garbage', isGarbageTitle('\n Indeed \n \n \n \n Pepsico Indeed Link'), true);
check('Apply Now is garbage', isGarbageTitle('Apply Now'), true);
check('Skip to main content is garbage', isGarbageTitle('Skip to main content'), true);
check(
  'HTML entity title is decoded',
  cleanListingTitle('What it&#39;s like to work here'),
  "What it's like to work here"
);
check('Culture-page title is garbage', isGarbageTitle("What it&#39;s like to work here"), true);
check(
  'Microsoft glued location is stripped',
  cleanListingTitle('Senior Software EngineerUnited States, Washington, RedmondPosted a day ago'),
  'Senior Software Engineer'
);
check('Literal backslash-n title is cleaned', cleanListingTitle('\\n Indeed \\n \\n Pepsico Indeed Link'), 'Pepsico');
check('Abbott Right To Work is garbage', isGarbageTitle('Right To Work (Spanish)'), true);
check('E-Verify notice is garbage', isGarbageTitle('E-Verify Notice (English)'), true);
check('xlsx dividend file is garbage', isGarbageTitle('Final List OF Withheld Dividend Warrants.xlsx'), true);
check(
  'Careem Dubai title is not a Pakistan listing',
  isAllowedTargetListing({
    title: 'Program Manager Dubai, United Arab Emirates|Engineering - Technical program manager',
    url: 'https://www.careem.com/careers/program-manager',
    location: 'Pakistan',
    market: 'NATIONAL',
  }),
  false
);
check(
  'Careem Karachi title stays',
  isAllowedTargetListing({
    title: 'Product Operations Specialist Karachi, Pakistan|Engineering - Product Operations',
    url: 'https://www.careem.com/careers/product-ops',
    location: 'Karachi, Pakistan',
    market: 'NATIONAL',
  }),
  true
);
