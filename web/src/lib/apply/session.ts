import { chromium, type Browser, type BrowserContext, type Page, type Frame, type Response } from "playwright-core";
import { extractForm, type ApplyField, type ExtractedForm } from "./extract";
import { matchOption, clipToMax, logFieldDecision } from "./semantic-option.mjs";
import { parseGreenhouse, fetchGreenhouseSchema } from "./greenhouse";
import { statusBlock, dismissConsent, tryApplyTriggerFollow, dropNewTabs, classifyEmpty, captchaWarning, multiStepInfo, verifyFill, clickGuestApply, clickSignupTab, clickNextContinue, keepGoingMessage, clickGoogleSsoFollow, hasPasswordInput, pageIsLoginWall, type ApplyIssue } from "./diagnose";
import { agentInterpretForm } from "./agent-interpret";
import {
  chromeOpenFailedMessage,
  chromeProfileInUse,
  chromeProfileLockError,
  chromeUserDataDir,
  chromeUserDataExists,
  connectUserChromeCdp,
  launchDedicatedApplyChrome,
} from "./chrome-attach";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { studentCareerRoot } from "@/lib/student-career-ai";

async function loadListingUrl() {
  const moduleUrl = pathToFileURL(path.join(studentCareerRoot(), "lib", "saas", "listing-url.mjs")).href;
  return import(/* webpackIgnore: true */ moduleUrl) as Promise<{ isCareerHubUrl: (url: string) => boolean }>;
}

/** The frame with the most interactive controls — where the agentic interpreter
 *  should look when deterministic extraction found nothing usable. */
async function richestControlFrame(page: Page): Promise<Frame> {
  let best = page.mainFrame();
  let bestN = -1;
  for (const fr of page.frames()) {
    const n = await fr.evaluate(() => document.querySelectorAll('input, textarea, select, [role="combobox"], [contenteditable="true"]').length).catch(() => 0);
    if (n > bestN) {
      bestN = n;
      best = fr;
    }
  }
  return best;
}

/** Escape a value for use inside a double-quoted CSS attribute selector.
 *  Backslash FIRST, then quote — escaping only the quote would let a trailing
 *  backslash neutralize the closing quote (CodeQL js/incomplete-sanitization). */
function cssAttr(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function pageStillBlank(page: Page): boolean {
  try {
    const u = page.url();
    return !u || u === "about:blank" || u.startsWith("chrome://new");
  } catch {
    return true;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function assignLocation(page: Page, url: string): Promise<void> {
  await page.evaluate((u) => {
    window.location.href = u;
  }, url);
}

async function openTabAtUrl(context: BrowserContext, url: string): Promise<{ page: Page; resp: Response | null }> {
  const before = new Set(context.pages());
  const foreign = otherSessionPages();
  try {
    const seed =
      context.pages().find((p) => !p.isClosed() && !foreign.includes(p) && pageStillBlank(p)) ?? (await context.newPage());
    const createdSeed = !before.has(seed);
    const cdp = await context.newCDPSession(seed);
    await cdp.send("Target.createTarget", { url });
    await cdp.detach().catch(() => {});
    const deadline = Date.now() + 2_500;
    while (Date.now() < deadline) {
      const created = context.pages().find((p) => !before.has(p) && !p.isClosed() && p !== seed && !foreign.includes(p));
      if (created) {
        await created.bringToFront().catch(() => {});
        await created.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => {});
        if (pageStillBlank(created)) await gotoResilient(created, url);
        if (createdSeed && seed !== created && pageStillBlank(seed)) await seed.close().catch(() => {});
        return { page: created, resp: null };
      }
      await seed.waitForTimeout(120);
    }
    if (createdSeed && !seed.isClosed() && pageStillBlank(seed)) await seed.close().catch(() => {});
  } catch {
    /* Playwright newPage + goto below */
  }
  const page = await context.newPage();
  await page.bringToFront().catch(() => {});
  const resp = await gotoResilient(page, url);
  return { page, resp };
}

/** Navigate resiliently. Commit first so the tab leaves about:blank immediately. */
async function gotoResilient(page: Page, url: string): Promise<Response | null> {
  await page.bringToFront().catch(() => {});
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await page.goto(url, { waitUntil: "commit", timeout: 25_000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
      if (pageStillBlank(page)) {
        await assignLocation(page, url);
        await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
      }
      return resp;
    } catch (e) {
      lastErr = e;
      try {
        await assignLocation(page, url);
        await page.waitForLoadState("domcontentloaded", { timeout: 12_000 }).catch(() => {});
        if (!pageStillBlank(page)) return null;
      } catch {
        /* next attempt */
      }
      await page.waitForTimeout(600 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Could not open the job URL in Chrome.");
}

/** Distinguish a real APPLICATION form from a careers-listing / job-search form
 *  (a closed Greenhouse posting redirects to the board, whose keyword/department
 *  filters would otherwise look like a fillable form). */
function looksLikeApplicationForm(form: ExtractedForm): boolean {
  const fs = form.fields;
  if (fs.length === 0) return false;
  const lab = (f: ApplyField) => (f.label || "").toLowerCase();
  const hasFile = fs.some((f) => f.type === "file");
  const hasEmail = fs.some((f) => f.type === "email" || /e-?mail/.test(lab(f)));
  const hasAppish = fs.some((f) => /first name|last name|full name|resume|résumé|\bcv\b|cover letter|phone|linkedin|github|why |portfolio|sponsorship|relocat/.test(lab(f)));
  const hasIbmId = fs.some((f) => /ibm\s*id|ibmid/.test(lab(f)));
  if (hasFile || hasAppish || hasIbmId) return true;
  const onApplyPath = /apply|application|login|signin|sign-in|register|account|myworkdayjobs|jobApplication/i.test(form.url || "");
  if (hasEmail && (onApplyPath || fs.length >= 2)) return true;
  const allSearch = fs.every(
    (f) => /search|buscar|filtr|keyword|palabra|department|departa|office|oficina|location|ubicaci|remote|category|categor|newsletter|subscribe/.test(lab(f)) || /filter|search|keyword/.test((f.nativeId || "").toLowerCase()),
  );
  if (allSearch) return false;
  if (fs.length <= 3 && fs.every((f) => !f.required)) return false;
  return true;
}

/** ATS forms are often embedded in an <iframe> on a company career site
 *  (greenhouse/lever/smartrecruiters embeds), sometimes cross-origin — the main
 *  frame then has 0 fields. Extract from EVERY frame and keep the richest one. */
async function pickFormFrame(page: Page): Promise<{ frame: Frame; form: ExtractedForm }> {
  let best: { frame: Frame; form: ExtractedForm } = {
    frame: page.mainFrame(),
    form: { title: "", url: page.url(), fields: [] },
  };
  for (const fr of page.frames()) {
    try {
      const form = await extractForm(fr);
      if (form.fields.length > best.form.fields.length) best = { frame: fr, form };
    } catch {
      /* detached / cross-origin restriction → skip */
    }
  }
  // Prefer the main frame's title (the posting title) when an iframe won the form.
  if (best.frame !== page.mainFrame() && !best.form.title) best.form.title = await page.title().catch(() => best.form.title);
  return best;
}

function matchSchemaByContainedName(
  schema: Map<string, { label: string; type: string; required: boolean; options: string[] }>,
  nativeName?: string,
  nativeId?: string,
) {
  const blob = `${nativeName || ""} ${nativeId || ""}`;
  for (const [key, value] of schema) {
    if (key.startsWith("label:")) continue;
    if (key.length >= 6 && blob.includes(key)) return value;
  }
  return undefined;
}

/** Enrich generically-extracted fields with an ATS's published schema (clean
 *  labels, correct types, real options) — Greenhouse renders react-select
 *  widgets whose options aren't in the DOM. Matched by native id/name, then label. */
async function enrichFromAts(url: string, fields: ApplyField[]): Promise<void> {
  const gh = parseGreenhouse(url);
  if (!gh) return;
  const schema = await fetchGreenhouseSchema(gh.token, gh.jobId);
  if (!schema) return;
  for (const f of fields) {
    const labelKey = (f.label || "").replace(/\s*\*+\s*$/, "").trim().toLowerCase();
    const hit =
      (f.nativeName && schema.get(f.nativeName)) ||
      (f.nativeId && schema.get(f.nativeId)) ||
      (labelKey && schema.get(`label:${labelKey}`)) ||
      matchSchemaByContainedName(schema, f.nativeName, f.nativeId);
    if (!hit) continue;
    if (hit.label) f.label = hit.label;
    if (hit.type) f.type = hit.type as ApplyField["type"];
    if (hit.options.length) f.options = hit.options;
    if (hit.required) f.required = true;
    if (hit.type === "select") f.combobox = true;
  }
}

// A persistent apply SESSION keeps one real-form page open (headed-but-off-screen)
// so we can: extract → (user verifies pre-filled answers) → FILL the real form →
// bringToFront() for the human to submit it themselves. Headed (channel:chrome) =
// the user's own Chrome on their residential IP (best ATS success); never submits.
type Session = {
  id: string;
  url: string;
  title: string;
  fields: ApplyField[];
  context: BrowserContext;
  page: Page;
  frame: Frame;
  createdAt: number;
  lastActiveAt?: number;
  formShot?: string;
  filledIds?: Set<string>;
  resumeAttached?: boolean;
  coverAttached?: boolean;
  directFilled?: boolean;
  formPrepared?: boolean;
};

let tabOpenChain: Promise<unknown> = Promise.resolve();

function withTabOpenLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tabOpenChain.then(fn, fn);
  tabOpenChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

declare global {
  // eslint-disable-next-line no-var
  var __coApplySessions: Map<string, Session> | undefined;
  // eslint-disable-next-line no-var
  var __coHeadedBrowser: Browser | undefined;
  // eslint-disable-next-line no-var
  var __coHeadedContext: BrowserContext | undefined;
  // eslint-disable-next-line no-var
  var __coConnectedCdp: boolean | undefined;
  // eslint-disable-next-line no-var
  var __coOwnApplyChrome: boolean | undefined;
  // eslint-disable-next-line no-var
  var __coUsingUserChrome: boolean | undefined;
  // eslint-disable-next-line no-var
  var __coIdleTimer: ReturnType<typeof setTimeout> | undefined;
}
const SESSIONS: Map<string, Session> = (globalThis.__coApplySessions ??= new Map());

function otherSessionPages(self?: Page): Page[] {
  const out: Page[] = [];
  for (const s of SESSIONS.values()) {
    if (s.page && !s.page.isClosed() && s.page !== self) out.push(s.page);
  }
  return out;
}

function resetApplyChrome() {
  globalThis.__coHeadedBrowser = undefined;
  globalThis.__coHeadedContext = undefined;
  globalThis.__coConnectedCdp = undefined;
  globalThis.__coOwnApplyChrome = undefined;
  globalThis.__coUsingUserChrome = undefined;
}

function rememberApplyChrome(browser: Browser | undefined, context: BrowserContext, owned: boolean, usingUserChrome: boolean) {
  globalThis.__coHeadedBrowser = browser;
  globalThis.__coHeadedContext = context;
  globalThis.__coConnectedCdp = !owned;
  globalThis.__coOwnApplyChrome = owned;
  globalThis.__coUsingUserChrome = usingUserChrome;
  context.setDefaultTimeout(8000);
  context.on("close", () => {
    if (globalThis.__coHeadedContext === context) resetApplyChrome();
  });
  return context;
}

function contextLooksAlive(ctx: BrowserContext | undefined): boolean {
  if (!ctx) return false;
  try {
    // Touch the context. A closed context throws or reports no browser.
    void ctx.pages();
    const browser = ctx.browser();
    if (browser && !browser.isConnected()) return false;
    return true;
  } catch {
    return false;
  }
}

async function launchUserChrome(): Promise<BrowserContext> {
  const userData = chromeUserDataDir();
  const opts = {
    headless: false,
    viewport: null as null,
    args: ["--remote-debugging-port=9222", "--profile-directory=Default", "--no-first-run", "--no-default-browser-check"],
  };
  try {
    return await chromium.launchPersistentContext(userData, { ...opts, channel: "chrome" });
  } catch (err) {
    if (chromeProfileLockError(err)) throw err;
    try {
      return await chromium.launchPersistentContext(userData, opts);
    } catch (inner) {
      throw inner instanceof Error ? inner : err instanceof Error ? err : new Error("Could not open Google Chrome.");
    }
  }
}

/**
 * Prefer a new tab in the Chrome window already on screen (CDP).
 * If that profile is locked (Chrome is open without debugging), open a
 * dedicated Apply Chrome window and load the job there — do not spawn a
 * blank tab in the user's window.
 */
async function headedContext(): Promise<BrowserContext> {
  const cached = globalThis.__coHeadedContext;
  if (contextLooksAlive(cached)) {
    cached!.setDefaultTimeout(8000);
    return cached!;
  }
  resetApplyChrome();

  const attached = await connectUserChromeCdp();
  if (attached && contextLooksAlive(attached.context)) {
    return rememberApplyChrome(attached.browser, attached.context, false, true);
  }

  if (chromeUserDataExists() && !chromeProfileInUse()) {
    try {
      const context = await withTimeout(launchUserChrome(), 8_000, "Chrome profile is already open");
      return rememberApplyChrome(context.browser() ?? undefined, context, true, true);
    } catch {
      const retry = await connectUserChromeCdp();
      if (retry && contextLooksAlive(retry.context)) {
        return rememberApplyChrome(retry.browser, retry.context, false, true);
      }
    }
  }

  try {
    const context = await launchDedicatedApplyChrome();
    return rememberApplyChrome(context.browser() ?? undefined, context, true, false);
  } catch (err) {
    const retry = await connectUserChromeCdp();
    if (retry && contextLooksAlive(retry.context)) {
      return rememberApplyChrome(retry.browser, retry.context, false, true);
    }
    throw new Error(chromeOpenFailedMessage(err));
  }
}

async function openApplyTab(url?: string): Promise<{ context: BrowserContext; page: Page; resp: Response | null }> {
  const tryOpen = async () => {
    const context = await headedContext();
    if (url) {
      const opened = await openTabAtUrl(context, url);
      return { context, ...opened };
    }
    const page = await context.newPage();
    await page.bringToFront().catch(() => {});
    return { context, page, resp: null };
  };

  return withTabOpenLock(async () => {
    try {
      return await tryOpen();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/has been closed|Target closed|browser has been closed|context.*closed/i.test(msg)) throw err;
      resetApplyChrome();
      return await tryOpen();
    }
  });
}

async function closeApplyTab(page?: Page) {
  await page?.close().catch(() => {});
}

/** Keep the apply Chrome window alive so the next Apply is a tab in it. */
function scheduleIdleClose() {
  if (globalThis.__coIdleTimer) clearTimeout(globalThis.__coIdleTimer);
}

function prune() {
  const now = Date.now();
  for (const [id, s] of SESSIONS) {
    const last = s.lastActiveAt || s.createdAt;
    if (now - last < 5 * 60_000) continue;
    if (now - s.createdAt > 45 * 60_000) void closeSession(id);
  }
}

/** Bounded scroll pass to trigger lazy/virtualized forms that only render their
 *  fields once scrolled into view, then return to the top. */
async function nudgeScroll(page: Page): Promise<void> {
  for (let i = 1; i <= 3; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), i * 1200).catch(() => {});
    await page.waitForTimeout(40);
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
}

export async function openSession(url: string, cliId?: string, forceAgent?: boolean, noApplyBtn?: boolean): Promise<{ id: string; title: string; fields: ApplyField[]; shots: string[]; issues: ApplyIssue[]; needsDrive?: boolean }> {
  prune();
  if (globalThis.__coIdleTimer) clearTimeout(globalThis.__coIdleTimer); // someone's active
  const opened = await openApplyTab(url);
  const context = opened.context;
  let page = opened.page;
  const abort = async (msg: string): Promise<never> => {
    await closeApplyTab(page);
    if (SESSIONS.size === 0) scheduleIdleClose();
    throw new Error(msg);
  };
  // Capture the real form as we read it → a "behind the scenes" progress strip
  // that proves we genuinely opened + parsed THEIR form (not magic). The last
  // shot doubles as a subtle blurred backdrop behind the clean proxy.
  const shots: string[] = [];
  const snap = async () => {
    try {
      const b = await page.screenshot({ type: "jpeg", quality: 42 });
      shots.push(`data:image/jpeg;base64,${b.toString("base64")}`);
    } catch {
      /* ignore */
    }
  };
  const resp = opened.resp;
  if (pageStillBlank(page)) await gotoResilient(page, url);
  await snap(); // first paint
  const sBlock = statusBlock(resp?.status(), resp ? resp.headers() : {});
  if (sBlock) return abort(sBlock.message);

  // 2) Clear any cookie/consent overlay that hides the form (never a hard block).
  const consentIssues = await dismissConsent(page);

  // 3) Wait for real form controls to render (SPA hydrate) in ANY frame (embedded
  //    forms), then settle. More reliable than a fixed sleep.
  const formSel = 'form input, form textarea, input[type=file], [role=combobox], [class*="application-form" i], #application_form, [data-automation-id="email"]';
  const settle = async (ms = 12_000) => {
    await Promise.race(page.frames().map((f) => f.waitForSelector(formSel, { timeout: ms }).catch(() => null))).catch(() => {});
    await page.waitForTimeout(80);
    await dropNewTabs(page);
  };
  const navIssues: ApplyIssue[] = [];
  await settle(12_000);
  await snap();

  const listingUrl = await loadListingUrl().catch(() => null);
  const hubPage = listingUrl?.isCareerHubUrl?.(page.url() || url) === true;
  let { frame, form } = await pickFormFrame(page);
  if (hubPage && !looksLikeApplicationForm(form)) {
    navIssues.push({
      level: "block",
      code: "listing-page",
      message: "This is a careers / job-search page, not a direct application. Open the specific job’s Apply URL — the agent will not click Find roles on a hub.",
    });
  }
  if (!noApplyBtn && !hubPage) {
    for (let step = 0; step < 8; step++) {
      await dismissConsent(page);
      await dropNewTabs(page);
    await nudgeScroll(page);
    ({ frame, form } = await pickFormFrame(page));
      if (looksLikeApplicationForm(form)) break;

      if (await clickGuestApply(page)) {
        navIssues.push({ level: "info", code: "nav-guest", message: "Clicked guest apply to skip account creation." });
        await settle(10_000);
        ({ frame, form } = await pickFormFrame(page));
        await snap();
        continue;
      }

      const trig = await tryApplyTriggerFollow(page, otherSessionPages(page));
      if (trig.page !== page && !trig.page.isClosed()) page = trig.page;
      if (trig.acted) {
        navIssues.push({ level: "info", code: "nav-apply", message: "Clicked Apply now / followed the application link." });
        await settle(12_000);
    ({ frame, form } = await pickFormFrame(page));
    await snap();
        continue;
      }

      if (await clickSignupTab(page)) {
        navIssues.push({ level: "info", code: "nav-signup", message: "Opened the create-profile step (password is left for you)." });
        await settle(8_000);
        ({ frame, form } = await pickFormFrame(page));
        await snap();
        continue;
      }

      const needsAccount = await pageIsLoginWall(page);
      if (needsAccount && globalThis.__coUsingUserChrome) {
        const google = await clickGoogleSsoFollow(page, otherSessionPages(page));
        if (google.acted) {
          if (google.page !== page && !google.page.isClosed()) page = google.page;
          navIssues.push({
            level: "info",
            code: "nav-google",
            message: "This listing required an account, so Continue with Google was used. Type any password yourself — we never submit.",
          });
          await settle(12_000);
          ({ frame, form } = await pickFormFrame(page));
          await snap();
          continue;
        }
      }

      break;
    }
  }
  await enrichFromAts(page.url(), form.fields);
  await snap();

  let aiInterpreted = false;
  // Opt-in: ALWAYS interpret with AI (max robustness, ignores the deterministic
  // result) — for users who'd rather pay tokens than risk a heuristic miss.
  if (forceAgent && cliId) {
    const aiFrame = await richestControlFrame(page);
    const aiFields = await agentInterpretForm(aiFrame, cliId, form.title || (await page.title().catch(() => ""))).catch(() => [] as ApplyField[]);
    if (aiFields.length) {
      frame = aiFrame;
      form = { ...form, fields: aiFields };
      aiInterpreted = true;
      await snap();
    }
  }

  // 5) Deterministic extraction found no usable APPLICATION form. Classify WHY
  //    first — then run the AGENTIC FALLBACK only for the genuinely AMBIGUOUS
  //    "no-form" case (controls are present but our heuristics produced nothing).
  //    A challenge/login/listing/expired/Workday page has no form to interpret,
  //    so we abort directly with the right message (no wasted AI run).
  if (!aiInterpreted && !looksLikeApplicationForm(form)) {
    const why = await classifyEmpty(page, page.url() || url);
    if (cliId && why.code === "no-form") {
      const id = `apply-${crypto.randomUUID()}`;
      const title = form.title || (await page.title().catch(() => "")) || "Application";
      SESSIONS.set(id, { id, url: page.url() || url, title, fields: [], context, page, frame, createdAt: Date.now(), formShot: shots[shots.length - 1] });
      return { id, title, fields: [], shots, issues: [...consentIssues, ...navIssues], needsDrive: true };
    }
    const id = `apply-${crypto.randomUUID()}`;
    const title = form.title || (await page.title().catch(() => "")) || "Application";
    SESSIONS.set(id, { id, url: page.url() || url, title, fields: [], context, page, frame, createdAt: Date.now(), formShot: shots[shots.length - 1] });
    return {
      id,
      title,
      fields: [],
      shots,
      issues: [...consentIssues, ...navIssues, keepGoingMessage(why)],
    };
  }

  const [cap, multi] = await Promise.all([captchaWarning(page), multiStepInfo(page)]);
  const unlabeled = form.fields.filter((f) => !(f.label || "").trim()).length;
  const issues: ApplyIssue[] = [...consentIssues, ...navIssues];
  if (cap) issues.push(cap);
  if (multi) issues.push(multi);
  if (aiInterpreted) issues.push({ level: "info", code: "ai-interpreted", message: "This form had an uncommon layout, so AI read its fields live — give them an extra check before submitting." });
  if (unlabeled > 0) issues.push({ level: "warn", code: "unlabeled-fields", message: `${unlabeled} field${unlabeled > 1 ? "s" : ""} couldn't be labelled cleanly — double-check ${unlabeled > 1 ? "them" : "it"} before submitting.` });

  const id = `apply-${crypto.randomUUID()}`;
  SESSIONS.set(id, { id, url: page.url() || url, title: form.title, fields: form.fields, context, page, frame, createdAt: Date.now(), formShot: shots[shots.length - 1] });
  return { id, title: form.title, fields: form.fields, shots, issues };
}

export function getSession(id: string): Session | undefined {
  return SESSIONS.get(id);
}

/** Click Next/Continue after filling a step. Never Submit. Re-extracts the new page. */
export async function advanceSession(id: string): Promise<{ advanced: boolean; fields: ApplyField[] }> {
  const s = SESSIONS.get(id);
  if (!s) return { advanced: false, fields: [] };
  if (await hasPasswordInput(s.page)) return { advanced: false, fields: s.fields };

  if (globalThis.__coUsingUserChrome && (await pageIsLoginWall(s.page))) {
    const google = await clickGoogleSsoFollow(s.page, otherSessionPages(s.page));
    if (google.acted) {
      s.page = google.page;
      await s.page.bringToFront().catch(() => {});
      await s.page.waitForTimeout(800);
      const { frame, form } = await pickFormFrame(s.page);
      await enrichFromAts(s.page.url(), form.fields);
      s.frame = frame;
      s.fields = form.fields;
      if (form.title) s.title = form.title;
      s.url = s.page.url() || s.url;
      return { advanced: true, fields: form.fields };
    }
  }

  const hasForm = looksLikeApplicationForm({ title: s.title, url: s.url, fields: s.fields });
  const clicked = await clickNextContinue(s.page, hasForm);
  if (!clicked) return { advanced: false, fields: s.fields };
  await Promise.race(
    s.page.frames().map((f) => f.waitForSelector("form input, form textarea, input[type=file], [role=combobox]", { timeout: 8000 }).catch(() => null)),
  ).catch(() => {});
  await s.page.waitForTimeout(800);
  await dropNewTabs(s.page);
  const { frame, form } = await pickFormFrame(s.page);
  await enrichFromAts(s.page.url(), form.fields);
  if (!looksLikeApplicationForm(form) && !(await hasPasswordInput(s.page))) return { advanced: false, fields: s.fields };
  s.frame = frame;
  s.fields = form.fields;
  if (form.title) s.title = form.title;
  s.url = s.page.url() || s.url;
  return { advanced: true, fields: form.fields };
}

/** Open a bare headed page on a URL (for the agentic drive loop / validation),
 *  without the full extract pipeline. Caller must close the context. */
export async function newDrivePage(url: string): Promise<{ page: Page; context: BrowserContext }> {
  if (globalThis.__coIdleTimer) clearTimeout(globalThis.__coIdleTimer);
  const { context, page } = await openApplyTab(url);
  if (pageStillBlank(page)) await gotoResilient(page, url);
  await dismissConsent(page).catch(() => {});
  await page.waitForTimeout(1000);
  return { page, context };
}

/** Extract+enrich the current page (used after the drive loop reaches a form). */
export async function extractCurrent(page: Page, url: string): Promise<{ frame: Frame; form: ExtractedForm }> {
  const r = await pickFormFrame(page);
  await enrichFromAts(url, r.form.fields);
  return r;
}

export function isApplicationFormFn(form: ExtractedForm): boolean {
  return looksLikeApplicationForm(form);
}

/** After the streamed drive loop reaches a form, extract+enrich it (Tier-3
 *  interpret as a last resort), UPDATE the open session, and return the fields +
 *  issues. Returns null if no real application form materialised. */
export async function finalizeDrivenSession(id: string, cliId?: string): Promise<{ title: string; fields: ApplyField[]; issues: ApplyIssue[] } | null> {
  const s = SESSIONS.get(id);
  if (!s) return null;
  let { frame, form } = await pickFormFrame(s.page);
  await enrichFromAts(s.url, form.fields);
  let aiInterpreted = false;
  if (!looksLikeApplicationForm(form) && cliId) {
    const aiFrame = await richestControlFrame(s.page);
    const aiFields = await agentInterpretForm(aiFrame, cliId, form.title || s.title).catch(() => [] as ApplyField[]);
    if (aiFields.length && looksLikeApplicationForm({ title: form.title, url: form.url, fields: aiFields })) {
      frame = aiFrame;
      form = { ...form, fields: aiFields };
      aiInterpreted = true;
    }
  }
  if (!looksLikeApplicationForm(form)) return null;
  s.frame = frame;
  s.fields = form.fields;
  if (form.title) s.title = form.title;
  const issues: ApplyIssue[] = [{ level: "info", code: "ai-navigated", message: "AI navigated to reach this application form on your machine — review the fields before submitting." }];
  if (aiInterpreted) issues.push({ level: "info", code: "ai-interpreted", message: "AI also read the fields live (uncommon layout) — give them an extra check." });
  const cap = await captchaWarning(s.page);
  if (cap) issues.push(cap);
  return { title: s.title, fields: s.fields, issues };
}

export async function closeSession(id: string): Promise<void> {
  const s = SESSIONS.get(id);
  SESSIONS.delete(id);
  await closeApplyTab(s?.page);
  if (SESSIONS.size === 0) scheduleIdleClose();
}

export type FillStep = { fieldId: string; label: string; ok: boolean; thumb?: string };

function fieldBlob(f: ApplyField): string {
  return [f.label, f.nativeName, f.nativeId, f.id, f.placeholder].filter(Boolean).join(" ");
}

const DROPDOWN_OPTION_SEL =
  '[role="option"], [role="listbox"] [role="option"], [role="listbox"] li, .select__option, .select__menu-list [role="option"], li[class*="option" i], div[class*="option" i]';

const FIELD_FILL_BUDGET_MS = 4000;
const ACTION_MS = 1500;

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

async function waitForOpenOptions(frame: Frame, page: Page, timeout = 700) {
  await frame.locator(DROPDOWN_OPTION_SEL).first().waitFor({ state: "visible", timeout }).catch(() => {});
  await page.locator(DROPDOWN_OPTION_SEL).first().waitFor({ state: "visible", timeout: 250 }).catch(() => {});
}

const FORM_CONTROL_SEL = 'input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select, [role="combobox"], [contenteditable="true"]';

/** Wait until the live form gains/loses controls (dynamic fields). Short timeout if nothing changes. */
export async function waitForFormChange(page: Page, timeout = 900): Promise<void> {
  const n = await page.locator(FORM_CONTROL_SEL).count().catch(() => 0);
  await page
    .waitForFunction(
      (prev) =>
        document.querySelectorAll(
          'input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select, [role="combobox"], [contenteditable="true"]',
        ).length !== prev,
      n,
      { timeout },
    )
    .catch(() => {});
}

async function fillTextControl(loc: ReturnType<Frame["locator"]>, value: string): Promise<boolean> {
  await loc.scrollIntoViewIfNeeded({ timeout: ACTION_MS }).catch(() => {});
  const editable = await loc.evaluate((el) => (el as HTMLElement).isContentEditable).catch(() => false);
  if (editable) {
    await loc.click({ force: true, timeout: ACTION_MS }).catch(() => {});
    await loc.evaluate((el, v) => {
      const h = el as HTMLElement;
      h.focus();
      h.textContent = v;
      h.dispatchEvent(new InputEvent("input", { bubbles: true, data: v }));
      h.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    const landed = await loc.innerText().catch(() => "");
    return !value || String(landed || "").includes(value.slice(0, Math.min(24, value.length)));
  }
  await loc.fill(value, { timeout: ACTION_MS }).catch(() => {});
  const landed = await loc.inputValue().catch(() => "");
  if (landed.trim() !== value.trim() && value.length <= 120) {
    await loc.fill("", { timeout: ACTION_MS }).catch(() => {});
    await loc.pressSequentially(value, { delay: 8, timeout: ACTION_MS }).catch(async () => {
      await loc.fill(value, { timeout: ACTION_MS }).catch(() => {});
    });
  }
  const again = await loc.inputValue().catch(() => "");
  return !(value.length > 0 && !String(again || "").includes(value.slice(0, Math.min(24, value.length))));
}

async function clickOpenMenuOption(frame: Frame, page: Page, value: string): Promise<boolean> {
  const want = String(value || "").trim();
  if (!want) return false;
  await waitForOpenOptions(frame, page);
  const texts = await frame
    .locator(DROPDOWN_OPTION_SEL)
    .evaluateAll((els) => els.map((el) => (el.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean))
    .catch(() => [] as string[]);
  const matched = matchOption(texts, want) || want;
  const candidates = [matched, want, ...want.split(/[,/|]/).map((s) => s.trim()).filter((s) => s && s.toLowerCase() !== want.toLowerCase())];
  const menu = frame.locator(DROPDOWN_OPTION_SEL);
  for (const candidate of candidates) {
    const esc = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const re of [new RegExp(`^\\s*${esc}\\s*$`, "i"), new RegExp(esc, "i")]) {
      const matches = menu.filter({ hasText: re });
      const n = Math.min(await matches.count().catch(() => 0), 12);
      for (let i = 0; i < n; i++) {
        const opt = matches.nth(i);
        if (!(await opt.isVisible().catch(() => false))) continue;
        await opt.click({ force: true }).catch(() => {});
        return true;
      }
    }
  }
  return false;
}

/** Native <select> first; Lever/Ashby "Select..." widgets are often a button + listbox. */
async function chooseDropdownValue(
  frame: Frame,
  page: Page,
  loc: ReturnType<Frame["locator"]>,
  value: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await selectBestOption(loc, value)) return true;
    await loc.scrollIntoViewIfNeeded({ timeout: ACTION_MS }).catch(() => {});
    if (!(await loc.isEnabled().catch(() => true))) return false;
    await loc.click({ force: true, timeout: ACTION_MS }).catch(() => {});
    await waitForOpenOptions(frame, page, 700);
    if (await clickOpenMenuOption(frame, page, value)) return true;
    if (await selectBestOption(loc, value)) return true;
    await page.keyboard.press("Escape").catch(() => {});
  }
  return false;
}

async function selectBestOption(loc: ReturnType<Frame["locator"]>, value: string): Promise<boolean> {
  const want = String(value || "").trim();
  if (!want) return false;
  const labels = await loc
    .evaluate((el) => Array.from((el as HTMLSelectElement).options || []).map((o) => (o.textContent || "").trim()).filter(Boolean))
    .catch(() => [] as string[]);
  const matched = matchOption(labels, want) || want;
  const candidates = [matched, want, ...want.split(/[,/|]/).map((s) => s.trim()).filter((s) => s && s.toLowerCase() !== want.toLowerCase())];
  for (const candidate of candidates) {
    try {
      await loc.selectOption({ label: candidate });
      return true;
    } catch {
      /* try value */
    }
    try {
      await loc.selectOption(candidate);
      return true;
    } catch {
      /* try DOM */
    }
    const found = await loc
      .evaluate((el, raw) => {
        const sel = el as HTMLSelectElement;
        const w = String(raw || "").trim().toLowerCase();
        const opts = Array.from(sel.options);
        const skip = (t: string) => /^(select|choose|--|no answer)/i.test(t.trim());
        const hit =
          opts.find((o) => o.text.trim().toLowerCase() === w) ||
          opts.find((o) => !skip(o.text) && (o.text.toLowerCase().includes(w) || w.includes(o.text.trim().toLowerCase()))) ||
          opts.find((o) => o.value.toLowerCase() === w);
        if (!hit) return false;
        sel.value = hit.value;
        sel.dispatchEvent(new Event("input", { bubbles: true }));
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }, candidate)
      .catch(() => false);
    if (found) return true;
  }
  return false;
}

/** True for a file field that wants the candidate's résumé/CV (vs. cover letter,
 *  portfolio, or a generic attachment we leave for the user). */
function isResumeField(f: ApplyField): boolean {
  if (f.type !== "file") return false;
  const blob = fieldBlob(f);
  if (/cover\s*letter|motivation\s*letter|transcript|certificate|portfolio|other document/i.test(blob)) return false;
  return /resume|résumé|\bcv\b|curriculum|lebenslauf|currículum/i.test(blob) || !String(f.label || "").trim();
}

function isCoverLetterField(f: ApplyField): boolean {
  return f.type === "file" && /cover\s*letter|motivation\s*letter|letter\s+of\s+interest/i.test(fieldBlob(f));
}

function isLocationField(f: ApplyField): boolean {
  const blob = fieldBlob(f).toLowerCase();
  return /location|city|locate me/.test(blob) && !/country|phone|email|longitude|latitude/.test(blob);
}

export type DirectFacts = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  phoneNational?: string;
  city?: string;
  country?: string;
  location?: string;
  preferredLocation?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
  employer?: string;
  title?: string;
  skills?: string;
  experienceYears?: string;
    yearOfGraduation?: string;
    noticePeriod?: string;
    gender?: string;
    currentSalary?: string;
    expectedSalary?: string;
    coverLetter?: string;
    source?: string;
    cvText?: string;
    university?: string;
    degree?: string;
    careerStart?: string;
    aiTools?: string;
    surveyClicks?: string[];
  surveySelects?: Array<{ label: string; value: string }>;
};

async function geocodeCity(value: string): Promise<{ lat: string; lon: string; label: string } | null> {
  try {
    const q = encodeURIComponent(value);
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&accept-language=en`, {
      headers: { Accept: "application/json", "User-Agent": "StudentCareerAI-apply/1.0", "Accept-Language": "en" },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const rows = (await r.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
    const hit = rows[0];
    if (!hit?.lat || !hit?.lon) return null;
    const label = latinLocationLabel(hit.display_name || value, value);
    return { lat: String(hit.lat), lon: String(hit.lon), label };
  } catch {
    return null;
  }
}

function latinLocationLabel(display: string, fallback: string): string {
  const text = String(display || "").trim();
  const latin = (text.match(/[A-Za-z][A-Za-z .'-]{1,}/g) || []).join(", ").replace(/\s+,/g, ",").trim();
  if (latin.length >= 3) return latin;
  return String(fallback || "").trim() || text;
}

function locationQueryTokens(value: string): string[] {
  const city = value.split(",")[0]?.trim() || value;
  const latinCity = latinLocationLabel(city, city);
  const out = [latinCity, city, value];
  if (/pakistan/i.test(value) || /peshawar|lahore|karachi|islamabad/i.test(city)) {
    out.push(`${latinCity}, Pakistan`);
  }
  return out.filter((q, i, all) => q && all.indexOf(q) === i && !/[\u0600-\u06FF]/.test(q));
}

async function clickPlaceSuggestion(frame: Frame, page: Page, city: string): Promise<boolean> {
  const token = latinLocationLabel(city, city).split(",")[0]?.trim() || city;
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(esc, "i");
  const selectors = [
    page.locator(".pac-item, .pac-item-query"),
    frame.locator(".pac-item, .pac-item-query"),
    page.getByRole("option"),
    frame.getByRole("option"),
    page.locator('[role="listbox"] [role="option"], [role="listbox"] li, ul[role="listbox"] > *'),
    frame.locator('[role="listbox"] [role="option"], [role="listbox"] li, ul[role="listbox"] > *'),
    page.getByText(new RegExp(`^${esc}[,\\s]`, "i")),
    frame.getByText(new RegExp(`^${esc}[,\\s]`, "i")),
  ];
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    for (const menu of selectors) {
      const match = menu.filter({ hasText: re }).first();
      if (await match.count()) {
        await match.scrollIntoViewIfNeeded().catch(() => {});
        const clicked = await match.click({ timeout: 2000 }).then(() => true).catch(() => false);
        if (clicked) return true;
      }
    }
    await page.waitForTimeout(200);
  }
  for (const menu of selectors) {
    const first = menu.first();
    if (await first.count()) {
      const text = ((await first.innerText().catch(() => "")) || "").trim();
      if (text && re.test(text)) {
        const clicked = await first.click({ timeout: 2000 }).then(() => true).catch(() => false);
        if (clicked) return true;
      }
    }
  }
  for (const menu of selectors) {
    const first = menu.first();
    if (await first.count()) {
      const clicked = await first.click({ timeout: 2000 }).then(() => true).catch(() => false);
      if (clicked) return true;
    }
  }
  return false;
}

async function writeLocationFallback(frame: Frame, value: string, geo: { lat: string; lon: string; label: string } | null): Promise<boolean> {
  return frame.evaluate(
    ({ value: label, geo: g }) => {
      const input = document.querySelector<HTMLInputElement>(
        '#job_application_location, input[name="job_application[location]"], input[name="location"], input[id*="location" i]:not([type=hidden])',
      );
      if (!input) return false;
      const next = String(g?.label || label || "").trim();
      if (!next || /[\u0600-\u06FF]/.test(next)) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, next);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const lat = document.querySelector<HTMLInputElement>('#job_application_latitude, input[name="job_application[latitude]"], input[name="latitude"]');
      const lng = document.querySelector<HTMLInputElement>('#job_application_longitude, input[name="job_application[longitude]"], input[name="longitude"]');
      if (g && lat) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(lat, g.lat);
        lat.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (g && lng) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(lng, g.lon);
        lng.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return Boolean((input.value || "").trim()) && !/locate me/i.test(input.value);
    },
    { value, geo },
  );
}

function toIsoDate(value: string): string {
  const s = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^(19|20)\d{2}$/.test(s)) return `${s}-01-01`;
  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const eu = s.match(/^(\d{1,2})[.](\d{1,2})[.](\d{4})$/);
  if (eu) return `${eu[3]}-${eu[2].padStart(2, "0")}-${eu[1].padStart(2, "0")}`;
  return s;
}

async function fillDateControl(loc: ReturnType<Frame["locator"]>, value: string): Promise<boolean> {
  const iso = toIsoDate(value);
  const year = iso.slice(0, 4);
  const variants = Array.from(new Set([iso, value, year])).filter(Boolean);
  for (const candidate of variants) {
    try {
      await loc.fill(candidate);
      const landed = (await loc.inputValue().catch(() => "")).trim();
      if (landed) return true;
    } catch {
      /* try next encoding */
    }
  }
  return false;
}

async function fillLocationInput(frame: Frame, page: Page, loc: ReturnType<Frame["locator"]>, value: string): Promise<boolean> {
  return withBudget(FIELD_FILL_BUDGET_MS, async () => {
    const city = latinLocationLabel(value.split(",")[0]?.trim() || value, value.split(",")[0]?.trim() || value);
    const queries = locationQueryTokens(value);
    await loc.scrollIntoViewIfNeeded({ timeout: ACTION_MS }).catch(() => {});
    for (const query of queries) {
      await loc.click({ timeout: ACTION_MS }).catch(() => {});
      await loc.fill("", { timeout: ACTION_MS }).catch(() => {});
      await loc.pressSequentially(query, { delay: 25, timeout: ACTION_MS }).catch(async () => {
        await page.keyboard.type(query, { delay: 25 });
      });
      await page.waitForTimeout(180);
      if (await clickPlaceSuggestion(frame, page, city)) {
        const landed = (await loc.inputValue().catch(() => "")).trim();
        if (landed && !/locate me/i.test(landed) && !/[\u0600-\u06FF]/.test(landed)) return true;
      }
    }
    const geo = await geocodeCity(queries[0] || value);
    const typed = await clickPlaceSuggestion(frame, page, city);
    if (typed) {
      const landed = (await loc.inputValue().catch(() => "")).trim();
      if (landed && !/[\u0600-\u06FF]/.test(landed)) return true;
    }
    if (geo) {
      await loc.fill("", { timeout: ACTION_MS }).catch(() => {});
      await loc.pressSequentially(geo.label, { delay: 25, timeout: ACTION_MS }).catch(() => loc.fill(geo.label, { timeout: ACTION_MS }));
      await page.waitForTimeout(180);
      if (await clickPlaceSuggestion(frame, page, city)) return true;
    }
    return writeLocationFallback(frame, queries[0] || value, geo);
  }, false);
}

async function attachBySelectors(frame: Frame, filePath: string, selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    try {
      const loc = frame.locator(sel).first();
      if (await loc.count()) {
        await loc.setInputFiles(filePath);
        return true;
      }
    } catch {
      /* try next */
    }
  }
  return false;
}

const RESUME_FILE_SELECTORS = [
  'input[type=file][name="resume"]',
  'input[type=file][name="job_application[resume]"]',
  'input[type=file][name="candidate[resume]"]',
  'input[type=file][name*="resume" i]',
  'input[type=file][id*="resume" i]',
  'input[type=file][id="resume"]',
  'input[type=file][accept*="pdf" i]',
  "form#application-form input[type=file]",
  "form input[type=file]",
  "input[type=file]",
];

async function frameHasJazzHrResume(frame: Frame): Promise<boolean> {
  return (await frame.locator("#resumator-choose-upload, #resumator-choose-paste, #resumator-resume-value, #resumator-resumetext-value").count()) > 0;
}

/** JazzHR only counts a résumé after Attach/Paste is chosen and that panel is on screen. */
async function resumeVisibleOnJazzHr(frame: Frame): Promise<boolean> {
  return frame
    .evaluate(() => {
      const shown = (el: HTMLElement | null) => {
        if (!el) return false;
        if (el.classList.contains("none")) return false;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
        return el.offsetParent !== null || style.position === "fixed";
      };
      const chooser = document.getElementById("resumator-resume-options") as HTMLElement | null;
      if (shown(chooser)) return false;
      const ta = document.querySelector("#resumator-resumetext-value") as HTMLTextAreaElement | null;
      const pasteWrap = document.getElementById("resumator-resume-paste-wrapper") as HTMLElement | null;
      if (shown(pasteWrap) && ta && String(ta.value || "").trim().length > 40) return true;
      const uploadWrap = document.getElementById("resumator-resume-upload-wrapper") as HTMLElement | null;
      const input = document.querySelector("#resumator-resume-value") as HTMLInputElement | null;
      return !!(shown(uploadWrap) && input?.files && input.files.length > 0);
    })
    .catch(() => false);
}

async function resumeAlreadyAttached(frame: Frame): Promise<boolean> {
  if (await frameHasJazzHrResume(frame)) return resumeVisibleOnJazzHr(frame);
  return frame
    .evaluate(() =>
      Array.from(document.querySelectorAll("input[type=file]")).some((el) => {
        const files = (el as HTMLInputElement).files;
        return !!(files && files.length > 0);
      }),
    )
    .catch(() => false);
}

type JazzHrResumeMode = "upload" | "paste";

async function revealJazzHrResumePanel(frame: Frame, mode: JazzHrResumeMode): Promise<void> {
  const sel = mode === "upload" ? "#resumator-choose-upload" : "#resumator-choose-paste";
  await frame.locator(sel).click({ force: true, timeout: 4000 }).catch(() => {});
  await frame
    .evaluate((which) => {
      type Jq = (sel: string) => { click: () => void };
      const w = window as unknown as { jQuery?: Jq; $?: Jq };
      const jq = w.jQuery || w.$;
      const id = which === "upload" ? "#resumator-choose-upload" : "#resumator-choose-paste";
      if (jq) jq(id).click();
      else (document.querySelector(id) as HTMLElement | null)?.click();
      const show = (el: HTMLElement | null) => {
        if (!el) return;
        el.classList.remove("none");
        el.style.removeProperty("display");
        el.style.setProperty("display", "block", "important");
      };
      const hide = (el: HTMLElement | null) => {
        if (!el) return;
        el.classList.add("none");
        el.style.setProperty("display", "none", "important");
      };
      hide(document.getElementById("resumator-resume-options") as HTMLElement | null);
      if (which === "upload") {
        show(document.getElementById("resumator-resume-upload-wrapper") as HTMLElement | null);
        hide(document.getElementById("resumator-resume-paste-wrapper") as HTMLElement | null);
      } else {
        show(document.getElementById("resumator-resume-paste-wrapper") as HTMLElement | null);
        hide(document.getElementById("resumator-resume-upload-wrapper") as HTMLElement | null);
      }
    }, mode)
    .catch(() => {});
}

async function revealAndPasteJazzHr(frame: Frame, cvText: string): Promise<boolean> {
  await revealJazzHrResumePanel(frame, "paste");
  const pasteWrap = frame.locator("#resumator-resume-paste-wrapper");
  await pasteWrap.waitFor({ state: "visible", timeout: 4000 }).catch(() => {});
  const ta = frame.locator("#resumator-resumetext-value, textarea[name='resumator-resumetext-value']").first();
  if (!(await ta.count())) return false;
  await ta.fill(cvText, { timeout: 8000 }).catch(async () => {
    await frame.evaluate((text) => {
      const el = document.querySelector("#resumator-resumetext-value") as HTMLTextAreaElement | null;
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, cvText);
  });
  return resumeVisibleOnJazzHr(frame);
}

async function revealAndUploadJazzHr(frame: Frame, _page: Page, filePath: string): Promise<boolean> {
  // "Attach resume" only unhides the file input — it does not open a file chooser.
  await revealJazzHrResumePanel(frame, "upload");
  await frame.locator("#resumator-resume-upload-wrapper").waitFor({ state: "visible", timeout: 4000 }).catch(() => {});
  const file = frame.locator("#resumator-resume-value, input[name='resumator-resume-value']").first();
  if (!(await file.count())) return false;
  await file.setInputFiles(filePath);
  return resumeVisibleOnJazzHr(frame);
}

async function attachResumeEverywhere(page: Page, frame: Frame, filePath?: string, cvText?: string): Promise<boolean> {
  if (!filePath && !cvText) return false;
  const frames = page.frames().length ? page.frames() : [frame];
  const jazzFrames: Frame[] = [];
  for (const fr of frames) {
    if (await frameHasJazzHrResume(fr)) jazzFrames.push(fr);
    else if (await resumeAlreadyAttached(fr)) return true;
  }

  for (const fr of jazzFrames) {
    if (await resumeVisibleOnJazzHr(fr)) return true;
    if (filePath) {
      const uploaded = await revealAndUploadJazzHr(fr, page, filePath).catch(() => false);
      if (uploaded) return true;
    }
    if (cvText) {
      const pasted = await revealAndPasteJazzHr(fr, cvText).catch(() => false);
      if (pasted) return true;
    }
  }
  if (jazzFrames.length) return false;

  if (filePath) {
    for (const fr of frames) {
      if (await attachBySelectors(fr, filePath, RESUME_FILE_SELECTORS)) return true;
    }
    for (const fr of frames) {
      const btn = fr.getByRole("button", { name: /attach( resume| cv)?/i }).first();
      const link = fr.getByRole("link", { name: /^(attach resume|upload resume)$/i }).first();
      const target = (await btn.count()) ? btn : link;
      if (!(await target.count())) continue;
      try {
        const [chooser] = await Promise.all([
          page.waitForEvent("filechooser", { timeout: 5000 }),
          target.click({ timeout: 4000 }),
        ]);
        await chooser.setFiles(filePath);
        return true;
      } catch {
        await target.click({ timeout: 4000 }).catch(() => {});
        if (await attachBySelectors(fr, filePath, RESUME_FILE_SELECTORS)) return true;
      }
    }
  }
  if (cvText) {
    for (const fr of frames) {
      const paste = fr.getByRole("link", { name: /paste resume/i }).first();
      if (await paste.count()) await paste.click({ force: true }).catch(() => {});
      const ta = fr.locator('textarea[name*="resume" i], textarea[id*="resume" i], textarea[placeholder*="resume" i]').first();
      if (await ta.count()) {
        await ta.fill(cvText);
        return true;
      }
    }
  }
  return false;
}

/** Tick only the matching Greenhouse multi-select option; never click a parent that wraps every choice. */
async function clickExactSurveyOption(frame: Frame, page: Page, optionText: string): Promise<boolean> {
  const needle = optionText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/['’]/g, "['’]");
  const re = optionText.trim().length <= 4
    ? new RegExp(`^\\s*${needle}\\s*$`, "i")
    : new RegExp(needle, "i");

  const radio = frame.getByRole("radio", { name: re }).first();
  if (await radio.count()) {
    await radio.click({ force: true }).catch(async () => {
      await radio.check({ force: true }).catch(() => {});
    });
    return true;
  }

  const checkbox = frame.getByRole("checkbox", { name: re }).first();
  if (await checkbox.count()) {
    const checked = await checkbox.isChecked().catch(() => false);
    if (!checked) await checkbox.check({ force: true }).catch(async () => {
      await checkbox.click({ timeout: 3000 });
    });
    return true;
  }

  // Prefer the <label> whose own text is this option (not the question fieldset).
  const labels = frame.locator("label");
  const n = await labels.count();
  for (let i = 0; i < n; i++) {
    const lab = labels.nth(i);
    const text = ((await lab.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    if (!re.test(text)) continue;
    // Skip labels that contain many options (parent / legend wrappers).
    if ((text.match(/\n/g) || []).length >= 2 || text.length > optionText.length + 80) continue;
    await lab.scrollIntoViewIfNeeded().catch(() => {});
    const input = lab.locator('input[type="checkbox"], input[type="radio"]').first();
    if (await input.count()) {
      const checked = await input.isChecked().catch(() => false);
      if (!checked) await input.check({ force: true }).catch(async () => {
        await lab.click({ timeout: 3000 });
      });
    } else {
      await lab.click({ timeout: 3000 }).catch(() => {});
    }
    return true;
  }

  const exact = frame.getByText(re);
  // Walk matches and pick the smallest leaf-looking node (option row), not the question block.
  const count = await exact.count().catch(() => 0);
  for (let i = 0; i < Math.min(count, 12); i++) {
    const el = exact.nth(i);
    const text = ((await el.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    if (!re.test(text) || text.length > optionText.length + 100) continue;
    if ((text.match(/\n/g) || []).length >= 2) continue;
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.click({ timeout: 3000 }).catch(() => {});
    return true;
  }
  return false;
}

/**
 * Click a radio option inside its question group. Custom ATS radios (hidden
 * native inputs, role=radio, stylized labels) often ignore locator.check().
 */
async function selectRadioOption(frame: Frame, page: Page, question: string, option: string): Promise<boolean> {
  const opt = String(option || "").trim();
  const q = String(question || "").trim();
  if (!opt) return false;

  const landed = await frame
    .evaluate(({ q, opt }) => {
      const norm = (s: string) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
      const want = norm(opt);
      const yes = want === "yes";
      const no = want === "no";

      const optionLabel = (radio: Element) => {
        const id = (radio as HTMLElement).id;
        if (id) {
          const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (lab) return (lab.textContent || "").replace(/\s+/g, " ").trim();
        }
        const wrap = radio.closest("label");
        if (wrap) {
          const c = wrap.cloneNode(true) as HTMLElement;
          c.querySelectorAll("input, svg, [class*='circle' i]").forEach((n) => n.remove());
          return (c.textContent || "").replace(/\s+/g, " ").trim();
        }
        const aria = radio.getAttribute("aria-label") || "";
        if (aria) return aria.trim();
        return ((radio as HTMLInputElement).value || radio.textContent || "").replace(/\s+/g, " ").trim();
      };

      const matches = (text: string, value: string) => {
        const t = norm(text);
        const v = norm(value);
        if (t === want || v === want) return true;
        if (want.length > 3 && t.includes(want) && t.length <= want.length + 28) return true;
        if (yes && (v === "1" || t === "true" || t === "y")) return true;
        if (no && (v === "0" || v === "2" || t === "false" || t === "n")) return true;
        return false;
      };

      const activate = (radio: Element) => {
        const el = radio as HTMLElement;
        el.scrollIntoView({ block: "center", inline: "nearest" });
        const input = el.matches("input") ? (el as HTMLInputElement) : el.querySelector('input[type="radio"]');
        const label = input?.id
          ? (document.querySelector(`label[for="${CSS.escape(input.id)}"]`) as HTMLElement | null)
          : (el.closest("label") as HTMLElement | null);
        const target = label || el;
        target.click();
        if (input && !input.checked) {
          input.checked = true;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return true;
      };

      const qn = norm(q).slice(0, 70);
      const containers = Array.from(
        document.querySelectorAll('fieldset, [role="radiogroup"], [class*="question" i], [class*="field" i], [class*="form-group" i], form'),
      );
      const ranked = qn
        ? containers
            .filter((c) => norm(c.textContent || "").includes(qn))
            .sort((a, b) => (a.textContent || "").length - (b.textContent || "").length)
        : [];
      const scopes: ParentNode[] = ranked.length ? [ranked[0]] : [document];

      for (const scope of scopes) {
        const radios = Array.from(scope.querySelectorAll('input[type="radio"], [role="radio"]'));
        for (const radio of radios) {
          const value = (radio as HTMLInputElement).value || "";
          if (matches(optionLabel(radio), value)) return activate(radio);
        }
      }
      return false;
    }, { q, opt })
    .catch(() => false);

  if (landed) return true;

  try {
    const nameRe = new RegExp(`^\\s*${opt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
    if (q) {
      const heading = frame.getByText(q.slice(0, 48), { exact: false }).first();
      if (await heading.count()) {
        const group = heading.locator("xpath=ancestor::*[.//input[@type='radio'] or .//*[@role='radio']][1]");
        const byRole = group.getByRole("radio", { name: nameRe }).first();
        if (await byRole.count()) {
          await byRole.click({ force: true });
          return true;
        }
        const lab = group.locator("label").filter({ hasText: nameRe }).first();
        if (await lab.count()) {
          await lab.click({ force: true });
          return true;
        }
      }
    }
    const pageRadio = frame.getByRole("radio", { name: nameRe }).first();
    if (await pageRadio.count()) {
      await pageRadio.click({ force: true });
      return true;
    }
  } catch {
    /* fall through */
  }
  return clickExactSurveyOption(frame, page, opt);
}

/** Uncheck every checkbox under a question whose label does not match keepNeedles. */
async function clearSurveyGroupExcept(frame: Frame, questionRe: RegExp, keepNeedles: string[]): Promise<void> {
  const keep = keepNeedles.map((n) => new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/['’]/g, "['’]"), "i"));
  const heading = frame.getByText(questionRe).first();
  if (!(await heading.count())) return;
  const group = heading.locator("xpath=ancestor::*[.//input[@type='checkbox']][1]");
  const boxes = (await group.count()) ? group.locator('input[type="checkbox"]') : frame.locator('input[type="checkbox"]');
  const n = await boxes.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const box = boxes.nth(i);
    const id = await box.getAttribute("id").catch(() => null);
    let labelText = "";
    if (id) {
      labelText = ((await frame.locator(`label[for="${cssAttr(id)}"]`).innerText().catch(() => "")) || "").trim();
    }
    if (!labelText) {
      labelText = ((await box.evaluate((el) => (el as HTMLInputElement).closest("label")?.innerText || "").catch(() => "")) || "").trim();
    }
    const keepThis = keep.some((re) => re.test(labelText));
    if (keepThis) continue;
    if (await box.isChecked().catch(() => false)) {
      await box.uncheck({ force: true }).catch(async () => {
        await box.click({ force: true }).catch(() => {});
      });
    }
  }
}

async function fillLabeledText(frame: Frame, page: Page, labels: RegExp, value: string, location = false): Promise<boolean> {
  if (!value) return false;
  const box = frame.getByLabel(labels).first();
  if (await box.count()) {
    const tag = await box.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
    if (tag === "select") return chooseDropdownValue(frame, page, box, value);
    if (location) return fillLocationInput(frame, page, box, value);
    try {
      await box.fill(value);
      return true;
    } catch {
      try {
        await box.click();
        await box.pressSequentially(value, { delay: 15 });
        return true;
      } catch {
        /* fall through to question-label lookup */
      }
    }
  }
  return fillByQuestionLabel(frame, page, value, labels);
}

async function fillByQuestionLabel(frame: Frame, page: Page, value: string, labels: RegExp): Promise<boolean> {
  const lab = frame.getByText(labels).first();
  if (!(await lab.count())) return false;
  const sel = lab.locator("xpath=following::select[1]");
  if (await sel.count()) return chooseDropdownValue(frame, page, sel, value);
  const box = lab.locator("xpath=following::input[1] | following::textarea[1]");
  if (!(await box.count())) return false;
  try {
    await box.fill(value);
    return true;
  } catch {
    return false;
  }
}

/** Greenhouse/ATS native names — fill even if extraction missed the field id. */
async function fillDirectAtsFields(frame: Frame, page: Page, facts: DirectFacts, cvPath?: string, coverPath?: string): Promise<FillStep[]> {
  const steps: FillStep[] = [];
  const named: Array<[string, string, string]> = [
    ["first_name", "First Name", facts.firstName || ""],
    ["firstName", "First Name", facts.firstName || ""],
    ["last_name", "Last Name", facts.lastName || ""],
    ["lastName", "Last Name", facts.lastName || ""],
    ["email", "Email", facts.email || ""],
    ["phone", "Phone", facts.phoneNational || facts.phone || ""],
    ["yearOfGraduation", "Year of Graduation", facts.yearOfGraduation || ""],
    ["experienceYears", "Years of Experience", facts.experienceYears || ""],
    ["currentEmployer", "Current Employer", facts.employer || ""],
    ["skills", "Key Skills", facts.skills || ""],
    ["linkedin", "LinkedIn", facts.linkedin || ""],
    ["portfolio", "Portfolio", facts.portfolio || facts.github || ""],
    ["currentLocation", "Current Location", facts.location || ""],
    ["preferredLocation", "Preferred Work Location", facts.preferredLocation || facts.location || ""],
    ["noticePeriod", "Notice Period", facts.noticePeriod || ""],
    ["currentCTC", "Current Salary", facts.currentSalary || ""],
    ["expectedCTC", "Expected Salary", facts.expectedSalary || ""],
    ["gender", "Gender", facts.gender || ""],
    ["eeo[gender]", "Gender", facts.gender || ""],
    ["coverLetter", "Cover Letter", facts.coverLetter || ""],
  ];
  for (const [name, label, value] of named) {
    if (!value) continue;
    try {
      const loc = frame.locator(`input[name="${name}"], textarea[name="${name}"], select[name="${name}"], #${name}`).first();
      if (await loc.count()) {
        let ok = true;
        const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => "input");
        if (tag === "select") {
          const days = name === "noticePeriod" && /^\d+$/.test(value) ? `${value} days` : value;
          ok = (await selectBestOption(loc, days)) || (await selectBestOption(loc, value));
        } else {
          const current = (await loc.inputValue().catch(() => "")).trim();
          if (!current) {
            const type = ((await loc.getAttribute("type")) || "").toLowerCase();
            const fillVal =
              name === "noticePeriod" && type === "number" && !/^\d+$/.test(value)
                ? "0"
                : name === "noticePeriod" && type !== "number" && /^\d+$/.test(value)
                  ? `${value} days`
                  : value;
            await loc.fill(fillVal);
          }
        }
        steps.push({ fieldId: name, label, ok });
      }
    } catch {
      steps.push({ fieldId: name, label, ok: false });
    }
  }

  if (facts.source) {
    const sel = frame.locator('select[name="source"]').first();
    if (await sel.count()) {
      let ok = false;
      await sel
        .selectOption({ label: facts.source })
        .then(() => {
          ok = true;
        })
        .catch(async () => {
          const opt = sel.locator("option").filter({ hasText: /website|linkedin/i }).nth(0);
          if (await opt.count()) {
            const v = await opt.getAttribute("value");
            if (v) await sel.selectOption(v);
            ok = true;
          }
        });
      steps.push({ fieldId: "source", label: "How did you hear", ok });
    }
  }

  if (facts.linkedin) {
    steps.push({ fieldId: "linkedin-label", label: "LinkedIn Profile", ok: await fillLabeledText(frame, page, /linkedin/i, facts.linkedin) });
  }
  if (facts.github || facts.portfolio) {
    steps.push({
      fieldId: "portfolio-label",
      label: "Portfolio / GitHub",
      ok: await fillLabeledText(frame, page, /portfolio|github/i, facts.portfolio || facts.github || ""),
    });
  }
  if (facts.skills) {
    steps.push({ fieldId: "skills-label", label: "Key Skills", ok: await fillLabeledText(frame, page, /key skills|^skills$/i, facts.skills) });
  }
  if (facts.experienceYears) {
    steps.push({
      fieldId: "years-label",
      label: "Years of Experience",
      ok: await fillLabeledText(frame, page, /years of experience|total experience/i, facts.experienceYears),
    });
  }
  if (facts.university) {
    steps.push({
      fieldId: "university-label",
      label: "University Name",
      ok: await fillLabeledText(frame, page, /university name|university|college|institution/i, facts.university),
    });
  }
  if (facts.degree) {
    steps.push({
      fieldId: "education-label",
      label: "Education Qualification",
      ok: await fillLabeledText(frame, page, /education qualification|highest education|qualification/i, facts.degree),
    });
  }
  if (facts.careerStart) {
    steps.push({
      fieldId: "career-start-label",
      label: "Career Start date",
      ok: await fillLabeledText(frame, page, /career start|start date/i, facts.careerStart),
    });
  }
  if (facts.aiTools) {
    steps.push({
      fieldId: "ai-tools-label",
      label: "AI tools",
      ok: await fillLabeledText(frame, page, /list the ai tool|ai tool\(s\) name/i, facts.aiTools),
    });
  }
  if (facts.employer) {
    steps.push({ fieldId: "employer-label", label: "Current Employer", ok: await fillLabeledText(frame, page, /current employer/i, facts.employer) });
  }
  if (facts.title) {
    steps.push({ fieldId: "title-label", label: "Current Job Title", ok: await fillLabeledText(frame, page, /current (job )?title/i, facts.title) });
  }
  if (facts.gender) {
    steps.push({ fieldId: "gender-label", label: "Gender", ok: await fillLabeledText(frame, page, /^gender\b/i, facts.gender) });
  }

  const city = [facts.city, facts.country].filter(Boolean).join(", ");
  const locLabel = frame.getByLabel(/^location/i).first();
  if (await locLabel.count()) {
    const tag = await locLabel.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
    if (tag === "select") {
      const picked =
        (await selectBestOption(locLabel, facts.city || "")) ||
        (await selectBestOption(locLabel, city)) ||
        (await selectBestOption(locLabel, facts.preferredLocation || "")) ||
        (await selectBestOption(locLabel, "Karachi")) ||
        (await selectBestOption(locLabel, "Lahore"));
      steps.push({ fieldId: "location-select", label: "Location", ok: picked });
    }
  }
  if (city) {
    const locSels = [
      'input[name="job_application[location]"]',
      "input#job_application_location",
      'input[name="location"]',
      'input[id*="location" i]:not([type=hidden])',
      'input[placeholder*="Locate" i]',
      'input[aria-label*="Location" i]',
    ];
    let ok = false;
    for (const sel of locSels) {
      const loc = frame.locator(sel).first();
      if (await loc.count()) {
        const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => "input");
        if (tag === "select") {
          ok =
            (await selectBestOption(loc, facts.city || "")) ||
            (await selectBestOption(loc, city)) ||
            (await selectBestOption(loc, "Karachi"));
        } else {
          ok = await fillLocationInput(frame, page, loc, city);
        }
        if (ok) break;
      }
    }
    if (!ok) {
      const beside = frame.getByText(/^Locate me$/i).locator("xpath=preceding::input[1]");
      if (await beside.count()) ok = await fillLocationInput(frame, page, beside, city);
    }
    if (!ok) ok = await fillLabeledText(frame, page, /location\s*\(city\)|^location$|city/i, facts.city || city, true);
    steps.push({ fieldId: "location", label: "Location (City)", ok });
  }

  if (facts.noticePeriod) {
    steps.push({
      fieldId: "notice-label",
      label: "Notice period",
      ok: await fillLabeledText(frame, page, /notice period/i, facts.noticePeriod),
    });
  }
  if (facts.expectedSalary) {
    steps.push({
      fieldId: "expected-label",
      label: "Expected Salary",
      ok: await fillLabeledText(frame, page, /expected salary|expected ctc/i, facts.expectedSalary),
    });
  }

  const resumeOk = await attachResumeEverywhere(page, frame, cvPath, facts.cvText);
  steps.push({ fieldId: "resume-direct", label: "Resume/CV", ok: resumeOk });

  if (coverPath) {
    const ok = await attachBySelectors(frame, coverPath, [
      'input[type=file][name="cover_letter"]',
      'input[type=file][name*="cover" i]',
      'input[type=file][id*="cover" i]',
    ]);
    steps.push({ fieldId: "cover-direct", label: "Cover Letter", ok });
  }

  // Clear Greenhouse "tick all that apply" groups, then tick only the intended options.
  await clearSurveyGroupExcept(frame, /how did you learn about a role/i, [
    "Careers Page",
  ]);
  await clearSurveyGroupExcept(frame, /what influenced your decision/i, [
    "career growth and development",
    "opportunity to drive impact",
  ]);
  await clearSurveyGroupExcept(frame, /specify the platform/i, []);

  for (const text of facts.surveyClicks || []) {
    const ok = await clickExactSurveyOption(frame, page, text);
    steps.push({ fieldId: `survey-${text.slice(0, 24)}`, label: text, ok });
  }
  for (const sel of facts.surveySelects || []) {
    const box = frame.getByLabel(new RegExp(sel.label, "i")).first();
    let ok = false;
    if (await box.count()) {
      await box.click().catch(() => {});
      await page.waitForTimeout(200);
      await page.keyboard.type(sel.value, { delay: 20 }).catch(() => {});
      const opt = frame.getByRole("option", { name: new RegExp(`^${sel.value}$`, "i") }).first();
      if (await opt.count()) {
        await opt.click();
        ok = true;
      } else {
        const any = frame.locator('[role="option"], .select__option').filter({ hasText: new RegExp(sel.value, "i") }).first();
        if (await any.count()) {
          await any.click();
          ok = true;
        }
      }
    }
    steps.push({ fieldId: `survey-select-${sel.label}`, label: sel.label, ok });
  }

  return steps;
}

/** Fill the real form with verified answers, screenshotting after each field.
 *  Attaches the tailored CV PDF to résumé/CV file fields (cvPath). NEVER clicks a
 *  submit/apply control — only fills/selects/checks/attaches. */
export async function fillSession(
  id: string,
  answers: Record<string, string>,
  fieldsMeta: ApplyField[],
  cvPath?: string,
  coverLetterPath?: string,
  direct?: DirectFacts,
): Promise<{ steps: FillStep[]; navigated: boolean; issues: ApplyIssue[] }> {
  const s = SESSIONS.get(id);
  if (!s) throw new Error("apply session not found (it may have expired)");
  s.filledIds ??= new Set();
  s.lastActiveAt = Date.now();
  const byId = new Map(fieldsMeta.map((f) => [f.id, f]));
  const steps: FillStep[] = [];
  // Belt-and-suspenders: if filling ever navigates the page (i.e. something got
  // submitted), the URL path changes. We never submit by construction, but we
  // report it so the caller can flag it instead of silently "succeeding".
  const startPath = (() => {
    try {
      return new URL(s.frame.url()).pathname;
    } catch {
      return s.frame.url();
    }
  })();

  const shoot = async () => {
    try {
      const buf = await s.page.screenshot({ type: "jpeg", quality: 38 });
      return `data:image/jpeg;base64,${buf.toString("base64")}`;
    } catch {
      return undefined;
    }
  };

  // 1) Attach the tailored CV to every résumé/CV file field (even with no text
  //    answer). The real <input type=file> was tagged data-co-field at extract
  //    time; setInputFiles works even when the ATS visually hides it behind a
  //    dropzone. Other file fields (cover letter, portfolio) are left to the user.
  const attachFile = async (meta: ApplyField, filePath: string, label: string) => {
      let ok = false;
      try {
      await s.frame.locator(`[data-co-field="${cssAttr(meta.id)}"]`).first().setInputFiles(filePath);
        ok = true;
      } catch {
        try {
        const named = meta.nativeName
          ? s.frame.locator(`input[type=file][name="${cssAttr(meta.nativeName)}"]`).first()
          : s.frame.locator(`input[type=file]`).first();
        await named.setInputFiles(filePath);
          ok = true;
        } catch {
          ok = false;
        }
      }
    steps.push({ fieldId: meta.id, label, ok, thumb: await shoot() });
  };

  if ((cvPath || direct?.cvText) && !s.resumeAttached) {
    const jazz = await frameHasJazzHrResume(s.frame);
    const ok = await attachResumeEverywhere(s.page, s.frame, cvPath, direct?.cvText);
    steps.push({
      fieldId: "resume",
      label: ok ? "Resume (CV attached)" : "Resume (CV attach failed)",
      ok,
      thumb: await shoot(),
    });
    if (ok) s.resumeAttached = true;
    if (!ok && cvPath && !jazz) {
      const resumeFields = fieldsMeta.filter((meta) => isResumeField(meta));
      for (const meta of resumeFields) await attachFile(meta, cvPath, `${meta.label || "Resume"} (CV attached)`);
    }
  }
  if (coverLetterPath && !s.coverAttached) {
    for (const meta of fieldsMeta.filter((f) => isCoverLetterField(f))) {
      await attachFile(meta, coverLetterPath, `${meta.label || "Cover letter"} (attached)`);
    }
    s.coverAttached = true;
  }

  for (const [fid, raw] of Object.entries(answers)) {
    const meta = byId.get(fid);
    const value = clipToMax((raw ?? "").toString(), meta?.maxLength);
    if (!meta || value === "") continue;
    if (s.filledIds.has(fid)) continue;
    if (meta.type === "file") continue; // handled above (CV) — never auto-fill other uploads
    // Survey multi-selects ("tick all that apply") are filled only via exact option
    // clicks in fillDirectAtsFields — generic fill here was checking every box.
    const surveyBlob = [meta.label, meta.nativeName, meta.nativeId].filter(Boolean).join(" ").toLowerCase();
    if (
      direct?.surveyClicks?.length &&
      (meta.type === "checkbox" || meta.type === "radio") &&
      /how did you (learn|hear|find)|learn about a role|influenced your decision|what influenced|specify the platform|seen .+ social|content on social/.test(surveyBlob)
    ) {
      continue;
    }
    // Defense-in-depth: NEVER auto-tick a legal consent/agreement checkbox — the
    // human must affirmatively accept. (The planner already flags these
    // needs_confirmation; this guarantees it even if it slips.)
    if (meta.type === "checkbox" && /\b(i (have )?read|i agree|i consent|i accept|consent to|privacy notice|terms|gdpr|data protection)\b/i.test(meta.label || "")) {
      steps.push({ fieldId: fid, label: `${meta.label} — you confirm`, ok: false, thumb: undefined });
      continue;
    }
    const ok = await withBudget(FIELD_FILL_BUDGET_MS, async () => {
    try {
      const loc = s.frame.locator(`[data-co-field="${cssAttr(fid)}"]`).first();
        let gaveUp = false;
        if (isLocationField(meta)) {
          gaveUp = !(await fillLocationInput(s.frame, s.page, loc, value));
        } else if (meta.combobox || meta.type === "select") {
          // Native <select> or Lever/Ashby "Select..." combobox. Click the matching
          // option — never press Enter (that can submit the application).
          gaveUp = !(await chooseDropdownValue(s.frame, s.page, loc, value));
          if (gaveUp && meta.combobox) {
            await loc.scrollIntoViewIfNeeded({ timeout: ACTION_MS }).catch(() => {});
            await loc.click({ timeout: ACTION_MS }).catch(() => {});
            await waitForOpenOptions(s.frame, s.page, 700);
            await loc.pressSequentially(value, { delay: 12, timeout: ACTION_MS }).catch(async () => {
          await s.page.keyboard.type(value);
        });
            await waitForOpenOptions(s.frame, s.page, 700);
            gaveUp = !(await clickOpenMenuOption(s.frame, s.page, value));
            if (gaveUp) await s.page.keyboard.press("Escape").catch(() => {});
          }
      } else if (meta.type === "checkbox") {
        const want = ["true", "1", "yes", "on", "checked"].includes(value.toLowerCase());
        let done = false;
        try {
            await loc.setChecked(want, { timeout: ACTION_MS });
          done = true;
        } catch {
          // custom-styled checkbox with a hidden real <input> → click its label
          // (native toggle + React onChange) or force as a last resort.
          if ((await loc.isChecked().catch(() => false)) === want) {
            done = true;
          } else {
            const cid = await loc.getAttribute("id").catch(() => null);
            const lab = cid ? s.frame.locator(`label[for="${cssAttr(cid)}"]`).first() : null;
            if (lab && (await lab.count())) {
                await lab.click({ timeout: ACTION_MS }).catch(() => {});
              done = true;
            } else {
              try {
                  await loc.check({ force: true, timeout: ACTION_MS });
                done = true;
              } catch {
                /* leave for the user */
              }
            }
          }
        }
          if (done) {
            const checked = await loc.isChecked().catch(() => want);
            done = checked === want;
          }
        gaveUp = !done;
      } else if (meta.type === "radio") {
          let done = false;
          const optionValue = matchOption(meta.options || [], value) || value;
          const r = s.frame.locator(`[data-co-field="${cssAttr(fid)}"][data-co-option="${cssAttr(optionValue)}"]`).first();
          if (await r.count()) {
            const rid = await r.getAttribute("id").catch(() => null);
            const lab = rid
              ? s.frame.locator(`label[for="${cssAttr(rid)}"]`).first()
              : s.frame.locator("label").filter({ has: r }).first();
            if (lab && (await lab.count())) {
              await lab.click({ force: true, timeout: ACTION_MS }).catch(() => {});
            } else {
              await r.click({ force: true, timeout: ACTION_MS }).catch(() => {});
            }
            done = await r.isChecked().catch(() => false);
          }
          if (!done) done = await selectRadioOption(s.frame, s.page, meta.label || "", optionValue);
          if (done) {
            const still = await s.frame.locator(`[data-co-field="${cssAttr(fid)}"]`).evaluateAll((els, want) => {
              const n = String(want || "").toLowerCase();
              return els.some((el) => {
                const input = el.matches("input") ? (el as HTMLInputElement) : el.querySelector("input");
                const checked = input ? input.checked : el.getAttribute("aria-checked") === "true";
                const opt = (el.getAttribute("data-co-option") || "").toLowerCase();
                return Boolean(checked && (opt === n || opt.includes(n) || n.includes(opt)));
              });
            }, optionValue).catch(() => true);
            done = Boolean(still);
          }
          gaveUp = !done;
        } else if (meta.type === "date") {
          gaveUp = !(await fillDateControl(loc, value));
      } else {
          gaveUp = !(await fillTextControl(loc, value));
      }
        return !gaveUp;
    } catch {
        return false;
      }
    }, false);
    logFieldDecision({
      label: meta.label,
      widget: meta.type,
      value,
      action: ok ? "selected" : "failed",
      verification: ok ? "passed" : "failed",
    });
    if (ok) s.filledIds.add(fid);
    steps.push({ fieldId: fid, label: meta.label, ok, thumb: await shoot() });
  }

  if (direct && !s.directFilled) {
    const extra = await withBudget(8000, () => fillDirectAtsFields(s.frame, s.page, direct, cvPath, coverLetterPath), []);
    steps.push(...extra);
    s.directFilled = true;
  }

  if ((cvPath || direct?.cvText) && !s.resumeAttached) {
    const ok = await attachResumeEverywhere(s.page, s.frame, cvPath, direct?.cvText);
    if (ok) s.resumeAttached = true;
    const resumeStep = steps.find((step) => step.fieldId === "resume" || step.fieldId === "resume-direct");
    if (resumeStep) {
      resumeStep.ok = ok;
      resumeStep.label = ok ? "Resume (CV attached)" : "Resume (CV attach failed)";
      resumeStep.thumb = await shoot();
    } else {
      steps.push({
        fieldId: "resume",
        label: ok ? "Resume (CV attached)" : "Resume (CV attach failed)",
        ok,
        thumb: await shoot(),
      });
    }
  }

  const endPath = (() => {
    try {
      return new URL(s.frame.url()).pathname;
    } catch {
      return s.frame.url();
    }
  })();
  // Read the real form back: did every answer actually land? any validation
  // error? — so we warn the user about silent divergence before the handoff.
  const issues = await verifyFill(s.frame, fieldsMeta, answers).catch(() => [] as ApplyIssue[]);
  return { steps, navigated: endPath !== startPath, issues };
}

/** Observe-only: is an interactive CAPTCHA still on screen? Never clicks it. */
export async function sessionHasInteractiveCaptcha(id: string): Promise<boolean> {
  const s = SESSIONS.get(id);
  if (!s?.page) return false;
  return Boolean(await captchaWarning(s.page));
}

/** True when the tab is still open, the challenge is gone, and a form is visible. */
export async function sessionIsUsableForFill(id: string): Promise<boolean> {
  const s = SESSIONS.get(id);
  if (!s?.page) return false;
  if (await captchaWarning(s.page)) return false;
  const n = await s.page
    .locator('form input, form textarea, form select, [role="combobox"], input[type=file]')
    .count()
    .catch(() => 0);
  return n > 0;
}

export function sessionStillOpen(id: string): boolean {
  return Boolean(SESSIONS.get(id)?.page);
}

/** Focus this application's Chrome tab. Never submits. */
export async function handoffSession(id: string): Promise<void> {
  const s = SESSIONS.get(id);
  if (!s) throw new Error("apply session not found");
  await s.page.bringToFront().catch(() => {});
}

export async function snapshotSession(id: string): Promise<{ preview: string; url: string; title: string } | null> {
  const s = SESSIONS.get(id);
  if (!s?.page || s.page.isClosed()) return null;
  try {
    const buf = await s.page.screenshot({ type: "jpeg", quality: 48, timeout: 2500 });
    const preview = `data:image/jpeg;base64,${buf.toString("base64")}`;
    s.formShot = preview;
    return { preview, url: s.page.url() || s.url, title: s.title };
  } catch {
    return s.formShot ? { preview: s.formShot, url: s.url, title: s.title } : null;
  }
}

export async function dispatchApplyPointer(
  id: string,
  event: { type: string; x?: number; y?: number; key?: string; deltaY?: number },
): Promise<boolean> {
  const s = SESSIONS.get(id);
  if (!s?.page || s.page.isClosed()) return false;
  const vp = s.page.viewportSize() || { width: 1280, height: 720 };
  const x = Math.max(0, Math.min(vp.width - 1, Number(event.x || 0) * vp.width));
  const y = Math.max(0, Math.min(vp.height - 1, Number(event.y || 0) * vp.height));
  s.lastActiveAt = Date.now();
  try {
    if (event.type === "move") await s.page.mouse.move(x, y);
    else if (event.type === "down") {
      await s.page.mouse.move(x, y);
      await s.page.mouse.down();
    } else if (event.type === "up") {
      await s.page.mouse.move(x, y);
      await s.page.mouse.up();
    } else if (event.type === "click") await s.page.mouse.click(x, y);
    else if (event.type === "scroll") await s.page.mouse.wheel(0, Number(event.deltaY || 0));
    else if (event.type === "key" && event.key) await s.page.keyboard.press(event.key);
    else return false;
    return true;
  } catch {
    return false;
  }
}
