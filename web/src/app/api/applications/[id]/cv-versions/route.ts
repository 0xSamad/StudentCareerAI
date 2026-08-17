import { NextResponse } from "next/server";
import { requireUserSession } from "@/lib/user-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { authContext, container } = await requireUserSession(req);
    const engine = container.cvDecisionEngine;
    if (!engine) {
      return NextResponse.json({ ok: true, versions: [] });
    }

    const app =
      (await container.applicationRepository.getById?.(id, authContext)) ||
      (await container.applicationRepository.getByOpportunityId?.(id, authContext.userId, authContext.tenantId));

    let versions = await engine.listVersions(authContext, { applicationId: app?.id || id });
    if (!versions.length) {
      versions = await engine.listVersions(authContext, { opportunityId: app?.opportunity_id || id });
    }

    return NextResponse.json({
      ok: true,
      versions: versions.map((v: any) => ({
        id: v.id,
        kind: v.kind,
        reason: v.reason,
        changes: v.changes || [],
        decision: v.decision || {},
        validation: v.validation || {},
        createdAt: v.createdAt,
        cvHtml: v.cvHtml || null,
        cvText: v.kind === "MASTER" || v.kind === "REUSED" ? v.cvText : undefined,
      })),
    });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ ok: false, error: err.message || "Failed to load CV versions" }, { status });
  }
}
