"use client";

import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import {
  demandCounts,
  demandPercent,
  matchesCategory,
  type SkillRow,
} from "@/lib/role-analyzer-view";

export function DemandChart({
  rows,
  market,
  category,
  onSelect,
}: {
  rows: SkillRow[];
  market: "all" | "pakistan" | "international";
  category: string;
  onSelect: (skill: SkillRow) => void;
}) {
  const filtered = rows.filter((row) => matchesCategory(row, category) && demandPercent(row) != null);
  if (!filtered.length) {
    return <p className="text-sm text-muted">No measured frequencies for this filter. Percentages are only shown when they were calculated from analyzed postings.</p>;
  }

  return (
    <div>
      <ul className="space-y-3" aria-label="Skill frequency from analyzed postings">
        {filtered.slice(0, 16).map((row) => {
          const percent = demandPercent(row);
          if (percent == null) return null;
          const { count, total } = demandCounts(row);
          return (
            <li key={`${market}-${row.skill}`}>
              <button
                type="button"
                onClick={() => onSelect(row)}
                className="group w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              >
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium text-foreground group-hover:text-brand-text">{row.skill}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    {percent}%
                    {total ? ` · ${count}/${total} jobs` : ""}
                  </span>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-surface-hover"
                  role="img"
                  aria-label={`${row.skill} appears in ${percent} percent of analyzed jobs (${count} of ${total})`}
                >
                  <div
                    className={cn("h-full rounded-full bg-brand/80", percent >= 60 && "bg-brand")}
                    style={{ width: `${Math.min(100, percent)}%` }}
                  />
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <table className="sr-only">
        <caption>Skill demand ({market})</caption>
        <thead>
          <tr>
            <th>Skill</th>
            <th>Percent</th>
            <th>Postings</th>
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, 16).map((row) => {
            const percent = demandPercent(row);
            const { count, total } = demandCounts(row);
            return (
              <tr key={`t-${row.skill}`}>
                <td>{row.skill}</td>
                <td>{percent}%</td>
                <td>
                  {count}/{total}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function FilterPills({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (id: string) => void;
  options: Array<{ id: string; label: string }>;
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition",
            value === opt.id
              ? "border-brand/40 bg-brand-soft text-brand-text"
              : "border-border text-muted hover:bg-surface-hover hover:text-foreground"
          )}
          aria-pressed={value === opt.id}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function PriorityBadge({ value }: { value?: string }) {
  const v = (value || "").toUpperCase();
  const tone = v === "CRITICAL" ? "bad" : v === "HIGH" ? "warn" : v === "MAINTAIN" ? "good" : "muted";
  const label =
    v === "CRITICAL"
      ? "Must learn"
      : v === "HIGH"
        ? "Important"
        : v === "MEDIUM"
          ? "Later"
          : v === "LOW"
            ? "Optional"
            : v === "MAINTAIN"
              ? "Keep sharp"
              : v || "—";
  return <Badge tone={tone}>{label}</Badge>;
}
