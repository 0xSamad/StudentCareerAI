import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { studentCareerRoot } from "@/lib/student-career-ai";
import { answersFromProfile, advertisedSalaryFromJd, candidateFacts, latestEmployment } from "./answers-from-profile.mjs";
import { completeFormAnswers } from "./guess-form-answers.mjs";
import { renderHtmlToPdf } from "./html-to-pdf";
import {
  defaultSurveyAnswers,
  tailorCoverLetter,
  tailorCoverLetterHtml,
  tailorCvHtml,
  tailorCvText,
} from "./tailor-documents.mjs";
import { tailorUserCvForJob } from "./ats-cv-from-profile.mjs";
import { fillSession, handoffSession, openSession, advanceSession, getSession, extractCurrent, sessionHasInteractiveCaptcha, waitForFormChange } from "./session";
import { fillGoogleIdentifier } from "./diagnose";
import { planFormTurn, setFormAgentPersistPath, loadFormAgentPersist, formAgentResumeKey, answersExcludingFilled, fieldAlreadyValued } from "./form-agent.mjs";
import { prepareIntelligentForm } from "./form-agent-browser";
import type { ApplyField } from "./extract";

export { answersFromProfile, candidateFacts, latestEmployment };

async function captureApplyPreview(_page: unknown, _force = false): Promise<string | undefined> {
  return undefined;
}

type FillProgressInfo = {
  sessionId: string;
  extracted: string[];
  completed: string[];
  pending: string[];
  log?: string;
  preview?: string;
};

async function emitFillProgress(
  page: unknown,
  onFillProgress: ((info: FillProgressInfo) => void) | null | undefined,
  info: Omit<FillProgressInfo, "preview">,
  force = false,
) {
  const preview = await captureApplyPreview(page, force);
  onFillProgress?.({ ...info, preview });
}

type ProfileLike = {
  identity?: {
    name?: string;
    email?: string;
    phone?: string;
    city?: string;
    country?: string;
    linkedin?: string;
    github?: string;
    portfolio?: string;
    gender?: string;
  };
  education?: Array<{ university?: string; degree?: string; major?: string }>;
  experience?:
    | Array<{ company?: string; role?: string; title?: string; organization?: string }>
    | {
        internships?: Array<{ company?: string; role?: string; title?: string }>;
        jobs?: Array<{ company?: string; role?: string; title?: string }>;
      };
};

export function slugPart(value: string) {
  return (value.toLowerCase().match(/[a-z0-9]+/g) || []).join("-").slice(0, 48);
}

export function applyArtifactSlug(company = "", role = "") {
  const companySlug = slugPart(company || "company") || "company";
  const roleSlug = slugPart(role).slice(0, 40);
  return roleSlug ? `${companySlug}-${roleSlug}` : companySlug;
}

function attachFileBase(name: string, company: string, role: string) {
  const parts = [slugPart(name) || "resume", slugPart(company), slugPart(role).slice(0, 40)].filter(Boolean);
  return parts.join("-").slice(0, 90) || "resume";
}

/** Write text; on Windows EBUSY (file open in editor), fall back to a unique name. */
function writeTextSafe(preferred: string, body: string, fallbackDir: string, fallbackName: string): string {
  mkdirSync(dirname(preferred), { recursive: true });
  mkdirSync(fallbackDir, { recursive: true });
  try {
    writeFileSync(preferred, body, "utf8");
    return preferred;
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
    if (!/^(EBUSY|EPERM|EACCES)$/i.test(code)) throw err;
    const alt = join(fallbackDir, fallbackName);
    writeFileSync(alt, body, "utf8");
    return alt;
  }
}

function copyFileSafe(src: string, preferred: string, fallbackDir: string, fallbackName: string): string {
  mkdirSync(dirname(preferred), { recursive: true });
  mkdirSync(fallbackDir, { recursive: true });
  try {
    copyFileSync(src, preferred);
    return preferred;
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
    if (!/^(EBUSY|EPERM|EACCES)$/i.test(code)) throw err;
    const alt = join(fallbackDir, fallbackName);
    copyFileSync(src, alt);
    return alt;
  }
}

const PLAN_TURN_BUDGET_MS = 8000;

function withBudget<T>(ms: number, work: () => Promise<T>, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    work().then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function fillableEmpty(fields: ApplyField[], touched: Set<string>, waitingSeen: Set<string>) {
  return fields.filter(
    (f) => f.type !== "file" && !touched.has(f.id) && !waitingSeen.has(f.id) && !fieldAlreadyValued(f),
  );
}

export async function writeApplyArtifacts({
  cvText,
  cvHtml = "",
  cvDocx = null,
  coverLetter,
  coverHtml = "",
  company = "",
  role = "",
  candidateName = "",
  artifactKey = "",
  artifactStem = "",
}: {
  cvText: string;
  cvHtml?: string;
  cvDocx?: Buffer | Uint8Array | null;
  coverLetter: string;
  coverHtml?: string;
  company?: string;
  role?: string;
  candidateName?: string;
  artifactKey?: string;
  artifactStem?: string;
}) {
  const slug = slugPart(artifactKey) || applyArtifactSlug(company, role);
  const stamp = `${Date.now()}`;
  const outDir = join(studentCareerRoot(), "output", "apply", slug);
  const reviewDir = join(studentCareerRoot(), "data", "apply-review");
  const attachDir = join(tmpdir(), "student-career-ai-apply", slug, stamp);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(reviewDir, { recursive: true });
  mkdirSync(attachDir, { recursive: true });

  const fileBase = attachFileBase(candidateName || "resume", company, role);
  const cvPdfName = artifactStem ? `${artifactStem}_tailored_cv.pdf` : `${fileBase}.pdf`;
  const coverPdfName = artifactStem ? `${artifactStem}_cover_letter.pdf` : `${fileBase}-cover-letter.pdf`;
  const cvOutName = artifactStem ? `${artifactStem}_tailored_cv.pdf` : "resume.pdf";
  const coverOutName = artifactStem ? `${artifactStem}_cover_letter.pdf` : "cover-letter.pdf";
  let cvPath: string | null = null;
  let coverPath: string | null = null;
  let htmlPath: string | null = null;
  const attachNotes: string[] = [];

  if (cvDocx && cvDocx.byteLength) {
    const docxName = artifactStem ? `${artifactStem}_tailored_cv.docx` : `${fileBase}.docx`;
    const docxAttach = join(attachDir, docxName);
    writeFileSync(docxAttach, Buffer.from(cvDocx));
    copyFileSafe(docxAttach, join(outDir, artifactStem ? `${artifactStem}_tailored_cv.docx` : "resume.docx"), outDir, `resume-${stamp}.docx`);
    copyFileSafe(docxAttach, join(reviewDir, `${slug}-resume.docx`), reviewDir, `${slug}-resume-${stamp}.docx`);
  }

  if (cvHtml.trim()) {
    htmlPath = writeTextSafe(join(outDir, artifactStem ? `${artifactStem}_tailored_cv.html` : "resume.html"), cvHtml, outDir, `resume-${stamp}.html`);
    writeTextSafe(join(reviewDir, `${slug}-resume.html`), cvHtml, reviewDir, `${slug}-resume-${stamp}.html`);
    const pdfAttach = join(attachDir, cvPdfName);
    try {
      await renderHtmlToPdf(cvHtml, pdfAttach);
      cvPath = pdfAttach;
      copyFileSafe(pdfAttach, join(outDir, cvOutName), outDir, `resume-${stamp}.pdf`);
      copyFileSafe(pdfAttach, join(reviewDir, `${slug}-resume.pdf`), reviewDir, `${slug}-resume-${stamp}.pdf`);
    } catch (err) {
      attachNotes.push(`CV PDF render failed (${err instanceof Error ? err.message : "unknown"}); a text résumé will be attached instead.`);
    }
  }

  if (!cvPath && cvText.trim()) {
    cvPath = join(attachDir, artifactStem ? `${artifactStem}_tailored_cv.txt` : `${fileBase}.txt`);
    writeFileSync(cvPath, cvText, "utf8");
    if (!attachNotes.some((n) => /text résumé/i.test(n))) {
      attachNotes.push("A text résumé was attached so the CV field is not left empty.");
    }
  }

  // Keep a readable text copy for the review tab — never attach .txt to the ATS when a PDF exists.
  if (cvText.trim()) {
    writeTextSafe(join(outDir, artifactStem ? `${artifactStem}_tailored_cv.txt` : "resume.txt"), cvText, outDir, `resume-${stamp}.txt`);
    writeTextSafe(join(reviewDir, `${slug}-resume.txt`), cvText, reviewDir, `${slug}-resume-${stamp}.txt`);
  }

  if (coverLetter.trim()) {
    writeTextSafe(join(outDir, artifactStem ? `${artifactStem}_cover_letter.txt` : "cover-letter.txt"), coverLetter, outDir, `cover-letter-${stamp}.txt`);
    writeTextSafe(join(reviewDir, `${slug}-cover-letter.txt`), coverLetter, reviewDir, `${slug}-cover-letter-${stamp}.txt`);
    const coverHtmlBody = coverHtml.trim() || `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${coverLetter}</pre>`;
    writeTextSafe(join(reviewDir, `${slug}-cover-letter.html`), coverHtmlBody, reviewDir, `${slug}-cover-letter-${stamp}.html`);
    const coverPdf = join(attachDir, coverPdfName);
    try {
      await renderHtmlToPdf(coverHtmlBody, coverPdf);
      coverPath = coverPdf;
      copyFileSafe(coverPdf, join(outDir, coverOutName), outDir, `cover-letter-${stamp}.pdf`);
      copyFileSafe(coverPdf, join(reviewDir, `${slug}-cover-letter.pdf`), reviewDir, `${slug}-cover-letter-${stamp}.pdf`);
    } catch {
      // Textarea cover letters still get the plain text via answers; file fields need a PDF.
      coverPath = join(attachDir, artifactStem ? `${artifactStem}_cover_letter.txt` : `${fileBase}-cover-letter.txt`);
      writeFileSync(coverPath, coverLetter, "utf8");
      attachNotes.push("Cover letter PDF render failed; a text file was used instead.");
    }
  }

  return {
    cvPath,
    coverPath,
    htmlPath,
    cvPreview: cvText,
    cvHtml,
    coverLetterPreview: coverLetter,
    attachedAs: cvPath?.toLowerCase().endsWith(".pdf") ? "pdf" : cvPath ? "text" : "none",
    attachNotes,
    reviewPath: `/apply/review?company=${encodeURIComponent(company)}&role=${encodeURIComponent(role)}${artifactKey ? `&job=${encodeURIComponent(artifactKey)}` : ""}`,
  };
}

export async function runStudentCareerLiveApply({
  url,
  profile,
  company = "",
  cvText = "",
  role = "",
  jdText = "",
  prebuiltDocuments = null,
  artifactKey = "",
  artifactStem = "",
  useFormAgent = false,
  originalBuffer = null,
  originalFilename = "",
  originalMime = "",
  fetchGitHubEvidence = null,
  githubToken = "",
  onSessionOpen = null,
  onFillProgress = null,
}: {
  url: string;
  profile: ProfileLike | null | undefined;
  company?: string;
  cvText?: string;
  role?: string;
  jdText?: string;
  prebuiltDocuments?: {
    cvText?: string;
    cvHtml?: string;
    coverLetter?: string;
    coverHtml?: string;
    cvDocx?: Buffer | Uint8Array | null;
  } | null;
  artifactKey?: string;
  artifactStem?: string;
  useFormAgent?: boolean;
  originalBuffer?: Buffer | Uint8Array | null;
  originalFilename?: string;
  originalMime?: string;
  fetchGitHubEvidence?: ((input: Record<string, unknown>) => Promise<unknown>) | null;
  githubToken?: string;
  onSessionOpen?: ((sessionId: string) => void) | null;
  onFillProgress?: ((info: FillProgressInfo) => void) | null;
}) {
  const master = String(cvText || "").trim();
  const facts = candidateFacts(profile, master);
  const prebuilt = prebuiltDocuments && typeof prebuiltDocuments === "object" ? prebuiltDocuments : null;
  const masterCopy = !prebuilt?.cvText
    ? await tailorUserCvForJob({
        profile,
        cvText: master,
        originalBuffer,
        originalFilename,
        originalMime,
        root: studentCareerRoot(),
        company,
        role,
        jdText,
        fetchGitHubEvidence,
        githubToken,
      })
    : null;
  const tailoredCv = prebuilt?.cvText
    ? prebuilt.cvText
    : masterCopy?.text
      ? masterCopy.text
      : tailorCvText({ cvText: master, company, role, jdText });
  const tailoredHtml = prebuilt?.cvHtml
    ? prebuilt.cvHtml
    : masterCopy?.html
      ? masterCopy.html
      : tailorCvHtml({ cvText: master, company, role, jdText });
  const cover = prebuilt?.coverLetter ? prebuilt.coverLetter : tailorCoverLetter({ cvText: master, profile, company, role, jdText });
  const coverHtml = prebuilt?.coverHtml ? prebuilt.coverHtml : tailorCoverLetterHtml({ cvText: master, profile, company, role, jdText });
  // Open the listing in Chrome immediately — do not wait on PDF render or the
  // tab sits on about:blank while artifacts generate.
  const sessionPromise = openSession(url);
  const artifacts = await writeApplyArtifacts({
    cvText: tailoredCv,
    cvHtml: tailoredHtml,
    cvDocx: prebuilt?.cvDocx || masterCopy?.buffer || null,
    coverLetter: cover,
    coverHtml,
    company,
    role,
    candidateName: facts.name,
    artifactKey,
    artifactStem,
  });
  const survey = defaultSurveyAnswers();

  const session = await sessionPromise;
  const opened = getSession(session.id);
  if (opened) {
    opened.filledIds ??= new Set();
    opened.lastActiveAt = Date.now();
  }
  onSessionOpen?.(session.id);
  const firstPreview = session.shots?.at(-1) || (await captureApplyPreview(opened?.page, true));
  onFillProgress?.({
    sessionId: session.id,
    extracted: (session.fields || []).map((f) => f.label || f.id),
    completed: [],
    pending: [],
    log: "Opened the employer form — you can watch it below",
    preview: firstPreview,
  });
  await handoffSession(session.id).catch(() => {});
  const liveSess = getSession(session.id);
  const pageText = liveSess
    ? await liveSess.page.locator("body").innerText({ timeout: 5000 }).catch(() => "")
    : "";
  const payHay = [jdText, pageText].filter(Boolean).join("\n");
  const expectedSalary = advertisedSalaryFromJd(payHay);
  const nameParts = facts.name.split(/\s+/).filter(Boolean);
  const howHeard = session.fields.find((f) => /how did you (learn|hear|find)|hear about this position/i.test(`${f.label} ${f.nativeName}`));
  const source =
    howHeard?.options?.find((o) => /website|careers/i.test(o)) ||
    howHeard?.options?.find((o) => /linkedin/i.test(o)) ||
    "";
  const direct = {
    firstName: nameParts[0] || facts.name,
    lastName: nameParts.slice(1).join(" "),
    email: facts.email,
    phone: facts.phone,
    phoneNational: facts.phoneNational,
    city: facts.city,
    country: facts.country,
    location: facts.location,
    preferredLocation: facts.preferredLocation,
    linkedin: facts.linkedin,
    github: facts.github,
    portfolio: facts.portfolio || facts.github,
    employer: facts.employer,
    title: facts.title,
    skills: facts.skills,
    experienceYears: facts.experienceYears,
    yearOfGraduation: facts.yearOfGraduation,
    noticePeriod: facts.noticePeriod,
    gender: facts.gender,
    currentSalary: facts.currentSalary,
    expectedSalary: expectedSalary || facts.expectedSalary,
    coverLetter: cover,
    source,
    cvText: tailoredCv,
    university: facts.university,
    degree: facts.degree,
    careerStart: facts.careerStart,
    aiTools: facts.aiTools,
    surveyClicks: [
      "Careers Page and decided to apply",
      "career growth and development opportunities",
      "opportunity to drive impact",
    ],
    surveySelects: [{ label: "seen Careem", value: "No" }],
  };
  const extras = { cvText: master, company, coverLetter: cover, attemptedAiChallenge: false, survey, jdText: payHay, fieldAi: true };
  let fields = session.fields as ApplyField[];
  const allSteps: { fieldId: string; label: string; ok: boolean; thumb?: string }[] = [];
  const fillIssues = [...(session.issues || [])];
  let waitingFields: { fieldId: string; label: string; reason: string }[] = [];
  const stages: { name: string; status: string }[] = [];
  let lastAudit: { filled: string[]; pending: string[]; failed: string[] } = { filled: [], pending: [], failed: [] };
  let humanIntervention: { kind: string; question: string; reason?: string } | null = null;
  let agentStatus = "in_progress";
  const agentKey = useFormAgent ? formAgentResumeKey(url) || session.id : "";
  const touched = new Set<string>([...(opened?.filledIds || [])]);
  const reportProgress = (log?: string) => {
    void (async () => {
      const page = getSession(session.id)?.page;
      const preview = await captureApplyPreview(page);
      onFillProgress?.({
        sessionId: session.id,
        extracted: fields.map((f) => f.label || f.id),
        completed: [...new Set(allSteps.filter((s) => s.ok).map((s) => s.label).filter(Boolean))],
        pending: waitingFields.map((w) => w.label),
        log,
        preview,
      });
    })();
  };
  reportProgress("Opened a Chrome tab and started filling empty fields");
  if (useFormAgent) {
    setFormAgentPersistPath(join(studentCareerRoot(), "data", "apply-agent-state.json"));
    loadFormAgentPersist();
  }

  const deadline = Date.now() + 40 * 60 * 1000;
  const waitingSeen = new Set<string>();
  let googleTyped = false;
  let pageNo = 0;
  let idleNoWork = 0;
  let sawCaptcha = false;
  const noteCaptcha = (log?: string) => {
    if (sawCaptcha) return;
    sawCaptcha = true;
    fillIssues.push({
      level: "warn",
      code: "captcha-present",
      message: "Human verification is on this form. Other empty fields are still being filled — the captcha is left for you.",
    });
    reportProgress(log || "CAPTCHA seen — filling the other empty fields, not solving it");
  };
  for (let scan = 0; scan < 2000 && Date.now() < deadline; scan++) {
    const live = getSession(session.id);
    if (!live) break;
    if (useFormAgent && (await sessionHasInteractiveCaptcha(session.id))) {
      noteCaptcha();
    }
    live.lastActiveAt = Date.now();
    if (useFormAgent) {
      await withBudget(2000, () => prepareIntelligentForm(live.page, profile, { repeating: !live.formPrepared }), undefined);
      live.formPrepared = true;
      const extracted = await withBudget(4000, () => extractCurrent(live.page, url), null);
      if (extracted?.form?.fields?.length) {
        live.fields = extracted.form.fields;
        live.frame = extracted.frame;
        fields = extracted.form.fields as ApplyField[];
      }
    }
    if (!googleTyped && facts.email && (globalThis as { __coUsingUserChrome?: boolean }).__coUsingUserChrome) {
      const typed = await fillGoogleIdentifier(live.page, facts.email).catch(() => false);
      if (typed) {
        googleTyped = true;
        allSteps.push({ fieldId: "google-email", label: "Google email", ok: true });
        fillIssues.push({
          level: "info",
          code: "nav-google",
          message: "Entered your CV email on Google sign-in. Type the Google password yourself — we never invent one, and we never submit the job.",
        });
      }
    }

    let answers: Record<string, string> = {};
    let pageWaiting: { fieldId: string; label: string; reason: string }[] = [];
    for (const field of fields) {
      if (fieldAlreadyValued(field)) touched.add(field.id);
    }
    const unknownEmpty = fillableEmpty(fields, touched, waitingSeen);
    if (useFormAgent && unknownEmpty.length === 0) {
      const next = await advanceSession(session.id).catch(() => ({ advanced: false, fields }));
      if (next.advanced) {
        pageNo += 1;
        fields = next.fields;
        live.formPrepared = false;
        idleNoWork = 0;
        continue;
      }
      idleNoWork += 1;
      if (scan % 8 === 0) reportProgress("Scanning for new empty fields");
      if (fields.length === 0) {
        if (idleNoWork >= 10) break;
        await waitForFormChange(live.page, 400).catch(() => {});
        continue;
      }
      if (idleNoWork >= 3) break;
      await waitForFormChange(live.page, 80).catch(() => {});
      continue;
    }
    if (useFormAgent) {
      const pageTextNow = await live.page.locator("body").innerText({ timeout: 600 }).catch(() => "");
      const turn = await withBudget(
        PLAN_TURN_BUDGET_MS,
        () =>
          planFormTurn({
            fields,
            profile,
            cvText: master,
            extras: { ...extras, role, company, fieldAi: true, fillRemaining: true },
            pageText: pageTextNow,
            sessionId: agentKey || session.id,
            pageIndex: pageNo,
            fieldAi: unknownEmpty.length > 0,
            skipFieldIds: [...touched, ...waitingSeen],
          }),
        null,
      );
      if (turn) {
        answers = answersExcludingFilled(turn.fillAnswers, touched);
        pageWaiting = (turn.waiting || []).filter((w) => !touched.has(w.fieldId));
        for (const row of pageWaiting) waitingSeen.add(row.fieldId);
        if (turn.audit) lastAudit = turn.audit;
        if (turn.stage) stages.push({ name: turn.stage, status: turn.waiting?.length ? "waiting" : "complete" });
      } else {
        answers = answersExcludingFilled(
          await completeFormAnswers(
            fields,
            answersFromProfile(fields, profile, { ...extras, fillRemaining: true }) as Record<string, string>,
            profile,
            { ...extras, fillRemaining: true, role, company },
          ),
          touched,
        );
        for (const f of unknownEmpty) {
          if (!answers[f.id]) waitingSeen.add(f.id);
        }
      }
    } else if (fields.length) {
      answers = answersExcludingFilled(
        await completeFormAnswers(
          fields,
          answersFromProfile(fields, profile, { ...extras, fillRemaining: true }) as Record<string, string>,
          profile,
          { ...extras, fillRemaining: true, role, company },
        ),
        touched,
      );
    }

    if (Object.keys(answers).length) {
      idleNoWork = 0;
      let filledPage = { steps: [] as { fieldId: string; label: string; ok: boolean }[], issues: [] as typeof fillIssues };
      try {
        filledPage = await fillSession(session.id, answers, fields, artifacts.cvPath || undefined, artifacts.coverPath || undefined, direct);
      } catch {
        fillIssues.push({
          level: "warn",
          code: "fill-skip",
          message: "A field failed; other empty fields are still being filled.",
        });
        for (const id of Object.keys(answers)) waitingSeen.add(id);
      }
      allSteps.push(...(filledPage.steps || []));
      fillIssues.push(...(filledPage.issues || []));
      for (const step of filledPage.steps || []) {
        if (step.ok) touched.add(step.fieldId);
      }
      const retry: Record<string, string> = {};
      for (const step of filledPage.steps || []) {
        if (!step.ok && answers[step.fieldId] && !touched.has(step.fieldId) && !waitingSeen.has(step.fieldId)) {
          retry[step.fieldId] = answers[step.fieldId];
        }
      }
      if (Object.keys(retry).length) {
        try {
          const again = await fillSession(session.id, retry, fields, artifacts.cvPath || undefined, artifacts.coverPath || undefined, direct);
          allSteps.push(...(again.steps || []));
          fillIssues.push(...(again.issues || []));
          for (const step of again.steps || []) {
            if (step.ok) touched.add(step.fieldId);
            else if (retry[step.fieldId]) {
              pageWaiting.push({ fieldId: step.fieldId, label: step.label, reason: "Fill did not land after retry" });
              waitingSeen.add(step.fieldId);
              touched.add(step.fieldId);
            }
          }
        } catch {
          for (const id of Object.keys(retry)) waitingSeen.add(id);
        }
      }
      waitingFields.push(...pageWaiting);
      reportProgress("Filled empty fields — still scanning for more");
      continue;
    }

    for (const f of unknownEmpty) waitingSeen.add(f.id);
    waitingFields = pageWaiting.length ? [...waitingFields, ...pageWaiting] : waitingFields;
    if (!useFormAgent) break;
    const next = await advanceSession(session.id).catch(() => ({ advanced: false, fields }));
    if (next.advanced) {
      pageNo += 1;
      fields = next.fields;
      live.formPrepared = false;
      idleNoWork = 0;
      continue;
    }
    idleNoWork += 1;
    if (scan % 8 === 0) reportProgress("Scanning for new empty fields");
    if (idleNoWork >= 3) break;
    await waitForFormChange(live.page, 80).catch(() => {});
  }
  await handoffSession(session.id).catch(() => {});

  const filledCount = allSteps.filter((step) => step.ok).length;
  const where = company || session.title || "application";
  const attached = artifacts.attachedAs === "pdf" ? " Formatted PDF résumé attached." : "";
  const pause = (session.issues || []).find((i) => i.code === "login-wall" || i.code === "multi-step" || i.code === "nav-apply" || i.code === "nav-signup" || i.code === "nav-google");
  const filledOk = new Set(allSteps.filter((step) => step.ok).map((step) => step.fieldId));
  const uniqueWaiting: { fieldId: string; label: string; reason: string }[] = [];
  const seenWait = new Set<string>();
  for (const row of waitingFields) {
    if (filledOk.has(row.fieldId)) continue;
    const key = row.fieldId || row.label;
    if (seenWait.has(key)) continue;
    seenWait.add(key);
    uniqueWaiting.push(row);
  }
  const uniqueStages: { name: string; status: string }[] = [];
  const seenStage = new Set<string>();
  for (let i = stages.length - 1; i >= 0; i--) {
    if (seenStage.has(stages[i].name)) continue;
    seenStage.add(stages[i].name);
    uniqueStages.unshift(stages[i]);
  }
  const audit = {
    filled: [...new Set(allSteps.filter((step) => step.ok).map((step) => step.label).filter(Boolean))],
    pending: uniqueWaiting.map((w) => w.label),
    failed: [
      ...new Set(
        allSteps
          .filter((step) => !step.ok && !filledOk.has(step.fieldId) && !uniqueWaiting.some((w) => w.fieldId === step.fieldId))
          .map((step) => step.label)
          .filter(Boolean),
      ),
    ],
  };
  if (lastAudit.filled?.length && !audit.filled.length) {
    audit.filled = lastAudit.filled;
  }
  if (uniqueWaiting.length && agentStatus !== "HUMAN_ACTION_REQUIRED") {
    agentStatus = "waiting_for_user";
    humanIntervention = humanIntervention || {
      kind: "information",
      question: uniqueWaiting[0].label,
      reason: uniqueWaiting[0].reason,
    };
  }
  if (sawCaptcha) {
    agentStatus = "HUMAN_ACTION_REQUIRED";
    humanIntervention = humanIntervention || {
      kind: "captcha",
      question: "Please complete the verification challenge in the application window.",
      reason: "CAPTCHA",
    };
  }
  const waitingNote = uniqueWaiting.length
    ? ` ${uniqueWaiting.length} field(s) need you — we did not guess.`
    : "";
  const captchaNote = sawCaptcha
    ? " Human verification is still required in the application window — we did not solve it."
    : "";
  const message =
    uniqueWaiting.length
      ? `Application paused — human input required. ${where}: ${uniqueWaiting[0].label}.${attached}${captchaNote} The application window stayed on that field. Nothing was submitted.`
      : sawCaptcha && filledCount > 0
        ? `Filled empty fields.${captchaNote}${attached} Nothing was submitted.`
        : sawCaptcha
          ? "Human verification is required. Please complete it in the application window. Nothing was submitted."
          : filledCount > 0
        ? `The application window is open on the ${where} flow. ${filledCount} field(s) filled across the steps we could reach.${attached}${waitingNote} Continue there if a password or extra page appears. Nothing was submitted.`
        : pause
          ? `${pause.message} The application window stayed open so you can continue. Nothing was submitted.`
          : session.fields.length === 0
            ? "The application window is open on this posting. Click Apply now / create profile there if needed — we fill attested fields and never submit."
            : `The application window is open on the ${where} form.${attached}${waitingNote} Complete any remaining fields yourself — nothing was submitted.`;

  await emitFillProgress(
    getSession(session.id)?.page,
    onFillProgress,
    {
      sessionId: session.id,
      extracted: fields.map((f) => f.label || f.id),
      completed: [...new Set(allSteps.filter((s) => s.ok).map((s) => s.label).filter(Boolean))],
      pending: uniqueWaiting.map((w) => w.label),
      log: "Paused — last view of the employer form",
    },
    true,
  );

  return {
    sessionId: session.id,
    title: session.title,
    fieldCount: fields.length || session.fields.length,
    filledCount,
    steps: allSteps,
    issues: [...fillIssues, ...artifacts.attachNotes],
    message,
    tailored: true,
    waitingFields: uniqueWaiting,
    stages: uniqueStages,
    useFormAgent: Boolean(useFormAgent),
    status: agentStatus,
    audit,
    humanIntervention,
    currentStep: uniqueStages.find((s) => s.status !== "complete")?.name || uniqueStages[uniqueStages.length - 1]?.name || "",
    ...artifacts,
  };
}

/**
 * Resume a paused URL apply on the open Chrome tab.
 * Regenerates nothing. Never submits. Never touches CAPTCHA widgets.
 */
export async function continueStudentCareerLiveApply({
  sessionId,
  url,
  profile,
  company = "",
  cvText = "",
  role = "",
  jdText = "",
  prebuiltDocuments = null,
  artifactKey = "",
  artifactStem = "",
  userAnswers = {},
  cvPath = "",
  coverPath = "",
  onFillProgress = null,
}: {
  sessionId?: string;
  url: string;
  profile: ProfileLike | null | undefined;
  company?: string;
  cvText?: string;
  role?: string;
  jdText?: string;
  prebuiltDocuments?: {
    cvText?: string;
    cvHtml?: string;
    coverLetter?: string;
    coverHtml?: string;
    cvDocx?: Buffer | Uint8Array | null;
  } | null;
  artifactKey?: string;
  artifactStem?: string;
  userAnswers?: Record<string, string> | { byId?: Record<string, string>; byLabel?: Record<string, string> };
  cvPath?: string;
  coverPath?: string;
  onFillProgress?: ((info: FillProgressInfo) => void) | null;
}) {
  const live = sessionId ? getSession(sessionId) : undefined;
  if (!live) {
    return runStudentCareerLiveApply({
      url,
      profile,
      company,
      cvText,
      role,
      jdText,
      prebuiltDocuments,
      artifactKey,
      artifactStem,
      useFormAgent: true,
      onFillProgress,
    });
  }

  const master = String(cvText || "").trim();
  const cover = prebuiltDocuments?.coverLetter || "";
  const extras = { cvText: master, company, coverLetter: cover, attemptedAiChallenge: false, survey: defaultSurveyAnswers(), jdText, fieldAi: true };
  const facts = candidateFacts(profile, master);
  const nameParts = facts.name.split(/\s+/).filter(Boolean);
  const direct = {
    firstName: nameParts[0] || facts.name,
    lastName: nameParts.slice(1).join(" "),
    email: facts.email,
    phone: facts.phone,
    city: facts.city,
    country: facts.country,
    coverLetter: cover,
  };
  const allSteps = [];
  const fillIssues = [];
  if (await sessionHasInteractiveCaptcha(live.id)) {
    fillIssues.push({
      level: "warn",
      code: "captcha-present",
      message: "Human verification is on this form. Other empty fields are still being filled — the captcha is left for you.",
    });
  }
  await withBudget(2000, () => prepareIntelligentForm(live.page, profile), undefined);
  live.filledIds ??= new Set();
  live.lastActiveAt = Date.now();
  void emitFillProgress(
    live.page,
    onFillProgress,
    {
      sessionId: live.id,
      extracted: (live.fields || []).map((f) => f.label || f.id),
      completed: [],
      pending: [],
      log: "Resumed filling — watch the form below",
    },
    true,
  );
  let waitingFields = [];
  let lastTurn = null;
  const touched = new Set(live.filledIds);
  const waitingSeen = new Set<string>();
  const deadline = Date.now() + 40 * 60 * 1000;
  let idleNoWork = 0;
  let pageNo = 0;
  let sawCaptcha = fillIssues.some((issue) => issue?.code === "captcha-present");
  for (let scan = 0; scan < 2000 && Date.now() < deadline; scan++) {
    if (await sessionHasInteractiveCaptcha(live.id)) {
      if (!sawCaptcha) {
        sawCaptcha = true;
        fillIssues.push({
          level: "warn",
          code: "captcha-present",
          message: "Human verification is on this form. Other empty fields are still being filled — the captcha is left for you.",
        });
      }
    }
    live.lastActiveAt = Date.now();
    await withBudget(2000, () => prepareIntelligentForm(live.page, profile, { repeating: !live.formPrepared }), undefined);
    live.formPrepared = true;
    const extractedNow = await withBudget(4000, () => extractCurrent(live.page, url), null);
    const fieldsNow = (extractedNow?.form?.fields?.length ? extractedNow.form.fields : live.fields) as ApplyField[];
    if (extractedNow?.form?.fields?.length) {
      live.fields = extractedNow.form.fields;
      live.frame = extractedNow.frame;
    }
    for (const field of fieldsNow) {
      if (fieldAlreadyValued(field)) touched.add(field.id);
    }
    const unknownEmpty = fillableEmpty(fieldsNow, touched, waitingSeen);
    if (unknownEmpty.length === 0) {
      const next = await advanceSession(live.id).catch(() => ({ advanced: false, fields: fieldsNow }));
      if (next.advanced) {
        pageNo += 1;
        live.formPrepared = false;
        idleNoWork = 0;
        continue;
      }
      idleNoWork += 1;
      if (scan % 8 === 0) {
        void emitFillProgress(live.page, onFillProgress, {
          sessionId: live.id,
          extracted: fieldsNow.map((f) => f.label || f.id),
          completed: allSteps.filter((s) => s.ok).map((s) => s.label).filter(Boolean),
          pending: waitingFields.map((w) => w.label),
          log: "Scanning for new empty fields",
        });
      }
      if (fieldsNow.length === 0) {
        if (idleNoWork >= 10) break;
        await waitForFormChange(live.page, 400).catch(() => {});
        continue;
      }
      if (idleNoWork >= 3) break;
      await waitForFormChange(live.page, 80).catch(() => {});
      continue;
    }
    const pageTextNow = await live.page.locator("body").innerText({ timeout: 600 }).catch(() => "");
    const turn = await withBudget(
      PLAN_TURN_BUDGET_MS,
      () =>
        planFormTurn({
          fields: fieldsNow,
          profile,
          cvText: master,
          extras: { ...extras, role, company, fieldAi: true, fillRemaining: true },
          pageText: pageTextNow,
          sessionId: formAgentResumeKey(url) || live.id,
          pageIndex: pageNo,
          userAnswers,
          fieldAi: unknownEmpty.length > 0,
          skipFieldIds: [...touched, ...waitingSeen],
        }),
      null,
    );
    lastTurn = turn || lastTurn;
    let answers = {};
    if (turn) {
      answers = answersExcludingFilled(turn.fillAnswers, touched);
      waitingFields = (turn.waiting || []).filter((w) => !touched.has(w.fieldId));
      for (const row of waitingFields) waitingSeen.add(row.fieldId);
    } else {
      answers = answersExcludingFilled(
        await completeFormAnswers(
          fieldsNow,
          answersFromProfile(fieldsNow, profile, { ...extras, fillRemaining: true }) as Record<string, string>,
          profile,
          { ...extras, fillRemaining: true, role, company },
        ),
        touched,
      );
      for (const f of unknownEmpty) {
        if (!answers[f.id]) waitingSeen.add(f.id);
      }
    }
    if (Object.keys(answers).length) {
      idleNoWork = 0;
      try {
        const filledPage = await fillSession(live.id, answers, fieldsNow, cvPath || undefined, coverPath || undefined, direct);
        allSteps.push(...(filledPage.steps || []));
        fillIssues.push(...(filledPage.issues || []));
        for (const step of filledPage.steps || []) {
          if (step.ok) touched.add(step.fieldId);
          else waitingSeen.add(step.fieldId);
        }
      } catch {
        for (const id of Object.keys(answers)) waitingSeen.add(id);
      }
      void emitFillProgress(live.page, onFillProgress, {
        sessionId: live.id,
        extracted: fieldsNow.map((f) => f.label || f.id),
        completed: allSteps.filter((s) => s.ok).map((s) => s.label).filter(Boolean),
        pending: waitingFields.map((w) => w.label),
        log: "Filled empty fields — still scanning for more",
      });
      continue;
    }
    for (const f of unknownEmpty) waitingSeen.add(f.id);
    const next = await advanceSession(live.id).catch(() => ({ advanced: false, fields: fieldsNow }));
    if (next.advanced) {
      pageNo += 1;
      live.formPrepared = false;
      idleNoWork = 0;
      continue;
    }
    idleNoWork += 1;
    if (scan % 8 === 0) {
      void emitFillProgress(live.page, onFillProgress, {
        sessionId: live.id,
        extracted: fieldsNow.map((f) => f.label || f.id),
        completed: allSteps.filter((s) => s.ok).map((s) => s.label).filter(Boolean),
        pending: waitingFields.map((w) => w.label),
        log: "Scanning for new empty fields",
      });
    }
    if (idleNoWork >= 3) break;
    await waitForFormChange(live.page, 80).catch(() => {});
  }
  await handoffSession(live.id).catch(() => {});
  const filledCount = allSteps.filter((step) => step.ok).length;
  const status = sawCaptcha ? "HUMAN_ACTION_REQUIRED" : waitingFields.length ? "waiting_for_user" : "in_progress";
  const captchaNote = sawCaptcha ? " Human verification is still required in the application window — we did not solve it." : "";
  await emitFillProgress(
    live.page,
    onFillProgress,
    {
      sessionId: live.id,
      extracted: (live.fields || []).map((f) => f.label || f.id),
      completed: allSteps.filter((s) => s.ok).map((s) => s.label).filter(Boolean),
      pending: waitingFields.map((w) => w.label),
      log: "Paused — last view of the employer form",
    },
    true,
  );
  return {
    sessionId: live.id,
    title: live.title,
    fieldCount: live.fields?.length || 0,
    filledCount,
    steps: allSteps,
    issues: fillIssues,
    message: waitingFields.length
      ? `Application paused — human input required. ${waitingFields[0].label}.${captchaNote} Nothing was submitted.`
      : sawCaptcha
        ? `Filled empty fields.${captchaNote} Nothing was submitted.`
        : "Continued from the saved application. Nothing was submitted.",
    waitingFields,
    stages: lastTurn?.stage ? [{ name: lastTurn.stage, status: waitingFields.length ? "waiting" : "complete" }] : [],
    useFormAgent: true,
    status,
    audit: lastTurn?.audit || { filled: allSteps.filter((s) => s.ok).map((s) => s.label), pending: waitingFields.map((w) => w.label), failed: [] },
    humanIntervention: sawCaptcha
      ? { kind: "captcha", question: "Please complete the verification challenge in the application window.", reason: "CAPTCHA" }
      : waitingFields[0]
        ? { kind: "information", question: waitingFields[0].label, reason: waitingFields[0].reason }
        : null,
    cvPath,
    coverPath,
  };
}
