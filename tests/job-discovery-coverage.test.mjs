import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const CS = pathToFileURL(join(ROOT, 'lib/saas/cs-field-discovery.mjs')).href;
const HTTP = pathToFileURL(join(ROOT, 'lib/saas/careers-http-scrape.mjs')).href;

const { isInternshipTitle, isStudentOpportunityTitle, passesSearchMode, isCsFieldRole } = await import(CS);
const { extractJobLinksFromHtml } = await import(HTTP);

console.log('\njob-discovery-coverage — intern matching, student titles, HTML career scrape');

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function checkTrue(label, actual) {
  if (actual) pass(label);
  else fail(`${label} — expected truthy, got ${JSON.stringify(actual)}`);
}

check('Software Intern is an internship', isInternshipTitle('Software Intern'), true);
check('Summer Internship is an internship', isInternshipTitle('Summer Internship — Backend'), true);
check('Software Engineer is not an intern title', isInternshipTitle('Software Engineer'), false);
check('Junior Software Engineer is student-relevant', isStudentOpportunityTitle('Junior Software Engineer'), true);
check('New Grad Developer is student-relevant', isStudentOpportunityTitle('New Grad Developer'), true);
check('Senior Staff Engineer is not student-relevant', isStudentOpportunityTitle('Senior Staff Engineer'), false);
check('INTERNSHIP mode keeps junior CS', passesSearchMode('Junior Backend Engineer', 'INTERNSHIP'), true);
check('INTERNSHIP mode drops senior CS', passesSearchMode('Senior Backend Engineer', 'INTERNSHIP'), false);
check('JOB mode keeps Software Engineer', passesSearchMode('Software Engineer', 'JOB'), true);
check('BOTH mode keeps intern and job', passesSearchMode('Data Analyst Intern', 'BOTH') && passesSearchMode('Data Analyst', 'BOTH'), true);
checkTrue('CS intern title matches CS field', isCsFieldRole('Software Development Intern'));

const html = `
  <html><body>
    <a href="/careers">Careers home</a>
    <a href="https://example.com/jobs/software-intern-lahore">Software Intern — Lahore</a>
    <a href="https://boards.greenhouse.io/acme/jobs/123">Backend Engineer Intern</a>
    <a href="https://facebook.com/acme">Facebook</a>
  </body></html>
`;
const links = extractJobLinksFromHtml(html, 'https://example.com/careers', { maxLinks: 10 });
checkTrue('Extracts intern posting from HTML', links.some((l) => /software intern/i.test(l.title)));
checkTrue('Extracts greenhouse job URL', links.some((l) => /greenhouse/i.test(l.url)));
checkTrue('Skips social links', !links.some((l) => /facebook/i.test(l.url)));
checkTrue('Skips careers landing path when it has no job slug', !links.some((l) => l.url.endsWith('/careers')));
