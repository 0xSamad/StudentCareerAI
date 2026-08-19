"use client";

import { useState } from "react";
import { ListPlus, Send } from "lucide-react";
import { buttonPrimaryClassName, buttonSecondaryClassName } from "@/components/ui/page-header";
import type { Opportunity } from "@/app/api/opportunities/route";
import { addOpportunitiesToQueue } from "@/lib/queue-client";
import { startListingApplications } from "@/lib/opportunity-client";
import { closeApplyWatchWindow, finishApplyLaunch, openBlankApplyWatchWindow } from "@/lib/apply/open-watch-window";

export function AddToQueueToolbar({
  opportunities,
  selectedIds,
  onAdded,
}: {
  opportunities: Opportunity[];
  selectedIds: string[];
  onAdded?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const selected = opportunities.filter((o) => selectedIds.includes(o.id));

  const add = async (items: Opportunity[]) => {
    if (items.length === 0) {
      setMessage("Select listings with the checkboxes first.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const data = await addOpportunitiesToQueue(items, items.length);
      setMessage(data.message || `Added ${items.length} to Applications.`);
      onAdded?.();
    } catch (err: any) {
      setMessage(err.message || "Failed to add to Applications");
    } finally {
      setBusy(false);
    }
  };

  const applySelected = async () => {
    if (selected.length === 0) {
      setMessage("Select listings with the checkboxes first.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const watcher = openBlankApplyWatchWindow();
    try {
      const data = await startListingApplications(selected);
      const launched = finishApplyLaunch(data, watcher);
      if (!launched.ok) {
        setMessage(launched.error || "Could not open the application.");
      } else {
        setMessage(launched.message);
      }
      onAdded?.();
    } catch (err: any) {
      closeApplyWatchWindow(watcher);
      setMessage(err.message || "Failed to apply");
    } finally {
      setBusy(false);
    }
  };

  if (opportunities.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-muted">
        {selected.length
          ? `${selected.length} selected`
          : "Tick listings below, then add them to Applications."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || selected.length === 0}
          onClick={() => add(selected)}
          className={buttonPrimaryClassName}
        >
          <ListPlus className="size-3.5" />
          Add to Applications{selected.length ? ` (${selected.length})` : ""}
        </button>
        <button
          type="button"
          disabled={busy || selected.length === 0}
          onClick={applySelected}
          className={buttonSecondaryClassName}
        >
          <Send className="size-3.5" />
          Fill selected forms
        </button>
      </div>
      {message ? <p className="text-xs text-muted w-full">{message}</p> : null}
    </div>
  );
}
