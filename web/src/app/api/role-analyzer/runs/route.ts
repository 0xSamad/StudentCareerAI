import { NextResponse } from "next/server";
import { requireUserSession } from "@/lib/user-session";
import { loadRoleAnalyzer } from "@/lib/role-analyzer-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { userId, container } = await requireUserSession(req);
    const url = new URL(req.url);
    const savedOnly = url.searchParams.get("saved") === "1" || url.searchParams.get("saved") === "true";
    const ra = await loadRoleAnalyzer();
    const runs = await ra.listRuns(container.postgresClient, userId, { savedOnly });
    return NextResponse.json({ ok: true, runs });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status || 500;
    const message = err instanceof Error ? err.message : "Failed to list analyses";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
