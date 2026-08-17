/**
 * Human-in-the-loop notifications for URL apply.
 * In-app is always on. Browser payloads are returned for the client to show.
 * Email is a stub you can plug later — this file never reads API keys or secrets.
 */

export const APPLY_NOTIFY = Object.freeze({
  CAPTCHA: "captcha_required",
  INFORMATION: "information_required",
  LOGIN: "login_required",
  EMAIL: "email_verification_required",
  WAITING: "waiting_for_user",
  COMPLETED: "application_completed",
});

export class InAppApplyChannel {
  constructor() {
    this.name = "in_app";
    this.store = new Map();
  }

  async send(payload, context = {}) {
    const userId = String(context.userId || payload.userId || "default");
    const key = `${context.tenantId || "default"}:${userId}`;
    const row = {
      id: `hitl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      channel: "in_app",
      kind: payload.kind,
      title: payload.title,
      body: payload.body,
      heading: payload.heading || "",
      jobId: payload.jobId || null,
      batchId: payload.batchId || null,
      metadata: payload.metadata || {},
      read: false,
      createdAt: new Date().toISOString(),
    };
    const list = this.store.get(key) || [];
    list.unshift(row);
    this.store.set(key, list.slice(0, 40));
    return row;
  }

  list(userId, tenantId = "default") {
    return this.store.get(`${tenantId}:${userId}`) || [];
  }
}

/** Server records the payload; the browser shows Notification if the user allowed it. */
export class BrowserApplyChannel {
  constructor() {
    this.name = "browser";
  }

  async send(payload) {
    return {
      channel: "browser",
      status: "ready",
      title: payload.title,
      body: payload.body,
      kind: payload.kind,
      jobId: payload.jobId || null,
    };
  }
}

/**
 * Plug-in point for email. Does not send unless a sendFn is provided.
 * Never reads SMTP keys, SendGrid tokens, or env secrets itself.
 */
export class EmailApplyChannel {
  constructor({ sendFn } = {}) {
    this.name = "email";
    this.sendFn = typeof sendFn === "function" ? sendFn : null;
  }

  async send(payload, context = {}) {
    if (!this.sendFn) {
      return { channel: "email", status: "skipped", reason: "email channel not configured" };
    }
    return this.sendFn({
      subject: payload.title,
      body: payload.body,
      kind: payload.kind,
      recipient: context.email || payload.recipient || "",
    });
  }
}

export function completedChecklist(job = {}) {
  const items = [];
  if (job.normalizedJob || job.company) items.push({ name: "Job analysis", done: true });
  if (job.documents?.cvText || job.files?.cvName || job.files?.cvPath) items.push({ name: "CV tailoring", done: true });
  if (job.documents?.coverLetter || job.files?.coverName || job.files?.coverPath) {
    items.push({ name: "Cover letter", done: true });
  }
  for (const stage of job.stages || []) {
    items.push({ name: stage.name, done: stage.status === "complete" });
  }
  return items;
}

export function buildActionRequiredCard(job = {}) {
  const company = job.company || "this company";
  const role = job.role || "this role";
  const heading = `${role} — ${company}`;
  const completed = completedChecklist(job).filter((item) => item.done);
  const waiting = Array.isArray(job.waitingFields) ? job.waitingFields : [];
  const question = waiting[0] || null;
  const phase = job.phase;

  if (phase === "CAPTCHA_REQUIRED") {
    return {
      kind: APPLY_NOTIFY.CAPTCHA,
      title: "🟡 Action Required",
      heading,
      intro: "StudentCareer AI completed:",
      completed,
      body: "The application is currently blocked by CAPTCHA.",
      question: null,
      primaryCta: "Open Application",
      primaryAction: "open",
      hint: "Complete the CAPTCHA in Chrome. After completion, the agent will continue.",
    };
  }
  if (phase === "LOGIN_REQUIRED") {
    return {
      kind: APPLY_NOTIFY.LOGIN,
      title: "🟡 Action Required",
      heading,
      intro: "StudentCareer AI completed:",
      completed,
      body: "This listing needs you to sign in. We never invent a password.",
      question: null,
      primaryCta: "Open Application",
      primaryAction: "open",
      hint: "Sign in or complete MFA in Chrome. The agent will continue afterward.",
    };
  }
  if (phase === "EMAIL_VERIFICATION_REQUIRED") {
    return {
      kind: APPLY_NOTIFY.EMAIL,
      title: "🟡 Action Required",
      heading,
      intro: "StudentCareer AI completed:",
      completed,
      body: "This employer sent an email or code to verify you.",
      question: null,
      primaryCta: "Open Application",
      primaryAction: "open",
      hint: "Complete verification in Chrome or your inbox. We never enter OTP codes.",
    };
  }
  if (phase === "INFORMATION_REQUIRED") {
    const legal = question && /i agree|i consent|privacy notice|terms of/.test(String(question.label || "").toLowerCase());
    const needsJd = !question && /job description|paste/i.test(`${job.message || ""} ${job.error || ""}`);
    return {
      kind: APPLY_NOTIFY.INFORMATION,
      title: "🟡 Your input is required",
      heading,
      intro: "StudentCareer AI completed:",
      completed,
      body: legal
        ? "This is a legal declaration. Open Chrome and confirm it yourself — we will not tick it for you."
        : question
          ? "AI cannot safely determine this from your profile."
          : needsJd
            ? "Unable to extract the full job description. Paste it to continue this application only."
            : job.message || "This application needs information only you can provide.",
      question: legal ? null : question,
      needsJd,
      primaryCta: legal ? "Open Application" : question ? "Enter Answer" : needsJd ? "Save job description" : "Continue",
      primaryAction: legal ? "open" : question ? "answer" : needsJd ? "jd" : "resume",
      hint: legal
        ? "Nothing was guessed or submitted."
        : "After you respond, the agent will continue this application only.",
    };
  }
  return {
    kind: APPLY_NOTIFY.WAITING,
    title: "🟡 Action Required",
    heading,
    intro: "StudentCareer AI completed:",
    completed,
    body: job.message || "This application is waiting for you in Chrome.",
    question: null,
    primaryCta: "Open Application",
    primaryAction: "open",
    hint: "Nothing was submitted.",
  };
}

export function createApplyNotificationHub({ emailSendFn } = {}) {
  const inApp = new InAppApplyChannel();
  const browser = new BrowserApplyChannel();
  const email = new EmailApplyChannel({ sendFn: emailSendFn });
  const channels = new Map([
    [inApp.name, inApp],
    [browser.name, browser],
    [email.name, email],
  ]);

  return {
    channels,
    inApp,
    async notify(payload, context = {}) {
      const names = payload.channels || ["in_app", "browser", "email"];
      const results = [];
      for (const name of names) {
        const channel = channels.get(name);
        if (!channel) continue;
        try {
          results.push({ channel: name, status: "delivered", result: await channel.send(payload, context) });
        } catch (err) {
          results.push({ channel: name, status: "failed", error: err instanceof Error ? err.message : "send failed" });
        }
      }
      return results;
    },
    listInApp(userId, tenantId) {
      return inApp.list(userId, tenantId);
    },
  };
}

const HUB = (globalThis.__coApplyNotifyHub ??= createApplyNotificationHub());

export function applyNotificationHub() {
  return HUB;
}

export function resetApplyNotificationsForTests() {
  globalThis.__coApplyNotifyHub = createApplyNotificationHub();
}
