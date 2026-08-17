import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fail, pass, ROOT } from "./helpers.mjs";
import { pathToFileURL } from "node:url";

const MOD = pathToFileURL(join(ROOT, "web/src/lib/apply/cover-letter-engine.mjs")).href;
const { composeCoverLetter, validateCoverLetter } = await import(MOD);
const cvText = readFileSync(join(ROOT, "cv.md"), "utf8");
const profile = {
  identity: { name: "ABDUL SAMAD", email: "okzsamad57@gmail.com", phone: "+92 304-1093329", city: "Peshawar", country: "Pakistan" },
};

console.log("\ncover-letter-engine — unique, attested, role-aware letters");

const jobs = [
  {
    id: "ai",
    company: "Xsolla",
    role: "AI Intern",
    jdText: "AI-First Engineering Intern. Python, machine learning coursework, REST APIs, LLMs.",
  },
  {
    id: "data",
    company: "Careem",
    role: "Data Science Intern",
    jdText: "Python SQL data analysis intern. Requirements: Python, SQL, Git.",
  },
  {
    id: "sec",
    company: "Acme",
    role: "Cybersecurity Intern",
    jdText: "OWASP XSS Burp Suite Nmap penetration testing Nuclei CTF.",
  },
];

const letters = {};
for (const job of jobs) {
  letters[job.id] = composeCoverLetter({ cvText, profile, ...job });
}

{
  const bodies = jobs.map((j) => letters[j.id].body);
  const unique = new Set(bodies).size === 3;
  const named = bodies.every((b, i) => b.includes(jobs[i].company) && b.includes(jobs[i].role));
  if (unique && named) pass("Three jobs produce three different letters with the right company and title");
  else fail("Cover letters were reused or mis-addressed");
}

{
  const ai = letters.ai.body;
  const sec = letters.sec.body;
  const data = letters.data.body;
  const aiOk =
    /Introduction to Modern AI|coursework in AI/i.test(ai) &&
    /Python/i.test(ai) &&
    !/eJPT|PT1|OWASP Top 10/i.test(ai) &&
    !/TensorFlow|PyTorch|pandas/i.test(ai);
  const secOk = /HackerOne|OWASP|eJPT|penetration/i.test(sec) && /Acme/.test(sec);
  const dataOk = /Python/i.test(data) && /SQL|MySQL/i.test(data) && !/TensorFlow|PyTorch/i.test(data);
  if (aiOk && secOk && dataOk) pass("Evidence selection follows the role, not a universal security template");
  else fail(`Role evidence off\nAI:${ai.slice(0, 280)}\nDATA:${data.slice(0, 220)}\nSEC:${sec.slice(0, 220)}`);
}

{
  let ok = true;
  for (const job of jobs) {
    const letter = letters[job.id];
    if (!letter.validation.ok) {
      ok = false;
      fail(`Validation failed for ${job.id}: ${letter.validation.reasons.join(", ")}`);
    }
  }
  if (ok) pass("Each generated letter passes quality control");
}

{
  const fake = composeCoverLetter({
    cvText,
    profile,
    company: "Careem",
    role: "Data Science Intern",
    jdText: "Python SQL",
  }).body.replace("Careem", "Amazon");
  const check = validateCoverLetter(fake, letters.data.brief, { foreignCompanies: ["Amazon"] });
  if (!check.ok && check.reasons.some((r) => /leak:Amazon|missing-company/.test(r))) {
    pass("Validator catches a previous-company leak");
  } else fail(`Leak not caught: ${check.reasons.join(", ")}`);
}

{
  const invented = `${letters.ai.body}\nI built production-scale TensorFlow and PyTorch LLM systems.`;
  const check = validateCoverLetter(invented, letters.ai.brief);
  if (!check.ok && check.reasons.some((r) => /unattested/.test(r))) pass("Validator rejects unattested tools");
  else fail(`Invented tools slipped through: ${check.reasons.join(", ")}`);
}
