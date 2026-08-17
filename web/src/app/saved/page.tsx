"use client";

import { useEffect, useState } from "react";
import { Bookmark, Search } from "lucide-react";
import { OpportunityCard } from "@/components/dashboard/opportunity-card";
import { ApplicationDetailModal } from "@/components/dashboard/application-detail-modal";
import { AddToQueueToolbar } from "@/components/dashboard/add-to-queue-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import type { Opportunity } from "@/app/api/opportunities/route";
import { addOpportunitiesToQueue } from "@/lib/queue-client";

function mapSavedRow(row: any): Opportunity | null {
  const o = row?.opportunity || {};
  const id = o.id || row.opportunityId;
  if (!id) return null;
  const listingStatus = String(o.status || o.listingStatus || "UNKNOWN").toUpperCase();
  const typeRaw = String(o.opportunityType || o.opportunity_type || o.type || "UNKNOWN").toUpperCase();
  return {
    id,
    company: o.company || o.company_name || "Unknown company",
    role: o.title || o.role || "Untitled role",
    type: typeRaw === "JOB" ? "JOB" : typeRaw === "INTERNSHIP" ? "INTERNSHIP" : "UNKNOWN",
    location: o.location || "Location unknown",
    matchScore: typeof o.matchScore === "number" ? o.matchScore : null,
    eligibility: "PENDING",
    source: o.source || o.source_name || "Discovery",
    source_type: "DISCOVERY",
    source_name: o.source || o.source_name || "Discovery",
    source_url: o.sourceUrl || o.source_url || o.applicationUrl || o.application_url || o.url || null,
    source_id: o.sourceId || o.source_id || null,
    discovered_at: o.firstDiscoveredAt || o.first_discovered_at || null,
    is_demo: false,
    is_verified: listingStatus === "ACTIVE",
    postedDate: o.postedAt || o.posted_at || null,
    deadline: o.deadline || null,
    status: listingStatus,
    listingStatus,
    url: o.applicationUrl || o.application_url || o.sourceUrl || o.source_url || o.url || "",
    description: o.description || null,
    market: o.country === "Pakistan" ? "NATIONAL" : "INTERNATIONAL",
    country: o.country || null,
    workplace: o.remote ? "remote" : "on-site",
    saved: true,
    userState: row.status || "SAVED",
    lastSeenAt: o.lastSeenAt || o.last_seen_at || null,
    lastCheckedAt: o.lastCheckedAt || o.last_checked_at || null,
    isActive: listingStatus === "ACTIVE",
  };
}

export default function SavedOpportunitiesPage() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchQueued = () => {
    fetch("/api/applications")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return;
        const ids = new Set<string>(
          (d.applications || []).flatMap((a: any) => [a.opportunityId, a.id].filter(Boolean))
        );
        setQueuedIds(ids);
      })
      .catch(() => {});
  };

  const fetchSaved = () => {
    setLoading(true);
    fetch("/api/v1/opportunities/saved")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.ok === false) throw new Error(d.error || "Failed to load saved opportunities");
        const mapped = (d.saved || [])
          .filter((row: any) => row.status === "SAVED" || row.status === "APPLIED")
          .map(mapSavedRow)
          .filter(Boolean) as Opportunity[];
        setOpportunities(mapped);
        setLoadError(null);
      })
      .catch((err) => {
        setLoadError(err?.message || "Failed to load saved opportunities");
        setOpportunities([]);
      })
      .finally(() => setLoading(false));
    fetchQueued();
  };

  useEffect(() => {
    fetchSaved();
  }, []);

  const filtered = opportunities.filter((o) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return o.company.toLowerCase().includes(q) || o.role.toLowerCase().includes(q);
  });

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-8 max-sm:pb-24">
      <PageHeader
        badge="Saved"
        badgeVariant="success"
        title="Saved opportunities"
        description="Listings you saved stay here even if they later disappear from a source. Status shows ACTIVE, CLOSED, or EXPIRED. Apply uses the persisted record — no new scan is required."
      />

      <AddToQueueToolbar opportunities={filtered} selectedIds={selectedIds} onAdded={fetchQueued} />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-faint" />
        <input
          type="text"
          placeholder="Filter saved listings…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-xl border border-border bg-surface pl-9 pr-4 py-2.5 text-xs text-foreground placeholder:text-muted focus:border-brand focus:outline-hidden"
        />
      </div>

      {loadError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-700 dark:text-red-300">
          {loadError}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted">
          <div className="size-8 animate-spin rounded-full border-2 border-brand border-t-transparent mb-3" />
          <p className="text-xs">Loading saved opportunities…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-12 text-center space-y-3">
          <Bookmark className="size-10 text-faint mx-auto" />
          <h3 className="font-bold text-base text-foreground">No saved opportunities yet</h3>
          <p className="text-xs text-muted max-w-md mx-auto">
            Open Internships or Jobs and click Save on a listing. It remains here even if the original posting later closes.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((opp) => (
            <OpportunityCard
              key={opp.id}
              opportunity={opp}
              queued={queuedIds.has(opp.id)}
              selected={selectedIds.includes(opp.id)}
              onToggleSelect={(o) =>
                setSelectedIds((prev) =>
                  prev.includes(o.id) ? prev.filter((id) => id !== o.id) : [...prev, o.id]
                )
              }
              onViewDetails={(o) => setSelectedOpportunity(o)}
              onAddToQueue={async (o) => {
                await addOpportunitiesToQueue([o], 1);
                fetchQueued();
              }}
              onSavedChange={(_o, isSaved) => {
                if (!isSaved) fetchSaved();
              }}
            />
          ))}
        </div>
      )}

      {selectedOpportunity && (
        <ApplicationDetailModal
          opportunity={selectedOpportunity}
          onClose={() => setSelectedOpportunity(null)}
          onQueued={fetchQueued}
        />
      )}
    </div>
  );
}
