"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Link2, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { getUrlApplicationBatch, resumeUrlApplication, startUrlApplications } from "@/lib/opportunity-client";
import { applyWatchExpected, closeApplyWatchWindow, finishApplyLaunch, openBlankApplyWatchWindow } from "@/lib/apply/open-watch-window";
import { buttonPrimaryClassName, buttonSecondaryClassName, inputClassName } from "@/components/ui/page-header";
import { cn } from "@/lib/cn";

const MAX_URL_APPLY_JOBS = 12;

function isTerminalPhase(phase: string) {
  return phase === "COMPLETED" || phase === "FAILED";
}

function isWaitingPhase(phase: string) {
  return (
    phase === "WAITING_FOR_USER" ||
    phase === "CAPTCHA_REQUIRED" ||
    phase === "INFORMATION_REQUIRED" ||
    phase === "LOGIN_REQUIRED" ||
    phase === "EMAIL_VERIFICATION_REQUIRED"
  );
}

type UrlRow = { id: string; url: string };

type ActionRequired = {
  kind: string;
  title: string;
  heading: string;
  intro?: string;
  completed?: { name: string; done: boolean }[];
  body: string;
  question?: { fieldId: string; label: string; reason?: string } | null;
  primaryCta: string;
  primaryAction: string;
  hint: string;
  needsJd?: boolean;
};

type BatchJob = {
  id: string;
  index: number;
  url: string;
  company: string;
  role: string;
  phase: string;
  progress: number;
  label: string;
  message: string;
  error?: string | null;
  captcha?: boolean;
  reviewPath?: string | null;
  files?: { cvName?: string; coverName?: string; stem?: string; job_id?: string };
  stages?: { name: string; status: string }[];
  waitingFields?: { fieldId: string; label: string; reason: string }[];
  fields?: { completedCount?: number; pendingCount?: number; extractedCount?: number };
  actionRequired?: ActionRequired | null;
  currentStage?: string;
  logs?: { at: number; message: string }[];
  tone?: string;
  pauseReason?: string | null;
  claimedBy?: string | null;
  localChrome?: boolean;
};

type Batch = {
  id: string;
  status: string;
  jobs: BatchJob[];
  summary?: { total: number; completed: number; failed: number; waiting: number; running: number };
};

function newRow(): UrlRow {
  return { id: `row-${Math.random().toString(36).slice(2, 9)}`, url: "" };
}

function companyName(job: BatchJob) {
  return job.company || `Application #${job.index}`;
}

function roleName(job: BatchJob) {
  return job.role || (job.company ? "Role" : "");
}

function headingFor(job: BatchJob) {
  const company = companyName(job);
  const role = roleName(job);
  if (!job.company && !job.role) return `Application #${job.index}`;
  return role ? `${company} — ${role}` : company;
}

function barClass(job: BatchJob) {
  if (job.phase === "FAILED") return "bg-red-500";
  if (job.phase === "COMPLETED") return "bg-emerald-500";
  if (isWaitingPhase(job.phase)) return "bg-amber-400";
  return "bg-brand";
}

function statusLine(job: BatchJob) {
  if (job.phase === "FAILED") return `✗ ${job.error || "Application failed"}`;
  if (job.phase === "COMPLETED") return "✓ Application completed";
  if (job.phase === "CAPTCHA_REQUIRED") return "🟡 CAPTCHA required";
  if (job.phase === "INFORMATION_REQUIRED") return "🟡 Information required";
  if (job.phase === "LOGIN_REQUIRED") return "🟡 Sign-in required";
  if (job.phase === "EMAIL_VERIFICATION_REQUIRED") return "🟡 Email verification required";
  if (job.phase === "WAITING_FOR_USER") return "🟡 Action required";
  return job.label || job.message;
}

function statusTone(job: BatchJob) {
  if (job.phase === "FAILED") return "text-red-600 dark:text-red-400";
  if (job.phase === "COMPLETED") return "text-emerald-600 dark:text-emerald-400";
  if (isWaitingPhase(job.phase)) return "text-amber-700 dark:text-amber-300";
  return "text-muted";
}

export function MultiUrlApplyPanel({ className }: { className?: string }) {
  const [rows, setRows] = useState<UrlRow[]>([newRow()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [batch, setBatch] = useState<Batch | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [acting, setActing] = useState("");
  const notified = useRef(new Set<string>());

  const filled = useMemo(() => rows.map((row) => row.url.trim()).filter(Boolean), [rows]);
  const active = Boolean(batch && (batch.jobs || []).some((job) => !isTerminalPhase(job.phase)));

  useEffect(() => {
    if (!batch?.id) return;
    const allTerminal = (batch.jobs || []).every((job) => isTerminalPhase(job.phase));
    if (allTerminal) return;
    const timer = window.setInterval(() => {
      void getUrlApplicationBatch(batch.id)
        .then((data) => {
          if (data.batch) setBatch(data.batch);
        })
        .catch(() => {});
    }, 1400);
    return () => window.clearInterval(timer);
  }, [batch?.id, batch?.status, batch?.jobs]);

  useEffect(() => {
    if (!batch?.jobs?.length || typeof window === "undefined" || !("Notification" in window)) return;
    for (const job of batch.jobs) {
      if (!isWaitingPhase(job.phase)) continue;
      const key = `${job.id}:${job.phase}`;
      if (notified.current.has(key)) continue;
      notified.current.add(key);
      const title = job.actionRequired?.title || "🟡 Action Required";
      const body = `${headingFor(job)}. ${job.actionRequired?.body || job.message}`;
      if (Notification.permission === "granted") {
        try {
          new Notification(title, { body });
        } catch {
          /* browser may block */
        }
      } else if (Notification.permission === "default") {
        void Notification.requestPermission().then((perm) => {
          if (perm === "granted") {
            try {
              new Notification(title, { body });
            } catch {
              /* ignore */
            }
          }
        });
      }
    }
  }, [batch]);

  const addRow = () => {
    if (rows.length >= MAX_URL_APPLY_JOBS) return;
    setRows((prev) => [...prev, newRow()]);
  };

  const removeRow = (id: string) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((row) => row.id !== id)));
  };

  const start = async () => {
    setBusy(true);
    setError("");
    const watcher = openBlankApplyWatchWindow();
    try {
      const data = await startUrlApplications(filled);
      setBatch(data.batch);
      const launched = finishApplyLaunch(data, watcher);
      if (!launched.ok) setError(launched.error || "Could not start applications.");
      else if (!launched.live) setError("");
    } catch (err: unknown) {
      closeApplyWatchWindow(watcher);
      setError(err instanceof Error ? err.message : "Could not start applications.");
    } finally {
      setBusy(false);
    }
  };

  const act = async (job: BatchJob, action: "open" | "resume" | "answer") => {
    if (!batch?.id) return;
    setActing(job.id);
    setError("");
    try {
      const payload: {
        action: "open" | "resume" | "answer";
        answers?: { fieldId: string; label: string; value: string }[];
        jdText?: string;
        captchaCleared?: boolean;
      } = { action };
      if (action === "answer") {
        if (job.actionRequired?.needsJd) {
          const value = (answers[job.id] || "").trim();
          if (!value) throw new Error("Paste the job description first.");
          payload.jdText = value;
          payload.action = "resume";
        } else {
          const field = job.actionRequired?.question || job.waitingFields?.[0];
          const value = (answers[job.id] || "").trim();
          if (!field || !value) throw new Error("Enter an answer first.");
          payload.answers = [{ fieldId: field.fieldId, label: field.label, value }];
        }
      }
      if (action === "resume" && job.phase === "CAPTCHA_REQUIRED") payload.captchaCleared = true;
      const data = await resumeUrlApplication(batch.id, job.id, payload);
      if (data.batch) setBatch(data.batch);
      if (action === "answer") setAnswers((prev) => ({ ...prev, [job.id]: "" }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not continue that application.");
    } finally {
      setActing("");
    }
  };

  return (
    <section className={cn("space-y-4", className)}>
      <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5 space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand">Apply to jobs</p>
          <h2 className="mt-1 text-base font-semibold text-foreground">Paste one or more job URLs</h2>
          <p className="mt-1 text-xs text-muted">
            Each URL becomes its own application — its own CV, cover letter, form, and status. Start Applying opens a
            window where you watch the form fill and solve CAPTCHAs. Nothing is submitted for you.
          </p>
        </div>

        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={row.id} className="flex items-center gap-2">
              <label className="relative min-w-0 flex-1">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
                <input
                  value={row.url}
                  onChange={(e) =>
                    setRows((prev) => prev.map((item) => (item.id === row.id ? { ...item, url: e.target.value } : item)))
                  }
                  placeholder={`URL ${index + 1}  https://company.com/jobs/…`}
                  className={cn(inputClassName, "pl-9")}
                  disabled={busy}
                  autoComplete="off"
                  aria-label={`Job URL ${index + 1}`}
                />
              </label>
              <button
                type="button"
                onClick={() => removeRow(row.id)}
                disabled={busy || rows.length <= 1}
                className={cn(buttonSecondaryClassName, "px-3")}
                aria-label={`Remove URL ${index + 1}`}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={addRow} disabled={busy || rows.length >= MAX_URL_APPLY_JOBS} className={buttonSecondaryClassName}>
            <Plus className="size-4" />
            Add Job URL
          </button>
          <button type="button" onClick={start} disabled={busy || filled.length === 0} className={buttonPrimaryClassName}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {busy ? "Starting…" : "Start Applying"}
          </button>
        </div>
        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      </section>

      {batch ? (
        <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-brand">Application Center</p>
              <h2 className="mt-1 text-base font-semibold text-foreground">Independent applications</h2>
            </div>
            <p className="text-xs text-muted">
              {batch.summary?.completed || 0} completed · {batch.summary?.waiting || 0} waiting · {batch.summary?.failed || 0}{" "}
              failed
            </p>
          </div>

          <div className="grid gap-3">
            {(batch.jobs || []).map((job) => {
              const card = job.actionRequired;
              const progress = Math.max(0, Math.min(100, job.progress || 0));
              return (
                <article
                  key={job.id}
                  className="rounded-2xl border border-border bg-background px-5 py-4 space-y-3 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-lg font-semibold tracking-tight text-foreground">{companyName(job)}</h3>
                      {roleName(job) ? <p className="mt-0.5 text-sm text-muted">{roleName(job)}</p> : null}
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{progress}%</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-hover">
                      <div
                        className={cn("h-full rounded-full transition-all duration-500", barClass(job))}
                        style={{ width: `${Math.max(progress === 0 ? 0 : 6, progress)}%` }}
                      />
                    </div>
                  </div>

                  <p className={cn("text-sm font-medium", statusTone(job))}>{statusLine(job)}</p>

                  {batch?.id && applyWatchExpected() ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                      onClick={() => {
                        const launched = finishApplyLaunch({ batch, liveWindow: true });
                        if (!launched.ok) setError(launched.error || "Allow pop-ups so the application window can open.");
                      }}
                    >
                      <ExternalLink className="size-3.5" />
                      Open application window
                    </button>
                  ) : null}

                  <dl className="grid gap-1 text-[11px] text-muted sm:grid-cols-2">
                    <div>
                      <dt className="uppercase tracking-wider text-faint">Tailored CV</dt>
                      <dd className="truncate text-foreground">{job.files?.cvName || "Generating…"}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wider text-faint">Cover letter</dt>
                      <dd className="truncate text-foreground">{job.files?.coverName || "Generating…"}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="uppercase tracking-wider text-faint">Current stage</dt>
                      <dd className="text-foreground">{job.currentStage || job.label}</dd>
                    </div>
                  </dl>

                  {card ? (
                    <div className="rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-3 space-y-2 dark:border-amber-700/60 dark:bg-amber-950/40">
                      <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">{card.title}</p>
                      <p className="text-xs font-medium text-foreground">{card.heading}</p>
                      {card.completed?.length ? (
                        <div>
                          <p className="text-[11px] text-muted">{card.intro}</p>
                          <ul className="mt-1 text-[11px] text-muted space-y-0.5">
                            {card.completed.map((item) => (
                              <li key={item.name}>✓ {item.name}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <p className="text-xs text-foreground">{card.body}</p>
                      {card.question || card.needsJd ? (
                        <div className="space-y-2">
                          {card.question ? (
                            <p className="text-xs text-muted">
                              Question: <span className="font-medium text-foreground">“{card.question.label}”</span>
                            </p>
                          ) : null}
                          <textarea
                            value={answers[job.id] || ""}
                            onChange={(e) => setAnswers((prev) => ({ ...prev, [job.id]: e.target.value }))}
                            placeholder={card.needsJd ? "Paste the job description" : "Enter the verified answer"}
                            className={cn(inputClassName, "min-h-[72px] py-2")}
                          />
                          <button
                            type="button"
                            className={buttonPrimaryClassName}
                            disabled={acting === job.id || !(answers[job.id] || "").trim()}
                            onClick={() => void act(job, "answer")}
                          >
                            {acting === job.id ? <Loader2 className="size-4 animate-spin" /> : null}
                            {card.question ? "Answer Question" : card.primaryCta}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={buttonPrimaryClassName}
                          disabled={acting === job.id}
                          onClick={() => void act(job, card.primaryAction === "resume" ? "resume" : "open")}
                        >
                          {acting === job.id ? <Loader2 className="size-4 animate-spin" /> : null}
                          {card.primaryCta}
                        </button>
                      )}
                      <p className="text-[11px] text-muted">{card.hint}</p>
                    </div>
                  ) : null}

                  {job.reviewPath ? (
                    <a
                      href={job.reviewPath}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex text-xs font-medium text-brand hover:underline"
                    >
                      Open tailored documents
                    </a>
                  ) : null}
                </article>
              );
            })}
          </div>
          {active ? (
            <p className="text-xs text-muted">
              The application window shows the live form. Watch it fill, and solve CAPTCHAs there. Other jobs keep
              preparing in parallel.
            </p>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
