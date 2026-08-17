import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fail, pass, ROOT } from "./helpers.mjs";
import { pathToFileURL } from "node:url";

const MOD = pathToFileURL(join(ROOT, "web/src/lib/apply/cv-copy-tailor.mjs")).href;
const { tailorMasterCvDocx, extractDocxText, fileSha256, masterCvDocxPath } = await import(MOD);

console.log("\ncv-copy-tailor — clone docs/cv.docx, do not redesign it");

const masterPath = masterCvDocxPath(ROOT);
const before = readFileSync(masterPath);
const beforeHash = fileSha256(before);

const jobs = [
  {
    id: "sec",
    company: "Acme",
    role: "Cybersecurity Intern",
    jdText: "OWASP XSS Burp Suite Nmap penetration testing Nuclei CTF",
  },
  {
    id: "data",
    company: "Careem",
    role: "Data Science Intern",
    jdText: "Python SQL data analysis pandas intern. TensorFlow and PyTorch preferred.",
  },
  {
    id: "ai",
    company: "Xsolla",
    role: "AI Intern",
    jdText: "AI-First Engineering Intern. Python, machine learning coursework, REST APIs.",
  },
];

const results = {};
for (const job of jobs) {
  results[job.id] = tailorMasterCvDocx({ root: ROOT, ...job });
}

{
  const after = readFileSync(masterPath);
  if (fileSha256(after) === beforeHash) pass("docs/cv.docx is never overwritten");
  else fail("Master docs/cv.docx was modified");
}

{
  const headings = ["PROFESSIONAL SUMMARY", "TECHNICAL SKILLS", "WORK EXPERIENCE", "EDUCATION", "ACHIEVEMENTS", "CERTIFICATIONS", "LANGUAGES", "INTERESTS"];
  let ok = true;
  for (const job of jobs) {
    const text = results[job.id]?.text || "";
    const idx = headings.map((h) => text.indexOf(h));
    if (idx.some((i) => i < 0) || idx.some((v, i) => i > 0 && v < idx[i - 1])) ok = false;
    if (/CORE COMPETENCIES|career-intelligent-agent|TensorFlow|PyTorch/i.test(text)) ok = false;
    if (!/HackerOne/.test(text) || !/eJPT/.test(text) || !/3\.85/.test(text)) ok = false;
    if (!new RegExp(job.company).test(text)) ok = false;
  }
  if (ok) pass("All three copies keep master sections, facts, and skip invented skills/projects");
  else fail("A tailored copy dropped structure or invented content");
}

{
  const sec = results.sec.text;
  const data = results.data.text;
  const ai = results.ai.text;
  const sameDesign = /ABDUL SAMAD/.test(sec) && /ABDUL SAMAD/.test(data) && /ABDUL SAMAD/.test(ai);
  const different =
    /Cybersecurity Intern Candidate/.test(sec) &&
    /Data Science Intern Candidate/.test(data) &&
    /AI Intern Candidate/.test(ai) &&
    sec !== data &&
    data !== ai;
  const dataSkills = data.split("TECHNICAL SKILLS")[1].split("WORK EXPERIENCE")[0];
  const secSkills = sec.split("TECHNICAL SKILLS")[1].split("WORK EXPERIENCE")[0];
  const dataPythonFirst = dataSkills.indexOf("Programming") < dataSkills.indexOf("Penetration Testing");
  const secPentestFirst = secSkills.indexOf("Penetration Testing") < secSkills.indexOf("Programming");
  if (sameDesign && different && dataPythonFirst && secPentestFirst) {
    pass("Cyber / Data / AI copies differ in emphasis and share the master design");
  } else fail("The three role copies did not diverge correctly");
}

{
  const hashes = new Set(jobs.map((j) => results[j.id].outputHash));
  if (hashes.size === 3 && ![...hashes].includes(beforeHash)) pass("Each job gets its own copy; none equals the master bytes");
  else fail("Job copies were not isolated from the master / each other");
}

{
  const aiSum = results.ai.text.split("PROFESSIONAL SUMMARY")[1].split("TECHNICAL SKILLS")[0];
  const secSum = results.sec.text.split("PROFESSIONAL SUMMARY")[1].split("TECHNICAL SKILLS")[0];
  const dataSum = results.data.text.split("PROFESSIONAL SUMMARY")[1].split("TECHNICAL SKILLS")[0];
  const aiOk =
    /coursework in AI/i.test(aiSum) &&
    /Python/i.test(aiSum) &&
    /Introduction to Modern AI/i.test(aiSum) &&
    !/strong foundation in cybersecurity and penetration testing/i.test(aiSum) &&
    !/TensorFlow|PyTorch/i.test(aiSum);
  const secOk = /cybersecurity|penetration testing|OWASP|HackerOne/i.test(secSum);
  const dataOk = /Python/i.test(dataSum) && /SQL|MySQL/i.test(dataSum) && !/TensorFlow|PyTorch/i.test(dataSum);
  if (aiOk && secOk && dataOk) pass("Summaries are role-specific and stay inside attested facts");
  else fail(`Summaries off: ai=${aiSum.slice(0, 220)}`);
}

{
  const zipMod = pathToFileURL(join(ROOT, "web/src/lib/apply/docx-zip.mjs")).href;
  const { unzip } = await import(zipMod);
  const xml = unzip(results.ai.buffer).get("word/document.xml").toString("utf8");
  const paras = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
  const skill = paras.find((p) => /Programming &amp; Scripting:/.test(p) || /Programming & Scripting:/.test(p));
  const runs = skill ? skill.match(/<w:r\b[\s\S]*?<\/w:r>/g) || [] : [];
  const labelRun = runs[0] || "";
  const valueRun = runs[1] || "";
  const labelBold = /<w:b\b/.test(labelRun);
  const valueBold = /<w:b\b/.test(valueRun);
  if (skill && runs.length >= 2 && labelBold && !valueBold && /Python/.test(valueRun)) {
    pass("Skill lines bold only the label before the colon");
  } else fail(`Skill bolding: runs=${runs.length} labelBold=${labelBold} valueBold=${valueBold}`);
}

{
  const html = results.ai.html || "";
  const labeled = /<strong>Programming(?: &amp;|&) Scripting:<\/strong>\s*Python/.test(html);
  const wholeLineBold = /<strong>Programming(?: &amp;|&) Scripting: Python/.test(html);
  if (labeled && !wholeLineBold) pass("HTML skills bold only the label before the colon");
  else fail("HTML skill labels were not split at the colon");
}
