"use client";

import { useEffect, useState } from "react";
import {
  MapPin,
  Calendar,
  Clock,
  Sparkles,
  ShieldCheck,
  AlertCircle,
  FileText,
  CheckCircle2,
  XCircle,
  Briefcase,
  GraduationCap,
  Globe2,
  Bookmark,
  BookmarkCheck,
  Send,
} from "lucide-react";
import type { Opportunity } from "@/app/api/opportunities/route";
import { addOpportunitiesToQueue } from "@/lib/queue-client";
import { enqueueAndApply, saveOpportunity, unsaveOpportunity } from "@/lib/opportunity-client";
import { cn } from "@/lib/cn";

interface OpportunityCardProps {
  opportunity: Opportunity;
  onViewDetails: (opp: Opportunity) => void;
  onAddToQueue?: (opp: Opportunity) => void | Promise<void>;
  onApply?: (opp: Opportunity) => void | Promise<void>;
  onSavedChange?: (opp: Opportunity, saved: boolean) => void;
  selected?: boolean;
  onToggleSelect?: (opp: Opportunity) => void;
  queued?: boolean;
}

function eligibilityLabel(eligibility: string) {
  switch (eligibility) {
    case "ELIGIBLE":
      return "Eligible for you";
    case "REQUIRES_REVIEW":
      return "Needs a quick review";
    case "NOT_ELIGIBLE":
      return "Likely not eligible";
    default:
      return null;
  }
}

function listingBadge(status?: string) {
  const s = String(status || "ACTIVE").toUpperCase();
  if (s === "CLOSED" || s === "REMOVED") {
    return { label: "CLOSED", className: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/30" };
  }
  if (s === "EXPIRED") {
    return { label: "EXPIRED", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30" };
  }
  return { label: "ACTIVE", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" };
}

export function OpportunityCard({
  opportunity,
  onViewDetails,
  onAddToQueue,
  onApply,
  onSavedChange,
  selected = false,
  onToggleSelect,
  queued = false,
}: OpportunityCardProps) {
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(queued || false);
  const [addError, setAddError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(Boolean(opportunity.saved));
  const [applying, setApplying] = useState(false);
  const [appliedMsg, setAppliedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (queued) setAdded(true);
  }, [queued]);

  useEffect(() => {
    setSaved(Boolean(opportunity.saved));
  }, [opportunity.saved, opportunity.id]);

  const isInternship = opportunity.type === "INTERNSHIP";
  const score = opportunity.matchScore;
  const hasScore = typeof score === "number";
  const listing = listingBadge(opportunity.listingStatus || opportunity.status);
  const closed = listing.label === "CLOSED" || listing.label === "EXPIRED";

  const scoreColor = !hasScore
    ? "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/20"
    : score >= 90
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
      : score >= 80
        ? "bg-brand/10 text-brand border-brand/20"
        : score >= 70
          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
          : "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/20";

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (saving) return;
    setSaving(true);
    setAddError(null);
    try {
      if (saved) {
        await unsaveOpportunity(opportunity.id);
        setSaved(false);
        onSavedChange?.(opportunity, false);
      } else {
        await saveOpportunity(opportunity.id);
        setSaved(true);
        onSavedChange?.(opportunity, true);
      }
    } catch (err: any) {
      setAddError(err?.message || "Could not update saved state.");
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (added || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      if (onAddToQueue) {
        await onAddToQueue(opportunity);
      } else {
        await addOpportunitiesToQueue([opportunity], 1);
      }
      setAdded(true);
    } catch (err: any) {
      setAddError(err?.message || "Could not add to applications.");
    } finally {
      setAdding(false);
    }
  };

  const handleApply = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (applying || closed) return;
    setApplying(true);
    setAddError(null);
    setAppliedMsg(null);
    try {
      if (onApply) {
        await onApply(opportunity);
      } else {
        const data = await enqueueAndApply([opportunity]);
        const msg =
          data.message ||
          "Chrome should be open on the application form. Nothing was submitted.";
        setAppliedMsg(msg);
        const jobKey = data.jobId || data.job || data.files?.job_id || "";
        const review =
          data.reviewPath ||
          `/apply/review?company=${encodeURIComponent(opportunity.company || "")}&role=${encodeURIComponent(opportunity.role || "")}${jobKey ? `&job=${encodeURIComponent(jobKey)}` : ""}`;
        window.open(review, "_blank", "noopener");
        window.alert(msg);
      }
      setAdded(true);
    } catch (err: any) {
      setAddError(err?.message || "Could not apply.");
    } finally {
      setApplying(false);
    }
  };

  const eligibility = eligibilityLabel(opportunity.eligibility);
  const showListingStatus = listing.label !== "ACTIVE";
  const workplace = String(opportunity.workplace || "on-site").replace(/-/g, " ");
  const locationBits = [opportunity.location, opportunity.country].filter(Boolean);
  const uniqueLocation = [...new Set(locationBits.map((part) => String(part).trim()).filter(Boolean))].join(" · ");

  return (
    <div
      onClick={() => onViewDetails(opportunity)}
      className={cn(
        "group relative flex flex-col justify-between rounded-xl border bg-surface p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md cursor-pointer",
        selected ? "border-brand ring-1 ring-brand/30" : "border-border"
      )}
    >
      <div>
        <div className="flex items-start gap-3">
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={selected}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                e.stopPropagation();
                onToggleSelect(opportunity);
              }}
              className="mt-1 size-4 rounded border-border accent-brand shrink-0"
              aria-label={`Select ${opportunity.company} ${opportunity.role}`}
            />
          )}
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-hover/80 text-foreground text-sm font-bold shadow-xs">
            {opportunity.company.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold leading-snug text-foreground break-words text-pretty group-hover:text-brand transition-colors">
              {opportunity.role}
            </h3>
            <p className="mt-1 text-sm text-muted">{opportunity.company}</p>
          </div>
          {hasScore && (
            <div className={cn("flex flex-col items-end rounded-lg border px-2.5 py-1 text-right shrink-0", scoreColor)}>
              <div className="flex items-center gap-1 font-bold text-sm">
                <Sparkles className="size-3.5" />
                <span>{score}%</span>
              </div>
              <span className="text-[9px] uppercase font-bold tracking-wider opacity-85">Match</span>
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium border",
              isInternship
                ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                : "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"
            )}
          >
            {isInternship ? <GraduationCap className="size-3.5" /> : <Briefcase className="size-3.5" />}
            {isInternship ? "Internship" : "Job"}
          </span>

          {uniqueLocation && (
            <span className="inline-flex items-center gap-1 min-w-0">
              <MapPin className="size-3.5 shrink-0 text-faint" />
              <span className="break-words">{uniqueLocation}</span>
            </span>
          )}

          <span className="capitalize">{workplace}</span>

          {opportunity.market === "NATIONAL" && <span>National</span>}
          {opportunity.market === "INTERNATIONAL" && (
            <span className="inline-flex items-center gap-1">
              <Globe2 className="size-3.5 text-faint" />
              International
            </span>
          )}

          {showListingStatus && (
            <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide border", listing.className)}>
              {listing.label}
            </span>
          )}
        </div>

        {eligibility && (
          <p
            className={cn(
              "mt-2 inline-flex items-center gap-1 text-xs font-medium",
              opportunity.eligibility === "ELIGIBLE"
                ? "text-emerald-600 dark:text-emerald-400"
                : opportunity.eligibility === "NOT_ELIGIBLE"
                  ? "text-red-600 dark:text-red-400"
                  : "text-amber-600 dark:text-amber-400"
            )}
          >
            {opportunity.eligibility === "ELIGIBLE" ? (
              <ShieldCheck className="size-3.5" />
            ) : opportunity.eligibility === "NOT_ELIGIBLE" ? (
              <XCircle className="size-3.5" />
            ) : (
              <AlertCircle className="size-3.5" />
            )}
            {eligibility}
          </p>
        )}

        {opportunity.description && (
          <p className="mt-3 text-sm text-muted line-clamp-3 leading-relaxed">{opportunity.description}</p>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-border flex flex-col gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-faint text-[11px] min-w-0">
          {opportunity.postedDate && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="size-3" />
              {String(opportunity.postedDate).slice(0, 10)}
            </span>
          )}
          {opportunity.deadline && (
            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <Clock className="size-3" />
              Due {String(opportunity.deadline).slice(0, 10)}
            </span>
          )}
          {(opportunity.source_name || opportunity.source) && (
            opportunity.source_url ? (
              <a
                href={opportunity.source_url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="hover:text-brand underline-offset-2 hover:underline truncate max-w-[160px]"
              >
                {opportunity.source_name || opportunity.source}
              </a>
            ) : (
              <span className="truncate max-w-[160px]">{opportunity.source_name || opportunity.source}</span>
            )
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            title={saved ? "Saved — stays here even if the source listing disappears" : "Save this opportunity"}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors border",
              saved
                ? "border-brand/30 bg-brand/10 text-brand"
                : "border-transparent text-muted hover:bg-surface-hover hover:text-foreground hover:border-border"
            )}
          >
            {saved ? <BookmarkCheck className="size-3.5" /> : <Bookmark className="size-3.5" />}
            {saved ? "Saved" : "Save"}
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewDetails(opportunity);
            }}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-muted hover:bg-surface-hover hover:text-foreground transition-colors border border-transparent hover:border-border"
          >
            <FileText className="size-3.5" />
            View
          </button>

          <button
            onClick={handleAdd}
            disabled={adding || added}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium border transition-colors",
              added
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 cursor-default"
                : "border-border text-muted hover:bg-surface-hover hover:text-foreground"
            )}
          >
            {added ? (
              <>
                <CheckCircle2 className="size-3.5" />
                Added
              </>
            ) : adding ? (
              "Adding…"
            ) : (
              "Add"
            )}
          </button>

          <button
            onClick={handleApply}
            disabled={applying || closed}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-semibold shadow-xs transition-all",
              closed
                ? "bg-zinc-500/15 text-zinc-500 cursor-not-allowed"
                : "bg-brand text-brand-foreground hover:bg-brand-200 active:scale-95"
            )}
          >
            {closed ? (
              listing.label
            ) : applying ? (
              "Applying…"
            ) : (
              <>
                <Send className="size-3" />
                Apply
              </>
            )}
          </button>
        </div>
      </div>
      {(addError || appliedMsg) && (
        <p className={cn("mt-2 text-sm font-medium", addError ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
          {addError || appliedMsg}
        </p>
      )}
    </div>
  );
}
