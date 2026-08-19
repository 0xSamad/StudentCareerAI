"use client";

import { useState } from "react";
import { Send, Lock, Loader2 } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { startUrlApplications } from "@/lib/opportunity-client";
import { closeApplyWatchWindow, finishApplyLaunch, openBlankApplyWatchWindow } from "@/lib/apply/open-watch-window";

// The "Apply" CTA — brand orange, paper-plane. Enabled ONLY when the tailored CV
// for THIS offer is ready (the tracker's PDF column is ✅, or a pdf worker for
// this #n just finished). On click it opens a live application window (where the
// user reviews and submits it themselves — never auto-submit).
export function ApplyButton({ n, url, company, pdfReady }: { n: string; url?: string; company: string; pdfReady: boolean }) {
  const { jobs } = useJobs();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pdfJobDone = jobs.some((j) => j.kind === "pdf" && j.input === n && j.status === "done");
  const hasUrl = !!url && /^https?:\/\//i.test(url);
  const ready = (pdfReady || pdfJobDone) && hasUrl;

  if (!ready) {
    return (
      <button
        type="button"
        disabled
        title={!hasUrl ? "No application URL on this report" : "Generate the tailored CV (PDF) first to apply"}
        className="inline-flex cursor-not-allowed items-center justify-center gap-1.5 rounded-full border border-border bg-surface/40 px-3.5 py-1 text-xs font-medium text-faint max-sm:min-h-[44px]"
      >
        <Lock className="size-3.5" /> Apply
      </button>
    );
  }
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          const watcher = openBlankApplyWatchWindow();
          try {
            const data = await startUrlApplications([{ url: url!, company }]);
            const launched = finishApplyLaunch(data, watcher);
            if (!launched.ok) setError(launched.error || "Could not apply.");
          } catch (err: unknown) {
            closeApplyWatchWindow(watcher);
            setError(err instanceof Error ? err.message : "Could not apply.");
          } finally {
            setBusy(false);
          }
        }}
        className="inline-flex items-center justify-center gap-1.5 rounded-full bg-brand px-3.5 py-1 text-xs font-medium text-brand-foreground shadow-sm transition-colors hover:bg-brand-200 disabled:opacity-60 max-sm:min-h-[44px]"
        title="Apply — fills the form in Chrome on this computer. You review and submit yourself."
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
        Apply
      </button>
      {error ? <span className="max-w-[220px] text-right text-[10px] font-medium text-red-600 dark:text-red-400">{error}</span> : null}
    </span>
  );
}
