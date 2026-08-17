"use client";

import { useEffect, useRef, useState } from "react";
import { GraduationCap, Sparkles, Search, RefreshCw } from "lucide-react";
import { OpportunityCard } from "@/components/dashboard/opportunity-card";
import { ApplicationDetailModal } from "@/components/dashboard/application-detail-modal";
import { AddToQueueToolbar } from "@/components/dashboard/add-to-queue-toolbar";
import { PageHeader, buttonSecondaryClassName } from "@/components/ui/page-header";
import type { Opportunity } from "@/app/api/opportunities/route";
import { addOpportunitiesToQueue } from "@/lib/queue-client";
import { runOpportunityScan, getOpportunityScanStatus, watchOpportunityScan } from "@/lib/scan-client";
import { PipelineStatusBar, type SourceWarning } from "@/components/discovery/pipeline-status-bar";
import { MultiUrlApplyPanel } from "@/components/apply/multi-url-apply-panel";
import { ListingFilters, type LocationFilter, type WorkplaceFilter } from "@/components/dashboard/listing-filters";
import { readLastVisit, stampLastVisit } from "@/lib/last-visit";

export default function InternshipsPage() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [lastUpdatedAgo, setLastUpdatedAgo] = useState<string | null>(null);
  const [refreshAllowed, setRefreshAllowed] = useState(true);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [newSinceLastVisit, setNewSinceLastVisit] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const [applicationsCount, setApplicationsCount] = useState(0);
  const [sourceWarnings, setSourceWarnings] = useState<SourceWarning[]>([]);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const visitSinceRef = useRef<string | null | undefined>(undefined);
  const stampedVisit = useRef(false);
  const [minScoreFilter, setMinScoreFilter] = useState(0);
  const [workplaceFilter, setWorkplaceFilter] = useState<WorkplaceFilter>("ALL");
  const [locationFilter, setLocationFilter] = useState<LocationFilter>("PK_REMOTE");
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);

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

  const fetchInternships = (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const query = new URLSearchParams({ type: "INTERNSHIP", limit: "400", verifiedOnly: "false" });
    if (searchQuery) query.set("search", searchQuery);
    if (minScoreFilter > 0) query.set("minScore", String(minScoreFilter));
    if (workplaceFilter !== "ALL") query.set("workplace", workplaceFilter);
    if (locationFilter !== "ALL") query.set("location", locationFilter);
    if (visitSinceRef.current === undefined) visitSinceRef.current = readLastVisit();
    if (visitSinceRef.current) query.set("since", visitSinceRef.current);

    fetch(`/api/opportunities?${query.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        setOpportunities(d.opportunities || []);
        setLastUpdatedAgo(d.lastUpdatedAgo || null);
        setRefreshAllowed(d.refreshAllowed !== false);
        setRefreshMessage(d.refreshMessage || null);
        setNewSinceLastVisit(Number(d.newSinceLastVisit) || 0);
        setSavedCount(Number(d.savedCount) || 0);
        setApplicationsCount(Number(d.applicationsCount) || 0);
        setSourceWarnings(Array.isArray(d.sourceWarnings) ? d.sourceWarnings : []);
        setEmptyMessage(d.empty_message || null);
        if (!stampedVisit.current) {
          stampedVisit.current = true;
          stampLastVisit();
        }
      })
      .catch((err) => console.error("Error fetching internships:", err))
      .finally(() => {
        if (!opts?.silent) setLoading(false);
      });
    fetchQueued();
  };

  const handleScanOpportunities = async () => {
    setScanning(true);
    setScanMessage("Scanning Pakistan Top 100 first, then remote roles from international companies and Adzuna.");
    try {
      const { ok, data } = await runOpportunityScan(
        {
          searchMode: "BOTH",
          market: locationFilter === "PAKISTAN" ? "NATIONAL" : "ALL",
          maxJobs: 250,
          maxCompanies: 100,
          mode: "full",
        },
        {
          onProgress: (msg) => setScanMessage(msg),
          onPartial: () => fetchInternships({ silent: true }),
        }
      );
      fetchInternships({ silent: true });
      if (ok) {
        if (data.servedFromCache) {
          setRefreshAllowed(false);
          setRefreshMessage(data.message || null);
          if (data.lastUpdatedAgo) setLastUpdatedAgo(data.lastUpdatedAgo);
        }
        setScanMessage(data.message || "Scan complete. Listings are saved.");
        setTimeout(() => setScanMessage(null), 14000);
      } else {
        setScanMessage(data.error || "Scan finished with errors. Tap Refresh to load any saved listings.");
      }
    } catch (err: any) {
      fetchInternships({ silent: true });
      setScanMessage("Error scanning portals: " + (err.message || "unknown error") + ". Tap Refresh to load any saved listings.");
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    fetchInternships();
    const onScan = () => fetchInternships({ silent: true });
    window.addEventListener("sc:scan-complete", onScan);
    let cancelled = false;
    (async () => {
      const { data } = await getOpportunityScanStatus();
      if (cancelled || !data?.running) return;
      setScanning(true);
      setScanMessage(data.message || "Scan still running — listings are being saved.");
      const result = await watchOpportunityScan({
        onProgress: (msg) => {
          if (!cancelled) setScanMessage(msg);
        },
        onPartial: () => {
          if (!cancelled) fetchInternships({ silent: true });
        },
      });
      if (cancelled) return;
      fetchInternships({ silent: true });
      setScanMessage(result.data?.message || "Scan complete. Listings are saved.");
      setScanning(false);
      setTimeout(() => setScanMessage(null), 14000);
    })();
    return () => {
      cancelled = true;
      window.removeEventListener("sc:scan-complete", onScan);
    };
  }, [searchQuery, minScoreFilter, workplaceFilter, locationFilter]);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-8 max-sm:pb-24">
      <PageHeader
        badge="Internships"
        badgeVariant="success"
        title="Internship opportunities"
        description="Pakistan internships first, then remote. Refresh scans the Pakistan Top 100, international remote roles, and Adzuna. Apply opens the job form URL — not a career homepage."
        actions={
          <button onClick={() => fetchInternships()} className={buttonSecondaryClassName}>
            <RefreshCw className="size-3.5" /> Reload from database
          </button>
        }
      />

      <MultiUrlApplyPanel />

      {scanMessage && (
        <div className="p-4 bg-brand/10 border border-brand/30 rounded-2xl flex items-center gap-3 text-brand text-xs md:text-sm">
          <Sparkles className="size-5 shrink-0" />
          <span>{scanMessage}</span>
        </div>
      )}

      <PipelineStatusBar
        lastUpdatedAgo={lastUpdatedAgo}
        newSinceLastVisit={newSinceLastVisit}
        savedCount={savedCount}
        applicationsCount={applicationsCount}
        refreshAllowed={refreshAllowed}
        refreshMessage={refreshMessage}
        sourceWarnings={sourceWarnings}
        scanning={scanning}
        onRefresh={handleScanOpportunities}
      />

      <AddToQueueToolbar
        opportunities={opportunities}
        selectedIds={selectedIds}
        onAdded={fetchQueued}
      />

      {opportunities.length > 0 && (
        <label className="flex items-center gap-2 px-1 text-xs text-muted">
          <input
            type="checkbox"
            checked={selectedIds.length === opportunities.length && opportunities.length > 0}
            onChange={() =>
              setSelectedIds((prev) =>
                prev.length === opportunities.length ? [] : opportunities.map((o) => o.id)
              )
            }
            className="size-4 accent-brand"
          />
          Select all {opportunities.length} listings
        </label>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <ListingFilters
          workplace={workplaceFilter}
          location={locationFilter}
          onWorkplaceChange={setWorkplaceFilter}
          onLocationChange={setLocationFilter}
        />
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-faint" />
          <input
            type="text"
            placeholder="Filter internships by company, role title, or technology..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface pl-9 pr-4 py-2.5 text-xs text-foreground placeholder:text-muted focus:border-brand focus:outline-hidden"
          />
        </div>
        <select
          value={minScoreFilter}
          onChange={(e) => setMinScoreFilter(Number(e.target.value))}
          className="rounded-xl border border-border bg-surface px-3.5 py-2.5 text-xs text-muted focus:border-brand focus:outline-hidden"
        >
          <option value="0">All Match Scores</option>
          <option value="90">≥ 90% (Excellent Match)</option>
          <option value="80">≥ 80% (Strong Match)</option>
          <option value="70">≥ 70% (Good Match)</option>
        </select>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted">
          <div className="size-8 animate-spin rounded-full border-2 border-brand border-t-transparent mb-3" />
          <p className="text-xs">Loading saved internships…</p>
        </div>
      ) : opportunities.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-12 text-center space-y-3">
          <GraduationCap className="size-10 text-faint mx-auto" />
          <h3 className="font-bold text-base text-foreground">No internships currently in feed</h3>
          <p className="text-xs text-muted max-w-md mx-auto">
            {emptyMessage ||
              "Click Refresh Opportunities to check due sources for new or updated listings. Opening this page never re-downloads everything."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {opportunities.map((opp) => (
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
