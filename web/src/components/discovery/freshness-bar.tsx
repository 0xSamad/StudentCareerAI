"use client";

import { Clock } from "lucide-react";

export function FreshnessBar({
  lastUpdatedAgo,
  refreshAllowed,
  refreshMessage,
}: {
  lastUpdatedAgo?: string | null;
  refreshAllowed?: boolean;
  refreshMessage?: string | null;
}) {
  if (!lastUpdatedAgo && !refreshMessage) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      <span className="inline-flex items-center gap-1.5">
        <Clock className="size-3.5" />
        Last updated: {lastUpdatedAgo || "never"}
      </span>
      {refreshAllowed === false && refreshMessage ? (
        <span className="text-faint">{refreshMessage}</span>
      ) : null}
    </div>
  );
}
