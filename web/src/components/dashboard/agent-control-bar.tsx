"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Play,
  Pause,
  Square,
  Radar,
  Bot,
  ChevronRight,
  GraduationCap,
  Briefcase,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { buttonPrimaryClassName, buttonSecondaryClassName } from "@/components/ui/page-header";

interface AgentControlBarProps {
  agentState: "RUNNING" | "PAUSED" | "STOPPED" | "ERROR";
  pauseReason?: string;
  onRefresh: () => void;
  compact?: boolean;
}

const STATUS_STYLES = {
  RUNNING: {
    dot: "bg-emerald-500",
    pill: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
    label: "Running",
  },
  PAUSED: {
    dot: "bg-amber-500",
    pill: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
    label: "Paused",
  },
  STOPPED: {
    dot: "bg-muted",
    pill: "bg-surface-hover text-muted border-border",
    label: "Stopped",
  },
  ERROR: {
    dot: "bg-red-500",
    pill: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20",
    label: "Error",
  },
} as const;

export function AgentControlBar({ agentState, pauseReason, onRefresh, compact = false }: AgentControlBarProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const status = STATUS_STYLES[agentState] ?? STATUS_STYLES.STOPPED;

  const handleAction = async (action: string, payload?: Record<string, unknown>) => {
    setLoadingAction(action);
    try {
      await fetch("/api/autonomous/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      onRefresh();
    } catch (err) {
      console.error(`Error performing action ${action}:`, err);
    } finally {
      setLoadingAction(null);
    }
  };

  const isRunning = agentState === "RUNNING";
  const isStopped = agentState === "STOPPED" || agentState === "ERROR";
  const busy = loadingAction !== null;

  return (
    <section className="rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4 min-w-0">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <Bot className="size-5" />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-foreground tracking-tight">
                Career agent
              </h2>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
                  status.pill
                )}
              >
                <span className={cn("size-1.5 rounded-full", status.dot, isRunning && "animate-pulse")} />
                {status.label}
              </span>
            </div>
            <p className="text-sm text-muted leading-snug max-w-xl">
              {isRunning
                ? "Scanning sources and preparing matched applications."
                : agentState === "PAUSED"
                  ? pauseReason || "Paused — resume when you are ready."
                  : compact
                    ? "Optional. Start it from here, or open the Agent page for full controls."
                    : "Start the agent to scan verified sources and prepare matched applications."}
            </p>
          </div>
        </div>

        <Link
          href="/agent"
          className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-brand-text hover:underline underline-offset-2"
        >
          Open agent console
          <ChevronRight className="size-4" />
        </Link>
      </div>

      {compact ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3 bg-surface-hover/30">
          {isStopped ? (
            <button
              type="button"
              onClick={() => handleAction("start", { forceEnable: true })}
              disabled={busy}
              className={cn(buttonPrimaryClassName, "text-sm py-2 px-3.5")}
            >
              <Play className="size-3.5" />
              {loadingAction === "start" ? "Starting…" : "Start"}
            </button>
          ) : isRunning ? (
            <button
              type="button"
              onClick={() => handleAction("pause", { reason: "User requested pause" })}
              disabled={busy}
              className={cn(buttonSecondaryClassName, "text-sm py-2 px-3.5")}
            >
              <Pause className="size-3.5" />
              {loadingAction === "pause" ? "Pausing…" : "Pause"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleAction("resume")}
              disabled={busy}
              className={cn(buttonPrimaryClassName, "text-sm py-2 px-3.5")}
            >
              <Play className="size-3.5" />
              {loadingAction === "resume" ? "Resuming…" : "Resume"}
            </button>
          )}
          <Link href="/internships" className={cn(buttonSecondaryClassName, "text-sm py-2 px-3.5")}>
            <GraduationCap className="size-3.5" />
            Browse internships
          </Link>
          <Link href="/jobs" className={cn(buttonSecondaryClassName, "text-sm py-2 px-3.5")}>
            <Briefcase className="size-3.5" />
            Browse jobs
          </Link>
        </div>
      ) : (
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3 bg-surface-hover/30">
        <button
          type="button"
          onClick={() => handleAction("start", { forceEnable: true })}
          disabled={busy || isRunning}
          className={cn(buttonPrimaryClassName, "text-sm py-2 px-3.5")}
        >
          <Play className="size-3.5" />
          {loadingAction === "start" ? "Starting…" : "Start"}
        </button>

        <button
          type="button"
          onClick={() => handleAction("pause", { reason: "User requested pause" })}
          disabled={busy || !isRunning}
          className={cn(buttonSecondaryClassName, "text-sm py-2 px-3.5")}
        >
          <Pause className="size-3.5" />
          {loadingAction === "pause" ? "Pausing…" : "Pause"}
        </button>

        <button
          type="button"
          onClick={() => handleAction("resume")}
          disabled={busy || agentState !== "PAUSED"}
          className={cn(buttonSecondaryClassName, "text-sm py-2 px-3.5")}
        >
          <Play className="size-3.5" />
          {loadingAction === "resume" ? "Resuming…" : "Resume"}
        </button>

        <button
          type="button"
          onClick={() => handleAction("stop")}
          disabled={busy || isStopped}
          className={cn(buttonSecondaryClassName, "text-sm py-2 px-3.5")}
        >
          <Square className="size-3.5" />
          {loadingAction === "stop" ? "Stopping…" : "Stop"}
        </button>

        <span className="hidden sm:block h-5 w-px bg-border mx-1" aria-hidden />

        <button
          type="button"
          onClick={() => handleAction("run-once")}
          disabled={busy}
          className={cn(buttonSecondaryClassName, "text-sm py-2 px-3.5")}
        >
          <Radar className="size-3.5" />
          {loadingAction === "run-once" ? "Scanning…" : "Run scan"}
        </button>

        <Link href="/internships" className={cn(buttonSecondaryClassName, "text-sm py-2 px-3.5 ml-auto sm:ml-0")}>
          <GraduationCap className="size-3.5" />
          Browse internships
        </Link>
        <Link href="/jobs" className={cn(buttonSecondaryClassName, "text-sm py-2 px-3.5")}>
          <Briefcase className="size-3.5" />
          Browse jobs
        </Link>
      </div>
      )}
    </section>
  );
}
