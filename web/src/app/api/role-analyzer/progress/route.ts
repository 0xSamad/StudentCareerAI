import { NextResponse } from "next/server";
import { requireUserSession } from "@/lib/user-session";
import { loadRoleAnalyzer } from "@/lib/role-analyzer-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { userId, container } = await requireUserSession(req);
    const url = new URL(req.url);
    const analysisId = String(url.searchParams.get("analysisId") || url.searchParams.get("id") || "").trim();
    if (!analysisId) {
      return NextResponse.json({ ok: false, error: "Pass analysisId." }, { status: 400 });
    }
    const ra = await loadRoleAnalyzer();
    const items = await ra.listProgress(container.postgresClient, userId, analysisId);
    return NextResponse.json({
      ok: true,
      analysisId,
      completed: items.filter((i: { completed?: boolean }) => i.completed).map((i: { itemKey: string }) => i.itemKey),
    });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status || 500;
    const message = err instanceof Error ? err.message : "Failed to load progress";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function PUT(req: Request) {
  try {
    const { userId, container } = await requireUserSession(req);
    const body = (await req.json().catch(() => ({}))) as {
      analysisId?: string;
      itemKey?: string;
      completed?: boolean;
    };
    const analysisId = String(body.analysisId || "").trim();
    const itemKey = String(body.itemKey || "").trim().slice(0, 180);
    if (!analysisId || !itemKey) {
      return NextResponse.json({ ok: false, error: "analysisId and itemKey are required." }, { status: 400 });
    }
    const ra = await loadRoleAnalyzer();
    const row = await ra.upsertProgress(container.postgresClient, {
      userId,
      analysisId,
      itemKey,
      completed: body.completed !== false,
    });
    return NextResponse.json({ ok: true, ...row });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status || 500;
    const message = err instanceof Error ? err.message : "Failed to update progress";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
