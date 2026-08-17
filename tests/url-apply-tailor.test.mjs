import { fail, pass, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const MOD = pathToFileURL(join(ROOT, 'web/src/lib/apply/url-apply-tailor.mjs')).href;
const COPY = pathToFileURL(join(ROOT, 'web/src/lib/apply/cv-copy-tailor.mjs')).href;
const { tailorUrlApplyDocuments, tailoredDraftToText, coverLetterToHtml } = await import(MOD);
const { fileSha256, masterCvDocxPath } = await import(COPY);

console.log('\nurl-apply-tailor — per-user ATS CV, not the repo master');

const profile = {
  identity: { name: 'Ali Hassan', email: 'ali@example.com' },
  education: [{ university: 'LUMS', degree: 'BS', major: 'CS' }],
  skills: { programming_languages: ['Python'] },
  experience: { internships: [], jobs: [] },
  projects: [{ name: 'SentimentBot', description: 'NLP', technologies: ['Python'] }],
};

const opportunity = {
  source: 'external_url',
  title: 'Machine Learning Intern',
  company: 'Careem',
  description: 'Looking for a student with Python and PyTorch. Requirements: Git, SQL.',
  url: 'https://boards.greenhouse.io/careem/jobs/456',
};

{
  const text = tailoredDraftToText({
    summary: 'CS student targeting ML internships.',
    competencies: ['Python', 'PyTorch'],
    experience: [{ company: 'Arbisoft', role: 'ML Intern', start_date: '2026-06', end_date: '2026-08', bullets: ['Built NLP pipeline'] }],
    projects: [{ name: 'SentimentBot', description: 'Twitter sentiment', achievements: ['93.2% accuracy'] }],
  }, profile);
  if (text.includes('SentimentBot') && text.includes('Python') && !text.includes('Kubernetes')) {
    pass('Draft-to-text keeps attested facts only');
  } else fail('Draft-to-text leaked or dropped facts');
}

{
  const html = coverLetterToHtml('Ali Hassan', 'Careem', 'Dear Hiring Manager,\n\nI am applying.');
  if (html.includes('Dear Hiring Manager') && html.includes('Careem') && html.includes('<p>')) {
    pass('Cover letter HTML wraps existing engine body');
  } else fail('Cover letter HTML missing body');
}

{
  const masterPath = masterCvDocxPath(ROOT);
  const beforeHash = fileSha256(readFileSync(masterPath));
  let tailorArgs = null;
  let letterArgs = null;
  const result = await tailorUrlApplyDocuments({
    profile,
    cvText: '',
    opportunity,
    root: ROOT,
    loaders: {
      tailorCV: async (args) => {
        tailorArgs = args;
        return {
          tailored_html: '<html>tailored-cv</html>',
          tailored_draft: { summary: 'Targeted ML intern summary.', competencies: ['Python'], experience: [], projects: [{ name: 'SentimentBot' }] },
        };
      },
      generateCoverLetter: async (args) => {
        letterArgs = args;
        return { body: 'I am writing to apply for Machine Learning Intern at Careem.', subject_line: 'Application' };
      },
    },
  });
  const afterHash = fileSha256(readFileSync(masterPath));
  if (letterArgs?.opportunity?.description.includes('PyTorch')) {
    pass('Existing generateCoverLetter receives the extracted JD');
  } else fail('generateCoverLetter missing JD');
  if (
    result.usedExistingEngine &&
    /ALI HASSAN/.test(result.cvText) &&
    /SentimentBot/.test(result.cvText) &&
    /LUMS/.test(result.cvText) &&
    /PROFESSIONAL SUMMARY/.test(result.cvText) &&
    !/ABDUL SAMAD|HackerOne|eJPT|IMS Peshawar/i.test(result.cvText) &&
    result.coverLetter.includes('Careem')
  ) {
    pass('No-upload path generates this user ATS CV, not the repo master');
  } else fail('Adapter leaked the format-template owner or dropped Ali\'s facts');
  if (!tailorArgs) pass('AI tailorCV is not used when an ATS CV can be generated');
  else fail('AI tailorCV still rebuilt the CV');
  if (beforeHash === afterHash) pass('docs/cv.docx is unchanged after generating another user\'s CV');
  else fail('docs/cv.docx was modified');
}

{
  const result = await tailorUrlApplyDocuments({
    profile,
    opportunity: { title: 'X', company: 'Y', description: '' },
    loaders: {
      tailorCV: async () => {
        throw new Error('should not run without a JD');
      },
      generateCoverLetter: async () => {
        throw new Error('should not run without a JD');
      },
    },
  });
  if (!result.usedExistingEngine && !result.cvHtml) pass('Does not call the engine without a job description');
  else fail('Engine ran without a JD');
}

{
  const result = await tailorUrlApplyDocuments({
    profile,
    opportunity,
    root: ROOT,
    loaders: {
      tailorCV: async () => {
        throw new Error('fabricated');
      },
      generateCoverLetter: async () => {
        throw new Error('generic');
      },
    },
  });
  if (
    result.cvHtml &&
    /ALI HASSAN/.test(result.cvText) &&
    /SentimentBot/.test(result.cvText) &&
    result.coverLetter.includes('Careem') &&
    /Python|SentimentBot|Dear Hiring Manager/i.test(result.coverLetter) &&
    !/HackerOne|eJPT|ABDUL SAMAD/i.test(`${result.cvText}\n${result.coverLetter}`)
  ) {
    pass('AI engine failure still generates this user ATS CV and a grounded job-specific letter');
  } else fail('Failure path invented a letter or used the repo master CV');
}
