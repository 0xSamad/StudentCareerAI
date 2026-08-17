"use client";

import { Activity, Clock, RefreshCw, ShieldAlert } from "lucide-react";

export type DiscoveryHealth = {
  lastDiscovery?: string | null;
  lastDiscoveryAt?: string | null;
  newOpportunities?: number;
  updated?: number;
  sourcesHealthy?: number;
  sourcesTotal?: number;
  sourcesRateLimited?: number;
};

export function DiscoveryHealthStrip({ health }: { health: DiscoveryHealth | null }) {
  if (!health) return null;
  const items = [
    {
      label: "Last discovery",
      value: health.lastDiscovery || "never",
      icon: Clock,
    },
    {
      label: "New opportunities",
      value: String(health.newOpportunities ?? 0),
      icon: Activity,
    },
    {
      label: "Updated",
      value: String(health.updated ?? 0),
      icon: RefreshCw,
    },
    {
      label: "Sources healthy",
      value: `${health.sourcesHealthy ?? 0}/${health.sourcesTotal ?? 0}`,
      icon: Activity,
    },
    {
      label: "Rate limited",
      value: String(health.sourcesRateLimited ?? 0),
      icon: ShieldAlert,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
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
  );
}
