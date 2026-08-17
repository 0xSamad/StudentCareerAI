import { NextResponse } from "next/server";
import { studentCareerRoot } from "@/lib/student-career-ai";
import { requireUserSession } from "@/lib/user-session";
import {
  loadCvText,
  loadRoleAnalyzer,
  parseMarketScope,
  shapeStudentProfile,
} from "@/lib/role-analyzer-server";

function analysisFromJob(job: { result?: unknown } | null) {
  const result = job?.result as { analysis?: unknown; roadmap?: unknown } | null;
  if (!result || typeof result !== "object") return null;
  if (result.analysis && typeof result.analysis === "object") return result.analysis as Record<string, unknown>;
  return result as Record<string, unknown>;
}

export async function handleRoadmapPost(req: Request, { requireCustomDuration }: { requireCustomDuration: boolean }) {
  const { userId, tenantId, container } = await requireUserSession(req);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const ra = await loadRoleAnalyzer();

  if (requireCustomDuration) {
    const raw = body.durationMonths ?? body.duration ?? body.months;
    if (raw == null || raw === "") {
      return NextResponse.json(
        { ok: false, error: "Specify durationMonths (for example 3, 5, 8, or 12)." },
        { status: 400 }
      );
    }
  }

  let months: number;
  try {
    months = ra.parseDurationMonths(body);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Invalid duration" }, { status: 400 });
  }
  if (requireCustomDuration && (body.durationMonths == null || body.durationMonths === "") && months === 2) {
    const explicit = Number(body.duration ?? body.months);
    if (!Number.isFinite(explicit)) {
      return NextResponse.json(
        { ok: false, error: "Specify durationMonths (for example 3, 5, 8, or 12)." },
        { status: 400 }
      );
    }
  }
  if (!Number.isFinite(months) || months < 1 || months > 18) {
    return NextResponse.json({ ok: false, error: "durationMonths must be between 1 and 18." }, { status: 400 });
  }

  const stored = await container.profileRepository.getByUserId(userId, tenantId);
  const profile = shapeStudentProfile(stored);
  const cvText = loadCvText(stored);
  const useAi = body.useAi !== false;
  const analysisId = String(body.analysisId || body.id || "").trim();

  if (analysisId) {
    const job = await ra.loadRun(container.postgresClient, analysisId, userId);
    if (!job) {
      return NextResponse.json({ ok: false, error: "Analysis not found." }, { status: 404 });
    }
    if (job.status !== "COMPLETE") {
      return NextResponse.json(
        { ok: false, error: "Analysis is still running. Wait, then retry with the same analysisId." },
        { status: 409 }
      );
    }
    const analysis = analysisFromJob(job);
    if (!analysis?.role) {
      return NextResponse.json({ ok: false, error: "Analysis has no result to plan from." }, { status: 409 });
    }
    const roadmap = await ra.buildRoleRoadmap({
      analysis,
      profile,
      cvText,
      durationMonths: months,
      matchingConfig: profile.matching,
      useAi,
    });
    return NextResponse.json({
      ok: true,
      status: "COMPLETE",
      running: false,
      analysisId,
      durationMonths: months,
      roadmap,
    });
  }

  const role = String(body.role || body.targetRole || "").trim();
  if (!role) {
    return NextResponse.json(
      { ok: false, error: "Enter a target role, or pass analysisId from a completed analysis." },
      { status: 400 }
    );
  }
  const marketScope = parseMarketScope(body.market || body.marketScope || body.region);
  const refresh = body.refresh === true || body.forceRefresh === true;
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
        forceRefresh: refresh,
        allowNetwork: true,
        matchingConfig: profile.matching,
        onProgress,
      });
      onProgress({ phase: "roadmap", percent: 92, message: "Building personalized roadmap" });
      const roadmap = await ra.buildRoleRoadmap({
        analysis: result,
        profile,
        cvText,
        durationMonths: months,
        matchingConfig: profile.matching,
        useAi,
      });
      const combined = { ...result, roadmap };
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
        result: combined,
        cacheKey,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMonths: months,
      });
      return combined;
    },
  });

  return NextResponse.json({
    ok: true,
    id,
    status: "RUNNING",
    running: true,
    durationMonths: months,
    message: "Building a personalized roadmap from analyzed job data and your profile…",
  });
}
