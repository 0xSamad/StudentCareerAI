import { fail, pass, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ATS = pathToFileURL(join(ROOT, 'web/src/lib/apply/ats-cv-from-profile.mjs')).href;
const COPY = pathToFileURL(join(ROOT, 'web/src/lib/apply/cv-copy-tailor.mjs')).href;
const STORE = pathToFileURL(join(ROOT, 'web/src/lib/apply/user-cv-store.mjs')).href;
const STORAGE = pathToFileURL(join(ROOT, 'lib/saas/storage/local-storage.mjs')).href;
const MERGE = pathToFileURL(join(ROOT, 'lib/saas/database/merge-profile.mjs')).href;

const {
  composeAtsCvFromProfile,
  tailorUserCvForJob,
  resolveApplyCv,
} = await import(ATS);
const { fileSha256, masterCvDocxPath, extractDocxText, fillAtsFormatDocx } = await import(COPY);
const { saveOriginalCv, loadOriginalCv, originalStorageKey } = await import(STORE);
const { LocalStorageService } = await import(STORAGE);
const { mergeProfileRecord } = await import(MERGE);

console.log('\nats-cv-from-profile — generated ATS CV is per-user and does not copy template facts');

const ali = {
  identity: {
    name: 'Ali Hassan',
    email: 'ali@example.com',
    github: 'https://github.com/alihassan',
    linkedin: 'https://linkedin.com/in/alihassan',
    city: 'Lahore',
    country: 'Pakistan',
  },
  education: [
    { university: 'LUMS', degree: 'BS', major: 'Computer Science', gpa: 3.7, gpa_scale: 4.0 },
    { university: 'LUMS', degree: 'Bachelor of Science', major: 'Computer Science' },
  ],
  skills: { programming_languages: ['Python', 'python'], frameworks: ['Flask'] },
  experience: { internships: [], jobs: [] },
  projects: [{ name: 'SentimentBot', description: 'NLP classifier', technologies: ['Python'] }],
  certifications: ['AWS Cloud Practitioner', 'AWS Cloud Practitioner', 'AWS Certified Cloud Practitioner'],
  achievements: ['AWS Cloud Practitioner', 'Dean\'s List'],
  languages: ['English', 'english'],
  preferences: { target_roles: ['Machine Learning Intern'] },
};

{
  const text = composeAtsCvFromProfile({
    profile: ali,
    githubProjects: [{ name: 'SentimentBot', description: 'same repo', technologies: ['Python'] }],
    linkedinText: `EDUCATION\nBS Computer Science — LUMS\nCERTIFICATIONS\nAWS Cloud Practitioner\n`,
  });
  const eduBlock = text.split('EDUCATION')[1]?.split('PROJECTS')[0] || '';
  const certBlock = text.split('CERTIFICATIONS')[1]?.split('ACHIEVEMENTS')[0] || '';
  const lumsCount = (eduBlock.match(/LUMS/gi) || []).length;
  const awsCount = (certBlock.match(/AWS/gi) || []).length;
  const ok =
    /ALI HASSAN/.test(text) &&
    /SentimentBot/.test(text) &&
    lumsCount === 1 &&
    awsCount === 1 &&
    !/ABDUL SAMAD|HackerOne|eJPT|IMS Peshawar/i.test(text);
  if (ok) pass('Compose dedupes education and certs and stays on this user\'s facts');
  else fail(`Compose leaked or duplicated: edu=${lumsCount} aws=${awsCount}\n${text.slice(0, 400)}`);
}

{
  const masterPath = masterCvDocxPath(ROOT);
  const before = readFileSync(masterPath);
  const beforeHash = fileSha256(before);
  const tailored = await tailorUserCvForJob({
    profile: ali,
    root: ROOT,
    company: 'Careem',
    role: 'Machine Learning Intern',
    jdText: 'Python SQL intern. Git required.',
  });
  const afterHash = fileSha256(readFileSync(masterPath));
  const text = tailored?.text || '';
  if (afterHash === beforeHash) pass('Format template docs/cv.docx is never overwritten');
  else fail('docs/cv.docx was modified while generating an ATS CV');
  if (
    tailored?.source === 'generated' &&
    /ALI HASSAN/.test(text) &&
    /Careem|Machine Learning Intern/i.test(text) &&
    !/ABDUL SAMAD|HackerOne|eJPT|IMS Peshawar/i.test(text)
  ) {
    pass('Generated + tailored CV uses Ali\'s facts and the ATS format only');
  } else fail(`Generated CV leaked template owner facts: ${text.slice(0, 280)}`);
}

{
  const atsText = composeAtsCvFromProfile({ profile: ali });
  const generated = fillAtsFormatDocx({ root: ROOT, atsText });
  const originalHash = fileSha256(generated);
  const copy = Buffer.from(generated);
  const tailored = await tailorUserCvForJob({
    profile: ali,
    originalBuffer: copy,
    originalFilename: 'ali.docx',
    originalMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    root: ROOT,
    company: 'Careem',
    role: 'Data Intern',
    jdText: 'Python SQL intern',
  });
  if (fileSha256(copy) === originalHash && tailored?.source === 'upload') {
    pass('Uploaded original buffer is not mutated during tailoring');
  } else fail('Original upload bytes changed or upload source was not used');
}

{
  const dir = mkdtempSync(join(tmpdir(), 'cv-store-'));
  try {
    const storage = new LocalStorageService({ baseDir: dir });
    const bytesA = Buffer.from('user-a-original-cv');
    const bytesB = Buffer.from('user-b-original-cv');
    const recA = await saveOriginalCv({
      storage,
      buffer: bytesA,
      filename: 'a.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      context: { tenantId: 't1', userId: 'u1' },
    });
    await saveOriginalCv({
      storage,
      buffer: bytesB,
      filename: 'b.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      context: { tenantId: 't2', userId: 'u2' },
    });
    const loadedA = await loadOriginalCv({ storage, record: recA, context: { tenantId: 't1', userId: 'u1' } });
    const loadedB = await loadOriginalCv({
      storage,
      record: { storageKey: originalStorageKey('b.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') },
      context: { tenantId: 't2', userId: 'u2' },
    });
    const isolated =
      loadedA.buffer.toString() === 'user-a-original-cv' &&
      loadedB.buffer.toString() === 'user-b-original-cv' &&
      recA.storageKey === originalStorageKey('a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    if (isolated) pass('Original CVs are stored per tenant and user');
    else fail('Original CV storage leaked across users');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const merged = mergeProfileRecord(
    { identity: { name: 'Ali' }, cvOriginal: { storageKey: 'cvs/original/master.docx', filename: 'cv.docx' }, cvText: 'keep' },
    { identity: { city: 'Lahore' }, cvText: '' }
  );
  if (merged.cvOriginal?.storageKey === 'cvs/original/master.docx' && merged.cvText === 'keep' && merged.identity.city === 'Lahore') {
    pass('Empty profile updates keep cvOriginal and cvText');
  } else fail('cvOriginal or cvText was wiped on merge');
}

{
  const resolved = await resolveApplyCv({
    profile: ali,
    fetchGitHubEvidence: async () => ({
      facts: [{ factType: 'project', value: 'NewsRanker', evidence: 'Technologies: Python\nDescription: ranking' }],
    }),
    root: ROOT,
  });
  if (/NewsRanker/.test(resolved.text) && /SentimentBot/.test(resolved.text)) {
    pass('GitHub evidence is merged into a generated ATS CV');
  } else fail('GitHub projects were not merged');
}
