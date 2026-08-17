"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bookmark,
  BookmarkCheck,
  Compass,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { PageHeader, buttonPrimaryClassName, buttonSecondaryClassName, inputClassName } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { ProgressRail } from "@/components/role-analyzer/progress-rail";
import { CoachReport } from "@/components/role-analyzer/coach-report";
import {
  ROLE_EXAMPLES,
  analysisStepsFor,
  analysisFromPayload,
  broaderRoleHints,
  formatLongDate,
  type AnalysisResult,
  type MarketScope,
  type RoadmapPayload,
  type SavedRun,
} from "@/lib/role-analyzer-view";

const DURATION_PRESETS = [
  { id: "2", months: 2, label: "2 Months" },
  { id: "4", months: 4, label: "4 Months" },
  { id: "6", months: 6, label: "6 Months" },
  { id: "custom", months: null, label: "Custom" },
] as const;

export function RoleAnalyzerView() {
  const [role, setRole] = useState("AI Intern");
  const [market, setMarket] = useState<MarketScope>("ALL");
  const [durationId, setDurationId] = useState<"2" | "4" | "6" | "custom">("2");
  const [customMonths, setCustomMonths] = useState(5);
  const [busy, setBusy] = useState(false);
  const [roadmapBusy, setRoadmapBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<string | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [roadmap, setRoadmap] = useState<RoadmapPayload | null>(null);
  const [saved, setSaved] = useState(false);
  const [runs, setRuns] = useState<SavedRun[]>([]);
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  const durationMonths = durationId === "custom" ? customMonths : Number(durationId);

  const loadRuns = useCallback(() => {
    fetch("/api/role-analyzer/runs")
      .then((r) => r.json())
      .then((d) => setRuns(Array.isArray(d.runs) ? d.runs : []))
      .catch(() => {});
  }, []);

  const loadProgress = useCallback((id: string) => {
    fetch(`/api/role-analyzer/progress?analysisId=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d) => setCompleted(new Set(Array.isArray(d.completed) ? d.completed : [])))
      .catch(() => setCompleted(new Set()));
  }, []);

  const applyResult = useCallback((raw: Record<string, unknown>, id?: string) => {
    const parsed = analysisFromPayload(raw);
    if (!parsed) return;
    setAnalysis(parsed);
    if (parsed.roadmap) setRoadmap(parsed.roadmap);
    if (id) {
      setAnalysisId(id);
      loadProgress(id);
    }
  }, [loadProgress]);

  const poll = useCallback(async (id: string) => {
    for (let i = 0; i < 120; i++) {
      const res = await fetch(`/api/role-analyzer/status/${id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Status check failed");
      setMessage(data.message || analysisStepsFor(/intern/i.test(role) ? "internships" : "jobs")[0].label);
      setPhase(data.phase || null);
      setPercent(typeof data.progressPercent === "number" ? data.progressPercent : null);
      if (data.status === "COMPLETE") {
        const full = await fetch(`/api/role-analyzer/results/${id}`).then((r) => r.json());
        if (!full.ok) throw new Error(full.error || "Could not load results");
        applyResult(full.result, id);
        setPhase("done");
        setPercent(100);
        return;
      }
      if (data.status === "FAILED") throw new Error(data.error || data.message || "Analysis failed");
      await new Promise((r) => setTimeout(r, 850));
    }
    throw new Error("Analysis is still running. Use Retry in a minute, or reopen it from Saved analyses.");
  }, [applyResult]);

  const runAnalysis = async (opts: { refresh?: boolean } = {}) => {
    setBusy(true);
    setError("");
    setMessage(opts.refresh ? "Refreshing industry data…" : "Starting analysis…");
    setPhase("search");
    setPercent(8);
    try {
      const path = opts.refresh ? "/api/role-analyzer/roadmap" : "/api/role-analyzer/roadmap";
      const res = await fetch(durationId === "custom" ? "/api/role-analyzer/roadmap/custom" : path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          market,
          durationMonths,
          refresh: opts.refresh === true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not start analysis");
      if (data.roadmap && data.status === "COMPLETE") {
        applyResult({ ...(analysis || {}), roadmap: data.roadmap } as Record<string, unknown>, data.analysisId);
        return;
      }
      if (!data.id) throw new Error(data.error || "Could not start analysis");
      setAnalysisId(data.id);
      setSaved(false);
      await poll(data.id);
      loadRuns();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      setPhase(null);
    } finally {
      setBusy(false);
      setMessage("");
    }
  };

  const switchDuration = async (nextId: "2" | "4" | "6" | "custom", months?: number) => {
    setDurationId(nextId);
    const nextMonths = nextId === "custom" ? months ?? customMonths : Number(nextId);
    if (nextId === "custom") setCustomMonths(nextMonths);
    if (!analysisId || !analysis) return;
    setRoadmapBusy(true);
    setError("");
    try {
      const res = await fetch(nextId === "custom" ? "/api/role-analyzer/roadmap/custom" : "/api/role-analyzer/roadmap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisId, durationMonths: nextMonths }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not rebuild roadmap");
      if (data.roadmap) setRoadmap(data.roadmap);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not rebuild roadmap");
    } finally {
      setRoadmapBusy(false);
    }
  };

  const reopen = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/role-analyzer/results/${id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status !== "COMPLETE") throw new Error(data.error || "Could not reopen analysis");
      applyResult(data.result, id);
      setSaved(Boolean(runs.find((r) => r.id === id)?.saved));
      const parsed = analysisFromPayload(data.result);
      if (parsed?.rawRole || parsed?.role) setRole(parsed.rawRole || parsed.role);
      if (parsed?.roadmap?.durationMonths) {
        const m = parsed.roadmap.durationMonths;
        if (m === 2 || m === 4 || m === 6) setDurationId(String(m) as "2" | "4" | "6");
        else {
          setDurationId("custom");
          setCustomMonths(m);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not reopen analysis");
    } finally {
      setBusy(false);
    }
  };

  const saveAnalysis = async () => {
    if (!analysisId) return;
    const res = await fetch(`/api/role-analyzer/runs/${analysisId}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saved: !saved }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setSaved(data.saved !== false);
      loadRuns();
    } else setError(data.error || "Could not save analysis");
  };

  const toggleProgress = async (itemKey: string, next: boolean) => {
    if (!analysisId) return;
    setCompleted((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(itemKey);
      else copy.delete(itemKey);
      return copy;
    });
    const res = await fetch("/api/role-analyzer/progress", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analysisId, itemKey, completed: next }),
    });
    if (!res.ok) {
      setCompleted((prev) => {
        const copy = new Set(prev);
        if (next) copy.delete(itemKey);
        else copy.add(itemKey);
        return copy;
      });
    }
  };

  const openedRef = useRef(false);
  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (openedRef.current) return;
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) return;
    openedRef.current = true;
    void reopen(id);
  }, [reopen]);

  const postingCount = analysis?.metadata?.postingCount || 0;
  const emptyMarket = Boolean(analysis && postingCount === 0);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6">
      <PageHeader
        title="Career Role Analyzer"
        description="Type the job you want. We compare real listings to your profile and tell you exactly what to do next."
        badge="Start here"
        actions={
          analysisId ? (
            <button type="button" onClick={saveAnalysis} className={buttonSecondaryClassName} disabled={busy}>
              {saved ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
              {saved ? "Saved" : "Save this plan"}
            </button>
          ) : null
        }
      />

      {runs.length ? (
        <section className="space-y-2" aria-labelledby="saved-analyses">
          <h2 id="saved-analyses" className="text-sm font-semibold text-foreground">
            Your saved roles
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {runs.slice(0, 6).map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  onClick={() => reopen(run.id)}
                  className="w-full rounded-xl border border-border bg-surface px-3 py-3 text-left hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                >
                  <p className="text-sm font-medium">{run.role}</p>
                  <p className="text-xs text-muted">
                    {formatLongDate(run.completedAt || run.createdAt)}
                    {run.readiness != null ? ` · ${run.readiness}/100` : ""}
                    {run.saved ? " · saved" : ""}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-2xl border border-border bg-surface p-5 space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">What job do you want?</span>
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. AI Intern"
            className={inputClassName}
            disabled={busy}
            autoComplete="off"
          />
        </label>
        <p className="text-xs text-muted">Tap a suggestion, or type your own.</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Example roles">
          {ROLE_EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              disabled={busy}
              onClick={() => setRole(example)}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:bg-surface-hover hover:text-foreground"
            >
              {example}
            </button>
          ))}
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Where do you want to work?</span>
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value as MarketScope)}
            className={inputClassName}
            disabled={busy}
          >
            <option value="ALL">Pakistan and international</option>
            <option value="PAKISTAN">Pakistan</option>
            <option value="INTERNATIONAL">International</option>
          </select>
        </label>
        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted">How long can you prepare?</legend>
          <div className="flex flex-wrap gap-1.5">
            {DURATION_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                disabled={busy || roadmapBusy}
                onClick={() => {
                  if (analysis) void switchDuration(preset.id);
                  else setDurationId(preset.id);
                }}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium",
                  durationId === preset.id
                    ? "border-brand/40 bg-brand-soft text-brand-text"
                    : "border-border text-muted hover:bg-surface-hover"
                )}
                aria-pressed={durationId === preset.id}
              >
                {preset.label}
              </button>
            ))}
          </div>
          {durationId === "custom" ? (
            <label className="block max-w-xs space-y-1">
              <span className="text-xs text-muted">Number of months</span>
              <input
                type="number"
                min={1}
                max={18}
                value={customMonths}
                disabled={busy || roadmapBusy}
                className={inputClassName}
                onChange={(e) => {
                  const n = Math.min(18, Math.max(1, Number(e.target.value) || 1));
                  setCustomMonths(n);
                }}
                onBlur={() => {
                  if (analysis) void switchDuration("custom", customMonths);
                }}
              />
            </label>
          ) : null}
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy || !role.trim()} onClick={() => runAnalysis()} className={buttonPrimaryClassName}>
            <Compass className="size-4" />
            Analyze this role
          </button>
          <button
            type="button"
            disabled={busy || !role.trim()}
            onClick={() => runAnalysis({ refresh: true })}
            className={buttonSecondaryClassName}
          >
            <RefreshCw className={cn("size-4", busy && "animate-spin")} />
            Look for newer jobs
          </button>
        </div>
        {error ? (
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            <p>{error}</p>
            <button type="button" className="inline-flex items-center gap-1 font-medium underline" onClick={() => runAnalysis()}>
              <RotateCcw className="size-3.5" /> Retry
            </button>
          </div>
        ) : null}
      </section>


      {busy ? <ProgressRail phase={phase} percent={percent} message={message} searchType={analysis?.search_type || (/intern/i.test(role) ? "internships" : "jobs")} /> : null}

      {emptyMarket ? (
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold">Few or no matching {analysis?.role || role} ads were found.</h2>
          <p className="text-sm text-muted">
            The plan still uses established requirements for this role and your profile. Try a broader title if you want a thicker market sample.
          </p>
          <div className="flex flex-wrap gap-2">
            {broaderRoleHints(role, analysis?.searchedTitles).map((hint) => (
              <button
                key={hint}
                type="button"
                className="rounded-full border border-border px-3 py-1 text-xs hover:bg-surface-hover"
                onClick={() => setRole(hint)}
              >
                {hint}
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      {analysis && roadmap ? (
        <CoachReport
          analysis={analysis}
          roadmap={roadmap}
          completed={completed}
          onToggleWeek={toggleProgress}
          busy={!analysisId || busy}
          durationId={durationId}
          onDurationChange={(id) => void switchDuration(id)}
          roadmapBusy={roadmapBusy}
        />
      ) : null}
    </div>
  );
}
