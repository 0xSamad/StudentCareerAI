/**
 * GET /api/discovery/status — database/cache snapshot. Never fetches externally.
 */
import { NextResponse } from "next/server";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { studentCareerRoot } from "@/lib/student-career-ai";
import { requireUserSession } from "@/lib/user-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { container } = await requireUserSession(req);
    const root = studentCareerRoot();
    const engineUrl = pathToFileURL(path.join(root, "lib", "saas", "discovery-engine", "index.mjs")).href;
    const { summarizeDiscoveryHealth, ensureDiscoveryPipeline, loadRefreshPolicy, evaluateRefresh } =
      await import(/* webpackIgnore: true */ engineUrl);
    const policy = container.discoveryRefreshPolicy || loadRefreshPolicy(root);
    ensureDiscoveryPipeline({ container, repoRoot: root });

    const states = typeof container.discoveryStateStore?.list === "function"
      ? await container.discoveryStateStore.list()
      : [];
    const cacheEntries = typeof container.sourceCache?.list === "function"
      ? await container.sourceCache.list()
      : [];
    const health = await summarizeDiscoveryHealth({
      stateStore: container.discoveryStateStore,
      sourceCache: container.sourceCache,
    });
    const manual = evaluateRefresh({ policy, states, cacheEntries, requested: "manual" });

    return NextResponse.json({
      ok: true,
      servedFrom: "database",
      lastUpdatedAt: health.lastDiscoveryAt,
      lastUpdatedAgo: health.lastDiscoveryAgo,
      refreshAllowed: manual.allowed,
      refreshBlockedReason: manual.allowed ? null : manual.reason,
      refreshMessage: manual.allowed ? null : manual.message,
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
      sourceWarnings: health.sourceWarnings || [],
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message || "Failed to load discovery status" },
      { status: err?.status || 500 }
    );
  }
}
