import { NextResponse } from "next/server";
import { requireUserSession } from "@/lib/user-session";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { studentCareerRoot } from "@/lib/student-career-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type Opportunity = {
  id: string;
  company: string;
  role: string;
  type: "INTERNSHIP" | "JOB" | "OTHER" | "UNKNOWN";
  location: string;
  matchScore: number | null;
  matchTier?: string | null;
  eligibility: "ELIGIBLE" | "REQUIRES_REVIEW" | "NOT_ELIGIBLE" | "UNKNOWN" | "PENDING";
  source: string;
  source_type: "QUEUE" | "PIPELINE" | "DISCOVERY" | "DEMO";
  source_name: string;
  source_url: string | null;
  source_id: string | null;
  discovered_at: string | null;
  is_demo: boolean;
  is_verified: boolean;
  postedDate: string | null;
  deadline?: string | null;
  status: string;
  url: string;
  description?: string | null;
  requirements?: string[] | null;
  artifacts?: Record<string, unknown>;
  submitted_at?: string | null;
  market?: "NATIONAL" | "INTERNATIONAL" | string;
  sector?: string | null;
  country?: string | null;
  workplace?: "remote" | "hybrid" | "on-site" | string;
  queued?: boolean;
  listingStatus?: "ACTIVE" | "EXPIRED" | "CLOSED" | "REMOVED" | "UNKNOWN" | string;
  saved?: boolean;
  userState?: "SAVED" | "IGNORED" | "APPLIED" | "HIDDEN" | string | null;
  lastSeenAt?: string | null;
  lastCheckedAt?: string | null;
  isActive?: boolean;
};

function inferWorkplace(item: any): "remote" | "hybrid" | "on-site" {
  const explicit = String(item.workplace || item.metadata?.workplace || "").toLowerCase().replace(/_/g, "-");
  if (explicit === "remote" || explicit === "hybrid" || explicit === "on-site") return explicit;
  if (explicit === "onsite" || explicit === "office") return "on-site";
  const loc = `${item.location || ""} ${item.title || item.role || ""} ${item.description || ""}`.toLowerCase();
  if (item.remote === true || item.is_remote === true || /\bremote\b/.test(loc)) return "remote";
  if (/\bhybrid\b/.test(loc)) return "hybrid";
  return "on-site";
}

function matchesLocationFilter(item: any, locationFilter: string | null, workplace: string): boolean {
  const hay = `${item.location || ""} ${item.country || ""} ${item.market || ""} ${workplace}`.toLowerCase();
  const want = String(locationFilter || "ALL").toUpperCase();
  if (!locationFilter || want === "ALL" || want === "PK_REMOTE") return true;
  if (want === "PAKISTAN" || want === "NATIONAL") {
    return (
      String(item.market || "").toUpperCase() === "NATIONAL" ||
      /pakistan|lahore|karachi|islamabad|rawalpindi|faisalabad|peshawar|multan|quetta/.test(hay)
    );
  }
  if (want === "INTERNATIONAL") {
    return workplace === "remote" || /\bremote\b/.test(hay);
  }
  if (want === "REMOTE") {
    return workplace === "remote" || /\bremote\b/.test(hay);
  }
  return hay.includes(locationFilter.toLowerCase());
}

function inferCountry(item: any): string | null {
  if (item.country) return item.country;
  const market = item.market || item.metadata?.market;
  if (market === "NATIONAL") return "Pakistan";
  const loc = String(item.location || "");
  if (/pakistan|lahore|karachi|islamabad|rawalpindi|faisalabad|peshawar|quetta/i.test(loc)) {
    return "Pakistan";
  }
  const parts = loc.split(",").map((s: string) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 1];
  if (market === "INTERNATIONAL") return "International";
  return null;
}

function inferAtsName(url: string): string {
  if (!url) return "Unknown";
  if (url.includes("greenhouse")) return "Greenhouse";
  if (url.includes("lever")) return "Lever";
  if (url.includes("ashby")) return "Ashby";
  if (url.includes("myworkdayjobs")) return "Workday";
  return "Configured Source";
}

function mapQueueItem(item: any): Opportunity | null {
  if (!item?.url) return null;

  const isIntern =
    (item.opportunity_type || item.type || "").toUpperCase() === "INTERNSHIP" ||
    /intern|trainee|apprentice|werkstudent/i.test(item.title || item.role || "");

  const hasRealScore = typeof item.match_score === "number";
  const score = hasRealScore ? item.match_score : null;
  const eligibility =
    item.eligibility_status ||
    (item.eligible_to_apply === true
      ? "ELIGIBLE"
      : item.eligible_to_apply === false
        ? "NOT_ELIGIBLE"
        : "PENDING");

  // Never invent APPLIED/SUBMITTED without a real submission timestamp.
  let status = item.state || "DISCOVERED";
  if ((status === "APPLIED" || status === "SUBMITTED") && !item.submitted_at && !item.applied_at) {
    status = item.dry_run === false ? status : "APPLICATION_READY";
  }
  if (item.dry_run === true && (status === "APPLIED" || status === "SUBMITTED")) {
    status = "APPLICATION_READY";
  }
  if (status === "DRY_RUN") {
    status = "APPLICATION_READY";
  }

  return {
    id: item.id || item.opportunity_id || Buffer.from(item.url).toString("base64").slice(0, 16),
    company: item.company || "Unknown company",
    role: item.title || item.role || "Untitled role",
    type: isIntern ? "INTERNSHIP" : "JOB",
    location: item.location || (item.remote ? "Remote" : "Location unknown"),
    matchScore: score,
    matchTier: item.match_tier || null,
    eligibility,
    source: item.source || inferAtsName(item.url),
    source_type: "QUEUE",
    source_name: item.source_name || item.source || inferAtsName(item.url),
    source_url: item.url,
    source_id: item.source_id || item.id || null,
    discovered_at: item.discovered_at || item.posted_at || null,
    is_demo: false,
    is_verified: Boolean(item.is_verified),
    postedDate: item.posted_at || item.discovered_at || null,
    deadline: item.deadline || null,
    status,
    url: item.url,
    description: item.description || null,
    requirements: Array.isArray(item.requirements) ? item.requirements : null,
    artifacts: item.artifacts || {},
    submitted_at: item.submitted_at || null,
  };
}

function mapPipelineLine(line: string): Opportunity | null {
  const m = line.match(/^\s*-\s*\[([ xX])\]\s*(.+)$/);
  if (!m) return null;
  const parts = m[2].split("|").map((s) => s.trim());
  if (parts.length < 3) return null;

  const url = parts[0];
  if (!/^https?:\/\//i.test(url)) return null;

  const company = parts[1];
  const role = parts[2];
  const location = parts[3] || "Location unknown";
  const isDone = m[1].toLowerCase() === "x";
  const isIntern = /intern|trainee|apprentice|werkstudent/i.test(role) || /intern/i.test(url);

  return {
    id: Buffer.from(url).toString("base64").slice(0, 16),
    company,
    role,
    type: isIntern ? "INTERNSHIP" : "JOB",
    location,
    matchScore: null,
    matchTier: null,
    eligibility: "PENDING",
    source: inferAtsName(url),
    source_type: "PIPELINE",
    source_name: "Pipeline Inbox",
    source_url: url,
    source_id: null,
    discovered_at: null,
    is_demo: false,
    is_verified: false,
    postedDate: null,
    deadline: null,
    // Checked pipeline items mean "handled in tracker", not necessarily submitted.
    status: isDone ? "APPLICATION_READY" : "DISCOVERED",
    url,
    description: null,
    requirements: null,
    artifacts: {},
    submitted_at: null,
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const typeFilter = searchParams.get("type")?.toUpperCase();
    const search = searchParams.get("search")?.toLowerCase();
    const minScore = Number(searchParams.get("minScore") || 0);
    const includeDemo = searchParams.get("includeDemo") === "true";
    const verifiedOnly = searchParams.get("verifiedOnly") === "true";
    const eligibleOnly = searchParams.get("eligibleOnly") === "true";
    const market = searchParams.get("market")?.toUpperCase();
    const workplaceFilter = (searchParams.get("workplace") || "ALL").toLowerCase().replace(/_/g, "-");
    const locationFilter = searchParams.get("location")?.trim() || (market && market !== "ALL" ? market : "ALL");
    const { authContext, container } = await requireUserSession(req);
    const limit = Math.min(Number(searchParams.get("limit") || 400), 500);
    const baseQuery = {
      search,
      minScore,
      includeDemo,
      verifiedOnly,
      eligibleOnly,
      market: market && market !== "ALL" ? market : undefined,
      limit,
    };

    const storeModUrl = pathToFileURL(path.join(studentCareerRoot(), "lib", "saas", "opportunity-store", "index.mjs")).href;
    const {
      listPersistedOpportunitiesForUi,
      passesDisplayFilters,
      rankDisplayableListing,
      distinctCompanyCount,
      cleanListingTitle,
      cleanListingText,
    } = await import(/* webpackIgnore: true */ storeModUrl);
    const fromStore = await listPersistedOpportunitiesForUi(
      container,
      {
        type: typeFilter === "INTERNSHIP" || typeFilter === "JOB" ? typeFilter : undefined,
        search,
        limit,
        includeInactive: false,
      },
      authContext
    );

    let items: any[] = fromStore.opportunities || [];
    let servedFrom = fromStore.servedFrom;

    if (!items.length) {
      const mixed = await container.opportunityRepository.findByFilters(baseQuery, authContext);
      let typed: any[] = [];
      if (typeFilter === "INTERNSHIP" || typeFilter === "JOB") {
        typed = await container.opportunityRepository.findByFilters(
          { ...baseQuery, type: typeFilter },
          authContext
        );
      }
      const byId = new Map<string, any>();
      for (const item of [...typed, ...mixed]) {
        if (item?.id) byId.set(String(item.id), item);
      }
      items = [...byId.values()];
      servedFrom = "tenant_database";
    }

    const filtered = items.filter((item: any) => {
      const workplace = inferWorkplace(item);
      if (!passesDisplayFilters(item, { typeFilter, workplaceFilter })) return false;
      if (!matchesLocationFilter({ ...item, country: item.country || inferCountry(item) }, locationFilter, workplace)) {
        return false;
      }
      const score = typeof item.match_score === "number" ? item.match_score : item.matchScore;
      if (minScore > 0 && typeof score === "number" && score < minScore) return false;
      if (eligibleOnly) {
        const elig = item.eligibility_status || item.eligibilityStatus || item.eligibility;
        if (elig === "NOT_ELIGIBLE") return false;
      }
      return true;
    });

    filtered.sort((a: any, b: any) => rankDisplayableListing(a) - rankDisplayableListing(b));

    const visible = filtered.slice(0, limit);
    const opportunities: Opportunity[] = visible.map((item: any) => {
      const listingStatus = item.listingStatus || item.status || (item.active === false ? "CLOSED" : "ACTIVE");
      const role = cleanListingTitle(item.title || item.role) || "Untitled role";
      return {
        id: item.id,
        company: item.company || item.company_name || "Unknown company",
        role,
        type: item.type || item.opportunity_type || "UNKNOWN",
        location: item.location || "Location unknown",
        matchScore: typeof item.match_score === "number" ? item.match_score : item.matchScore ?? null,
        matchTier: item.match_tier || null,
        eligibility: item.eligibility_status || item.eligibilityStatus || item.eligibility || "PENDING",
        source: item.source_name || item.source || inferAtsName(item.url || ""),
        source_type: item.source_type || "DISCOVERY",
        source_name: item.source_name || inferAtsName(item.url || ""),
        source_url: item.source_url || item.url || null,
        source_id: item.source_id || null,
        discovered_at: item.discovered_at || item.firstDiscoveredAt || null,
        is_demo: !!item.is_demo,
        is_verified: Boolean(item.is_verified),
        postedDate: item.posted_at || item.postedDate || null,
        deadline: item.deadline || null,
        status: listingStatus,
        listingStatus,
        url: item.url || item.source_url || "",
        description: cleanListingText(item.description || "", 2000) || null,
        requirements: Array.isArray(item.requirements) ? item.requirements : null,
        artifacts: item.artifacts || {},
        submitted_at: item.submitted_at || null,
        market: item.market || item.metadata?.market || "INTERNATIONAL",
        sector: item.sector || item.metadata?.sector || null,
        country: inferCountry(item),
        workplace: inferWorkplace(item),
        saved: Boolean(item.saved) || item.userState === "SAVED" || item.userState === "APPLIED",
        userState: item.userState || null,
        lastSeenAt: item.lastSeenAt || null,
        lastCheckedAt: item.lastCheckedAt || null,
        isActive: item.isActive !== false && listingStatus === "ACTIVE",
      };
    });

    const engineUrl = pathToFileURL(path.join(studentCareerRoot(), "lib", "saas", "discovery-engine", "index.mjs")).href;
    const { summarizeDiscoveryHealth, evaluateRefresh, loadRefreshPolicy, ensureDiscoveryPipeline } =
      await import(/* webpackIgnore: true */ engineUrl);
    const policy = container.discoveryRefreshPolicy || loadRefreshPolicy(studentCareerRoot());
    ensureDiscoveryPipeline({ container, repoRoot: studentCareerRoot() });

    const storeCount =
      typeof container.opportunityStore?.count === "function" ? await container.opportunityStore.count() : opportunities.length;
    const health = await summarizeDiscoveryHealth({
      stateStore: container.discoveryStateStore,
      sourceCache: container.sourceCache,
      hasPersistedOpportunities: storeCount > 0,
      lastSeenFallback: items.reduce((latest: string | null, item: any) => {
        const seen = item.lastSeenAt || item.last_seen_at || item.lastCheckedAt || null;
        if (!seen) return latest;
        if (!latest || String(seen) > String(latest)) return seen;
        return latest;
      }, null),
    });
    const states = typeof container.discoveryStateStore?.list === "function"
      ? await container.discoveryStateStore.list()
      : [];
    const cacheEntries = typeof container.sourceCache?.list === "function"
      ? await container.sourceCache.list()
      : [];
    const manual = evaluateRefresh({ policy, states, cacheEntries, requested: "manual" });

    const sinceRaw = searchParams.get("since");
    const sinceMs = sinceRaw ? Date.parse(sinceRaw) : NaN;
    const newSinceLastVisit = Number.isNaN(sinceMs)
      ? 0
      : opportunities.filter((o) => Date.parse(String(o.discovered_at || o.lastSeenAt || 0)) > sinceMs).length;

    let savedCount = 0;
    if (typeof container.opportunityStore?.listUserStates === "function" && authContext.userId) {
      const savedRows = await container.opportunityStore.listUserStates(authContext.userId);
      savedCount = savedRows.filter((r: any) => r.status === "SAVED" || r.status === "APPLIED").length;
    }
    let applicationsCount = 0;
    try {
      if (typeof container.applicationRepository?.findMany === "function") {
        const apps = await container.applicationRepository.findMany({}, authContext);
        applicationsCount = apps.length;
      }
    } catch (err) {
      console.error("[opportunities] applicationsCount failed:", err instanceof Error ? err.message : err);
    }

    return NextResponse.json({
      total: opportunities.length,
      companyCount: distinctCompanyCount(opportunities),
      opportunities,
      empty: opportunities.length === 0,
      empty_message:
        opportunities.length === 0
          ? storeCount > 0
            ? "Saved listings exist, but none in this view are Pakistan or remote job postings with a real apply URL. Career homepages stay hidden. Refresh scans due sources — it does not re-download everything."
            : "No listings yet. Complete your profile, then use Refresh Opportunities when the source is due. Opening this page never fetches externally."
          : null,
      servedFrom: servedFrom === "opportunity_store" ? "database" : servedFrom || "database",
      lastUpdatedAt: health.lastDiscoveryAt,
      lastUpdatedAgo: health.lastDiscoveryAgo,
      refreshAllowed: manual.allowed,
      refreshMessage: manual.allowed ? null : manual.message,
      newSinceLastVisit,
      savedCount,
      applicationsCount,
      sourceWarnings: health.sourceWarnings || [],
      discovery: {
        lastDiscovery: health.lastDiscoveryAgo || "never",
        lastDiscoveryAt: health.lastDiscoveryAt,
        newOpportunities: health.newOpportunities,
        updated: health.updatedOpportunities,
        sourcesHealthy: health.sourcesHealthy,
        sourcesTotal: health.sourcesTotal,
        sourcesRateLimited: health.sourcesRateLimited,
        sourcesError: health.sourcesError,
        sourceWarnings: health.sourceWarnings || [],
      },
    });
  } catch (err: any) {
    console.error("[opportunities] GET failed:", err?.message || err);
    const status = err?.status || 500;
    return NextResponse.json({ error: err.message || "Failed to load opportunities" }, { status });
  }
}
