import { NextResponse } from "next/server";
import { studentCareerRoot } from "@/lib/student-career-ai";
import { requireUserSession } from "@/lib/user-session";
import {
  loadCvText,
  loadRoleAnalyzer,
  parseMarketScope,
  shapeStudentProfile,
} from "@/lib/role-analyzer-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

async function startRoleAnalysis(req: Request, forceRefresh: boolean) {
  const { userId, tenantId, container } = await requireUserSession(req);
  const body = await req.json().catch(() => ({}));
  const role = String(body.role || body.targetRole || "").trim();
  if (!role) {
    return NextResponse.json({ ok: false, error: "Enter one target career role." }, { status: 400 });
  }
  const marketScope = parseMarketScope(body.market || body.marketScope || body.region);
  const refresh = forceRefresh || body.refresh === true || body.forceRefresh === true;

  const stored = await container.profileRepository.getByUserId(userId, tenantId);
  const profile = shapeStudentProfile(stored);
  const cvText = loadCvText(stored);

  const ra = await loadRoleAnalyzer();
  const id = ra.newAnalysisId();
  const startedAt = new Date().toISOString();
  const family = ra.resolveRoleFamily(role);
  await ra.persistRun(container.postgresClient, {
    id,
    tenantId,
    userId,
    canonicalRole: family.canonical || role,
    rawRole: role,
    marketScope,
    status: "RUNNING",
    forceRefresh: refresh,
    searchedTitles: ra.searchedTitlesFor(family),
    startedAt,
  });

  ra.startAnalysisJob({
    id,
    userId,
    family,
    searchType: family.searchType,
    run: async (job: { message?: string; phase?: string; progressPercent?: number }) => {
      const onProgress = (payload: { message?: string; phase?: string; percent?: number }) => ra.applyJobProgress(job, payload);
      const { result, cacheKey, family } = await ra.analyzeRoleReadiness({
        role,
        marketScope,
        profile,
        cvText,
        opportunityStore: container.opportunityStore,
        repoRoot: studentCareerRoot(),
        postgresClient: container.postgresClient,
        forceRefresh: refresh,
        matchingConfig: profile.matching,
        onProgress,
      });
      await ra.persistRun(container.postgresClient, {
        id,
        tenantId,
        userId,
        canonicalRole: family.canonical,
        rawRole: role,
        marketScope,
        status: "COMPLETE",
        forceRefresh: refresh,
        searchedTitles: result.searchedTitles,
        result,
        cacheKey,
        startedAt,
        completedAt: new Date().toISOString(),
      });
      return result;
    },
  });

  return NextResponse.json({
    ok: true,
    id,
    status: "RUNNING",
    running: true,
    message: refresh
      ? "Refreshing industry data and comparing it to your profile…"
      : "Analyzing stored listings and industry sources for this role…",
  });
}

export async function POST(req: Request) {
  try {
    return await startRoleAnalysis(req, false);
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status || 500;
    const message = err instanceof Error ? err.message : "Failed to start analysis";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
