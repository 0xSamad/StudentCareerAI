"use client";

import { useEffect, useState } from "react";
import {
  FileCheck,
  RefreshCw,
  Search,
  FileText,
  Pause,
  RotateCcw,
  Trash2,
  Play,
  CheckSquare,
  ExternalLink,
} from "lucide-react";
import { ApplicationDetailModal } from "@/components/dashboard/application-detail-modal";
import type { Opportunity } from "@/app/api/opportunities/route";
import { cn } from "@/lib/cn";
import { buttonPrimaryClassName, buttonSecondaryClassName } from "@/components/ui/page-header";
import { UrlApplyBar } from "@/components/apply/url-apply-bar";

type QueueItem = {
  id: string;
  opportunityId?: string;
  company: string;
  position: string;
  type: string;
  eligibility: string;
  matchScore: number | null;
  cvStatus: string;
  coverLetterStatus: string;
  applicationStatus: string;
  stageLabel?: string | null;
  location?: string | null;
  country?: string | null;
  workplace?: string | null;
  deadline?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  submitted_at?: string | null;
  skipReason?: string | null;
  lastMessage?: string | null;
  outcome?: string | null;
  pauseReason?: string | null;
};

type ApplyResultRow = {
  id?: string;
  company?: string;
  position?: string;
  title?: string;
  applicationStatus?: string;
  status?: string;
  outcome?: string;
  message?: string;
  skipReason?: string | null;
  submitted_at?: string | null;
  stageLabel?: string | null;
};

const LIVE_STATES = new Set([
  "ANALYZING",
  "CV_PREPARATION",
  "COVER_LETTER_PREPARATION",
  "APPLICATION_PREPARATION",
  "APPLYING",
]);

function statusClass(status: string) {
  if (status === "SUBMITTED") return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
  if (status === "FAILED") return "bg-red-500/10 text-red-600 border-red-500/20";
  if (status === "SKIPPED") return "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20";
  if (status === "REQUIRES_USER_INPUT" || status === "PAUSED") {
    return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20";
  }
  if (status === "READY" || status === "APPLICATION_READY") {
    return "bg-blue-500/10 text-blue-600 border-blue-500/20";
  }
  if (LIVE_STATES.has(status)) return "bg-brand/10 text-brand border-brand/20";
  return "bg-surface-hover text-foreground border-border";
}

function artifactLabel(status: string) {
  if (status === "ready") return "Ready";
  if (status === "tailored") return "Tailored";
  if (status === "reused") return "Reused";
  if (status === "preparing") return "Preparing";
  if (status === "skipped") return "Not needed";
  return "Pending";
}

function eligibilityLabel(value: string) {
  if (value === "ELIGIBLE") return "Eligible";
  if (value === "NOT_ELIGIBLE") return "Not eligible";
  if (value === "REQUIRES_REVIEW") return "Needs review";
  return value.replaceAll("_", " ") || "Pending";
}

function stageFor(app: QueueItem) {
  if (app.stageLabel) return app.stageLabel;
  if (app.submitted_at) return "Submitted ✓";
  const s = app.applicationStatus;
  if (s === "ANALYZING") return "Analyzing...";
  if (s === "CV_PREPARATION") return "Preparing CV...";
  if (s === "COVER_LETTER_PREPARATION") return "Preparing cover letter...";
  if (s === "APPLICATION_PREPARATION") return "Opening application...";
  if (s === "APPLYING") return "Filling application...";
  if (s === "REQUIRES_USER_INPUT" && /captcha|mfa/i.test(app.pauseReason || app.outcome || "")) {
    return "Waiting for verification...";
  }
  if (s === "READY" || s === "APPLICATION_READY") return "Ready to Apply";
  return s.replaceAll("_", " ");
}

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedApp, setSelectedApp] = useState<Opportunity | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [batchResults, setBatchResults] = useState<ApplyResultRow[] | null>(null);

  const fetchApplications = (silent = false) => {
    if (!silent) setLoading(true);
    return fetch("/api/applications")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          throw new Error(d.error || "Failed to load applications");
        }
        setLoadError(null);
        setApplications(d.applications || []);
      })
      .catch((err) => {
        console.error("Error fetching applications:", err);
        setLoadError(err?.message || "Failed to load applications");
      })
      .finally(() => {
        if (!silent) setLoading(false);
      });
  };

  useEffect(() => {
    fetchApplications();
  }, []);

  useEffect(() => {
    if (!busy) return undefined;
    const timer = setInterval(() => {
      fetchApplications(true);
    }, 1200);
    return () => clearInterval(timer);
  }, [busy]);

  const filtered = applications.filter((app) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      app.company?.toLowerCase().includes(q) ||
      app.position?.toLowerCase().includes(q) ||
      app.applicationStatus?.toLowerCase().includes(q)
    );
  });

  const toggle = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleAll = () => {
    if (selectedIds.length === filtered.length) setSelectedIds([]);
    else setSelectedIds(filtered.map((a) => a.id));
  };

  const toOpportunity = (app: QueueItem): Opportunity => ({
    id: app.id,
    company: app.company,
    role: app.position,
    type: app.type === "JOB" ? "JOB" : "INTERNSHIP",
    location: app.location || "Location unknown",
    matchScore: typeof app.matchScore === "number" ? app.matchScore : null,
    eligibility: (app.eligibility as Opportunity["eligibility"]) || "PENDING",
    source: app.source || "Queue",
    source_type: "QUEUE",
    source_name: app.source || "Queue",
    source_url: app.sourceUrl || null,
    source_id: app.opportunityId || app.id,
    discovered_at: null,
    is_demo: false,
    is_verified: false,
    postedDate: null,
    deadline: app.deadline || null,
    status: app.applicationStatus,
    url: app.sourceUrl || "",
    submitted_at: app.submitted_at || null,
    country: app.country || null,
    workplace: app.workplace || undefined,
  });

  const runApply = async (all: boolean) => {
    setBusy(true);
    setMessage(null);
    setBatchResults(null);
    try {
      const res = await fetch("/api/applications/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(all ? { all: true } : { ids: selectedIds }),
      });
      const data = await res.json();
      setMessage(data.message || data.error || "Apply finished.");
      setBatchResults(Array.isArray(data.results) ? data.results : []);
      await fetchApplications(true);
    } catch (err: any) {
      setMessage(err.message || "Apply failed");
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: string, action: "pause" | "retry" | "remove") => {
    setBusy(true);
    setMessage(null);
    try {
      const url =
        action === "remove"
          ? `/api/applications/${id}`
          : `/api/applications/${id}/${action}`;
      const res = await fetch(url, { method: action === "remove" ? "DELETE" : "POST" });
      const data = await res.json();
      if (!res.ok) setMessage(data.error || "Action failed");
      await fetchApplications(true);
    } catch (err: any) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeSelected = async () => {
    if (!selectedIds.length) return;
    setBusy(true);
    try {
      for (const id of selectedIds) {
        await fetch(`/api/applications/${id}`, { method: "DELETE" });
      }
      setSelectedIds([]);
      await fetchApplications(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8 space-y-8 max-sm:pb-24">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-brand/10 text-brand px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider">
              Application Queue
            </span>
            <span className="rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-xs font-semibold">
              {selectedIds.length} selected
            </span>
            <span className="text-xs text-muted">{applications.length} in queue</span>
          </div>
          <h1 className="text-3xl font-bold text-foreground mt-2 tracking-tight flex items-center gap-2.5">
            <FileCheck className="size-8 text-brand" />
            Application queue
          </h1>
          <p className="text-sm text-muted mt-1 max-w-2xl">
            Ready to Apply means the package is prepared and the form was filled in a visible browser window — it is not submitted.
            Open the listing to verify, then retry a real posting (not a careers-hub page). Submit yourself on the employer site unless AUTO_APPLY is on.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => fetchApplications()} className={buttonSecondaryClassName}>
            <RefreshCw className="size-3.5" />
            Refresh
          </button>
          <button
            disabled={busy || selectedIds.length === 0}
            onClick={() => runApply(false)}
            className={buttonSecondaryClassName}
          >
            <CheckSquare className="size-3.5" />
            Apply to Selected
          </button>
          <button
            disabled={busy || selectedIds.length === 0}
            onClick={removeSelected}
            className={buttonSecondaryClassName}
          >
            <Trash2 className="size-3.5" />
            Remove
          </button>
          <button
            disabled={busy || applications.length === 0}
            onClick={() => runApply(true)}
            className={buttonPrimaryClassName}
          >
            <Play className="size-3.5" />
            Apply All
          </button>
        </div>
      </div>

      <UrlApplyBar onApplied={() => fetchApplications(true)} />

      {loadError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-700 dark:text-red-300">
          {loadError}
        </div>
      )}

      {message && (
        <div className="rounded-xl border border-border bg-surface px-4 py-3 text-xs text-foreground">{message}</div>
      )}

      {batchResults && batchResults.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-4 space-y-2">
          <h2 className="text-sm font-bold text-foreground">This run</h2>
          <ol className="space-y-1.5 text-xs">
            {batchResults.map((row, idx) => (
              <li key={row.id || `${row.company}-${idx}`} className="flex flex-wrap items-baseline gap-2">
                <span className="font-semibold text-foreground">
                  {idx + 1}. {row.company || "Unknown company"}
                </span>
                <span className="text-muted">{row.position || row.title || ""}</span>
                <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", statusClass(row.applicationStatus || row.status || ""))}>
                  {row.stageLabel || row.outcome || (row.applicationStatus || row.status || "").replaceAll("_", " ")}
                </span>
                {row.message && row.outcome !== row.message && (
                  <span className="text-muted">{row.message}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-faint" />
        <input
          type="text"
          placeholder="Filter by company, position, or status..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-xl border border-border bg-surface pl-9 pr-4 py-2.5 text-xs text-foreground placeholder:text-muted focus:border-brand focus:outline-hidden"
        />
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted">
          <div className="size-8 animate-spin rounded-full border-2 border-brand border-t-transparent mb-3" />
          <p className="text-xs">Loading your application queue...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-12 text-center space-y-3">
          <FileCheck className="size-10 text-faint mx-auto" />
          <h3 className="font-bold text-base text-foreground">{loadError ? "Could not load queue" : "Queue is empty"}</h3>
          <p className="text-xs text-muted max-w-md mx-auto">
            {loadError
              ? loadError
              : "Discover internships or jobs, then Add to Applications — or paste any job URL above. Chrome fills attested fields; you still submit."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="flex items-center gap-2 px-1 text-xs text-muted">
            <input
              type="checkbox"
              checked={selectedIds.length === filtered.length && filtered.length > 0}
              onChange={toggleAll}
              className="size-4 accent-brand"
            />
            Select all
          </label>
          {filtered.map((app) => {
            const live = LIVE_STATES.has(app.applicationStatus);
            return (
              <article
                key={app.id}
                className={cn(
                  "rounded-2xl border bg-surface p-5 shadow-xs",
                  selectedIds.includes(app.id) ? "border-brand/40" : "border-border"
                )}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(app.id)}
                    onChange={() => toggle(app.id)}
                    className="mt-1 size-4 accent-brand"
                    aria-label={`Select ${app.company}`}
                  />
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h2 className="text-base font-bold text-foreground">{app.company}</h2>
                        <p className="text-sm text-muted">{app.position}</p>
                      </div>
                      <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", statusClass(app.applicationStatus))}>
                        {stageFor(app)}
                      </span>
                    </div>
                    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs">
                      <div>
                        <dt className="text-muted">Eligibility</dt>
                        <dd className="font-semibold text-foreground">{eligibilityLabel(app.eligibility)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">Match</dt>
                        <dd className="font-semibold text-brand">
                          {typeof app.matchScore === "number" ? `${app.matchScore}%` : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted">CV</dt>
                        <dd className="font-semibold text-foreground">{artifactLabel(app.cvStatus)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">Cover Letter</dt>
                        <dd className="font-semibold text-foreground">{artifactLabel(app.coverLetterStatus)}</dd>
                      </div>
                    </dl>
                    {live && (
                      <p className="text-xs font-medium text-brand animate-pulse">{stageFor(app)}</p>
                    )}
                    {(app.outcome || app.lastMessage) && !live && (
                      <p className="text-xs text-muted">{app.outcome || app.lastMessage}</p>
                    )}
                    <div className="flex justify-end gap-1">
                      {app.sourceUrl && (
                        <a
                          href={app.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open application page"
                          className="rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-foreground"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      )}
                      <button title="View details" onClick={() => setSelectedApp(toOpportunity(app))} className="rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-foreground">
                        <FileText className="size-3.5" />
                      </button>
                      <button title="Pause" disabled={busy} onClick={() => act(app.id, "pause")} className="rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-foreground">
                        <Pause className="size-3.5" />
                      </button>
                      <button title="Retry" disabled={busy} onClick={() => act(app.id, "retry")} className="rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-foreground">
                        <RotateCcw className="size-3.5" />
                      </button>
                      <button title="Remove" disabled={busy} onClick={() => act(app.id, "remove")} className="rounded-md p-1.5 text-muted hover:bg-red-500/10 hover:text-red-600">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <ApplicationDetailModal opportunity={selectedApp} onClose={() => setSelectedApp(null)} />
    </div>
  );
}
