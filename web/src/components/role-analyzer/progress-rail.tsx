"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { analysisStepsFor } from "@/lib/role-analyzer-view";

export function ProgressRail({
  phase,
  percent,
  message,
  searchType,
}: {
  phase?: string | null;
  percent?: number | null;
  message?: string;
  searchType?: string | null;
}) {
  const steps = analysisStepsFor(searchType || (/intern/i.test(message || "") ? "internships" : "jobs"));
  const idx = Math.max(
    0,
    steps.findIndex((s) => s.id === phase)
  );
  const activeIndex = phase === "done" ? steps.length : idx;
  const shown = typeof percent === "number" ? Math.min(100, Math.max(0, percent)) : Math.round(((activeIndex + 1) / steps.length) * 100);

  return (
    <section
      className="rounded-2xl border border-border bg-surface p-5"
      aria-live="polite"
      aria-busy="true"
      aria-label="Analysis progress"
    >
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Please wait</p>
          <p className="text-sm font-medium text-foreground">{message || steps[Math.min(activeIndex, steps.length - 1)]?.label}</p>
        </div>
        <p className="text-sm tabular-nums text-muted" aria-hidden>
          {shown}%
        </p>
      </div>
      <div
        className="mb-5 h-1.5 overflow-hidden rounded-full bg-surface-hover"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={shown}
        aria-label={`Estimated progress ${shown} percent`}
      >
        <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${shown}%` }} />
      </div>
      <ol className="space-y-2.5">
        {steps.map((step, i) => {
          const done = phase === "done" || i < activeIndex;
          const current = phase !== "done" && i === activeIndex;
          return (
            <li key={step.id} className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]",
                  done && "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                  current && "border-brand bg-brand-soft text-brand-text",
                  !done && !current && "border-border text-faint"
                )}
                aria-hidden
              >
                {done ? <Check className="size-3" /> : i + 1}
              </span>
              <span className={cn("text-sm", current ? "font-medium text-foreground" : done ? "text-muted" : "text-faint")}>
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="sr-only">
        {steps.map((s, i) => `${i + 1}. ${s.label}${i === activeIndex ? " (current)" : i < activeIndex ? " (done)" : ""}`).join(". ")}
      </p>
    </section>
  );
}
