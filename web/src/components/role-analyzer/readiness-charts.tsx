"use client";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

type Slice = { label: string; value: number; className: string; swatch: string };

function Donut({ slices, center, caption }: { slices: Slice[]; center: string; caption: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (!total) return null;
  let acc = 0;
  const stops = slices
    .filter((s) => s.value > 0)
    .map((s) => {
      const start = (acc / total) * 360;
      acc += s.value;
      const end = (acc / total) * 360;
      return `${s.swatch} ${start}deg ${end}deg`;
    });
  return (
    <Card className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Skill evidence</p>
      <div className="flex flex-wrap items-center gap-5">
        <div className="relative size-36 shrink-0">
          <div
            className="size-36 rounded-full"
            style={{ background: `conic-gradient(${stops.join(", ")})` }}
            aria-hidden
          />
          <div className="absolute inset-6 flex items-center justify-center rounded-full bg-surface text-center">
            <p className="text-sm font-semibold leading-tight text-foreground">{center}</p>
          </div>
        </div>
        <ul className="space-y-2 text-sm">
          {slices.map((s) => (
            <li key={s.label} className="flex items-center gap-2">
              <span className={cn("size-2.5 rounded-full", s.className)} aria-hidden />
              <span className="text-foreground">{s.label}</span>
              <span className="tabular-nums text-muted">{s.value}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-faint">{caption}</p>
    </Card>
  );
}

function Bars({
  title,
  rows,
  caption,
}: {
  title: string;
  rows: Array<{ label: string; percent: number | null; hint?: string }>;
  caption: string;
}) {
  const usable = rows.filter((r) => r.percent != null);
  if (!usable.length) return null;
  return (
    <Card className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      <div className="space-y-3">
        {usable.map((row) => (
          <div key={row.label}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="text-foreground">{row.label}</span>
              <span className="tabular-nums text-muted">{row.percent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-hover">
              <div
                className="h-2 rounded-full bg-brand"
                style={{ width: `${Math.max(0, Math.min(100, row.percent || 0))}%` }}
              />
            </div>
            {row.hint ? <p className="mt-0.5 text-[11px] text-faint">{row.hint}</p> : null}
          </div>
        ))}
      </div>
      <p className="text-xs text-faint">{caption}</p>
    </Card>
  );
}

function youLevel(status?: string | null) {
  const s = String(status || "").toUpperCase();
  if (s.includes("ALREADY")) return 100;
  if (s.includes("PARTIAL")) return 35;
  if (s.includes("MISSING")) return 0;
  return null;
}

export function ReadinessCharts({
  alreadyHave = [],
  partial = [],
  missing = [],
  breakdown = [],
  market = [],
}: {
  alreadyHave?: string[];
  partial?: string[];
  missing?: string[];
  breakdown?: Array<{ label: string; percent: number | null; note?: string }>;
  market?: Array<{ skill: string; demand?: number | null; marketPercent?: number | null; status?: string | null }>;
}) {
  const slices: Slice[] = [
    { label: "Already have", value: alreadyHave.length, className: "bg-emerald-600", swatch: "rgb(5 150 105)" },
    { label: "Partial", value: partial.length, className: "bg-amber-500", swatch: "rgb(217 119 6)" },
    { label: "Missing", value: missing.length, className: "bg-red-600", swatch: "rgb(220 38 38)" },
  ];
  const total = alreadyHave.length + partial.length + missing.length;
  const demandRows = market.slice(0, 8).map((row) => ({
    label: row.skill,
    percent: row.demand ?? row.marketPercent ?? null,
    hint: row.status ? `You: ${row.status}` : undefined,
    you: youLevel(row.status),
  }));

  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold">How this looks in numbers</h3>
      <p className="text-sm text-muted">Charts from your profile vs this role — not a hiring prediction.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Donut slices={slices} center={`${total} skills`} caption="Count of role skills by evidence on your profile and CV." />
        <Bars
          title="Readiness by area"
          rows={breakdown.map((r) => ({ label: r.label, percent: r.percent, hint: r.note }))}
          caption="Weighted into the score. Deployment and missing core skills keep the total honest."
        />
      </div>
      {demandRows.length ? (
        <Card className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Job-ad demand vs your evidence</p>
          <div className="space-y-3">
            {demandRows.map((row) => (
              <div key={row.label}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-foreground">{row.label}</span>
                  <span className="text-xs text-muted">{row.hint}</span>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-faint">Ads</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-hover">
                      <div className="h-2 rounded-full bg-brand/80" style={{ width: `${row.percent ?? 0}%` }} />
                    </div>
                    <span className="w-10 text-right text-xs tabular-nums text-muted">{row.percent ?? "—"}%</span>
                  </div>
                  {row.you != null ? (
                    <div className="flex items-center gap-2">
                      <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-faint">You</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-hover">
                        <div
                          className={cn(
                            "h-2 rounded-full",
                            row.you >= 80 ? "bg-emerald-600" : row.you >= 20 ? "bg-amber-500" : "bg-red-600",
                          )}
                          style={{ width: `${row.you}%` }}
                        />
                      </div>
                      <span className="w-10 text-right text-xs tabular-nums text-muted">{row.you}%</span>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-faint">
            Ads = share of analyzed postings that name the skill. You = 100% have / 35% partial / 0% missing. Partial is coursework or a mention — not intern-ready.
          </p>
        </Card>
      ) : null}
    </section>
  );
}
