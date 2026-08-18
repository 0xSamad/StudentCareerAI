/**
 * application-workflow-core.mjs — Shared constants and deterministic gates
 * used by ApplicationOrchestrator. No AI, no browser session.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

export const APPLY_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const WORKFLOW_STATUS = Object.freeze({
  SUBMITTED: "SUBMITTED",
  REQUIRES_USER_INPUT: "REQUIRES_USER_INPUT",
  SKIPPED: "SKIPPED",
  FAILED: "FAILED",
  READY: "READY",
});

export const SKIP_REASON = Object.freeze({
  CLOSED: "CLOSED",
  DEADLINE_PASSED: "DEADLINE_PASSED",
  DUPLICATE: "DUPLICATE",
  NOT_ELIGIBLE: "NOT_ELIGIBLE",
});

export const STEP = Object.freeze({
  VERIFY_EXISTS: { n: 1, name: "Verify opportunity still exists" },
  VERIFY_DEADLINE: { n: 2, name: "Verify deadline" },
  VERIFY_DUPLICATE: { n: 3, name: "Verify duplicate application does not exist" },
  ELIGIBILITY: { n: 4, name: "Run eligibility" },
  MATCH: { n: 5, name: "Calculate/update match score" },
  CONTEXT: { n: 6, name: "Build candidate context" },
  ANALYZE_CV: { n: 7, name: "Analyze existing CV" },
  REUSE_CV: { n: 8, name: "Reuse CV if suitable" },
  TAILOR_CV: { n: 9, name: "Tailor CV if beneficial" },
  ANALYZE_LETTER: { n: 10, name: "Analyze whether cover letter is required" },
  GENERATE_LETTER: { n: 11, name: "Generate cover letter if needed" },
  OPEN_URL: { n: 12, name: "Open application URL" },
  DETECT_ATS: { n: 13, name: "Detect ATS/platform" },
  ANALYZE_FORM: { n: 14, name: "Semantic form analysis" },
  FILL_FIELDS: { n: 15, name: "Candidate data retrieval" },
  ASK_USER: { n: 16, name: "Ask user only for genuinely missing critical information" },
  VALIDATE: { n: 17, name: "Validate application" },
  SUBMIT: { n: 18, name: "Submit if safe and AUTO_APPLY enabled" },
  RECORD: { n: 19, name: "Record exact result" },
});

export function readAutoApply(repoRoot = REPO_ROOT) {
  try {
    const statePath = join(repoRoot, "data", "autonomous-state.json");
    if (!existsSync(statePath)) return false;
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    return Boolean(state?.config?.AUTO_SUBMIT || state?.config?.AUTO_APPLY);
  } catch {
    return false;
  }
}

export function heuristicMatch(profile, opportunity, eligibility, knowledgeContext = null) {
  const skills = [
    ...(profile.skills?.programming_languages || []),
    ...(profile.skills?.frameworks || []),
    ...(profile.skills?.ai_ml || []),
    ...(profile.skills?.databases || []),
    ...(profile.skills?.tools || []),
  ].map((s) => String(s).toLowerCase());
  const haystack = `${opportunity.title || ""} ${opportunity.description || ""}`.toLowerCase();
  let hits = 0;
  for (const skill of skills) {
    if (skill && haystack.includes(skill)) hits += 1;
  }
  const preferred = (knowledgeContext?.preferences?.preferredRoles || [])
    .filter((r) => r?.authority && r.authority !== "GENERATED")
    .map((r) => String(r.value || "").toLowerCase())
    .filter(Boolean);
  for (const role of preferred) {
    if (role && (haystack.includes(role) || String(opportunity.title || "").toLowerCase().includes(role))) {
      hits += 2;
    }
  }
  const score = Math.min(84, Math.max(40, 48 + hits * 7));
  return {
    match_score: score,
    tier: score >= 80 ? "STRONG" : score >= 70 ? "GOOD" : "WEAK",
    strengths: [],
    missing_skills: [],
    relevant_experience: [],
    relevant_projects: [],
    concerns: ["Heuristic score — AI matching was unavailable."],
    recommendation: "Review manually; AI matching was unavailable.",
    dimension_scores: {},
    eligibility_status: eligibility?.verdict || eligibility?.overall || "ELIGIBLE",
    eligible_to_apply: true,
    provider_used: "heuristic",
    model_used: "keyword-overlap",
    scored_at: new Date().toISOString(),
  };
}

export function deadlineHasPassed(opportunity = {}, requirements = {}, now = new Date()) {
  const raw = opportunity.deadline || opportunity.metadata?.deadline || requirements.deadline;
  if (!raw) return { passed: false, deadline: null };
  const dl = new Date(raw);
  if (Number.isNaN(dl.getTime())) return { passed: false, deadline: raw, unparsed: true };
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return { passed: dl < today, deadline: raw };
}

export function findDuplicateApplication(opportunity = {}, existingApplications = [], currentId = null) {
  const url = String(opportunity.url || "").toLowerCase();
  const oppId = String(opportunity.id || opportunity.opportunity_id || "");
  const company = String(opportunity.company || "").toLowerCase();
  const title = String(opportunity.title || opportunity.role || "").toLowerCase();

  return (existingApplications || []).find((app) => {
    if (currentId && String(app.id) === String(currentId)) return false;
    const submittedAt = app.submitted_at || app.applied_at;
    const state = app.state || app.applicationStatus;
    if (!submittedAt || !["SUBMITTED", "APPLIED"].includes(state)) return false;
    const appOpp = String(app.opportunity_id || app.opportunityId || "");
    const appUrl = String(app.url || app.metadata?.url || "").toLowerCase();
    const appCompany = String(app.company || "").toLowerCase();
    const appTitle = String(app.title || app.role || "").toLowerCase();
    if (oppId && appOpp && oppId === appOpp) return true;
    if (url && appUrl && url === appUrl) return true;
    if (company && title && appCompany === company && appTitle === title) return true;
    return false;
  });
}

export function summarizeWorkflowOutcome(result = {}) {
  const status = result.status;
  const reason = result.reason || result.message || "";
  const skip = result.skipReason;
  if (status === WORKFLOW_STATUS.SUBMITTED) return "submitted";
  if (status === WORKFLOW_STATUS.REQUIRES_USER_INPUT) {
    if (/captcha/i.test(reason) || result.pause_reason === "CAPTCHA") return "CAPTCHA → requires user";
    if (/mfa|two-factor/i.test(reason) || result.pause_reason === "MFA") return "MFA → requires user";
    return "requires user";
  }
  if (status === WORKFLOW_STATUS.SKIPPED) {
    if (skip === SKIP_REASON.NOT_ELIGIBLE) return "ineligible → skipped";
    if (skip === SKIP_REASON.DEADLINE_PASSED) return "deadline passed → skipped";
    if (skip === SKIP_REASON.CLOSED) return "posting closed → skipped";
    if (skip === SKIP_REASON.DUPLICATE) return "duplicate → skipped";
    return `skipped — ${reason || skip || "not processed"}`;
  }
  if (status === WORKFLOW_STATUS.READY) return "prepared (not submitted)";
  if (status === WORKFLOW_STATUS.FAILED) return `failed — ${reason || "unknown error"}`;
  return String(status || "unknown").toLowerCase();
}

export function summarizeBatch(results = []) {
  const submitted = results.filter((r) => r.status === WORKFLOW_STATUS.SUBMITTED).length;
  const requiresUser = results.filter((r) => r.status === WORKFLOW_STATUS.REQUIRES_USER_INPUT).length;
  const skipped = results.filter((r) => r.status === WORKFLOW_STATUS.SKIPPED).length;
  const failed = results.filter((r) => r.status === WORKFLOW_STATUS.FAILED).length;
  const ready = results.filter((r) => r.status === WORKFLOW_STATUS.READY).length;
  const parts = [];
  if (submitted) parts.push(`${submitted} submitted`);
  if (ready) parts.push(`${ready} prepared (not submitted)`);
  if (requiresUser) parts.push(`${requiresUser} require user`);
  if (skipped) parts.push(`${skipped} skipped`);
  if (failed) parts.push(`${failed} failed`);
  const headline =
    parts.length > 0
      ? `Processed ${results.length}: ${parts.join(", ")}.`
      : `Processed ${results.length}.`;
  return { headline, submitted, requiresUser, skipped, failed, ready, total: results.length };
}

export function applyBrowserHeaded() {
  if (process.env.CI === "true" || process.env.CI === "1") return false;
  if (process.env.STUDENT_CAREER_AI_SKIP_BROWSER === "1") return false;
  if (process.env.STUDENT_CAREER_AI_HEADLESS === "1") return false;
  return process.env.STUDENT_CAREER_AI_HEADED_BROWSER !== "0";
}

const headedBrowsers = new Set();

export async function revealApplyWindow(page) {
  if (!page) return;
  try {
    await page.bringToFront();
  } catch {
    /* ignore */
  }
  try {
    const session = await page.context().newCDPSession(page);
    const { windowId } = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "normal", left: 40, top: 40, width: 1280, height: 900 },
    });
  } catch {
    /* bundled Chromium without CDP window bounds */
  }
}

export function keepHeadedBrowser(browser, ms = 5 * 60_000) {
  if (!browser) return;
  headedBrowsers.add(browser);
  setTimeout(() => {
    headedBrowsers.delete(browser);
    browser.close().catch(() => {});
  }, ms).unref?.();
}

export async function launchApplyPage(url) {
  const { chromium } = await import("playwright");
  const headed = applyBrowserHeaded();
  const browser = await chromium.launch({
    headless: !headed,
    args: headed ? ["--window-position=40,40", "--window-size=1280,900"] : [],
  });
  try {
    const context = await browser.newContext({
      userAgent: APPLY_USER_AGENT,
      viewport: headed ? null : { width: 1280, height: 900 },
    });
    const applyPage = await context.newPage();
    await applyPage.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await applyPage.waitForTimeout(800);
    applyPage.__studentcareerHeaded = headed;
    if (headed) await revealApplyWindow(applyPage);
    return { browser, applyPage, headed };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

export function makeCallAIFn(container, authContext) {
  if (!container?.aiWorkerService?.complete) return null;
  return async (_provider, sys, usr) =>
    container.aiWorkerService.complete({ prompt: usr, system: sys }, authContext);
}
