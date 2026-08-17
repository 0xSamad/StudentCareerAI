import { NextResponse } from "next/server";
import { requireUserSession } from "@/lib/user-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREPARED_STATES = new Set([
  "CV_GENERATED",
  "APPLICATION_READY",
  "PREPARED",
  "DRY_RUN",
  "APPLYING",
  "SELECTED",
]);

const SUBMITTED_STATES = new Set(["SUBMITTED", "APPLIED"]);

export async function GET(req: Request) {
  try {
    const { authContext, container } = await requireUserSession(req);
    const [apps, opportunityCount, metrics] = await Promise.all([
      container.applicationRepository.findMany({}, authContext),
      container.opportunityRepository.countByFilters({}, authContext),
      container.applicationRepository.getMetrics(authContext.userId, authContext.tenantId),
    ]);

    const eligible = apps.filter((q: any) => (q.eligibility_status || q.eligibilityStatus) === "ELIGIBLE").length;
    const rejected = apps.filter(
      (q: any) => (q.eligibility_status || q.eligibilityStatus) === "NOT_ELIGIBLE" || q.state === "NOT_ELIGIBLE"
    ).length;
    const strongMatches = apps.filter((q: any) => {
      const score = typeof q.match_score === "number" ? q.match_score : q.matchScore;
      return typeof score === "number" && score >= 80;
    }).length;
    const applicationsPrepared = apps.filter((q: any) => PREPARED_STATES.has(q.state)).length;
    const applicationsSubmitted = apps.filter(
      (q: any) =>
        SUBMITTED_STATES.has(q.state) &&
        q.dry_run !== true &&
        (q.submitted_at || q.applied_at)
    ).length;
    const failed = apps.filter((q: any) => q.state === "FAILED" || q.state === "BLOCKED").length;

    return NextResponse.json({
      opportunitiesFound: opportunityCount,
      eligible,
      rejected,
      strongMatches,
      applicationsPrepared,
      applicationsSubmitted,
      failed,
      interviews: metrics?.interviews || 0,
      responses: metrics?.responses || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ error: err.message || "Failed to load dashboard stats" }, { status });
  }
}
