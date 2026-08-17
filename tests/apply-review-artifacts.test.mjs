import { fail, pass } from "./helpers.mjs";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MOD = pathToFileURL(join(ROOT, "web/src/lib/apply/apply-review-artifacts.mjs")).href;
const {
  isRebuiltTemplateCv,
  isFormatPreservingCv,
  findApplyArtifacts,
  isSafeArtifactPath,
} = await import(MOD);

console.log("\napply-review-artifacts — preview the attached master-format CV, not a rebuilt template");

const rebuilt = `<!DOCTYPE html><html><head>
<style>/* Themeable tokens (#1837): overridable via config/profile.yml */</style>
</head><body>
<h2>CORE COMPETENCIES</h2>
<div class="tags">python jupyter</div>
<p>GitHub repository containing the student's Agentic AI Labs.</p>
</body></html>`;

const preserving = `<!DOCTYPE html><html><head>
<style>body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; }</style>
</head><body>
<h1>ABDUL SAMAD</h1>
<h2>TECHNICAL SKILLS</h2>
<p>Python, REST APIs</p>
<h2>CERTIFICATIONS</h2>
<p>Introduction to Modern AI</p>
</body></html>`;

{
  if (isRebuiltTemplateCv(rebuilt) && !isFormatPreservingCv(rebuilt)) {
    pass("Detects career-ops template rebuilds (Themeable tokens / GitHub-lab blurbs)");
  } else fail("Missed rebuilt template CV");
}

{
  if (isFormatPreservingCv(preserving) && !isRebuiltTemplateCv(preserving)) {
    pass("Detects format-preserving Calibri / TECHNICAL SKILLS copy");
  } else fail("Missed format-preserving CV");
}

const root = join(tmpdir(), `career-ops-artifacts-${Date.now()}`);
try {
  const jobDir = join(root, "output", "apply", "urljob-f4ac1160-0ed1-4348-b3b1-17a2fb180ea5");
  const companyDir = join(root, "output", "apply", "xsolla-ai-first-engineering-intern");
  const reviewDir = join(root, "data", "apply-review");
  mkdirSync(jobDir, { recursive: true });
  mkdirSync(companyDir, { recursive: true });
  mkdirSync(reviewDir, { recursive: true });
  writeFileSync(join(jobDir, "xsolla_ai_first_engineering_intern_tailored_cv.html"), preserving);
  writeFileSync(join(jobDir, "xsolla_ai_first_engineering_intern_tailored_cv.pdf"), "%PDF-1.4 tailored");
  writeFileSync(join(jobDir, "xsolla_ai_first_engineering_intern_tailored_cv.txt"), "ABDUL SAMAD\nTECHNICAL SKILLS\nPython");
  writeFileSync(join(jobDir, "xsolla_ai_first_engineering_intern_cover_letter.pdf"), "%PDF-1.4 cover");
  writeFileSync(join(jobDir, "xsolla_ai_first_engineering_intern_cover_letter.txt"), "Dear Hiring Manager");
  writeFileSync(join(companyDir, "resume.html"), rebuilt);
  writeFileSync(join(companyDir, "resume.pdf"), "%PDF-1.4 rebuilt");
  writeFileSync(join(reviewDir, "xsolla-ai-first-engineering-intern-resume.html"), rebuilt);
  writeFileSync(join(reviewDir, "xsolla-ai-first-engineering-intern-resume.pdf"), "%PDF-1.4 rebuilt-review");

  const found = findApplyArtifacts({
    roots: [root],
    company: "xsolla",
    role: "AI-First Engineering Intern",
  });

  if (found.cvPdf.endsWith("xsolla_ai_first_engineering_intern_tailored_cv.pdf")) {
    pass("Prefers output/apply urljob *_tailored_cv.pdf over company-role template resume");
  } else fail(`Picked the wrong CV PDF: ${found.cvPdf}`);

  if (found.html.includes("TECHNICAL SKILLS") && !found.html.includes("Themeable tokens")) {
    pass("HTML preview is the format-preserving copy, not the rebuilt template");
  } else fail("HTML preview still loaded the rebuilt template");

  const withJob = findApplyArtifacts({
    roots: [root],
    company: "xsolla",
    role: "AI-First Engineering Intern",
    jobId: "urljob-f4ac1160-0ed1-4348-b3b1-17a2fb180ea5",
  });
  if (withJob.cvPdf.includes("urljob-f4ac1160")) {
    pass("Job id pins the urljob tailored PDF");
  } else fail(`Job-scoped lookup missed urljob PDF: ${withJob.cvPdf}`);

  if (
    isSafeArtifactPath(found.cvPdf, [root]) &&
    !isSafeArtifactPath(join(root, "docs", "cv.docx"), [root])
  ) {
    pass("File serving only allows output/apply and data/apply-review");
  } else fail("Artifact path sandbox is too loose or too strict");
} finally {
  rmSync(root, { recursive: true, force: true });
}
