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
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const { userId, tenantId, container } = await requireUserSession(req);
    const body = await req.json().catch(() => ({}));
    const role = String(body.role || body.targetRole || "").trim();
    if (!role) {
      return NextResponse.json({ ok: false, error: "Enter one target career role." }, { status: 400 });
    }
    const marketScope = parseMarketScope(body.market || body.marketScope || body.region);
    const stored = await container.profileRepository.getByUserId(userId, tenantId);
    const profile = shapeStudentProfile(stored);
    const cvText = loadCvText(stored);
    const ra = await loadRoleAnalyzer();
    const id = ra.newAnalysisId();
    const startedAt = new Date().toISOString();
    const family = ra.resolveRoleFamily(role);

    ra.startAnalysisJob({
      id,
      userId,
      family,
      searchType: family.searchType,
      run: async (job: { message?: string }) => {
        const onProgress = (payload: { message?: string; phase?: string; percent?: number }) =>
          ra.applyJobProgress(job, payload);
        const { result, cacheKey } = await ra.analyzeRoleReadiness({
          role,
          marketScope,
          profile,
          cvText,
          opportunityStore: container.opportunityStore,
          repoRoot: studentCareerRoot(),
          postgresClient: container.postgresClient,
          forceRefresh: true,
          allowNetwork: true,
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
          forceRefresh: true,
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
      message: "Refreshing industry data from ATS providers and stored listings…",
    });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status || 500;
    const message = err instanceof Error ? err.message : "Failed to refresh industry data";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
