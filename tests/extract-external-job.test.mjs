import { fail, pass } from './helpers.mjs';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOD = pathToFileURL(join(ROOT, 'web/src/lib/apply/extract-external-job.mjs')).href;
const { extractExternalJob, htmlToVisibleText, jobPostingFromHtml, normalizeExternalJob, greenhouseFromHtml } = await import(MOD);

console.log('\nextract-external-job — URL apply job extraction');

{
  const text = htmlToVisibleText('<p>Build <b>APIs</b></p><script>alert(1)</script>');
  if (text.includes('Build APIs') && !text.includes('alert')) pass('Strips tags and scripts from HTML');
  else fail(`Visible text was ${JSON.stringify(text)}`);
}

{
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: 'Software Engineering Intern',
    hiringOrganization: { name: 'Acme Labs' },
    description: '<p>You will write Python services.</p><p>Requirements: Git, SQL, REST APIs.</p>',
    jobLocation: { address: { addressLocality: 'Karachi', addressCountry: 'PK' } },
    employmentType: 'INTERN',
    skills: ['Python', 'SQL'],
  })}</script>`;
  const job = jobPostingFromHtml(html);
  if (job?.title === 'Software Engineering Intern' && job.hiringOrganization?.name === 'Acme Labs') {
    pass('Reads schema.org JobPosting JSON-LD');
  } else fail('JSON-LD JobPosting not found');
}

{
  const html = `<html><head><meta property="og:title" content="Backend Engineer | Careers"/></head>
  <body><h1>Backend Engineer</h1><main><p>About the role</p><p>We are looking for someone who can own REST APIs and SQL. Requirements include Git and Python. This is a full-time job.</p></main></body></html>`;
  const extracted = await extractExternalJob({
    url: 'https://example.com/careers/backend-engineer',
    fetchPage: async () => ({ ok: true, status: 200, text: html }),
  });
  if (extracted.ok && extracted.job.title.includes('Backend Engineer') && extracted.job.description.includes('REST APIs')) {
    pass('Career page visible text becomes the job description');
  } else fail(`Career page extract failed: ${JSON.stringify({ ok: extracted.ok, title: extracted.job.title, len: extracted.job.description.length })}`);
}

{
  const extracted = await extractExternalJob({
    url: 'https://example.com/jobs/ intern',
    fetchPage: async () => ({ ok: true, status: 200, text: '<html><body>nav footer</body></html>' }),
  });
  if (!extracted.ok && extracted.warning && /paste the job description/i.test(extracted.warning)) {
    pass('Short page asks the user to paste the JD instead of inventing one');
  } else fail('Expected extraction failure with paste warning');
}

{
  const extracted = await extractExternalJob({
    url: 'https://example.com/jobs/x',
    pastedDescription: 'We are looking for a Python intern. Requirements include Git, SQL, and REST APIs. This internship is based in Lahore and includes mentoring, code review, and production bug fixes.',
    companyHint: 'Netsol',
    roleHint: 'Python Intern',
    fetchPage: async () => ({ ok: false, status: 403, text: '' }),
  });
  if (
    extracted.ok &&
    extracted.job.company === 'Netsol' &&
    extracted.job.title === 'Python Intern' &&
    extracted.job.description.includes('REST APIs') &&
    extracted.job.sourceKind === 'pasted-description'
  ) {
    pass('Pasted JD is used when the page cannot be fetched');
  } else fail('Pasted JD path failed');
}

{
  const job = normalizeExternalJob({
    url: 'https://boards.greenhouse.io/acme/jobs/1',
    title: 'ML Intern',
    company: 'Acme',
    description: 'Python internship',
  });
  if (job.source === 'external_url' && job.opportunity_type === 'INTERNSHIP' && job.title === 'ML Intern') {
    pass('Normalized job matches in-app opportunity fields');
  } else fail(`Unexpected normalized job: ${JSON.stringify(job)}`);
}

{
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@graph': [
      { '@type': 'WebPage' },
      {
        '@type': 'JobPosting',
        title: 'Product Designer',
        hiringOrganization: { name: 'Figma' },
        description: 'Requirements: Figma, user research, and prototyping. About the role: ship product surfaces with designers and engineers every week.',
      },
    ],
  })}</script>`;
  const extracted = await extractExternalJob({
    url: 'https://example.com/figma/jobs/123',
    fetchPage: async () => ({ ok: true, status: 200, text: html }),
  });
  if (extracted.ok && extracted.job.company === 'Figma' && extracted.job.title === 'Product Designer') {
    pass('JSON-LD @graph JobPosting is flattened');
  } else fail(`@graph extract failed: ${extracted.job.title} / ${extracted.job.company}`);
}

{
  const fromPage = greenhouseFromHtml('Apply at https://job-boards.greenhouse.io/stripe/jobs/8077887 today');
  const fromJid = greenhouseFromHtml('boards-api.greenhouse.io/v1/boards/acme/jobs.json gh_jid=99', '99');
  if (fromPage?.token === 'stripe' && fromPage?.jobId === '8077887' && fromJid?.token === 'acme') {
    pass('Infers Greenhouse board token from page HTML');
  } else fail(`greenhouseFromHtml failed: ${JSON.stringify(fromPage)} ${JSON.stringify(fromJid)}`);
}
