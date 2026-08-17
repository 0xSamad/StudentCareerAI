"use client";

import { Compass, ShieldCheck, Sparkles, FileCheck2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { instrumentSerif } from "@/lib/fonts";

export interface DashboardStats {
  opportunitiesFound: number;
  eligible: number;
  rejected: number;
  strongMatches: number;
  applicationsPrepared: number;
  applicationsSubmitted: number;
  failed: number;
  interviews: number;
  responses: number;
}

interface StatsGridProps {
  stats: DashboardStats;
}

const PRIMARY = [
  { key: "opportunitiesFound" as const, label: "Discovered", hint: "Listings in this view" },
  { key: "eligible" as const, label: "Eligible", hint: "Passed profile criteria" },
  { key: "strongMatches" as const, label: "Strong matches", hint: "Score ≥ 80%" },
  { key: "applicationsPrepared" as const, label: "Prepared", hint: "CV & forms ready" },
  { key: "applicationsSubmitted" as const, label: "Submitted", hint: "Live applications sent" },
  { key: "responses" as const, label: "Responses", hint: "Recruiter replies" },
];

const SECONDARY = [
  { key: "rejected" as const, label: "Skipped" },
  { key: "failed" as const, label: "Errors" },
  { key: "interviews" as const, label: "Interviews" },
];

export function StatsGrid({ stats }: StatsGridProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {PRIMARY.map((item, index) => {
          const value = stats[item.key];
          const featured = index === 0;
          return (
            <div
              key={item.key}
              className="rounded-xl border border-border bg-background px-4 py-3.5 transition-colors hover:border-brand/30"
            >
              <p className="text-xs font-medium text-muted">{item.label}</p>
              <p
                className={cn(
                  "mt-1 text-2xl tabular-nums tracking-tight text-foreground",
                  featured ? instrumentSerif.className : "font-semibold"
                )}
              >
                {value}
              </p>
              <p className="mt-0.5 text-[11px] text-faint truncate">{item.hint}</p>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border/80 bg-surface-hover/30 px-4 py-2.5">
        <span className="text-[11px] font-medium uppercase tracking-wider text-faint w-full sm:w-auto">
          Also tracked
        </span>
        {SECONDARY.map((item) => (
          <div key={item.key} className="flex items-baseline gap-2 text-sm">
            <span className="text-muted">{item.label}</span>
            <span className="font-semibold tabular-nums text-foreground">{stats[item.key]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatsStrip({ stats }: StatsGridProps) {
  const items = [
    { label: "Discovered", value: stats.opportunitiesFound, icon: Compass },
    { label: "Eligible", value: stats.eligible, icon: ShieldCheck },
    { label: "Strong", value: stats.strongMatches, icon: Sparkles },
    { label: "Prepared", value: stats.applicationsPrepared, icon: FileCheck2 },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map(({ label, value, icon: Icon }) => (
        <div
          key={label}
          className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 shadow-sm"
        >
          <Icon className="size-4 text-brand shrink-0" />
          <div>
            <p className="text-lg font-semibold tabular-nums leading-none text-foreground">{value}</p>
            <p className="text-[11px] text-muted mt-0.5">{label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
