"use client";

import { cn } from "@/lib/cn";

export type WorkplaceFilter = "ALL" | "remote" | "hybrid" | "on-site";
export type LocationFilter =
  | "ALL"
  | "PK_REMOTE"
  | "PAKISTAN"
  | "REMOTE"
  | "Karachi"
  | "Lahore"
  | "Islamabad"
  | "Peshawar";

const WORKPLACES: { id: WorkplaceFilter; label: string }[] = [
  { id: "ALL", label: "Any workplace" },
  { id: "remote", label: "Remote" },
  { id: "hybrid", label: "Hybrid" },
  { id: "on-site", label: "On-site" },
];

const LOCATIONS: { id: LocationFilter; label: string }[] = [
  { id: "PK_REMOTE", label: "Pakistan + Remote" },
  { id: "PAKISTAN", label: "Pakistan" },
  { id: "REMOTE", label: "Remote" },
  { id: "Karachi", label: "Karachi" },
  { id: "Lahore", label: "Lahore" },
  { id: "Islamabad", label: "Islamabad" },
  { id: "Peshawar", label: "Peshawar" },
  { id: "ALL", label: "Any (still PK/remote only)" },
];

export function ListingFilters({
  workplace,
  location,
  onWorkplaceChange,
  onLocationChange,
}: {
  workplace: WorkplaceFilter;
  location: LocationFilter;
  onWorkplaceChange: (value: WorkplaceFilter) => void;
  onLocationChange: (value: LocationFilter) => void;
}) {
  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex flex-wrap items-center gap-1.5">
        {WORKPLACES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onWorkplaceChange(item.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-[11px] font-semibold border transition-colors",
              workplace === item.id
                ? "border-brand/40 bg-brand/15 text-brand"
                : "border-border bg-surface text-muted hover:text-foreground"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {LOCATIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onLocationChange(item.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-[11px] font-semibold border transition-colors",
              location === item.id
                ? item.id === "PAKISTAN" || item.id === "PK_REMOTE"
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "border-brand/40 bg-brand/15 text-brand"
                : "border-border bg-surface text-muted hover:text-foreground"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
