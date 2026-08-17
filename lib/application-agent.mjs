// lib/application-agent.mjs — Intelligent Application Agent (Playwright-driven)
// Semantic field detection + Candidate Knowledge. DRY_RUN never submits.
// CAPTCHA / MFA / auth walls / unexpected sensitive questions → PAUSE. Never bypass.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { deriveFromProfile, nameAnswerForField } from './application-generator.mjs';
import { validateAgainstSourceFacts } from './cv-tailor.mjs';
import { rejectPrivateOrInvalid } from '../liveness-browser.mjs';
import {
  FIELD_INTENT,
  classifyApplicationField,
  classifyUnknownFieldsWithAI,
  isSensitiveIntent,
} from './saas/application-agent/field-classifier.mjs';
import {
  inspectApplicationForm,
  detectPlatformFromPage,
} from './saas/application-agent/semantic-extract.mjs';
import { enrichFieldsFromAtsAdapter } from './saas/application-agent/ats-adapters.mjs';
import { resolveFieldFromKnowledge } from './saas/application-agent/knowledge-resolver.mjs';

export {
  FIELD_INTENT,
  classifyApplicationField,
  isSensitiveIntent,
} from './saas/application-agent/field-classifier.mjs';

const MAX_NAV_STEPS = 8;
const SUBMIT_LABEL = /^(submit|apply|send application|submit application|apply now)$/i;
const NEXT_LABEL = /^(next|continue|save and continue|review|review application)$/i;
const APPLY_CTA = /^(apply|apply now|apply for this job|start application|begin application)$/i;

// ── Constants & Status Enums ──────────────────────────────────────────────────

export const ATS_HOSTS = {
  greenhouse: ['boards.greenhouse.io', 'greenhouse.io'],
  lever:      ['jobs.lever.co', 'jobs.eu.lever.co', 'lever.co'],
  ashby:      ['jobs.ashbyhq.com', 'ashbyhq.com'],
  workday:    ['myworkdayjobs.com', 'workday.com'],
};

export const SESSION_STATUS = {
  READY_TO_SUBMIT:     'READY_TO_SUBMIT',
  SUBMITTED:           'SUBMITTED',
  REQUIRES_USER_INPUT: 'REQUIRES_USER_INPUT',
  ERROR:               'ERROR',
  BLOCKED:             'BLOCKED',
  PAUSED:              'PAUSED',
  SKIPPED:             'SKIPPED',
};

export class ApplicationAgentError extends Error {
  constructor(message, code = 'AGENT_ERROR') {
    super(message);
    this.name = 'ApplicationAgentError';
    this.code = code;
  }
}

// ── ApplicationSession ────────────────────────────────────────────────────────

export class ApplicationSession {
  constructor({ opportunity_id, url, company, job_title, dry_run = true }) {
    this.session_id = randomUUID();
    this.opportunity_id = opportunity_id || 'unknown';
    this.url = url || '';
    this.company = company || '';
    this.job = job_title || '';
    this.ats = detectATS(url);
    this.platform = this.ats;
    this.dry_run = dry_run !== false;
    this.start_time = new Date().toISOString();
    this.end_time = null;
    this.status = SESSION_STATUS.SKIPPED;
    this.preflight = { passed: false, checks: {} };
    this.fields = [];
    this.unanswered_fields = [];
    this.fill_log = [];
    this.upload_log = [];
    this.action_log = [];
    this.validation_errors = [];
    this.errors = [];
    this.screenshots = [];
    this.pause_reason = null;
    this.final_status = SESSION_STATUS.SKIPPED;
    this.status_reason = 'Initialized';
  }

  logAction(entry = {}) {
    this.action_log.push({
      at: new Date().toISOString(),
      dry_run: this.dry_run,
      ...entry,
    });
  }

  complete(status, reason = '') {
    this.end_time = new Date().toISOString();
    this.status = status;
    this.final_status = status;
    this.status_reason = reason;
    this.logAction({ action: 'COMPLETE', status, detail: reason });
    return this;
  }

  toJSON() {
    return {
      session_id: this.session_id,
      opportunity_id: this.opportunity_id,
      url: this.url,
      company: this.company,
      job: this.job,
      ats: this.ats,
      platform: this.platform,
      dry_run: this.dry_run,
      start_time: this.start_time,
      end_time: this.end_time,
      status: this.status,
      preflight: this.preflight,
      fields: this.fields,
      unanswered_fields: this.unanswered_fields,
      fill_log: this.fill_log,
      upload_log: this.upload_log,
      action_log: this.action_log,
      validation_errors: this.validation_errors,
      errors: this.errors,
      screenshots: this.screenshots,
      pause_reason: this.pause_reason,
      final_status: this.final_status,
      status_reason: this.status_reason,
    };
  }
}

// ── ATS Detection ─────────────────────────────────────────────────────────────

export function detectATS(urlString) {
  if (!urlString) return 'generic';
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return 'generic';
  }

  const host = parsed.hostname.toLowerCase();
  for (const [ats, domains] of Object.entries(ATS_HOSTS)) {
    if (domains.some(d => host.includes(d))) {
      return ats;
    }
  }

  if (parsed.pathname.includes('/workday/') || host.includes('workday')) {
    return 'workday';
  }

  return 'generic';
}

function looksLikeLoginWall(htmlOrText = '') {
  const text = String(htmlOrText).toLowerCase();
  return (
    (/type=["']password["']/.test(text) || text.includes('type="password"')) &&
    /sign in|log in|login|create an account|sign in to apply/.test(text)
  );
}

function escapeAttr(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeCssId(value) {
  return String(value || '').replace(/([^\w-])/g, '\\$1');
}

async function safeWait(page, ms) {
  if (!page) return;
  if (typeof page.waitForTimeout === 'function') {
    await page.waitForTimeout(ms);
    return;
  }
  await new Promise((r) => setTimeout(r, ms));
}

function buttonText(locatorHandle) {
  return Promise.resolve()
    .then(async () => {
      if (typeof locatorHandle.innerText === 'function') return locatorHandle.innerText();
      if (typeof locatorHandle.textContent === 'function') return locatorHandle.textContent();
      return '';
    })
    .catch(() => '');
}

async function fillFieldOnPage(page, field, value) {
  if (!page || value == null || value === '') return false;
  const str = String(value);
  const names = [field.accessibleName, field.label, field.ariaLabel].filter(Boolean);

  if (field.type === 'select' && typeof page.selectOption === 'function') {
    const selectors = [];
    if (field.id) selectors.push(`[data-co-field="${escapeAttr(field.id)}"]`);
    if (field.nativeId) selectors.push(`#${escapeCssId(field.nativeId)}`);
    if (field.name) selectors.push(`[name="${escapeAttr(field.name)}"]`);
    for (const selector of selectors) {
      try {
        await page.selectOption(selector, { label: str }, { timeout: 2500 });
        return true;
      } catch {
        try {
          await page.selectOption(selector, str, { timeout: 1500 });
          return true;
        } catch { /* next */ }
      }
    }
  }

  if ((field.type === 'radio' || field.type === 'checkbox') && typeof page.getByLabel === 'function') {
    try {
      await page.getByLabel(str, { exact: false }).first().check({ timeout: 2500 });
      return true;
    } catch { /* fall through */ }
  }

  if (typeof page.getByLabel === 'function') {
    for (const name of names) {
      try {
        await page.getByLabel(name, { exact: false }).first().fill(str, { timeout: 2500 });
        return true;
      } catch { /* next label */ }
    }
  }

  if (typeof page.getByRole === 'function' && names[0]) {
    try {
      await page.getByRole('textbox', { name: names[0] }).first().fill(str, { timeout: 2500 });
      return true;
    } catch { /* ignore */ }
  }

  if (field.id && typeof page.locator === 'function') {
    try {
      await page.locator(`[data-co-field="${escapeAttr(field.id)}"]`).first().fill(str, { timeout: 2000 });
      return true;
    } catch { /* ignore */ }
  }

  if (field.ariaLabel && typeof page.locator === 'function') {
    try {
      await page.locator(`[aria-label="${escapeAttr(field.ariaLabel)}"]`).first().fill(str, { timeout: 2000 });
      return true;
    } catch { /* ignore */ }
  }

  const selectors = [];
  if (field.nativeId) selectors.push(`#${escapeCssId(field.nativeId)}`);
  if (field.id && field.id !== field.nativeId) selectors.push(`#${escapeCssId(field.id)}`);
  if (field.nativeName) selectors.push(`[name="${escapeAttr(field.nativeName)}"]`);
  if (field.name) selectors.push(`[name="${escapeAttr(field.name)}"]`);

  for (const selector of selectors) {
    try {
      if (typeof page.fill === 'function') {
        await page.fill(selector, str, { timeout: 2500 });
        return true;
      }
    } catch { /* try next selector */ }
  }

  return false;
}

async function attachFileToField(page, field, filePath) {
  if (!page || !filePath || !existsSync(filePath) || typeof page.locator !== 'function') return false;

  if (field && (field.label || field.accessibleName) && typeof page.getByLabel === 'function') {
    try {
      await page.getByLabel(field.label || field.accessibleName, { exact: false }).first().setInputFiles(filePath);
      return true;
    } catch { /* next */ }
  }

  const selectors = [];
  if (field?.id) selectors.push(`[data-co-field="${escapeAttr(field.id)}"]`);
  if (field?.nativeId) selectors.push(`#${escapeCssId(field.nativeId)}`);
  if (field?.nativeName) selectors.push(`input[type="file"][name="${escapeAttr(field.nativeName)}"]`);
  if (field?.name) selectors.push(`input[type="file"][name="${escapeAttr(field.name)}"]`);
  selectors.push('input[type="file"]');

  for (const selector of selectors) {
    try {
      const loc = page.locator(selector).first();
      if ((await loc.count()) > 0) {
        await loc.setInputFiles(filePath);
        return true;
      }
    } catch { /* next */ }
  }
  return false;
}

async function attachResumeIfPresent(page, pdfPath) {
  return attachFileToField(page, { label: 'Resume' }, pdfPath);
}

async function clickAdvance(page) {
  if (!page || typeof page.getByRole !== 'function') return false;
  try {
    const buttons = page.getByRole('button');
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      const text = String(await buttonText(btn) || '').replace(/\s+/g, ' ').trim();
      if (!text || SUBMIT_LABEL.test(text)) continue;
      if (!NEXT_LABEL.test(text)) continue;
      await btn.click({ timeout: 4000 });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function looksLikeApplicationForm(fields = []) {
  if (!Array.isArray(fields) || fields.length === 0) return false;
  const lab = (f) => String(f.label || f.name || '').toLowerCase();
  const hasFile = fields.some((f) => f.type === 'file');
  const hasEmail = fields.some((f) => f.type === 'email' || /e-?mail/.test(lab(f)));
  const hasAppish = fields.some((f) =>
    /first name|last name|full name|resume|résumé|\bcv\b|cover letter|phone|linkedin|github/.test(lab(f))
  );
  if (hasFile || hasEmail || hasAppish) return true;
  const allSearch = fields.every(
    (f) => /search|keyword|department|location|filter|category/.test(lab(f))
  );
  if (allSearch) return false;
  return fields.length >= 3;
}

/**
 * Job description pages are not the form. Follow an ATS apply link or click
 * Apply (never Submit). Returns true if navigation/click happened.
 */
export async function tryApplyTrigger(page) {
  if (!page) return false;
  try {
    const current = typeof page.url === 'function' ? String(page.url() || '') : '';
    const alreadyOnAts = /greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|workable\.com|myworkdayjobs\.com/.test(current);

    if (!alreadyOnAts && typeof page.locator === 'function') {
      const atsLink = page.locator(
        'a[href*="ashbyhq"], a[href*="greenhouse"], a[href*="lever.co"], a[href*="smartrecruiters"], a[href*="workable"], a[href*="recruitee"], a[href*="bamboohr"], a[href*="jobvite"], a[href*="teamtailor"], a[href*="myworkdayjobs"], a[href*="/apply"], a[href*="/application"]'
      ).first();
      if ((await atsLink.count().catch(() => 0)) > 0) {
        const href = await atsLink.getAttribute('href').catch(() => null);
        if (href && /^https?:\/\//i.test(href) && !/submit/i.test(href) && typeof page.goto === 'function') {
          if (href !== current) {
            await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
            return true;
          }
        }
      }
    }
    if (typeof page.getByRole === 'function') {
      const t = page
        .getByRole('button', { name: /apply|start application|begin application/i })
        .or(page.getByRole('link', { name: /apply for this job|apply now|^apply$/i }))
        .first();
      if ((await t.count().catch(() => 0)) && (await t.isVisible().catch(() => false))) {
        const label = String(await t.innerText().catch(() => '')).toLowerCase();
        if (/submit|applied|withdraw/.test(label)) return false;
        await t.click({ timeout: 4000 }).catch(() => {});
        return true;
      }
    }
    if (typeof page.getByRole === 'function') {
      const buttons = page.getByRole('button');
      const count = await buttons.count();
      for (let i = 0; i < count; i++) {
        const btn = buttons.nth(i);
        const text = String(await buttonText(btn) || '').replace(/\s+/g, ' ').trim();
        if (APPLY_CTA.test(text) && !SUBMIT_LABEL.test(text)) {
          await btn.click({ timeout: 4000 });
          return true;
        }
      }
    }
  } catch {
    return false;
  }
  return false;
}

async function dismissConsent(page) {
  if (!page || typeof page.getByRole !== 'function') return;
  try {
    const btn = page.getByRole('button', { name: /^(accept|allow|agree|got it|i agree|accept all|accept cookies)/i }).first();
    if ((await btn.count().catch(() => 0)) && (await btn.isVisible().catch(() => false))) {
      await btn.click({ timeout: 2000 }).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

async function dropNewTabs(page) {
  if (!page || typeof page.frames !== 'function') return;
  for (const fr of page.frames()) {
    await fr.evaluate(() => {
      document.querySelectorAll('a[target="_blank"], a[target="_new"], form[target]').forEach((el) => el.removeAttribute('target'));
      try {
        window.open = (u) => {
          if (u) location.href = u;
          return null;
        };
      } catch { /* ignore */ }
    }).catch(() => {});
  }
}

async function openApplicationForm(page, session) {
  if (!page) return [];
  await dismissConsent(page);
  await dropNewTabs(page);
  let fields = await extractFields(page, session);
  if (looksLikeApplicationForm(fields)) return fields;
  const clicked = await tryApplyTrigger(page);
  if (clicked) {
    session?.logAction?.({ action: 'NAVIGATE', detail: 'clicked Apply / followed ATS apply URL' });
    await safeWait(page, 1200);
    await dropNewTabs(page);
    if (typeof page.waitForSelector === 'function') {
      await page.waitForSelector(
        'form input, form textarea, input[type=file], #first_name, input[name="first_name"]',
        { timeout: 8000 }
      ).catch(() => {});
    }
    fields = await extractFields(page, session);
  }
  return fields;
}

async function clickSubmitOnPage(page) {
  if (!page || typeof page.locator !== 'function') return false;
  if (typeof page.getByRole === 'function') {
    try {
      const buttons = page.getByRole('button');
      const count = await buttons.count();
      for (let i = 0; i < count; i++) {
        const btn = buttons.nth(i);
        const text = String(await buttonText(btn) || '').replace(/\s+/g, ' ').trim();
        if (SUBMIT_LABEL.test(text)) {
          await btn.click({ timeout: 4000 });
          return true;
        }
      }
    } catch { /* fall back */ }
  }
  const selectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Submit application")',
    'button:has-text("Send application")',
    'button:has-text("Submit")',
    'button:has-text("Apply now")',
  ];
  for (const selector of selectors) {
    try {
      const loc = page.locator(selector).first();
      if ((await loc.count()) > 0) {
        await loc.click({ timeout: 4000 });
        return true;
      }
    } catch { /* try next */ }
  }
  return false;
}

function materializeCoverLetterFile(applicationRecord, coverLetterPath) {
  if (coverLetterPath && existsSync(coverLetterPath)) return coverLetterPath;
  const cl = applicationRecord?.cover_letter;
  if (!cl || cl.skipped) return null;
  const body = cl.body || cl.coverLetter;
  if (!body) return null;
  const dir = join(tmpdir(), 'career-ops-cover-letters');
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `cover-letter-${Date.now()}.txt`);
  writeFileSync(filePath, body, 'utf8');
  return filePath;
}

export function isCoverLetterSatisfied(applicationRecord) {
  const cl = applicationRecord?.cover_letter;
  const decision = applicationRecord?.cover_letter_decision;
  if (cl?.body || cl?.coverLetter) return true;
  if (cl?.skipped || decision?.skipped) return true;
  if (cl?.requirement === 'NOT_NEEDED' || decision?.requirement === 'NOT_NEEDED') return true;
  return false;
}

export function canSafelySubmit(session, { liveSubmit = false } = {}) {
  if (!liveSubmit || session?.dry_run) {
    return { ok: false, reason: 'DRY_RUN: live submit is disabled' };
  }
  if (session?.pause_reason) {
    return { ok: false, reason: `Paused: ${session.pause_reason}` };
  }
  if (session?.unanswered_fields?.some((u) => u.sensitive || u.field?.required)) {
    return { ok: false, reason: 'Required or sensitive fields are unanswered' };
  }
  if (session?.validation_errors?.length) {
    return { ok: false, reason: session.validation_errors.join('; ') };
  }
  return { ok: true };
}

// ── Security Controls Check ───────────────────────────────────────────────────

function hasInteractiveCaptcha(htmlOrText = '') {
  const raw = String(htmlOrText);
  const text = raw.toLowerCase();
  // Invisible reCAPTCHA v3 / script tags appear on almost every ATS page.
  // Only pause on a challenge the candidate must complete.
  return (
    /please verify you are (a )?human/.test(text) ||
    /solve the recaptcha/.test(text) ||
    /recaptcha challenge/.test(text) ||
    /not a robot/.test(text) ||
    /class=["'][^"']*g-recaptcha/.test(raw) ||
    text.includes('g-recaptcha">') ||
    /\bh-captcha\b/.test(text) ||
    /iframe[^>]+(?:recaptcha|hcaptcha|challenges\.cloudflare|turnstile)/.test(text)
  );
}

export function detectSecurityObstacles(htmlOrText = '') {
  const text = String(htmlOrText).toLowerCase();
  const obstacles = [];

  if (hasInteractiveCaptcha(htmlOrText)) {
    obstacles.push('CAPTCHA');
  }

  if (
    text.includes('two-factor') ||
    text.includes('mfa') ||
    text.includes('enter verification code') ||
    text.includes('authenticator app')
  ) {
    obstacles.push('MFA');
  }

  if (
    text.includes('cloudflare') &&
    (text.includes('access denied') || text.includes('attention required'))
  ) {
    obstacles.push('Anti-bot');
  }

  if (
    text.includes('sign in to apply') ||
    text.includes('log in to continue') ||
    text.includes('password required')
  ) {
    obstacles.push('Authentication Barrier');
  }

  return {
    hasSecurityObstacle: obstacles.length > 0,
    obstacles,
  };
}

function pauseForSecurity(session, obstacles, extra = '') {
  const reason = extra || `Security control detected: ${obstacles.join(', ')}`;
  session.pause_reason = obstacles[0] || 'SECURITY';
  session.errors.push(reason);
  session.logAction({ action: 'PAUSE', detail: reason, obstacles });
  return session.complete(SESSION_STATUS.PAUSED, reason);
}

// ── Pre-flight Verification ───────────────────────────────────────────────────

export function verifyPreFlight({ opportunity, applicationRecord, existingApplications = [] }) {
  const checks = {
    url_valid: false,
    correct_company: false,
    correct_position: false,
    correct_url: false,
    correct_cv: false,
    correct_cover_letter: false,
    eligibility_valid: false,
    no_duplicate: false,
  };

  const errors = [];

  if (opportunity?.url) {
    const invalidRes = rejectPrivateOrInvalid(opportunity.url);
    if (!invalidRes) {
      checks.url_valid = true;
    } else {
      errors.push(`Invalid target URL: ${invalidRes.reason}`);
    }
  } else {
    errors.push('Missing application URL');
  }

  if (opportunity?.company && opportunity.company.trim().length > 0) {
    checks.correct_company = true;
  } else {
    errors.push('Missing or empty company name');
  }

  if (opportunity?.title && opportunity.title.trim().length > 0) {
    checks.correct_position = true;
  } else {
    errors.push('Missing or empty job position title');
  }

  if (applicationRecord && opportunity?.url) {
    checks.correct_url = true;
  } else {
    errors.push('Application record or URL mismatch');
  }

  if (applicationRecord?.tailored_cv?.tailored_html || applicationRecord?.tailored_cv?.html) {
    checks.correct_cv = true;
  } else {
    errors.push('Tailored CV missing from application record');
  }

  if (isCoverLetterSatisfied(applicationRecord)) {
    checks.correct_cover_letter = true;
  } else {
    errors.push('Cover letter missing from application record');
  }

  if (opportunity?.eligibility_status !== 'NOT_ELIGIBLE') {
    checks.eligibility_valid = true;
  } else {
    errors.push('Opportunity eligibility status is NOT_ELIGIBLE');
  }

  const isDuplicate = existingApplications.some(app => {
    const sameCompany = app.company?.toLowerCase() === opportunity?.company?.toLowerCase();
    const sameTitle = app.role?.toLowerCase() === opportunity?.title?.toLowerCase();
    const sameUrl = app.url === opportunity?.url;
    return (sameCompany && sameTitle) || sameUrl;
  });

  if (!isDuplicate) {
    checks.no_duplicate = true;
  } else {
    errors.push(`Duplicate application detected for ${opportunity.company} - ${opportunity.title}`);
  }

  const passed = Object.values(checks).every(Boolean);

  return {
    passed,
    checks,
    errors,
  };
}

// ── Form Field Scanner & Mapper ───────────────────────────────────────────────

export function mapFieldToAnswer(field, applicationRecord, sourceFacts = null, profile = null) {
  const { label, name, type } = field;
  const classification = classifyApplicationField(field);
  const questionText = classification.questionText || label || name || '';
  const category = classification.category;
  const intent = classification.intent;

  if (classification.isSensitive || isSensitiveIntent(intent)) {
    return {
      answer: '',
      confidence: 0.0,
      requires_user_input: true,
      sensitive: true,
      category,
      intent,
      rationale: `Hard gate: "${questionText}" falls into sensitive category "${category}"`,
    };
  }

  if (type === 'file' || intent === FIELD_INTENT.CV_UPLOAD || intent === FIELD_INTENT.COVER_LETTER_UPLOAD || intent === FIELD_INTENT.FILE_UPLOAD) {
    return {
      answer: '',
      confidence: 1,
      requires_user_input: false,
      sensitive: false,
      category,
      intent,
      fileIntent: intent,
      rationale: 'File field — handled by upload step, not typed text.',
    };
  }

  if (applicationRecord?.application_answers) {
    const matchedAns = applicationRecord.application_answers.find(a => {
      const q = String(a.question || '').toLowerCase();
      const targetText = questionText.toLowerCase();
      return q.includes(targetText) || targetText.includes(q);
    });

    if (matchedAns) {
      if (matchedAns.requires_user_input) {
        return {
          answer: '',
          confidence: matchedAns.confidence,
          requires_user_input: true,
          sensitive: matchedAns.sensitive || false,
          category: matchedAns.category,
          intent,
          rationale: matchedAns.rationale || 'Flagged as requiring user input by application generator',
        };
      }

      if (sourceFacts && matchedAns.answer) {
        const validation = validateAgainstSourceFacts(matchedAns.answer, sourceFacts);
        if (!validation.valid) {
          return {
            answer: '',
            confidence: 0.0,
            requires_user_input: true,
            sensitive: false,
            category: matchedAns.category,
            intent,
            rationale: `Fabrication detected in generated answer: ${validation.violations.join('; ')}`,
          };
        }
      }

      return {
        answer:
          matchedAns.category === 'name' || intent === FIELD_INTENT.NAME
            ? nameAnswerForField(matchedAns.answer, field)
            : matchedAns.answer,
        confidence: matchedAns.confidence,
        requires_user_input: false,
        sensitive: false,
        category: matchedAns.category,
        intent,
        rationale: 'Derived from application record pre-generated answers',
      };
    }
  }

  if (profile) {
    const derived = deriveFromProfile(category, profile, applicationRecord?.opportunity || {});
    if (derived && derived.confidence >= 0.7) {
      const answer =
        category === 'name' || intent === FIELD_INTENT.NAME
          ? nameAnswerForField(derived.answer, field)
          : derived.answer;
      return {
        answer,
        confidence: derived.confidence,
        requires_user_input: false,
        sensitive: false,
        category,
        intent,
        rationale: `Deterministically derived from profile (${category})`,
      };
    }
  }

  return {
    answer: '',
    confidence: 0.0,
    requires_user_input: true,
    sensitive: false,
    category,
    intent,
    rationale: `Unmapped field: "${questionText}" cannot be confidently auto-filled`,
  };
}

function dryRunFillAction(filled) {
  return filled ? 'DRY_RUN: filled' : 'DRY_RUN: would fill';
}

function dryRunUploadAction(attached, verb = 'attach') {
  return attached ? `DRY_RUN: ${verb}` : `DRY_RUN: would ${verb}`;
}

async function readPageContent(page) {
  if (!page || typeof page.content !== 'function') return '';
  try {
    return await page.content();
  } catch {
    return '';
  }
}

async function extractFields(page, session) {
  if (!page) return [];
  let raw = [];
  if (typeof page.evaluate === 'function') {
    try {
      raw = await inspectApplicationForm(page);
    } catch (err) {
      session.errors.push(`Failed to extract DOM form fields: ${err.message}`);
      raw = [];
    }
  }
  if (!Array.isArray(raw)) raw = [];
  try {
    raw = await enrichFieldsFromAtsAdapter(session.url, raw, session.platform || session.ats);
  } catch {
    /* keep semantic fields */
  }
  return raw;
}

async function resolveMapping({
  field,
  classification,
  applicationRecord,
  sourceFacts,
  profile,
  opportunity,
  candidateKnowledgeService,
  authContext,
}) {
  if (candidateKnowledgeService || classification.intent === FIELD_INTENT.MOTIVATION_QUESTION) {
    return resolveFieldFromKnowledge({
      field,
      classification,
      profile,
      applicationRecord,
      sourceFacts,
      opportunity,
      candidateKnowledgeService,
      authContext,
    });
  }
  return mapFieldToAnswer(field, applicationRecord, sourceFacts, profile);
}

// ── Application Agent Main Engine ─────────────────────────────────────────────

export async function runApplicationAgent({
  opportunity,
  applicationRecord,
  pdfPath = null,
  cvPath = null,
  coverLetterPath = null,
  existingApplications = [],
  page = null,
  sourceFacts = null,
  profile = null,
  liveSubmit = false,
  candidateKnowledgeService = null,
  authContext = null,
  callAIFn = null,
}) {
  const resumePath = cvPath || pdfPath;
  const session = new ApplicationSession({
    opportunity_id: opportunity?.id || opportunity?.url,
    url: opportunity?.url,
    company: opportunity?.company,
    job_title: opportunity?.title,
    dry_run: !liveSubmit,
  });

  session.logAction({ action: 'START', url: session.url, platform: session.ats, dry_run: session.dry_run });

  const preflightResult = verifyPreFlight({ opportunity, applicationRecord, existingApplications });
  session.preflight = preflightResult;
  session.logAction({ action: 'PREFLIGHT', detail: preflightResult.passed ? 'passed' : preflightResult.errors.join('; ') });

  if (!preflightResult.passed) {
    session.errors.push(...preflightResult.errors);
    return session.complete(SESSION_STATUS.SKIPPED, `Pre-flight failed: ${preflightResult.errors.join('; ')}`);
  }

  let pageContent = await readPageContent(page);
  if (pageContent) {
    const fromPage = detectPlatformFromPage(session.url, pageContent);
    if (session.ats === 'generic' && fromPage !== 'generic') {
      session.ats = fromPage;
    }
    session.platform = session.ats === 'generic' ? fromPage : session.ats;
  }
  session.logAction({ action: 'DETECT_PLATFORM', platform: session.platform, ats: session.ats });

  const secCheck = detectSecurityObstacles(pageContent);
  if (secCheck.hasSecurityObstacle) {
    return pauseForSecurity(session, secCheck.obstacles);
  }
  if (looksLikeLoginWall(pageContent)) {
    return pauseForSecurity(session, ['Authentication Barrier'], 'Employer portal requires login before applying. PAUSE — never bypass.');
  }

  const unanswered = [];
  const processedKeys = new Set();
  const fileFields = [];
  const coverLetterFile = materializeCoverLetterFile(applicationRecord, coverLetterPath);
  const coverBody = applicationRecord?.cover_letter?.skipped
    ? ''
    : (applicationRecord?.cover_letter?.body || applicationRecord?.cover_letter?.coverLetter || '');

  const processFields = async (rawFields, step) => {
    const classified = rawFields.map((field) => {
      const classification = classifyApplicationField(field);
      return { ...field, classification, intent: classification.intent };
    });

    const unknown = classified.filter((f) => f.intent === FIELD_INTENT.UNKNOWN);
    if (unknown.length && callAIFn) {
      session.logAction({ action: 'AI_CLASSIFY', step, detail: `${unknown.length} unknown field(s)` });
      const aiMap = await classifyUnknownFieldsWithAI(unknown, callAIFn);
      for (const field of classified) {
        const aiIntent = aiMap.get(field.id) || aiMap.get(field.name);
        if (aiIntent && field.intent === FIELD_INTENT.UNKNOWN) {
          field.intent = aiIntent;
          field.classification = {
            ...field.classification,
            intent: aiIntent,
            isSensitive: isSensitiveIntent(aiIntent),
          };
        }
      }
    }

    for (const field of classified) {
      const key = `${field.id || ''}|${field.name || ''}|${field.label || ''}`;
      const classification = field.classification || classifyApplicationField(field);
      session.logAction({
        action: 'CLASSIFY',
        step,
        field: field.label || field.name,
        intent: classification.intent,
        required: !!field.required,
      });

      if (
        classification.intent === FIELD_INTENT.CV_UPLOAD ||
        classification.intent === FIELD_INTENT.COVER_LETTER_UPLOAD ||
        classification.intent === FIELD_INTENT.FILE_UPLOAD ||
        field.type === 'file'
      ) {
        fileFields.push({ field, classification });
        processedKeys.add(key);
        continue;
      }

      if (processedKeys.has(key) && field.value) continue;

      const mapping = await resolveMapping({
        field,
        classification,
        applicationRecord,
        sourceFacts,
        profile,
        opportunity,
        candidateKnowledgeService,
        authContext,
      });

      if (mapping.requires_user_input) {
        if (!field.required && !mapping.sensitive && !classification.isSensitive) {
          session.fill_log.push({
            field: field.label,
            action: session.dry_run ? 'DRY_RUN: skipped optional unknown' : 'SKIPPED_OPTIONAL',
            reason: mapping.rationale,
            intent: classification.intent,
          });
          session.logAction({ action: 'SKIP_OPTIONAL_UNKNOWN', step, field: field.label, intent: classification.intent });
          processedKeys.add(key);
          continue;
        }
        unanswered.push({
          field,
          reason: mapping.rationale,
          category: mapping.category,
          intent: classification.intent,
          sensitive: mapping.sensitive || classification.isSensitive,
        });
        session.fill_log.push({
          field: field.label,
          action: 'REQUIRES_USER_INPUT',
          reason: mapping.rationale,
          intent: classification.intent,
        });
        session.logAction({
          action: 'REQUIRES_USER_INPUT',
          step,
          field: field.label,
          intent: classification.intent,
          detail: mapping.rationale,
        });
        processedKeys.add(key);
        continue;
      }

      let filled = false;
      if (page && mapping.answer) {
        filled = await fillFieldOnPage(page, field, mapping.answer);
      }
      session.fill_log.push({
        field: field.label,
        action: session.dry_run
          ? dryRunFillAction(filled)
          : (filled ? 'FILLED' : (page ? 'FILL_FAILED' : 'MAPPED')),
        value_preview: mapping.answer,
        confidence: mapping.confidence,
        intent: classification.intent,
      });
      session.logAction({
        action: session.dry_run ? 'DRY_RUN_FILL' : 'FILL',
        step,
        field: field.label,
        intent: classification.intent,
        filled,
      });
      processedKeys.add(key);
    }
  };

  if (page) {
    for (let step = 1; step <= MAX_NAV_STEPS; step++) {
      const html = await readPageContent(page);
      const stepSec = detectSecurityObstacles(html);
      if (stepSec.hasSecurityObstacle) {
        return pauseForSecurity(session, stepSec.obstacles);
      }
      if (looksLikeLoginWall(html)) {
        return pauseForSecurity(session, ['Authentication Barrier'], 'Login wall appeared during navigation. PAUSE — never bypass.');
      }

      session.logAction({ action: 'INSPECT', step });
      const rawFields = step === 1
        ? await openApplicationForm(page, session)
        : await extractFields(page, session);
      session.fields = mergeFields(session.fields, rawFields);
      await processFields(rawFields, step);

      const blocking = unanswered.filter((u) => u.sensitive || u.field.required);
      if (blocking.length) break;

      const advanced = await clickAdvance(page);
      if (!advanced) break;
      session.logAction({ action: 'NAVIGATE', step, detail: 'clicked Next/Continue' });
      await safeWait(page, 800);
    }
  } else {
    const simulated = [
      { id: 'first_name', name: 'first_name', label: 'Full name', type: 'text', required: true },
      { id: 'email', name: 'email', label: 'Email address', type: 'email', required: true },
    ];
    session.fields = simulated;
    await processFields(simulated, 1);
  }

  session.unanswered_fields = unanswered;

  const handleUpload = async (type, filePath, field, verb) => {
    if (!filePath) return false;
    let attached = false;
    if (page && existsSync(filePath)) {
      attached = field
        ? await attachFileToField(page, field, filePath)
        : await attachResumeIfPresent(page, filePath);
    }
    session.upload_log.push({
      type,
      filename: basename(filePath),
      action: session.dry_run
        ? dryRunUploadAction(attached, verb)
        : (attached ? 'ATTACHED' : (page ? 'ATTACH_FAILED' : 'PREPARED')),
    });
    session.logAction({ action: session.dry_run ? 'DRY_RUN_UPLOAD' : 'UPLOAD', type, attached, field: field?.label });
    return attached;
  };

  const cvField = fileFields.find((f) => f.classification.intent === FIELD_INTENT.CV_UPLOAD)?.field
    || fileFields.find((f) => f.classification.intent === FIELD_INTENT.FILE_UPLOAD)?.field;
  const coverField = fileFields.find((f) => f.classification.intent === FIELD_INTENT.COVER_LETTER_UPLOAD)?.field;

  if (resumePath) {
    await handleUpload('CV_PDF', resumePath, cvField, 'attach PDF file');
  } else if (cvField?.required) {
    unanswered.push({
      field: cvField,
      reason: 'Required CV upload has no tailored CV file.',
      category: 'cv_file',
      intent: FIELD_INTENT.CV_UPLOAD,
      sensitive: false,
    });
    session.fill_log.push({ field: cvField.label, action: 'REQUIRES_USER_INPUT', intent: FIELD_INTENT.CV_UPLOAD });
  }

  if (coverField) {
    if (coverLetterFile) {
      await handleUpload('COVER_LETTER', coverLetterFile, coverField, 'attach cover letter');
    } else if (coverField.required) {
      unanswered.push({
        field: coverField,
        reason: 'Required cover-letter upload is missing. UNKNOWN — do not guess.',
        category: 'cover_file',
        intent: FIELD_INTENT.COVER_LETTER_UPLOAD,
        sensitive: false,
      });
    }
  } else if (coverBody) {
    session.upload_log.push({
      type: 'COVER_LETTER',
      filename: 'cover_letter.txt',
      action: session.dry_run ? 'DRY_RUN: would insert/attach cover letter' : 'PREPARED',
    });
  }

  session.unanswered_fields = unanswered;

  const validationErrors = [];
  const missingRequired = unanswered.filter(u => u.field.required);
  if (missingRequired.length > 0) {
    validationErrors.push(`${missingRequired.length} required field(s) require user input`);
  }
  session.validation_errors = validationErrors;

  const sensitiveUnknown = unanswered.filter((u) => u.sensitive);
  if (sensitiveUnknown.length > 0) {
    session.pause_reason = 'SENSITIVE_QUESTION';
    session.logAction({
      action: 'PAUSE',
      detail: 'Unexpected sensitive question — PAUSE. Never auto-answer.',
      count: sensitiveUnknown.length,
    });
    return session.complete(
      SESSION_STATUS.PAUSED,
      `Paused on unexpected sensitive question: ${sensitiveUnknown.map((u) => u.intent || u.category).join(', ')}`
    );
  }

  if (unanswered.length > 0) {
    return session.complete(
      SESSION_STATUS.REQUIRES_USER_INPUT,
      `Application requires manual input for ${unanswered.length} field(s)`
    );
  }

  if (validationErrors.length > 0) {
    return session.complete(SESSION_STATUS.ERROR, validationErrors.join('; '));
  }

  const safety = canSafelySubmit(session, { liveSubmit });
  session.logAction({ action: 'VALIDATE', detail: safety.ok ? 'safe to submit' : safety.reason });

  if (!safety.ok) {
    return session.complete(
      SESSION_STATUS.READY_TO_SUBMIT,
      'All checks passed cleanly in DRY_RUN mode. Ready for manual review and submission.'
    );
  }

  const submitted = await clickSubmitOnPage(page);
  session.logAction({ action: 'SUBMIT', submitted });
  if (submitted) {
    return session.complete(SESSION_STATUS.SUBMITTED, 'Application submitted.');
  }

  return session.complete(
    SESSION_STATUS.REQUIRES_USER_INPUT,
    'The agent filled available fields but could not find a submit control, or the portal blocked the final click.'
  );
}

function mergeFields(existing, incoming) {
  const out = Array.isArray(existing) ? [...existing] : [];
  const keys = new Set(out.map((f) => `${f.id}|${f.name}|${f.label}`));
  for (const field of incoming || []) {
    const key = `${field.id}|${field.name}|${field.label}`;
    if (keys.has(key)) continue;
    keys.add(key);
    out.push(field);
  }
  return out;
}
