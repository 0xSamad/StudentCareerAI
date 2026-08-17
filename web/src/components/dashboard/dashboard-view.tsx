"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  GraduationCap,
  Briefcase,
  Search,
  RefreshCw,
  ArrowRight,
  UserCheck,
  Zap,
} from "lucide-react";
import { AgentControlBar } from "@/components/dashboard/agent-control-bar";
import { ConfigSummaryCard } from "@/components/dashboard/config-summary-card";
import { StatsGrid, type DashboardStats } from "@/components/dashboard/stats-grid";
import { OpportunityCard } from "@/components/dashboard/opportunity-card";
import { ApplicationDetailModal } from "@/components/dashboard/application-detail-modal";
import { AddToQueueToolbar } from "@/components/dashboard/add-to-queue-toolbar";
import {
  PageHeader,
  buttonPrimaryClassName,
  buttonSecondaryClassName,
} from "@/components/ui/page-header";
import type { Opportunity } from "@/app/api/opportunities/route";
import { cn } from "@/lib/cn";
import { runOpportunityScan, getOpportunityScanStatus, watchOpportunityScan } from "@/lib/scan-client";
import { DiscoveryHealthStrip, type DiscoveryHealth } from "@/components/discovery/discovery-health-strip";
import { FreshnessBar } from "@/components/discovery/freshness-bar";
import { PipelineStatusBar, type SourceWarning } from "@/components/discovery/pipeline-status-bar";
import { MultiUrlApplyPanel } from "@/components/apply/multi-url-apply-panel";
import { ListingFilters, type LocationFilter, type WorkplaceFilter } from "@/components/dashboard/listing-filters";
import { readLastVisit, stampLastVisit } from "@/lib/last-visit";

export function DashboardView() {
  const [selectedTab, setSelectedTab] = useState<"INTERNSHIP" | "JOB" | "ALL">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [minScoreFilter, setMinScoreFilter] = useState(0);
  const [workplaceFilter, setWorkplaceFilter] = useState<WorkplaceFilter>("ALL");
  const [locationFilter, setLocationFilter] = useState<LocationFilter>("PK_REMOTE");

  const [stats, setStats] = useState<DashboardStats>({
    opportunitiesFound: 0,
    eligible: 0,
    rejected: 0,
    strongMatches: 0,
    applicationsPrepared: 0,
    applicationsSubmitted: 0,
    failed: 0,
    interviews: 0,
    responses: 0,
  });

  const [agentState, setAgentState] = useState<"RUNNING" | "PAUSED" | "STOPPED" | "ERROR">("STOPPED");
  const [pauseReason, setPauseReason] = useState("");

  const [config, setConfig] = useState({
    applicationsPerDay: 10,
    minScore: 70,
    scanIntervalMinutes: 30,
    locations: ["Lahore, Pakistan", "Karachi, Pakistan", "Remote"],
    remote: "Hybrid / Remote Preferred",
    targetRoles: ["Software Engineer Intern", "AI/ML Intern", "Backend Engineer Intern"],
    autoSubmit: false,
    autonomousMode: false,
  });

  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [discoveryHealth, setDiscoveryHealth] = useState<DiscoveryHealth | null>(null);
  const [lastUpdatedAgo, setLastUpdatedAgo] = useState<string | null>(null);
  const [refreshAllowed, setRefreshAllowed] = useState(true);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [newSinceLastVisit, setNewSinceLastVisit] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const [applicationsCount, setApplicationsCount] = useState(0);
  const [sourceWarnings, setSourceWarnings] = useState<SourceWarning[]>([]);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [userName, setUserName] = useState<string | null>(null);
  const visitSinceRef = useRef<string | null | undefined>(undefined);
  const stampedVisit = useRef(false);

  const fetchDashboardData = useCallback((opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);

    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d?.user?.name) setUserName(String(d.user.name).split(" ")[0]);
      })
      .catch(() => {});

    fetch("/api/dashboard/stats")
      .then((r) => r.json())
      .then((d) =>
        setStats((prev) => ({
          ...prev,
          eligible: d.eligible ?? prev.eligible,
          rejected: d.rejected ?? prev.rejected,
          strongMatches: d.strongMatches ?? prev.strongMatches,
          applicationsPrepared: d.applicationsPrepared ?? prev.applicationsPrepared,
          applicationsSubmitted: d.applicationsSubmitted ?? prev.applicationsSubmitted,
          failed: d.failed ?? prev.failed,
          interviews: d.interviews ?? prev.interviews,
          responses: d.responses ?? prev.responses,
        }))
      )
      .catch((err) => console.error("Error fetching stats:", err));

    fetch("/api/discovery/status")
      .then((r) => r.json())
      .then((d) => {
        if (d?.discovery) setDiscoveryHealth(d.discovery);
        setLastUpdatedAgo(d.lastUpdatedAgo || null);
        setRefreshAllowed(d.refreshAllowed !== false);
        setRefreshMessage(d.refreshMessage || null);
      })
      .catch(() => {});

    fetch("/api/autonomous/status")
      .then((r) => r.json())
      .then((d) => {
        setAgentState(d.state || "STOPPED");
        setPauseReason(d.pauseReason || "");
        if (d.config) {
          setConfig((prev) => ({
            ...prev,
            applicationsPerDay: d.config.MAX_APPLICATIONS_PER_DAY ?? prev.applicationsPerDay,
            minScore: d.config.MIN_MATCH_SCORE ?? prev.minScore,
            autoSubmit: d.config.AUTO_SUBMIT ?? prev.autoSubmit,
            autonomousMode: d.config.AUTONOMOUS_MODE ?? prev.autonomousMode,
          }));
        }
      })
      .catch((err) => console.error("Error fetching agent status:", err));

    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => setConfig((prev) => ({ ...prev, ...d })))
      .catch((err) => console.error("Error fetching settings:", err));

    const query = new URLSearchParams({ limit: "400", verifiedOnly: "false" });
    if (selectedTab !== "ALL") query.set("type", selectedTab);
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
        setEmptyMessage(d.empty_message || null);
        if (typeof d.total === "number") {
          setStats((prev) => ({ ...prev, opportunitiesFound: d.total }));
        }
        setNewSinceLastVisit(Number(d.newSinceLastVisit) || 0);
        setSavedCount(Number(d.savedCount) || 0);
        setApplicationsCount(Number(d.applicationsCount) || 0);
        setSourceWarnings(Array.isArray(d.sourceWarnings) ? d.sourceWarnings : []);
        if (d.lastUpdatedAgo) setLastUpdatedAgo(d.lastUpdatedAgo);
        if (d.refreshAllowed !== undefined) setRefreshAllowed(d.refreshAllowed !== false);
        if (d.refreshMessage !== undefined) setRefreshMessage(d.refreshMessage || null);
        if (!stampedVisit.current) {
          stampedVisit.current = true;
          stampLastVisit();
        }
      })
      .catch((err) => console.error("Error fetching opportunities:", err))
      .finally(() => {
        if (!opts?.silent) setLoading(false);
      });
  }, [selectedTab, searchQuery, minScoreFilter, workplaceFilter, locationFilter]);

  useEffect(() => {
    fetchDashboardData();
    const onScan = () => fetchDashboardData({ silent: true });
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
          if (!cancelled) fetchDashboardData({ silent: true });
        },
      });
      if (cancelled) return;
      fetchDashboardData({ silent: true });
      setScanMessage(result.data?.message || "Scan complete. Listings are saved.");
      setScanning(false);
    })();
    return () => {
      cancelled = true;
      window.removeEventListener("sc:scan-complete", onScan);
    };
  }, [fetchDashboardData]);

  const handleScan = async () => {
    setScanning(true);
    setScanMessage("Scanning Pakistan Top 100 first, then remote roles from international companies and Adzuna.");
    try {
      const { ok, data } = await runOpportunityScan(
        { mode: "full", maxJobs: 250, maxCompanies: 100 },
        {
          onProgress: (msg) => setScanMessage(msg),
          onPartial: () => fetchDashboardData({ silent: true }),
        }
      );
      if (!ok) {
        setScanMessage(data.error || "Scan failed. Check your profile and try again.");
      } else {
        if (data.servedFromCache) {
          setRefreshAllowed(false);
          setRefreshMessage(data.message || null);
          if (data.lastUpdatedAgo) setLastUpdatedAgo(data.lastUpdatedAgo);
        }
        setScanMessage(data.message || "Scan complete. Listings are saved.");
      }
      fetchDashboardData({ silent: true });
    } catch (err) {
      console.error("Scan failed:", err);
      setScanMessage("Scan failed — network or server error. Tap Refresh to load any saved listings.");
    } finally {
      setScanning(false);
    }
  };

  const tabs = [
    { id: "INTERNSHIP" as const, label: "Internships", icon: GraduationCap },
    { id: "JOB" as const, label: "Jobs", icon: Briefcase },
    { id: "ALL" as const, label: "All", icon: null },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-8 max-sm:pb-24">
      <PageHeader
        badge="Dashboard"
        badgeVariant="neutral"
        title={userName ? `Welcome back, ${userName}` : "Career dashboard"}
        description="Your internships, jobs, and applications. Refresh looks for new listings — it does not download everything again."
        actions={
          <Link href="/profile" className={buttonSecondaryClassName}>
            <UserCheck className="size-4" />
            Profile
          </Link>
        }
      />

      <MultiUrlApplyPanel />

      {scanMessage ? (
        <p
          className={cn(
            "rounded-lg border px-4 py-3 text-sm",
            scanMessage.includes("failed") || scanMessage.includes("Complete your profile")
              ? "border-red-500/20 bg-red-500/5 text-red-700 dark:text-red-300"
              : "border-emerald-500/20 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300"
          )}
          role="status"
        >
          {scanMessage}
        </p>
      ) : null}

      <DiscoveryHealthStrip health={discoveryHealth} />
      <PipelineStatusBar
        lastUpdatedAgo={lastUpdatedAgo}
        newSinceLastVisit={newSinceLastVisit}
        savedCount={savedCount}
        applicationsCount={applicationsCount}
        refreshAllowed={refreshAllowed}
        refreshMessage={refreshMessage}
        sourceWarnings={sourceWarnings}
        scanning={scanning}
        onRefresh={handleScan}
      />
      <FreshnessBar
        lastUpdatedAgo={lastUpdatedAgo}
        refreshAllowed={refreshAllowed}
        refreshMessage={refreshMessage}
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3 space-y-6">
          <AgentControlBar
            agentState={agentState}
            pauseReason={pauseReason}
            onRefresh={fetchDashboardData}
            compact
          />
          <section className="rounded-xl border border-border bg-surface shadow-sm p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Pipeline metrics</h2>
                <p className="text-xs text-muted mt-0.5">Live counts from your account</p>
              </div>
              <button
                type="button"
                onClick={() => fetchDashboardData()}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors"
              >
                <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
                Refresh
              </button>
            </div>
            <StatsGrid stats={stats} />
          </section>
        </div>

        <div className="lg:col-span-2">
          <ConfigSummaryCard config={config} />
        </div>
      </div>

      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground tracking-tight">
              Open opportunities
            </h2>
            <p className="text-sm text-muted mt-0.5">
              {opportunities.length} listing{opportunities.length === 1 ? "" : "s"} from your last refresh
            </p>
          </div>

          <div
            className="inline-flex rounded-lg border border-border bg-surface p-0.5"
            role="tablist"
            aria-label="Opportunity type"
          >
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selectedTab === id}
                onClick={() => setSelectedTab(id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  selectedTab === id
                    ? "bg-brand text-brand-foreground shadow-sm"
                    : "text-muted hover:text-foreground hover:bg-surface-hover"
                )}
              >
                {Icon ? <Icon className="size-3.5" /> : null}
                {label}
              </button>
            ))}
          </div>
        </div>

        <ListingFilters
          workplace={workplaceFilter}
          location={locationFilter}
          onWorkplaceChange={setWorkplaceFilter}
          onLocationChange={setLocationFilter}
        />

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-faint pointer-events-none" />
            <input
              type="search"
              placeholder="Search company or role…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface pl-9 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <select
            value={minScoreFilter}
            onChange={(e) => setMinScoreFilter(Number(e.target.value))}
            className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 sm:w-44"
            aria-label="Minimum match score"
          >
            <option value={0}>Any match score</option>
            <option value={90}>≥ 90% match</option>
            <option value={80}>≥ 80% match</option>
            <option value={70}>≥ 70% match</option>
          </select>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-surface py-16 text-muted">
            <div className="size-8 animate-spin rounded-full border-2 border-brand border-t-transparent mb-3" />
            <p className="text-sm">Loading opportunities…</p>
          </div>
        ) : opportunities.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface/50 px-6 py-14 text-center">
            <GraduationCap className="size-10 text-faint mx-auto mb-3" />
            <h3 className="text-base font-semibold text-foreground">
              {selectedTab === "INTERNSHIP"
                ? "No internship apply URLs in this feed"
                : selectedTab === "JOB"
                  ? "No full-time roles in this feed"
                  : "No opportunities yet"}
            </h3>
            <p className="text-sm text-muted mt-1 max-w-md mx-auto">
              {emptyMessage ||
                (selectedTab === "INTERNSHIP"
                  ? "Most saved internship links are career-program pages, not application forms. Switch to Jobs or All to see Pakistan and remote postings."
                  : "Complete your profile, then use Refresh Opportunities when sources are due. Opening this page never starts an external scan.")}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <Link href="/profile" className={buttonSecondaryClassName}>
                Complete profile
              </Link>
              <button type="button" onClick={handleScan} className={buttonPrimaryClassName}>
                <Zap className="size-4" />
                Refresh Opportunities
              </button>
            </div>
          </div>
        ) : (
          <>
            <AddToQueueToolbar
              opportunities={opportunities}
              selectedIds={selectedIds}
              onAdded={() => fetchDashboardData({ silent: true })}
            />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {opportunities.map((opp) => (
                <OpportunityCard
                  key={opp.id}
                  opportunity={opp}
                  selected={selectedIds.includes(opp.id)}
                  onToggleSelect={(o) =>
                    setSelectedIds((prev) =>
                      prev.includes(o.id) ? prev.filter((id) => id !== o.id) : [...prev, o.id]
                    )
                  }
                  onViewDetails={(selected) => setSelectedOpportunity(selected)}
                />
              ))}
            </div>
          </>
        )}

        {opportunities.length > 0 && (
          <div className="flex justify-center pt-2">
            <Link
              href={selectedTab === "INTERNSHIP" ? "/internships" : "/jobs"}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-text hover:underline underline-offset-2"
            >
              View all on {selectedTab === "INTERNSHIP" ? "internships" : "jobs"} page
              <ArrowRight className="size-4" />
            </Link>
          </div>
        )}
      </section>

      <ApplicationDetailModal
        opportunity={selectedOpportunity}
        onClose={() => setSelectedOpportunity(null)}
      />
    </div>
  );
}
