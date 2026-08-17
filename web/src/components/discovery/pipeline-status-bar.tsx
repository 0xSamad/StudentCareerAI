"use client";

import { Bookmark, Clock, FileCheck, Sparkles, Zap } from "lucide-react";
import { buttonPrimaryClassName } from "@/components/ui/page-header";
import { cn } from "@/lib/cn";

export type SourceWarning = { sourceId?: string; message: string };

export function PipelineStatusBar({
  lastUpdatedAgo,
  newSinceLastVisit = 0,
  savedCount = 0,
  applicationsCount = 0,
  refreshAllowed = true,
  refreshMessage = null,
  sourceWarnings = [],
  scanning = false,
  onRefresh,
}: {
  lastUpdatedAgo?: string | null;
  newSinceLastVisit?: number;
  savedCount?: number;
  applicationsCount?: number;
  refreshAllowed?: boolean;
  refreshMessage?: string | null;
  sourceWarnings?: SourceWarning[];
  scanning?: boolean;
  onRefresh?: () => void;
}) {
  const items = [
    { label: "Last updated", value: lastUpdatedAgo || "never", icon: Clock },
    { label: "New since last visit", value: String(newSinceLastVisit), icon: Sparkles },
    { label: "Saved", value: String(savedCount), icon: Bookmark },
    { label: "Applications", value: String(applicationsCount), icon: FileCheck },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {items.map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 shadow-sm"
          >
            <Icon className="size-4 text-brand shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold tabular-nums leading-none text-foreground truncate">{value}</p>
              <p className="text-[11px] text-muted mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
        {onRefresh ? (
          <button type="button" onClick={onRefresh} disabled={scanning} className={buttonPrimaryClassName}>
            <Zap className={cn("size-4", scanning && "animate-pulse")} />
            {scanning ? "Refreshing…" : "Refresh Opportunities"}
          </button>
        ) : null}
        <p className="text-xs text-muted">
          Refresh checks configured sources for new or updated opportunities. Opening this page never re-downloads the full catalogue.
        </p>
      </div>

      {refreshAllowed === false && refreshMessage ? (
        <p className="text-xs text-faint">{refreshMessage}</p>
      ) : null}

      {sourceWarnings.map((w) => (
        <p
          key={w.sourceId || w.message}
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
          role="status"
        >
          {w.message}
        </p>
      ))}
    </div>
  );
}
