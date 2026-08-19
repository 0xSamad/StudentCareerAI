"use client";

import { useState } from "react";
import { Link2, Loader2, Send } from "lucide-react";
import { startUrlApplications } from "@/lib/opportunity-client";
import { closeApplyWatchWindow, finishApplyLaunch, openBlankApplyWatchWindow } from "@/lib/apply/open-watch-window";
import { buttonPrimaryClassName, inputClassName } from "@/components/ui/page-header";
import { cn } from "@/lib/cn";

export function UrlApplyBar({
  className,
  onApplied,
  collapsed = false,
}: {
  className?: string;
  onApplied?: () => void;
  collapsed?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [jdText, setJdText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const run = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    const watcher = openBlankApplyWatchWindow();
    try {
      const data = await startUrlApplications([{ url, company, role, jdText }]);
      const launched = finishApplyLaunch(data, watcher);
      if (!launched.ok) {
        setError(launched.error || "Could not apply from that URL.");
      } else {
        setMessage(launched.message);
      }
      onApplied?.();
    } catch (err: unknown) {
      closeApplyWatchWindow(watcher);
      setError(err instanceof Error ? err.message : "Could not apply from that URL.");
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <>
      {!collapsed ? (
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">URL apply</p>
        <h2 className="mt-1 text-base font-semibold text-foreground">Paste any job or application link</h2>
        <p className="mt-1 text-xs text-muted">
          Does not need to be in Jobs. Chrome opens on this computer and fills attested fields. You still submit.
        </p>
      </div>
      ) : (
        <p className="text-xs text-muted">
          Chrome opens on this computer and fills attested CV fields. You still submit.
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative min-w-0 flex-1">
          <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && run()}
            placeholder="https://company.com/jobs/… or the Apply form URL"
            className={cn(inputClassName, "pl-9")}
            disabled={busy}
            autoComplete="off"
            aria-label="Job or application URL"
          />
        </label>
        <button type="button" disabled={busy || !url.trim()} onClick={run} className={buttonPrimaryClassName}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {busy ? "Filling…" : "Apply this URL"}
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Company (optional — guessed from the URL)"
          className={inputClassName}
          disabled={busy}
        />
        <input
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="Role title (optional)"
          className={inputClassName}
          disabled={busy}
        />
      </div>
      <textarea
        value={jdText}
        onChange={(e) => setJdText(e.target.value)}
        placeholder="Job description (optional — paste if the page cannot be read)"
        className={cn(inputClassName, "min-h-[88px] py-2")}
        disabled={busy}
        aria-label="Job description"
      />
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {message ? <p className="text-sm text-foreground">{message}</p> : null}
    </>
  );

  if (collapsed) {
    return (
      <details className={cn("rounded-2xl border border-border bg-surface", className)}>
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-foreground marker:content-none [&::-webkit-details-marker]:hidden">
          Apply a job URL that is not in this list
        </summary>
        <div className="space-y-3 border-t border-border px-4 pb-4 pt-3">{form}</div>
      </details>
    );
  }

  return (
    <section className={cn("rounded-2xl border border-border bg-surface p-4 sm:p-5 space-y-3", className)}>
      {form}
    </section>
  );
}
