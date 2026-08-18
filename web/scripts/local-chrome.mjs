/**
 * Opens a real Chrome window on THIS computer and fills application forms.
 * Pair it from Application Center, then leave this process running.
 *
 *   npm run apply:chrome -- --server http://HOST:3000 --token YOUR_TOKEN
 */
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

register(pathToFileURL(join(here, "alias-loader.mjs")).href, pathToFileURL(join(here, "local-chrome.mjs")).href);

process.env.APPLY_HEADLESS = "false";
process.env.STUDENT_CAREER_AI_ROOT = process.env.STUDENT_CAREER_AI_ROOT || repoRoot;
if (process.env.NODE_ENV === "production") process.env.APPLY_HEADLESS = "false";

function arg(name) {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf(name);
  if (idx >= 0) return String(argv[idx + 1] || "").trim();
  const pref = `${name}=`;
  const hit = argv.find((row) => row.startsWith(pref));
  return hit ? hit.slice(pref.length).trim() : "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const server = (arg("--server") || process.env.APPLY_CHROME_SERVER || "").replace(/\/$/, "");
const token = arg("--token") || process.env.APPLY_CHROME_TOKEN || "";

if (!server || !token) {
  console.error("Open Chrome on this computer with:");
  console.error("  npm run apply:chrome -- --server http://YOUR-HOST:3000 --token YOUR_TOKEN");
  console.error("Copy the command from Application Center in the StudentCareer AI dashboard.");
  process.exit(1);
}

const { runStudentCareerLiveApply, continueStudentCareerLiveApply } = await import("../src/lib/apply/live-from-profile.ts");
const { sessionHasInteractiveCaptcha } = await import("../src/lib/apply/session.ts");
const { classifyLiveOutcome } = await import("../src/lib/apply/multi-url-apply.mjs");

async function api(path, body) {
  const res = await fetch(`${server}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-apply-chrome-token": token },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Local Chrome helper failed (${res.status})`);
  }
  return data;
}

async function heartbeat() {
  try {
    await api("/api/apply/local-chrome", { action: "heartbeat" });
    return true;
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return false;
  }
}

async function nextWork(busyJobId = "") {
  const data = await api("/api/apply/local-chrome", { action: "work", busyJobId });
  return data.work || null;
}

async function reportLive(work, live) {
  await api("/api/apply/local-chrome", {
    action: "result",
    batchId: work.batchId,
    jobId: work.jobId,
    live,
  });
}

function humanPause(live) {
  const outcome = classifyLiveOutcome(live || {});
  return (
    outcome.phase === "CAPTCHA_REQUIRED" ||
    outcome.phase === "INFORMATION_REQUIRED" ||
    outcome.phase === "LOGIN_REQUIRED" ||
    outcome.phase === "EMAIL_VERIFICATION_REQUIRED" ||
    outcome.phase === "WAITING_FOR_USER"
  );
}

function applyArgs(work) {
  const originalBuffer = work.originalBase64 ? Buffer.from(work.originalBase64, "base64") : null;
  return {
    url: work.url,
    profile: work.profile,
    company: work.company,
    cvText: work.cvText,
    role: work.role,
    jdText: work.description,
    prebuiltDocuments: work.documents,
    artifactKey: work.jobId,
    artifactStem: work.files?.stem || "",
    originalBuffer,
    originalFilename: work.originalFilename || "",
    originalMime: work.originalMime || "",
    githubToken: work.githubToken || "",
    useFormAgent: true,
  };
}

async function fillWork(work) {
  console.log(`Opening Chrome for ${work.company || "this job"} — ${work.role || work.url}`);
  const live = await runStudentCareerLiveApply(applyArgs(work));
  await reportLive(work, live);
  return live;
}

async function continueWork(work, sessionId, extra = {}) {
  console.log(`Continuing in Chrome for ${work.company || "this job"}`);
  const live = await continueStudentCareerLiveApply({
    ...applyArgs(work),
    sessionId,
    userAnswers: extra.answers || extra.resume?.answers || work.userAnswers || {},
    cvPath: work.files?.cvPath || "",
    coverPath: work.files?.coverPath || "",
  });
  await reportLive(work, live);
  return live;
}

async function watchHuman(work, sessionId) {
  console.log("Solve the CAPTCHA or sign-in in the Chrome window on this computer. Do not close this terminal.");
  while (true) {
    await sleep(2000);
    let captcha = false;
    try {
      captcha = await sessionHasInteractiveCaptcha(sessionId);
    } catch {
      captcha = false;
    }
    if (!captcha) {
      const live = await continueWork(work, sessionId);
      if (!humanPause(live)) return live;
      sessionId = live?.sessionId || sessionId;
      continue;
    }
    let peek = null;
    try {
      peek = await nextWork(work.jobId);
    } catch {
      peek = null;
    }
    if (peek?.action === "continue" && peek.jobId === work.jobId) {
      const live = await continueWork(peek, sessionId, peek);
      if (!humanPause(live)) return live;
      sessionId = live?.sessionId || sessionId;
    }
  }
}

console.log("StudentCareer AI — Chrome on this computer");
console.log(`Server: ${server}`);
console.log("Leave this window open. A real Chrome window will open when an application is ready.");
console.log("CAPTCHAs must be solved in that Chrome window. Nothing is submitted for you.\n");

if (!(await heartbeat())) process.exit(1);

const sessions = new Map();
setInterval(() => {
  void heartbeat();
}, 4000);

while (true) {
  let work = null;
  try {
    work = await nextWork();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    await sleep(2500);
    continue;
  }
  if (!work?.jobId) {
    await sleep(1200);
    continue;
  }
  try {
    let live;
    if (work.action === "continue") {
      const sessionId = sessions.get(work.jobId) || work.sessionId;
      live = await continueWork(work, sessionId, work);
    } else {
      live = await fillWork(work);
    }
    if (live?.sessionId) sessions.set(work.jobId, live.sessionId);
    if (humanPause(live) && live?.sessionId) {
      live = await watchHuman(work, live.sessionId);
      if (live?.sessionId) sessions.set(work.jobId, live.sessionId);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    try {
      await reportLive(work, {
        sessionId: sessions.get(work.jobId) || null,
        filledCount: 0,
        issues: [{ level: "error", code: "local-chrome", message: err instanceof Error ? err.message : String(err) }],
        message: err instanceof Error ? err.message : "Chrome on this computer failed.",
        steps: [],
      });
    } catch {
      /* ignore */
    }
  }
}
