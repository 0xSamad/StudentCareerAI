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
export const maxDuration = 60;

function analysisFromJob(job: { result?: unknown } | null) {
  const result = job?.result as { analysis?: unknown } | null;
  if (!result || typeof result !== "object") return null;
  if (result.analysis && typeof result.analysis === "object") return result.analysis as Record<string, unknown>;
  return result as Record<string, unknown>;
}

export async function GET(req: Request) {
  try {
    const { userId, tenantId, container } = await requireUserSession(req);
    const ra = await loadRoleAnalyzer();
    const url = new URL(req.url);
    const analysisId = String(url.searchParams.get("analysisId") || url.searchParams.get("id") || "").trim();
    const durationRaw = url.searchParams.get("durationMonths") || url.searchParams.get("duration") || "6";
    let months: number;
    try {
      months = ra.parseDurationMonths({ durationMonths: durationRaw });
    } catch (err) {
      return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Invalid duration" }, { status: 400 });
    }

    const stored = await container.profileRepository.getByUserId(userId, tenantId);
    const profile = shapeStudentProfile(stored);
    const cvText = loadCvText(stored);

    if (analysisId) {
      const job = await ra.loadRun(container.postgresClient, analysisId, userId);
      if (!job) {
        return NextResponse.json({ ok: false, error: "Analysis not found." }, { status: 404 });
      }
      if (job.status !== "COMPLETE") {
        return NextResponse.json({
          ok: true,
          id: job.id,
          status: job.status,
          running: true,
          readiness: null,
          message: "Analysis still running.",
        });
      }
      const analysis = analysisFromJob(job);
      if (!analysis?.role) {
        return NextResponse.json({ ok: false, error: "Analysis has no result." }, { status: 409 });
      }
      const view = ra.buildReadinessView({ analysis, durationMonths: months });
      return NextResponse.json({ ok: true, status: "COMPLETE", analysisId, ...view });
    }

    const role = String(url.searchParams.get("role") || url.searchParams.get("targetRole") || "").trim();
    if (!role) {
      return NextResponse.json(
        { ok: false, error: "Pass analysisId or role to compute readiness." },
        { status: 400 }
      );
    }
    const marketScope = parseMarketScope(url.searchParams.get("market") || url.searchParams.get("marketScope"));
    const { result } = await ra.analyzeRoleReadiness({
      role,
      marketScope,
      profile,
      cvText,
      opportunityStore: container.opportunityStore,
      repoRoot: studentCareerRoot(),
      postgresClient: container.postgresClient,
      forceRefresh: false,
      allowNetwork: false,
    });
    const view = ra.buildReadinessView({ analysis: result, durationMonths: months });
    return NextResponse.json({ ok: true, status: "COMPLETE", ...view });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status || 500;
    const message = err instanceof Error ? err.message : "Failed to load readiness";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
