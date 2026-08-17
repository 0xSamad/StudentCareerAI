"use client";

import Link from "next/link";
import { Settings2, MapPin, Briefcase, Shield, Clock, Zap } from "lucide-react";
import { cn } from "@/lib/cn";

interface ConfigSummaryCardProps {
  config: {
    applicationsPerDay: number;
    minScore: number;
    scanIntervalMinutes: number;
    locations: string[];
    remote: string;
    targetRoles: string[];
    autoSubmit: boolean;
    autonomousMode: boolean;
  };
}

function ConfigRow({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-3 border-b border-border last:border-0">
      <div className="flex items-center gap-2 text-sm text-muted min-w-0">
        <Icon className="size-4 shrink-0 text-faint" />
        <span>{label}</span>
      </div>
      <div
        className={cn(
          "text-sm font-medium text-foreground text-right shrink-0",
          highlight && "text-emerald-700 dark:text-emerald-300"
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function ConfigSummaryCard({ config }: ConfigSummaryCardProps) {
  return (
    <section className="rounded-xl border border-border bg-surface shadow-sm h-full flex flex-col">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Search configuration</h2>
          <p className="text-xs text-muted mt-0.5">Active targeting and safety limits</p>
        </div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-hover transition-colors"
        >
          <Settings2 className="size-3.5" />
          Edit
        </Link>
      </div>

      <div className="px-5 py-1 flex-1">
        <ConfigRow icon={Zap} label="Daily application limit" value={`${config.applicationsPerDay} per day`} />
        <ConfigRow icon={Shield} label="Minimum match score" value={`${config.minScore}%`} />
        <ConfigRow icon={Clock} label="Scan interval" value={`Every ${config.scanIntervalMinutes} min`} />
        <ConfigRow
          icon={Shield}
          label="Submission mode"
          value={config.autoSubmit ? "Unattended submit" : "Final review"}
          highlight={!config.autoSubmit}
        />
      </div>

      <div className="px-5 py-4 border-t border-border bg-surface-hover/20 space-y-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-faint mb-2 flex items-center gap-1.5">
            <Briefcase className="size-3" />
            Target roles
          </p>
          <div className="flex flex-wrap gap-1.5">
            {config.targetRoles.slice(0, 4).map((role) => (
              <span
                key={role}
                className="rounded-md border border-border bg-background px-2 py-0.5 text-xs text-foreground"
              >
                {role}
              </span>
            ))}
            {config.targetRoles.length > 4 && (
              <span className="text-xs text-muted px-1">+{config.targetRoles.length - 4}</span>
            )}
          </div>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-faint mb-2 flex items-center gap-1.5">
            <MapPin className="size-3" />
            Locations
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(config.locations.length ? config.locations : ["Remote"]).slice(0, 3).map((loc) => (
              <span
                key={loc}
                className="rounded-md border border-border bg-background px-2 py-0.5 text-xs text-foreground"
              >
                {loc}
              </span>
            ))}
            <span className="rounded-md border border-brand/20 bg-brand/5 px-2 py-0.5 text-xs font-medium text-brand-text">
              {config.remote}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
