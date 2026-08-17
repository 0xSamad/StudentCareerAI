"use client";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

export function MetricHint({
  label,
  value,
  suffix,
  hint,
  featured,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  hint: string;
  featured?: boolean;
}) {
  return (
    <Card elevated={featured} className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
        <span className="group relative inline-flex">
          <button
            type="button"
            className="rounded-full border border-border px-1.5 text-[10px] text-faint hover:border-brand/40 hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            aria-label={`What ${label} means`}
          >
            i
          </button>
          <span
            role="tooltip"
            className="pointer-events-none absolute left-0 top-6 z-20 w-64 rounded-lg border border-border bg-surface px-3 py-2 text-[11px] font-normal normal-case tracking-normal text-muted opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          >
            {hint}
          </span>
        </span>
      </p>
      <p className="text-4xl tabular-nums leading-none text-foreground">
        {value}
        {suffix ? <span className="text-lg text-muted">{suffix}</span> : null}
      </p>
    </Card>
  );
}

export function DemandBars({
  rows,
}: {
  rows: Array<{ skill: string; percent: number; count?: number; total?: number }>;
}) {
  if (!rows.length) return null;
  return (
    <Card className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Market demand</h3>
        <p className="mt-1 text-sm text-muted">Share of analyzed postings that name each skill. Not a forecast.</p>
      </div>
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.skill}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-foreground">{row.skill}</span>
              <span className="shrink-0 tabular-nums text-muted">
                {row.percent}%
                {row.total ? ` (${row.count}/${row.total})` : ""}
              </span>
            </div>
            <div
              className="h-2.5 overflow-hidden rounded-full bg-surface-hover"
              role="img"
              aria-label={`${row.skill} ${row.percent}% (${row.count || 0} of ${row.total || 0} postings)`}
            >
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-500"
                style={{ width: `${Math.max(2, Math.min(100, row.percent))}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function YouVsMarket({
  rows,
}: {
  rows: Array<{
    skill: string;
    marketPercent?: number | null;
    marketCount?: number;
    marketTotal?: number;
    youPercent?: number;
    youLabel?: string;
  }>;
}) {
  if (!rows.length) return null;
  return (
    <Card className="space-y-4 overflow-x-auto">
      <div>
        <h3 className="text-lg font-semibold">Your skills vs market</h3>
        <p className="mt-1 text-sm text-muted">
          Market = % of analyzed postings. You = evidence strength on your profile (100 have / ~35 partial / 0 missing). Not a hiring prediction.
        </p>
      </div>
      <table className="w-full min-w-[28rem] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="pb-2 font-medium">Skill</th>
            <th className="pb-2 font-medium">Market</th>
            <th className="pb-2 font-medium">You</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.skill} className="border-t border-border">
              <td className="py-2.5 font-medium">{row.skill}</td>
              <td className="py-2.5 tabular-nums text-muted">
                {row.marketPercent == null
                  ? "Role baseline"
                  : `${row.marketPercent}%${row.marketTotal ? ` (${row.marketCount}/${row.marketTotal})` : ""}`}
              </td>
              <td className="py-2.5">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-hover">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        (row.youPercent || 0) >= 70 ? "bg-emerald-600" : (row.youPercent || 0) >= 25 ? "bg-amber-500" : "bg-red-600",
                      )}
                      style={{ width: `${row.youPercent || 0}%` }}
                    />
                  </div>
                  <span className="tabular-nums text-muted">{row.youPercent}%</span>
                </div>
                <p className="text-[11px] text-faint">{row.youLabel}</p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function MarketSplitTable({
  comparison,
}: {
  comparison: {
    ok: boolean;
    message?: string | null;
    rows?: Array<{ skill: string; pakistanPercent?: number | null; internationalPercent?: number | null }>;
  };
}) {
  if (!comparison.ok) {
    return (
      <Card>
        <h3 className="text-lg font-semibold">Pakistan vs international</h3>
        <p className="mt-2 text-sm text-muted">{comparison.message || "Insufficient data for a reliable comparison."}</p>
      </Card>
    );
  }
  return (
    <Card className="space-y-4 overflow-x-auto">
      <h3 className="text-lg font-semibold">Pakistan vs international</h3>
      <p className="text-sm text-muted">Each column uses only that market’s analyzed postings. Never mixed.</p>
      <table className="w-full min-w-[28rem] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="pb-2 font-medium">Skill</th>
            <th className="pb-2 font-medium">Pakistan</th>
            <th className="pb-2 font-medium">International</th>
          </tr>
        </thead>
        <tbody>
          {(comparison.rows || []).map((row) => (
            <tr key={row.skill} className="border-t border-border">
              <td className="py-2.5 font-medium">{row.skill}</td>
              <td className="py-2.5 tabular-nums text-muted">{row.pakistanPercent == null ? "—" : `${row.pakistanPercent}%`}</td>
              <td className="py-2.5 tabular-nums text-muted">
                {row.internationalPercent == null ? "—" : `${row.internationalPercent}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function ReadinessRadar({
  dimensions,
}: {
  dimensions: Array<{ label: string; percent: number }>;
}) {
  const dims = dimensions.filter((d) => d.percent != null).slice(0, 8);
  if (dims.length < 3) {
    return (
      <Card className="space-y-3">
        <h3 className="text-lg font-semibold">Readiness breakdown</h3>
        <ul className="space-y-2">
          {dims.map((d) => (
            <li key={d.label} className="flex items-center justify-between text-sm">
              <span>{d.label}</span>
              <span className="tabular-nums">{d.percent}</span>
            </li>
          ))}
        </ul>
      </Card>
    );
  }
  const cx = 160;
  const cy = 160;
  const r = 112;
  const n = dims.length;
  const pt = (i: number, pct: number) => {
    const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const rad = (Math.max(0, Math.min(100, pct)) / 100) * r;
    return [cx + Math.cos(angle) * rad, cy + Math.sin(angle) * rad];
  };
  const grid = [25, 50, 75, 100];
  const poly = dims.map((d, i) => pt(i, d.percent).join(",")).join(" ");
  return (
    <Card className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Readiness breakdown</h3>
        <p className="mt-1 text-sm text-muted">Evidence coverage by area for this role. 100 = strong attested evidence, not a job offer.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[20rem_1fr] lg:items-center">
        <svg viewBox="0 0 320 320" className="mx-auto w-full max-w-[20rem]" role="img" aria-label="Readiness radar">
          {grid.map((g) => (
            <polygon
              key={g}
              fill="none"
              className="stroke-border"
              strokeWidth="1"
              points={dims.map((_, i) => pt(i, g).join(",")).join(" ")}
            />
          ))}
          {dims.map((d, i) => {
            const [x, y] = pt(i, 100);
            return <line key={d.label} x1={cx} y1={cy} x2={x} y2={y} className="stroke-border" strokeWidth="1" />;
          })}
          <polygon points={poly} className="fill-brand/20 stroke-brand" strokeWidth="2" />
          {dims.map((d, i) => {
            const [x, y] = pt(i, 118);
            return (
              <text key={d.label} x={x} y={y} textAnchor="middle" className="fill-muted" fontSize="10">
                {d.label.length > 16 ? `${d.label.slice(0, 14)}…` : d.label}
              </text>
            );
          })}
        </svg>
        <ul className="space-y-2 text-sm">
          {dims.map((d) => (
            <li key={d.label} className="flex items-center justify-between gap-3">
              <span className="text-foreground">{d.label}</span>
              <span className="tabular-nums text-muted">{d.percent}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
