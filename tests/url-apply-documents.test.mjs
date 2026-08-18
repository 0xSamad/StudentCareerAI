import { fail, pass } from './helpers.mjs';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = pathToFileURL(join(ROOT, 'web/src/lib/apply/url-apply-documents.mjs')).href;
const BATCH = pathToFileURL(join(ROOT, 'web/src/lib/apply/multi-url-apply.mjs')).href;
const EXTRACT = pathToFileURL(join(ROOT, 'web/src/lib/apply/extract-external-job.mjs')).href;

const {
  isolateMasterCv,
  isolateProfile,
  documentFileStem,
  tailoredCvFileName,
  coverLetterFileName,
  freezeJobRecord,
  qualityCheckDocuments,
  generateJobDocuments,
} = await import(DOC);
const { createUrlApplyBatch, getUrlApplyBatch, runUrlApplyBatch, resetUrlApplyBatchesForTests, URL_APPLY_PHASE } = await import(BATCH);
const { extractJobSections, normalizeExternalJob } = await import(EXTRACT);

console.log('\nurl-apply-documents — isolated job-specific CVs from the existing engine');

const masterCv = Object.freeze('ABDUL SAMAD\nPython, SQL, Git. Built SentimentBot. BS Software Engineering at IMS Peshawar.');
const profile = {
  identity: { name: 'ABDUL SAMAD', email: 'okzsamad57@gmail.com' },
  education: [{ university: 'IMS Peshawar', degree: 'BS', major: 'Software Engineering' }],
  skills: { programming_languages: ['Python', 'SQL'], tools: ['Git'] },
  experience: { internships: [], jobs: [] },
  projects: [{ name: 'SentimentBot', description: 'NLP classifier', technologies: ['Python'] }],
};

const jobs = [
  {
    company: 'Google',
    title: 'AI Intern',
    description: `About the role
Work on applied AI intern projects.
Responsibilities
Fine-tune models and write evaluation harnesses.
Requirements
Python, PyTorch, Git.
Technologies
Python, PyTorch`,
  },
  {
    company: 'Microsoft',
    title: 'ML Intern',
    description: `About the role
Build ML intern pipelines on Azure.
Responsibilities
Train ranking models and ship notebooks.
Requirements
Python, Azure ML, SQL.
Technologies
Python, Azure`,
  },
  {
    company: 'Company X',
    title: 'Data Science Intern',
    description: `About the role
Analyze product data as a data science intern.
Responsibilities
Build dashboards and SQL analyses.
Requirements
SQL, Python, statistics.
Technologies
SQL, Python`,
  },
];

{
  const stem = documentFileStem('Google', 'AI Intern');
  if (stem === 'google_ai_intern' && tailoredCvFileName('Google', 'AI Intern') === 'google_ai_intern_tailored_cv.pdf' && coverLetterFileName('Microsoft', 'ML Intern') === 'microsoft_ml_intern_cover_letter.pdf' && tailoredCvFileName('Company X', 'Data Science Intern') === 'companyx_data_science_intern_tailored_cv.pdf') {
    pass('Job-specific PDF names follow company_role_tailored_cv.pdf');
  } else fail(`Unexpected stems: ${stem} / ${tailoredCvFileName('Company X', 'Data Science Intern')}`);
}

{
  const before = isolateMasterCv(masterCv);
  const copy = isolateProfile(profile);
  copy.identity.name = 'MUTATED';
  if (before === masterCv && profile.identity.name === 'ABDUL SAMAD') {
    pass('Master CV and profile are isolated copies — originals stay frozen');
  } else fail('Isolation mutated the master CV or profile');
}

{
  const sections = extractJobSections(jobs[0].description);
  if (sections.responsibilities.some((l) => /fine-tune/i.test(l)) && sections.requirements.some((l) => /pytorch/i.test(l)) && sections.technologies.includes('Python')) {
    pass('JD sections extract responsibilities, requirements, and technologies without inventing them');
  } else fail(`Sections were ${JSON.stringify(sections)}`);
}

{
  const frozen = freezeJobRecord(jobs[0], 'job-google');
  if (frozen.job_id === 'job-google' && frozen.company === 'Google' && frozen.skills.length + frozen.requirements.length > 0) {
    pass('Normalized Job object is frozen per application id');
  } else fail('Job freeze dropped fields');
}

{
  const leak = qualityCheckDocuments({
    job: jobs[1],
    profile,
    documents: {
      cvText: 'ABDUL SAMAD applying to Microsoft. Also mentioned Google AI Intern by mistake.',
      coverLetter: 'Dear Microsoft hiring team',
    },
    foreignCompanies: ['Google', 'Company X'],
    masterCv,
  });
  if (!leak.ok && leak.leaked.includes('Google')) {
    pass('Quality check blocks a Google leak into the Microsoft documents');
  } else fail(`Leak check missed Google: ${JSON.stringify(leak)}`);
}

{
  const received = [];
  const masterBefore = String(masterCv);
  const packs = [];
  for (const job of jobs) {
    const pack = await generateJobDocuments({
      jobId: `id-${job.company}`,
      job,
      profile,
      masterCv,
      foreignCompanies: jobs.filter((row) => row.company !== job.company).map((row) => row.company),
      tailorDocuments: async ({ opportunity, cvText }) => {
        received.push({ company: opportunity.company, title: opportunity.title, cv: cvText, jobId: opportunity.job_id });
        return {
          usedExistingEngine: true,
          cvText: `${profile.identity.name}\nTailored for ${opportunity.company} ${opportunity.title}. Python, SQL, Git. SentimentBot.\n${(opportunity.requirements || []).join(' ')} ${(opportunity.technologies || []).join(' ')}`,
          cvHtml: `<html>${opportunity.company}</html>`,
          coverLetter: `Dear ${opportunity.company} team, I am applying for ${opportunity.title}. I use Python and Git on SentimentBot.`,
          coverHtml: `<p>${opportunity.company}</p>`,
        };
      },
    });
    packs.push(pack);
  }
  const names = packs.map((p) => p.files.cvName);
  const covers = packs.map((p) => p.coverLetter);
  const cvs = packs.map((p) => p.cvText);
  const companiesSeen = received.map((r) => r.company).join(',');
  const idsBound = packs.every((p, i) => p.files.job_id === `id-${jobs[i].company}` && p.job.job_id === `id-${jobs[i].company}`);
  const different = cvs[0] !== cvs[1] && cvs[1] !== cvs[2] && covers[0] !== covers[1];
  const noLeak =
    !cvs[0].includes('Microsoft') &&
    !cvs[1].includes('Google') &&
    !covers[2].includes('Google') &&
    !covers[2].includes('Microsoft');
  const engineGotIsolatedMaster = received.every((r) => r.cv === masterBefore);
  if (
    names[0] === 'google_ai_intern_tailored_cv.pdf' &&
    names[1] === 'microsoft_ml_intern_tailored_cv.pdf' &&
    names[2] === 'companyx_data_science_intern_tailored_cv.pdf' &&
    companiesSeen === 'Google,Microsoft,Company X' &&
    idsBound &&
    different &&
    noLeak &&
    engineGotIsolatedMaster &&
    masterBefore === masterCv &&
    packs.every((p) => p.quality.ok && p.usedExistingEngine)
  ) {
    pass('Three jobs get three different engine-tailored CVs/letters, unique files, no company leak, master CV unchanged');
  } else {
    fail(`Document isolation failed: ${JSON.stringify({ names, companiesSeen, different, noLeak, idsBound, quality: packs.map((p) => p.quality.ok) })}`);
  }
}

{
  resetUrlApplyBatchesForTests();
  const batch = createUrlApplyBatch([
    'https://careers.google.com/jobs/ai-intern',
    'https://careers.microsoft.com/jobs/ml-intern',
    'https://companyx.example/jobs/ds-intern',
  ]);
  const tailoredJobs = [];
  await runUrlApplyBatch(batch.id, {
    profile,
    cvText: masterCv,
    extractExternalJob: async ({ url }) => {
      const job = url.includes('google') ? jobs[0] : url.includes('microsoft') ? jobs[1] : jobs[2];
      return { hasDescription: true, job: normalizeExternalJob({ url, ...job }) };
    },
    tailorUrlApplyDocuments: async ({ opportunity }) => {
      tailoredJobs.push(`${opportunity.company}::${opportunity.title}`);
      return {
        usedExistingEngine: true,
        cvText: `${profile.identity.name} CV for ${opportunity.company} ${opportunity.title}. Python SQL Git SentimentBot ${opportunity.description}`,
        cvHtml: `<html>${opportunity.company}-${opportunity.job_id}</html>`,
        coverLetter: `Dear ${opportunity.company}, applying for ${opportunity.title}. Python and SQL on SentimentBot.`,
        coverHtml: `<p>${opportunity.company}</p>`,
      };
    },
    runStudentCareerLiveApply: async ({ company, prebuiltDocuments, artifactStem }) => ({
      filledCount: 2,
      steps: [{ fieldId: 'name', label: 'Name', ok: true }],
      issues: [],
      message: `${company} filled with ${artifactStem}`,
      cvPath: prebuiltDocuments?.cvText ? `${artifactStem}_tailored_cv.pdf` : '',
    }),
    listingUrl: { isCredibleListingUrl: () => true },
    withChromeLock: (fn) => fn(),
  });
  const after = getUrlApplyBatch(batch.id);
  const files = after.jobs.map((j) => j.files?.cvName);
  const htmlBound = tailoredJobs.length === 3 && new Set(tailoredJobs).size === 3;
  if (
    after.jobs.every((j) => j.phase === URL_APPLY_PHASE.COMPLETED) &&
    files[0] === 'google_ai_intern_tailored_cv.pdf' &&
    files[1] === 'microsoft_ml_intern_tailored_cv.pdf' &&
    files[2] === 'companyx_data_science_intern_tailored_cv.pdf' &&
    after.jobs[0].files.job_id !== after.jobs[1].files.job_id &&
    htmlBound
  ) {
    pass('Batch of 3 URLs stores a unique tailored CV file on each application record');
  } else fail(`Batch file binding failed: ${JSON.stringify(files)} ${JSON.stringify(tailoredJobs)} ${after.jobs.map((j) => j.phase)}`);
}

{
  resetUrlApplyBatchesForTests();
  const batch = createUrlApplyBatch(['https://careers.google.com/jobs/ai', 'https://careers.microsoft.com/jobs/ml']);
  await runUrlApplyBatch(batch.id, {
    profile,
    cvText: masterCv,
    extractExternalJob: async ({ url }) => {
      const job = url.includes('google') ? jobs[0] : jobs[1];
      return { hasDescription: true, job: normalizeExternalJob({ url, ...job }) };
    },
    tailorUrlApplyDocuments: async ({ opportunity }) => ({
      usedExistingEngine: true,
      cvText: opportunity.company === 'Microsoft'
        ? `${profile.identity.name} Microsoft CV that also names Google AI Intern`
        : `${profile.identity.name} Google AI Intern CV. Python PyTorch Git SentimentBot`,
      cvHtml: `<html>${opportunity.company}</html>`,
      coverLetter: `Dear ${opportunity.company}, ${opportunity.title}. Python Git SentimentBot`,
      coverHtml: `<p>${opportunity.company}</p>`,
    }),
    runStudentCareerLiveApply: async () => ({ filledCount: 1, steps: [{ fieldId: 'n', label: 'Name', ok: true }], issues: [], message: 'filled' }),
    listingUrl: { isCredibleListingUrl: () => true },
    withChromeLock: (fn) => fn(),
  });
  const after = getUrlApplyBatch(batch.id);
  if (after.jobs[0].phase === URL_APPLY_PHASE.COMPLETED && after.jobs[1].phase === URL_APPLY_PHASE.FAILED && /leak/i.test(after.jobs[1].error || '')) {
    pass('Microsoft documents that leak Google are rejected and not attached to Application B');
  } else fail(`Leak rejection failed: ${after.jobs.map((j) => `${j.phase}:${j.error || ''}`).join(' | ')}`);
}
