import type { Page, Frame } from "playwright-core";
import type { ApplyField } from "./extract";
import type { ApplyIssue } from "./issue";
import { classifyControlLabel, isGoogleAccountsUrl, isCompanyLoginUrl } from "./navigate.mjs";

export type { ApplyIssue };

// ─────────────────────────────────────────────────────────────────────────────
// Robust block/obstacle detection for the local Playwright form-interpreter.
// Through-line guard (from the robustness taxonomy): only ever ABORT when there
// is NO fillable form after settle — a captcha/cookie badge over a populated form
// is NOT a block. Abort-level categories require ≥2 independent signal classes.
// We never auto-solve a challenge; we hand the human a clear, actionable message.
// ─────────────────────────────────────────────────────────────────────────────

/** Cheapest + first check: the navigation Response status/headers. Returns a hard
 *  block for auth/forbidden/geo/rate-limit/server/not-found — before any DOM work. */
export function statusBlock(status: number | null | undefined, headers: Record<string, string>): ApplyIssue | null {
  if (!status) return null;
  const cf = headers["cf-ray"] || headers["cf-mitigated"] || headers["cf-request-id"];
  if (status === 401 || status === 407) return { level: "block", code: "auth-required", message: "This page needs you to sign in first. Open it directly, log in, then paste the application-form URL here." };
  if (status === 451) return { level: "block", code: "geo-block", message: "This page is blocked for legal/region reasons. We can't open the form here." };
  if (status === 403) return { level: "block", code: cf ? "bot-block" : "forbidden", message: cf ? "This page is behind a bot check. Open it directly in your browser, then paste the URL back here." : "This page returned “403 access denied”. Open it directly in your browser to check." };
  if (status === 429) return { level: "block", code: "rate-limited", message: "The site is rate-limiting requests right now. Wait a minute, then try again or open it directly." };
  if (status >= 500) return { level: "block", code: "server-error", message: `The site returned an error (status ${status}). Try again shortly, or open it directly.` };
  if (status === 404 || status === 410) return { level: "block", code: "not-found", message: "This posting is gone (404). It's likely closed, or the link is wrong." };
  return null;
}

const CONSENT_ROOTS =
  '#onetrust-banner-sdk, #CybotCookiebotDialog, #truste-consent-track, .qc-cmp2-container, #usercentrics-root, [id*="cookie" i][class*="banner" i], [class*="cookie-consent" i], [aria-label*="cookie" i]';
const CONSENT_BUTTONS = [
  "#onetrust-accept-btn-handler",
  "#onetrust-button-accept-all",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "#CybotCookiebotDialogBodyButtonAccept",
  '.qc-cmp2-button[mode="primary"]',
  "#truste-consent-button",
];

/** Auto-dismiss a cookie/consent overlay that covers the form (it only HIDES the
 *  form, it's never a hard block). Tries vendor buttons, then a generic accept. */
export async function dismissConsent(page: Page): Promise<ApplyIssue[]> {
  try {
    const root = page.locator(CONSENT_ROOTS).first();
    if (!(await root.count().catch(() => 0))) return [];
    if (!(await root.isVisible().catch(() => false))) return [];
    for (const sel of CONSENT_BUTTONS) {
      const b = page.locator(sel).first();
      if ((await b.count().catch(() => 0)) && (await b.isVisible().catch(() => false))) {
        await b.click({ timeout: 2000 }).catch(() => {});
        return [{ level: "info", code: "consent-dismissed", message: "Dismissed a cookie banner to reach the form." }];
      }
    }
    const g = page.getByRole("button", { name: /^(accept|allow|agree|got it|i agree|accept all)/i }).first();
    if (await g.count().catch(() => 0)) {
      await g.click({ timeout: 2000 }).catch(() => {});
      return [{ level: "info", code: "consent-dismissed", message: "Dismissed a cookie banner to reach the form." }];
    }
  } catch {
    /* never let consent handling break the open */
  }
  return [];
}

/** Force same-tab navigation: many "Apply" links are <a target="_blank"> (e.g.
 *  openai.com → jobs.ashbyhq.com/…/application). Without this, clicking Apply
 *  opens a NEW tab we don't follow and the loop never reaches the form. We strip
 *  target=_blank in every frame so any click/navigation stays in OUR page. */
export async function dropNewTabs(page: Page): Promise<void> {
  for (const fr of page.frames()) {
    await fr
      .evaluate(() => {
        document.querySelectorAll('a[target="_blank"], a[target="_new"], form[target]').forEach((el) => el.removeAttribute("target"));
        // also neutralise window.open so JS "apply" handlers navigate in-tab
        try {
          (window as unknown as { open: (u?: string) => Window | null }).open = (u?: string) => {
            if (u) location.href = u;
            return null;
          };
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});
  }
}

const APPLY_HREF =
  'a[href*="ashbyhq"], a[href*="greenhouse"], a[href*="lever.co"], a[href*="smartrecruiters"], a[href*="workable"], a[href*="recruitee"], a[href*="bamboohr"], a[href*="jobvite"], a[href*="teamtailor"], a[href*="myworkdayjobs"], a[href*="icims.com"], a[href*="successfactors"], a[href*="oraclecloud.com"], a[href*="taleo"], a[href*="/apply"], a[href*="/application"], a[href*="jobApplication"]';

const APPLY_AUTOMATION = [
  '[data-automation-id="jobPostingApplyButton"]',
  '[data-automation-id="adventureButton"]',
  '[data-automation-id="applyButton"]',
  '[data-automation-id="ApplyButton"]',
  '[data-automation-id="bottom-navigation-next-button"]',
];

function onKnownAtsHost(url: string): boolean {
  return /greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters|workable\.com|myworkdayjobs\.com|icims\.com|successfactors|oraclecloud\.com|taleo\.net/i.test(url);
}

async function clickIfVisible(frame: Frame, selector: string): Promise<boolean> {
  const loc = frame.locator(selector).first();
  if (!(await loc.count().catch(() => 0))) return false;
  if (!(await loc.isVisible().catch(() => false))) return false;
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await loc.click({ timeout: 4000 });
  return true;
}

async function clickKindInFrames(page: Page, kind: "apply" | "guest" | "signup-tab" | "next" | "sso-google", hasApplicationFields = false): Promise<boolean> {
  for (const frame of page.frames()) {
    try {
      const buttons = frame.locator("button, a, [role='button'], input[type=button], input[type=submit]");
      const n = await buttons.count().catch(() => 0);
      for (let i = 0; i < n; i++) {
        const el = buttons.nth(i);
        if (!(await el.isVisible().catch(() => false))) continue;
        const label =
          (await el.innerText().catch(() => "")) ||
          (await el.getAttribute("value").catch(() => "")) ||
          (await el.getAttribute("aria-label").catch(() => "")) ||
          "";
        if (classifyControlLabel(label, { hasApplicationFields }) !== kind) continue;
        await el.scrollIntoViewIfNeeded().catch(() => {});
        await el.click({ timeout: 4000 });
        return true;
      }
    } catch {
      /* detached frame */
    }
  }
  return false;
}

/** If Apply opened a new tab, follow it. */
export async function adoptNewPage(page: Page, timeoutMs = 5000): Promise<Page> {
  const ctx = page.context();
  const before = new Set(ctx.pages());
  const extra = ctx.pages().find((p) => !before.has(p) && !p.isClosed());
  if (extra) {
    await extra.waitForLoadState("domcontentloaded").catch(() => {});
    return extra;
  }
  const popup = await ctx.waitForEvent("page", { timeout: timeoutMs }).catch(() => null);
  if (popup && !popup.isClosed()) {
    await popup.waitForLoadState("domcontentloaded").catch(() => {});
    return popup;
  }
  const newest = ctx.pages().filter((p) => !p.isClosed()).at(-1);
  return newest && newest !== page ? newest : page;
}

/**
 * Click Apply / Apply now / Workday apply (never Submit). Searches every iframe.
 * Follows a popup tab when the careers site opens one.
 */
function isForeignPage(page: Page, ignorePages: Page[] = []): boolean {
  return ignorePages.some((owned) => owned === page);
}

function newestOwnedPopup(page: Page, pagesBefore: Page[], ignorePages: Page[] = []): Page | undefined {
  return page.context().pages().find((p) => !p.isClosed() && !pagesBefore.includes(p) && !isForeignPage(p, ignorePages));
}

export async function tryApplyTrigger(page: Page, ignorePages: Page[] = []): Promise<boolean> {
  const result = await tryApplyTriggerFollow(page, ignorePages);
  return result.acted;
}

export async function tryApplyTriggerFollow(page: Page, ignorePages: Page[] = []): Promise<{ acted: boolean; page: Page }> {
  try {
    const current = page.url();
    const pagesBefore = page.context().pages().slice();
    const afterClick = async (): Promise<Page> => {
      await page.waitForTimeout(700);
      const extra = newestOwnedPopup(page, pagesBefore, ignorePages);
      if (extra) await extra.waitForLoadState("domcontentloaded").catch(() => {});
      const next = extra || page;
      await dropNewTabs(next);
      return next;
    };

    for (const frame of page.frames()) {
      for (const sel of APPLY_AUTOMATION.slice(0, 4)) {
        if (await clickIfVisible(frame, sel).catch(() => false)) {
          return { acted: true, page: await afterClick() };
        }
      }
    }

    if (await clickKindInFrames(page, "apply", false)) {
      return { acted: true, page: await afterClick() };
    }

    for (const frame of page.frames()) {
      const labeled = frame.getByText(/^(apply now|apply for this job|start application)$/i).first();
      if ((await labeled.count().catch(() => 0)) && (await labeled.isVisible().catch(() => false))) {
        await labeled.click({ timeout: 4000 }).catch(() => {});
        return { acted: true, page: await afterClick() };
      }
    }

    // Last: follow an ATS apply URL. Skip when already on that ATS so a logo
    // link cannot dump us on the careers home.
    if (!onKnownAtsHost(current)) {
      for (const frame of page.frames()) {
        const atsLink = frame.locator(APPLY_HREF).first();
        if (!(await atsLink.count().catch(() => 0))) continue;
        const href = await atsLink.getAttribute("href").catch(() => null);
        if (!href || /submit/i.test(href)) continue;
        const abs = href.startsWith("http") ? href : new URL(href, current).href;
        if (!/^https?:\/\//i.test(abs)) continue;
        await page.goto(abs, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
        return { acted: true, page };
      }
    }
  } catch {
    /* ignore */
  }
  return { acted: false, page };
}

export async function clickGuestApply(page: Page): Promise<boolean> {
  return clickKindInFrames(page, "guest", false);
}

export async function clickSignupTab(page: Page): Promise<boolean> {
  return clickKindInFrames(page, "signup-tab", false);
}

export async function hasPasswordInput(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    const n = await frame.locator('input[type="password"]').count().catch(() => 0);
    if (n > 0) return true;
  }
  return false;
}

async function findGoogleAccountsPage(page: Page, ignorePages: Page[] = []): Promise<Page | null> {
  for (const p of page.context().pages()) {
    if (p.isClosed() || isForeignPage(p, ignorePages)) continue;
    if (isGoogleAccountsUrl(p.url())) return p;
  }
  return isGoogleAccountsUrl(page.url()) ? page : null;
}

/** Click Continue with Google and follow that tab/redirect. Never submits a job. */
export async function clickGoogleSsoFollow(page: Page, ignorePages: Page[] = []): Promise<{ acted: boolean; page: Page }> {
  if (isGoogleAccountsUrl(page.url())) return { acted: false, page };
  const pagesBefore = page.context().pages().slice();
  let clicked = await clickKindInFrames(page, "sso-google", false);
  if (!clicked) {
    for (const frame of page.frames()) {
      const btn = frame
        .getByRole("button", { name: /continue with google|sign in with google|sign up with google|apply with google/i })
        .first();
      const link = frame.getByRole("link", { name: /continue with google|sign in with google|sign up with google|apply with google/i }).first();
      const iframe = frame.locator('iframe[src*="accounts.google"], iframe[title*="Google" i]').first();
      for (const el of [btn, link]) {
        if ((await el.count().catch(() => 0)) && (await el.isVisible().catch(() => false))) {
          await el.click({ timeout: 4000 }).catch(() => {});
          clicked = true;
          break;
        }
      }
      if (clicked) break;
      if ((await iframe.count().catch(() => 0)) && (await iframe.isVisible().catch(() => false))) {
        await iframe.click({ timeout: 4000 }).catch(() => {});
        clicked = true;
        break;
      }
    }
  }
  if (!clicked) return { acted: false, page };

  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(400);
    const extra = newestOwnedPopup(page, pagesBefore, ignorePages);
    if (extra) {
      await extra.waitForLoadState("domcontentloaded").catch(() => {});
      const google = (await findGoogleAccountsPage(extra, ignorePages)) || (await findGoogleAccountsPage(page, ignorePages));
      if (google) {
        await google.bringToFront().catch(() => {});
        await dropNewTabs(google);
        return { acted: true, page: google };
      }
    }
    const google = await findGoogleAccountsPage(page, ignorePages);
    if (google) {
      await google.bringToFront().catch(() => {});
      await dropNewTabs(google);
      return { acted: true, page: google };
    }
  }
  const extra = newestOwnedPopup(page, pagesBefore, ignorePages);
  const next = extra || page;
  await dropNewTabs(next);
  return { acted: true, page: next };
}

export async function fillGoogleIdentifier(page: Page, email: string): Promise<boolean> {
  const addr = String(email || "").trim();
  if (!addr || !isGoogleAccountsUrl(page.url())) return false;
  const listed = page.locator(`[data-identifier="${addr}"], [data-email="${addr}"]`).first();
  if ((await listed.count().catch(() => 0)) && (await listed.isVisible().catch(() => false))) {
    await listed.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(800);
    return true;
  }
  const chip = page.getByText(addr, { exact: true }).first();
  if ((await chip.count().catch(() => 0)) && (await chip.isVisible().catch(() => false))) {
    await chip.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(800);
    return true;
  }
  const input = page.locator("#identifierId, input[type=email], input[name=identifier]").first();
  if (!(await input.count().catch(() => 0))) return false;
  await input.fill(addr).catch(async () => {
    await input.click();
    await page.keyboard.type(addr);
  });
  const next = page.getByRole("button", { name: /^next$/i }).first();
  if ((await next.count().catch(() => 0)) && (await next.isVisible().catch(() => false))) {
    await next.click({ timeout: 4000 }).catch(() => {});
  }
  await page.waitForTimeout(800);
  return true;
}

/** Next/Continue only. Never Submit / Apply now on a form that already has fields.
 *  Never click IBM Continue when Continue with Google is the intended path. */
export async function clickNextContinue(page: Page, hasApplicationFields = true): Promise<boolean> {
  if (await hasPasswordInput(page)) return false;
  if (isCompanyLoginUrl(page.url()) && !isGoogleAccountsUrl(page.url())) return false;
  for (const frame of page.frames()) {
    if (await clickIfVisible(frame, '[data-automation-id="bottom-navigation-next-button"]').catch(() => false)) {
      return true;
    }
  }
  return clickKindInFrames(page, "next", hasApplicationFields);
}

/** True only when the page itself is an account wall — not a job form that happens to have a Sign in header. */
export async function pageIsLoginWall(page: Page): Promise<boolean> {
  if (await hasPasswordInput(page)) return true;
  const url = (page.url() || "").toLowerCase();
  if (/accounts\.google\.com|login\.microsoftonline|okta\.com|auth0\.com/.test(url)) return true;
  if (/\/(login|sign-?in|register|sign-?up|auth|account|mfa|2fa)(\/|$|\?)/.test(url)) return true;
  const body = await page
    .locator("body")
    .innerText({ timeout: 2000 })
    .catch(() => "");
  return /sign in to apply|log in to apply|create (an )?account to apply|join to apply|sign in or create/i.test(body.slice(0, 4000));
}

export function keepGoingMessage(why: ApplyIssue): ApplyIssue {
  if (why.code === "login-wall") {
    return {
      level: "warn",
      code: "login-wall",
      message:
        "This employer wants an account before the form. Continue with Google only if that button is on this page — most listings can be filled without signing up. We never invent a password and never submit.",
    };
  }
  if (why.code === "workday" || why.code === "no-form" || why.code === "listing-page") {
    return {
      level: "warn",
      code: why.code === "listing-page" ? "listing-page" : "multi-step",
      message:
        "Chrome is open on this posting. We follow Apply now, profile creation, and Next — never Submit. Continue in that window if a sign-in or extra step appears.",
    };
  }
  return { ...why, level: why.level === "block" ? "warn" : why.level };
}

/** When extraction yields 0 fields, classify WHY so we abort with the RIGHT
 *  message (bot-challenge vs login wall vs closed posting vs unsupported). */
export async function classifyEmpty(page: Page, url: string): Promise<ApplyIssue> {
  const sig = await page
    .evaluate(() => {
      const t = (document.title || "").toLowerCase();
      const body = (document.body?.innerText || "").toLowerCase().slice(0, 6000);
      const hasPassword = !!document.querySelector('input[type="password"]');
      const challengeDom = !!document.querySelector(
        '#challenge-running, #challenge-form, .cf-browser-verification, iframe[src*="challenges.cloudflare.com"], .g-recaptcha, .h-captcha, #px-captcha, [class*="datadome" i], #cf-please-wait',
      );
      return { t, body, hasPassword, challengeDom };
    })
    .catch(() => ({ t: "", body: "", hasPassword: false, challengeDom: false }));

  const u = url.toLowerCase();
  const challTitle = /just a moment|checking your browser|one moment please|verifying you|attention required/.test(sig.t);
  const challUrl = /__cf_chl|challenges\.cloudflare\.com|\/cdn-cgi\/|datadome|px-captcha/.test(u);
  const challText = /(verify (you|that you)|are you human|not a robot|human verification|checking your browser|enable javascript and cookies)/.test(sig.body);
  if ([challTitle, challUrl, sig.challengeDom, challText].filter(Boolean).length >= 2) {
    return { level: "block", code: "bot-challenge", message: "This page is asking you to verify you're human before showing the form. Open it directly in your browser, complete the check, then paste the URL back here." };
  }
  if (sig.hasPassword || /\/(login|sign-?in|register|sign-?up|auth|account|mfa|2fa)(\/|$|\?)/.test(u) || /create (an )?account|sign in to apply|join to apply/i.test(sig.body)) {
    return { level: "warn", code: "login-wall", message: "This page wants you to sign in or create a profile first." };
  }
  if (/no longer accepting|position has been filled|posting is closed|no longer available|this (job|position|posting) (is |has )?(closed|expired|been filled)/.test(sig.body) || /not found|no longer|removed|closed/.test(sig.t)) {
    return { level: "block", code: "expired", message: "This job posting is closed or expired — it's no longer accepting applications." };
  }
  if (/^(jobs|careers|empleos|empregos|all jobs|open (positions|roles)|search jobs|current openings)/i.test(sig.t) || /\/(jobs|careers|search|positions)\/?(\?|$)/.test(u)) {
    return { level: "block", code: "listing-page", message: "This looks like the careers listing, not a single application — the posting may have moved or closed. Open the specific job and paste its “Apply” URL." };
  }
  return { level: "block", code: "no-form", message: "Couldn't find a fillable form on this page. If it's a job description, open its “Apply” form and paste that URL." };
}

/** An INTERACTIVE captcha (a checkbox/widget the user must click) present on the
 *  form → warn. We deliberately IGNORE invisible reCAPTCHA v3 (the .grecaptcha-
 *  badge that's on nearly every ATS form and needs NO user action) so the warning
 *  isn't constant noise. */
export async function captchaWarning(page: Page): Promise<ApplyIssue | null> {
  const interactive = await page
    .evaluate(() => {
      const vis = (el: Element | null) => {
        if (!el) return false;
        const r = (el as HTMLElement).getBoundingClientRect();
        return (el as HTMLElement).offsetParent !== null && r.width > 40 && r.height > 20;
      };
      const some = (sel: string) => Array.from(document.querySelectorAll(sel)).some(vis);
      // v2 checkbox (anchor iframe / visible widget), hCaptcha checkbox, Turnstile widget.
      // NOT .grecaptcha-badge (invisible v3) and NOT the bare bframe.
      return (
        some('iframe[src*="recaptcha/api2/anchor"]') ||
        some('.g-recaptcha[data-size="normal"]') ||
        some('iframe[src*="hcaptcha.com"][src*="frame=checkbox"], .h-captcha iframe') ||
        some('.cf-turnstile')
      );
    })
    .catch(() => false);
  return interactive ? { level: "warn", code: "captcha-present", message: "This form has a captcha you'll need to tick — do it yourself on the real form at the end." } : null;
}

/** Conservatively detect a multi-STEP form (we only read/fill page 1) so we can
 *  set the user's expectation that they'll continue on the real form. Fires only
 *  on a "Step 1 of N" indicator, or a visible Next/Continue with NO Submit. */
export async function multiStepInfo(page: Page): Promise<ApplyIssue | null> {
  const ms = await page
    .evaluate(() => {
      const txt = (document.body?.innerText || "").toLowerCase();
      const stepText = /\b(step|page|stage)\s*\d+\s*(of|\/)\s*\d+/.test(txt);
      const vis = (el: Element) => (el as HTMLElement).offsetParent !== null;
      const btns = Array.from(document.querySelectorAll("button, a, [role=button]"));
      const label = (b: Element) => (b.textContent || "").replace(/\s+/g, " ").trim();
      const hasNext = btns.some((b) => vis(b) && /^(next|continue|save (and|&) continue|next step|continue to)\b/i.test(label(b)));
      const hasSubmit = btns.some((b) => vis(b) && /^(submit application|submit|send application|apply now)\b/i.test(label(b)));
      return (stepText || hasNext) && !hasSubmit;
    })
    .catch(() => false);
  return ms ? { level: "info", code: "multi-step", message: "This form has more than one step — after this page, you'll continue on the real form." } : null;
}

/** READ THE REAL FORM BACK after filling: did every answer land? required fields
 *  still empty? any validation error visible? — the self-verification a blind
 *  selector script can't do. Returns warnings to show BEFORE the human submits. */
export async function verifyFill(frame: Frame, fields: ApplyField[], answers: Record<string, string>): Promise<ApplyIssue[]> {
  const meta = fields.map((f) => ({ id: f.id, label: f.label || "this field", type: f.type, required: !!f.required, combobox: !!f.combobox }));
  type R = { mismatches: string[]; requiredEmpty: string[]; valErrors: string[] };
  const res = await frame
    .evaluate(
      ({ meta, answers }): R => {
        const norm = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
        const mismatches: string[] = [];
        const requiredEmpty: string[] = [];
        for (const f of meta) {
          const intended = answers[f.id];
          const el = document.querySelector(`[data-co-field="${f.id}"]`) as HTMLElement | null;
          if (!el) continue;
          if (f.type === "file") {
            // confirm a file actually landed on the input (the CV attach can fail
            // silently on a custom dropzone). Only warn if the field is required.
            const filesEl = el as HTMLInputElement;
            const has = !!(filesEl.files && filesEl.files.length > 0);
            if (f.required && !has) requiredEmpty.push(f.label);
            continue;
          }
          let actual = "";
          if (f.type === "checkbox") {
            actual = (el as HTMLInputElement).checked ? "true" : "";
          } else if (f.type === "radio") {
            const grp = Array.from(document.querySelectorAll(`[data-co-field="${f.id}"]`)) as HTMLInputElement[];
            actual = grp.some((r) => r.checked) ? "checked" : "";
          } else if (f.combobox) {
            // react-select keeps the chosen value in a sibling .select__single-value
            // (the tagged input stays empty). Read leniently: only conclude "empty"
            // when a placeholder is visibly shown — otherwise assume OK (never a
            // false "didn't land" warning).
            const shell = el.closest('[class*="select-shell" i], [class*="select__container" i], [class*="select__control" i], [class*="value-container" i]') || el.parentElement?.parentElement || el.parentElement;
            const sv = shell?.querySelector('.select__single-value, [class*="single-value" i], [class*="singleValue" i], [class*="multi-value" i]');
            const ph = shell?.querySelector('.select__placeholder, [class*="placeholder" i]');
            const svText = (sv?.textContent || "").trim();
            if (svText) actual = svText; // a value is shown
            else if (ph && (ph as HTMLElement).offsetParent !== null) actual = ""; // placeholder visible → empty
            else actual = intended || "ok"; // can't read reliably → don't flag
          } else {
            actual = (el as HTMLInputElement).value || "";
          }
          if (intended && intended.trim() && !norm(actual)) mismatches.push(f.label);
          else if (f.required && !norm(actual) && !(intended && intended.trim())) requiredEmpty.push(f.label);
        }
        const errSel = '[aria-invalid="true"], [role="alert"], [class*="error" i]:not([class*="clear" i]):not([class*="error-free" i])';
        const valErrors: string[] = [];
        for (const e of Array.from(document.querySelectorAll(errSel)) as HTMLElement[]) {
          const txt = (e.textContent || "").replace(/\s+/g, " ").trim();
          if (txt && txt.length > 2 && txt.length < 160 && e.offsetParent !== null) valErrors.push(txt);
        }
        return { mismatches, requiredEmpty, valErrors: Array.from(new Set(valErrors)).slice(0, 5) };
      },
      { meta, answers },
    )
    .catch(() => ({ mismatches: [], requiredEmpty: [], valErrors: [] }) as R);

  const out: ApplyIssue[] = [];
  if (res.mismatches.length) out.push({ level: "warn", code: "fill-mismatch", message: `These answers didn't seem to land on the real form — check them: ${res.mismatches.slice(0, 4).join(", ")}${res.mismatches.length > 4 ? "…" : ""}.` });
  if (res.requiredEmpty.length) out.push({ level: "warn", code: "required-empty", message: `Required and still empty — you'll need to fill ${res.requiredEmpty.length > 1 ? "these" : "this"}: ${res.requiredEmpty.slice(0, 4).join(", ")}${res.requiredEmpty.length > 4 ? "…" : ""}.` });
  for (const v of res.valErrors) out.push({ level: "warn", code: "validation", message: `The form flagged: “${v}”.` });
  return out;
}
