"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Square,
  Zap,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Sliders,
  History,
  RefreshCw,
  Loader2,
  Flame,
  Info,
} from "lucide-react";
import { cn } from "@/lib/cn";

type AgentStatus = {
  state: "RUNNING" | "PAUSED" | "STOPPED" | "ERROR";
  pauseReason: string | null;
  currentJob: string | null;
  lastRunAt: string | null;
  dailyStats: {
    date: string;
    timezone: string;
    counts: { internship?: number; job?: number };
    limits: { internship: number; job: number };
    remaining: { internship: number; job: number };
  };
  queueCounts?: {
    total: number;
    discovered: number;
    eligible: number;
    applied: number;
    requires_input: number;
    failed: number;
  };
  config: Record<string, any>;
};

type AuditLogEntry = {
  id: string;
  timestamp: string;
  type: string;
  [key: string]: any;
};

export function AutonomousPanel() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [config, setConfig] = useState<Record<string, any>>({});

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/autonomous/status");
      const data = await res.json();
      if (data.ok) {
        setStatus(data.status);
        setConfig(data.status.config || {});
        if (data.recentLogs) {
          setLogs(data.recentLogs);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  async function handleAction(action: string, extra: any = {}) {
    setActionLoading(action);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/autonomous/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus(data.status);
        if (data.recentLogs) setLogs(data.recentLogs);
      } else {
        setErrorMsg(data.error || "Action failed");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Network error");
    } finally {
      setActionLoading(null);
    }
  }

  async function updateConfig(key: string, value: any) {
    const updated = { ...config, [key]: value };
    setConfig(updated);
    try {
      const res = await fetch("/api/autonomous/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      const data = await res.json();
      if (data.ok) {
        fetchStatus();
      }
    } catch {
      // rollback
      fetchStatus();
    }
  }

  if (loading && !status) {
    return (
      <div className="flex h-96 items-center justify-center gap-3 text-muted">
        <Loader2 className="size-6 animate-spin text-brand" />
        <span>Loading Autonomous Background Engine...</span>
      </div>
    );
  }

  const isRunning = status?.state === "RUNNING";
  const isPaused = status?.state === "PAUSED";
  const isStopped = status?.state === "STOPPED";
  const isError = status?.state === "ERROR";

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6 md:p-10">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground md:text-3xl">
              Autonomous Agent Mode
            </h1>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider",
                isRunning && "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
                isPaused && "border border-amber-500/30 bg-amber-500/10 text-amber-400",
                isStopped && "border border-zinc-500/30 bg-zinc-500/10 text-zinc-400",
                isError && "border border-rose-500/30 bg-rose-500/10 text-rose-400"
              )}
            >
              <span
                className={cn(
                  "size-2 rounded-full",
                  isRunning && "animate-pulse bg-emerald-400",
                  isPaused && "bg-amber-400",
                  isStopped && "bg-zinc-400",
                  isError && "bg-rose-400"
                )}
              />
              {status?.state || "STOPPED"}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">
            Continuous 9-stage job discovery, eligibility verification, CV tailoring, application generation, and tracking.
          </p>
        </div>

        <button
          type="button"
          onClick={() => fetchStatus()}
          className="inline-flex items-center gap-2 self-start rounded-xl border border-border bg-surface px-3.5 py-2 text-xs font-medium text-muted transition hover:bg-surface-hover hover:text-foreground"
        >
          <RefreshCw className="size-3.5" />
          Refresh
        </button>
      </div>

      {/* Error banner */}
      {errorMsg && (
        <div className="flex items-center gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-400">
          <AlertTriangle className="size-5 shrink-0" />
          <div className="flex-1 font-medium">{errorMsg}</div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-xs font-bold text-rose-400 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Pause Notice */}
      {isPaused && status?.pauseReason && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-400">
          <AlertTriangle className="size-5 shrink-0" />
          <div>
            <div className="font-semibold">Pipeline Execution Paused</div>
            <div className="mt-0.5 text-xs text-amber-300/80">{status.pauseReason}</div>
          </div>
        </div>
      )}

      {/* Primary State Controls */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Start / Resume */}
        <button
          type="button"
          disabled={isRunning || actionLoading !== null}
          onClick={() => {
            if (isPaused) handleAction("resume");
            else handleAction("start", { forceEnable: true });
          }}
          className={cn(
            "flex flex-col items-start gap-2 rounded-2xl border p-5 text-left transition",
            isRunning
              ? "border-border/50 bg-surface/20 opacity-40"
              : "border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-500/60 hover:bg-emerald-500/10"
          )}
        >
          <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
            {actionLoading === "start" || actionLoading === "resume" ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <Play className="size-5 fill-current" />
            )}
          </div>
          <div>
            <div className="font-semibold text-foreground">
              {isPaused ? "Resume Pipeline" : "Start Autonomous Mode"}
            </div>
            <div className="text-xs text-muted">
              {isPaused ? "Continue processing from pause" : "Activate continuous background cycle"}
            </div>
          </div>
        </button>

        {/* Pause */}
        <button
          type="button"
          disabled={!isRunning || actionLoading !== null}
          onClick={() => handleAction("pause")}
          className={cn(
            "flex flex-col items-start gap-2 rounded-2xl border p-5 text-left transition",
            !isRunning
              ? "border-border/50 bg-surface/20 opacity-40"
              : "border-amber-500/30 bg-amber-500/5 hover:border-amber-500/60 hover:bg-amber-500/10"
          )}
        >
          <div className="flex size-10 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400">
            {actionLoading === "pause" ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <Pause className="size-5 fill-current" />
            )}
          </div>
          <div>
            <div className="font-semibold text-foreground">Pause Agent</div>
            <div className="text-xs text-muted">Safely hold processing without losing state</div>
          </div>
        </button>

        {/* Stop */}
        <button
          type="button"
          disabled={isStopped || actionLoading !== null}
          onClick={() => handleAction("stop")}
          className={cn(
            "flex flex-col items-start gap-2 rounded-2xl border p-5 text-left transition",
            isStopped
              ? "border-border/50 bg-surface/20 opacity-40"
              : "border-zinc-500/30 bg-zinc-500/5 hover:border-zinc-500/60 hover:bg-zinc-500/10"
          )}
        >
          <div className="flex size-10 items-center justify-center rounded-xl bg-zinc-500/20 text-zinc-400">
            {actionLoading === "stop" ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <Square className="size-5 fill-current" />
            )}
          </div>
          <div>
            <div className="font-semibold text-foreground">Stop Agent</div>
            <div className="text-xs text-muted">Halt all background tasks completely</div>
          </div>
        </button>

        {/* Single Cycle Run */}
        <button
          type="button"
          disabled={actionLoading !== null}
          onClick={() => handleAction("run-once")}
          className="flex flex-col items-start gap-2 rounded-2xl border border-brand/30 bg-brand-soft/30 p-5 text-left transition hover:border-brand hover:bg-brand-soft"
        >
          <div className="flex size-10 items-center justify-center rounded-xl bg-brand/20 text-brand">
            {actionLoading === "run-once" ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <Zap className="size-5" />
            )}
          </div>
          <div>
            <div className="font-semibold text-foreground">Run Single Cycle</div>
            <div className="text-xs text-muted">Discover and process one batch immediately</div>
          </div>
        </button>
      </div>

      {/* Quota & Queue Stats */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Daily Application Limits */}
        <div className="rounded-3xl border border-border bg-surface/40 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-brand" />
              <h2 className="font-display font-semibold text-foreground">Daily Application Quota</h2>
            </div>
            <button
              type="button"
              onClick={() => handleAction("reset")}
              className="text-xs text-faint hover:text-muted"
            >
              Reset Today
            </button>
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <div className="flex justify-between text-xs font-medium">
                <span className="text-muted">Internship Applications</span>
                <span className="font-mono text-foreground">
                  {status?.dailyStats.counts.internship || 0} / {status?.dailyStats.limits.internship || 10}
                </span>
              </div>
              <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-surface-hover">
                <div
                  className="h-full bg-brand transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      (((status?.dailyStats.counts.internship || 0) /
                        (status?.dailyStats.limits.internship || 10)) *
                        100)
                    )}%`,
                  }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-medium">
                <span className="text-muted">Full-Time Job Applications</span>
                <span className="font-mono text-foreground">
                  {status?.dailyStats.counts.job || 0} / {status?.dailyStats.limits.job || 10}
                </span>
              </div>
              <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-surface-hover">
                <div
                  className="h-full bg-emerald-400 transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      (((status?.dailyStats.counts.job || 0) /
                        (status?.dailyStats.limits.job || 10)) *
                        100)
                    )}%`,
                  }}
                />
              </div>
            </div>

            <div className="pt-2 text-xs text-faint">
              Auto-resets at midnight in timezone:{" "}
              <span className="font-mono text-muted">{status?.dailyStats.timezone}</span>
            </div>
          </div>
        </div>

        {/* Application Queue Overview */}
        <div className="rounded-3xl border border-border bg-surface/40 p-6">
          <div className="flex items-center gap-2">
            <Flame className="size-5 text-amber-400" />
            <h2 className="font-display font-semibold text-foreground">Application Pipeline Queue</h2>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-2xl border border-border/60 bg-surface/30 p-3">
              <div className="text-2xl font-bold font-mono text-foreground">
                {status?.queueCounts?.discovered || 0}
              </div>
              <div className="text-[11px] text-muted">Discovered</div>
            </div>
            <div className="rounded-2xl border border-border/60 bg-surface/30 p-3">
              <div className="text-2xl font-bold font-mono text-emerald-400">
                {status?.queueCounts?.eligible || 0}
              </div>
              <div className="text-[11px] text-muted">Eligible</div>
            </div>
            <div className="rounded-2xl border border-border/60 bg-surface/30 p-3">
              <div className="text-2xl font-bold font-mono text-brand">
                {status?.queueCounts?.applied || 0}
              </div>
              <div className="text-[11px] text-muted">Applied</div>
            </div>
          </div>

          {status?.currentJob && (
            <div className="mt-4 rounded-xl border border-brand/30 bg-brand-soft/30 p-3 text-xs text-brand-text">
              <span className="font-semibold">Currently Processing:</span> {status.currentJob}
            </div>
          )}
        </div>
      </div>

      {/* Safety & Configuration Settings */}
      <div className="rounded-3xl border border-border bg-surface/40 p-6">
        <div className="flex items-center gap-2">
          <Sliders className="size-5 text-brand" />
          <h2 className="font-display font-semibold text-foreground">Safety Rules & Configuration</h2>
        </div>
        <p className="mt-1 text-xs text-muted">
          All safety guards are enforced by strict zero-bypass logic in the pipeline runtime.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {/* Autonomous Mode Switch */}
          <ConfigToggle
            title="AUTONOMOUS_MODE"
            description="Enable continuous background autonomous pipeline execution"
            checked={!!config.AUTONOMOUS_MODE}
            onChange={(v) => updateConfig("AUTONOMOUS_MODE", v)}
          />

          {/* Auto Submit Switch */}
          <ConfigToggle
            title="AUTO_SUBMIT"
            description="Submit web applications automatically. Default stays review-first: prepare the package, then wait for the user's final submit click."
            checked={!!config.AUTO_SUBMIT}
            onChange={(v) => updateConfig("AUTO_SUBMIT", v)}
          />

          {/* Require Eligibility */}
          <ConfigToggle
            title="REQUIRE_ELIGIBILITY"
            description="Block applying to opportunities failing 14-criterion eligibility gate"
            checked={config.REQUIRE_ELIGIBILITY !== false}
            onChange={(v) => updateConfig("REQUIRE_ELIGIBILITY", v)}
          />

          {/* Require Confident Answers */}
          <ConfigToggle
            title="REQUIRE_CONFIDENT_ANSWERS"
            description="Flag or pause if any application question has low confidence answer"
            checked={config.REQUIRE_CONFIDENT_ANSWERS !== false}
            onChange={(v) => updateConfig("REQUIRE_CONFIDENT_ANSWERS", v)}
          />

          {/* Pause on CAPTCHA */}
          <ConfigToggle
            title="PAUSE_ON_CAPTCHA"
            description="Pause immediately when CAPTCHA is detected. Never attempts bypass."
            checked={config.PAUSE_ON_CAPTCHA !== false}
            onChange={(v) => updateConfig("PAUSE_ON_CAPTCHA", v)}
          />

          {/* Pause on Auth Barrier */}
          <ConfigToggle
            title="PAUSE_ON_AUTH_FAILURE"
            description="Pause when authentication, password, or MFA wall is encountered"
            checked={config.PAUSE_ON_AUTH_FAILURE !== false}
            onChange={(v) => updateConfig("PAUSE_ON_AUTH_FAILURE", v)}
          />

          {/* Pause on Unexpected Form */}
          <ConfigToggle
            title="PAUSE_ON_UNEXPECTED_FORM"
            description="Pause if form contains unmapped or unrecognizable fields"
            checked={config.PAUSE_ON_UNEXPECTED_FORM !== false}
            onChange={(v) => updateConfig("PAUSE_ON_UNEXPECTED_FORM", v)}
          />

          {/* Pause on Sensitive Questions */}
          <ConfigToggle
            title="PAUSE_ON_SENSITIVE_QUESTION"
            description="Pause on sensitive demographic, legal, salary, or sponsorship questions"
            checked={config.PAUSE_ON_SENSITIVE_QUESTION !== false}
            onChange={(v) => updateConfig("PAUSE_ON_SENSITIVE_QUESTION", v)}
          />
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {/* Max applications per day */}
          <div className="rounded-2xl border border-border/60 bg-surface/20 p-4">
            <div className="flex justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                MAX_APPLICATIONS_PER_DAY
              </span>
              <span className="font-mono text-xs font-bold text-foreground">
                {config.MAX_APPLICATIONS_PER_DAY || 10}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={50}
              value={config.MAX_APPLICATIONS_PER_DAY || 10}
              onChange={(e) => updateConfig("MAX_APPLICATIONS_PER_DAY", parseInt(e.target.value, 10))}
              className="mt-3 w-full accent-brand"
            />
          </div>

          {/* Min Match Score */}
          <div className="rounded-2xl border border-border/60 bg-surface/20 p-4">
            <div className="flex justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                MIN_MATCH_SCORE
              </span>
              <span className="font-mono text-xs font-bold text-foreground">
                {config.MIN_MATCH_SCORE || 70}%
              </span>
            </div>
            <input
              type="range"
              min={50}
              max={95}
              value={config.MIN_MATCH_SCORE || 70}
              onChange={(e) => updateConfig("MIN_MATCH_SCORE", parseInt(e.target.value, 10))}
              className="mt-3 w-full accent-brand"
            />
          </div>
        </div>
      </div>

      {/* Audit Log Stream */}
      <div className="rounded-3xl border border-border bg-surface/40 p-6">
        <div className="flex items-center gap-2">
          <History className="size-5 text-brand" />
          <h2 className="font-display font-semibold text-foreground">Audit Log Stream</h2>
        </div>
        <p className="mt-1 text-xs text-muted">
          Immutable event log recorded in data/autonomous-audit.json for transparency and debugging.
        </p>

        <div className="mt-4 max-h-72 overflow-y-auto rounded-2xl border border-border/60 bg-surface/20 p-4 font-mono text-xs">
          {logs.length === 0 ? (
            <div className="py-8 text-center text-muted">No audit events recorded yet.</div>
          ) : (
            <div className="space-y-2">
              {logs.map((l) => (
                <div key={l.id || Math.random()} className="flex items-start gap-2 border-b border-border/30 pb-2">
                  <span className="text-faint">{l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : ""}</span>
                  <span className="font-bold text-foreground">{l.type}</span>
                  <span className="truncate text-muted">
                    {l.company ? `${l.company} — ${l.title || ""}` : l.reason || l.error || JSON.stringify(l)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfigToggle({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <div
      onClick={() => onChange(!checked)}
      className="flex cursor-pointer items-start justify-between gap-4 rounded-2xl border border-border/60 bg-surface/20 p-4 transition hover:bg-surface/50"
    >
      <div className="min-w-0 flex-1">
        <div className="font-mono text-xs font-semibold text-foreground">{title}</div>
        <div className="mt-1 text-xs text-muted leading-relaxed">{description}</div>
      </div>
      <button
        type="button"
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-brand" : "bg-surface-hover border border-border"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[1.375rem]" : "translate-x-0.5"
          )}
        />
      </button>
    </div>
  );
}
