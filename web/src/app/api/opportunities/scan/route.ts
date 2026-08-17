import { after, NextResponse } from "next/server";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { studentCareerRoot } from "@/lib/student-career-ai";
import { emptyProfileShape, requireUserSession, withPreferredAiMatching } from "@/lib/user-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function shapeProfile(stored: Record<string, unknown> | null | undefined) {
  const defaults = emptyProfileShape();
  if (!stored) return defaults;
  return {
    identity: (stored.identity as typeof defaults.identity) || defaults.identity,
    education: Array.isArray(stored.education) ? stored.education : [],
    skills: (stored.skills as typeof defaults.skills) || defaults.skills,
    experience: (stored.experience as typeof defaults.experience) || defaults.experience,
    projects: Array.isArray(stored.projects) ? stored.projects : [],
    preferences: (stored.preferences as typeof defaults.preferences) || defaults.preferences,
    matching: withPreferredAiMatching(stored.matching as Record<string, unknown> | undefined) as typeof defaults.matching,
  };
}

async function loadScanModules(root: string) {
  const scanUrl = pathToFileURL(path.join(root, "lib", "saas", "web-opportunity-scan.mjs")).href;
  const jobUrl = pathToFileURL(path.join(root, "lib", "saas", "scan-job-runner.mjs")).href;
  const dualUrl = pathToFileURL(path.join(root, "lib", "saas", "opportunity-store", "dual-write.mjs")).href;
  const engineUrl = pathToFileURL(path.join(root, "lib", "saas", "discovery-engine", "index.mjs")).href;
  const [
    { scanOpportunitiesForUser },
    { startScanJob, getScanJob, publicScanJob },
    { createDualWriteRepository },
    engine,
  ] = await Promise.all([
    import(/* webpackIgnore: true */ scanUrl),
    import(/* webpackIgnore: true */ jobUrl),
    import(/* webpackIgnore: true */ dualUrl),
    import(/* webpackIgnore: true */ engineUrl),
  ]);
  return {
    scanOpportunitiesForUser,
    startScanJob,
    getScanJob,
    publicScanJob,
    createDualWriteRepository,
    ensureDiscoveryPipeline: engine.ensureDiscoveryPipeline,
    evaluateRefresh: engine.evaluateRefresh,
    loadRefreshPolicy: engine.loadRefreshPolicy,
    summarizeDiscoveryHealth: engine.summarizeDiscoveryHealth,
  };
}

function scanOptions(
  body: { maxCompanies?: number; maxJobs?: number; searchMode?: string; market?: string },
  light: boolean
) {
  return {
    maxCompanies: body.maxCompanies ?? (light ? 8 : 100),
    maxJobs: body.maxJobs ?? (light ? 30 : 250),
    discoveryMode: "cs_field",
    searchMode: body.searchMode,
    market: body.market?.toUpperCase() || "ALL",
    light,
    deadlineMs: light ? 25_000 : 0,
    usePlaywright: !light,
    playwrightBudget: light ? 0 : 40,
  };
}

export async function GET(req: Request) {
  try {
    const { userId, container } = await requireUserSession(req);
    const root = studentCareerRoot();
    const { getScanJob, publicScanJob, summarizeDiscoveryHealth, ensureDiscoveryPipeline } =
      await loadScanModules(root);
    ensureDiscoveryPipeline({ container, repoRoot: root });
    const health = await summarizeDiscoveryHealth({
      stateStore: container.discoveryStateStore,
      sourceCache: container.sourceCache,
    });
    return NextResponse.json({
      ok: true,
      ...publicScanJob(getScanJob(userId)),
      lastUpdatedAt: health.lastDiscoveryAt,
      lastUpdatedAgo: health.lastDiscoveryAgo,
      discovery: health,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message || "Failed to read scan status" },
      { status: err.status || 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const { userId, tenantId, container, authContext } = await requireUserSession(req);
    const stored = await container.profileRepository.getByUserId(userId, tenantId);
    const profile = shapeProfile(stored);
    const cvText = typeof stored?.cvText === "string" ? stored.cvText : "";

    if (!profile.identity?.name) {
      return NextResponse.json(
        {
          ok: false,
          error: "Complete your profile before scanning. Go to Profile and save your details.",
        },
        { status: 400 }
      );
    }

    const root = studentCareerRoot();
    const {
      scanOpportunitiesForUser,
      startScanJob,
      getScanJob,
      publicScanJob,
      createDualWriteRepository,
      ensureDiscoveryPipeline,
      evaluateRefresh,
      loadRefreshPolicy,
      summarizeDiscoveryHealth,
    } = await loadScanModules(root);

    const opportunityRepository = createDualWriteRepository({
      repository: container.opportunityRepository,
      store: container.opportunityStore,
    });

    let body: {
      maxCompanies?: number;
      maxJobs?: number;
      searchMode?: string;
      market?: string;
      mode?: string;
    } = {};
    try {
      body = await req.json();
    } catch {
      // empty body is fine
    }

    const light = body.mode === "light";
    const policy = container.discoveryRefreshPolicy || loadRefreshPolicy(root);
    const states = typeof container.discoveryStateStore?.list === "function"
      ? await container.discoveryStateStore.list()
      : [];
    const cacheEntries = typeof container.sourceCache?.list === "function"
      ? await container.sourceCache.list()
      : [];
    const verdict = evaluateRefresh({
      policy,
      states,
      cacheEntries,
      requested: light ? "scheduler" : "manual",
    });
    const health = await summarizeDiscoveryHealth({
      stateStore: container.discoveryStateStore,
      sourceCache: container.sourceCache,
    });

    if (!verdict.allowed) {
      return NextResponse.json({
        ok: true,
        running: false,
        servedFromCache: true,
        refreshAllowed: false,
        refreshBlockedReason: verdict.reason,
        lastFetchedAt: verdict.lastFetchedAt,
        lastUpdatedAt: health.lastDiscoveryAt,
        lastUpdatedAgo: health.lastDiscoveryAgo,
        message: verdict.message,
        discovery: health,
      });
    }

    const options = {
      ...scanOptions(body, light),
      discoveryStateStore: container.discoveryStateStore,
      sourceCache: container.sourceCache,
      refreshPolicy: policy,
      // Manual refresh may bypass the regular interval but NEVER rate limits.
      force: !light,
      requested: light ? "scheduler" : "manual",
    };

    ensureDiscoveryPipeline({ container, repoRoot: root });

    if (light) {
      const stats = await Promise.race([
        scanOpportunitiesForUser({
          repoRoot: root,
          profile: { ...profile, cvText },
          opportunityRepository,
          authContext,
          options,
        }),
        new Promise((_, reject) => {
          setTimeout(() => {
            const err = new Error(
              "Light scan hit the time limit. Saved listings stay in your feed."
            );
            (err as any).status = 504;
            reject(err);
          }, 33_000);
        }),
      ]);
      return NextResponse.json({
        ok: true,
        running: false,
        status: "complete",
        refreshAllowed: true,
        message: stats.message,
        stats,
        newCount: stats.newCount ?? stats.verifiedMatched ?? 0,
        existingCount: stats.existingCount ?? 0,
        discovery: health,
      });
    }

    const job = startScanJob({
      userId,
      run: async (activeJob: { progress?: unknown; message?: string }) => {
        return scanOpportunitiesForUser({
          repoRoot: root,
          profile: { ...profile, cvText },
          opportunityRepository,
          authContext,
          options: {
            ...options,
            onProgress: ({ phase, message }: { phase?: string; message?: string }) => {
              activeJob.progress = { phase };
              if (message) activeJob.message = message;
            },
          },
        });
      },
    });

    after(async () => {
      const started = Date.now();
      while (Date.now() - started < 280_000) {
        const current = getScanJob(userId);
        if (!current || current.status !== "running") break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    });

    return NextResponse.json({
      ok: true,
      ...publicScanJob(job),
      refreshAllowed: true,
      message:
        job.message ||
        "Scanning due sources only. Listings are saved as they are found.",
    });
  } catch (err: any) {
    console.error("Scan error:", err);
    const status = err?.status || 500;
    return NextResponse.json(
      { ok: false, error: err.message || "Failed to refresh scan" },
      { status }
    );
  }
}
