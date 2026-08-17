import { NextResponse } from "next/server";
import { requireUserSession } from "@/lib/user-session";
import { loadRoleAnalyzer } from "@/lib/role-analyzer-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId, container } = await requireUserSession(req);
    const { id } = await params;
    const ra = await loadRoleAnalyzer();
    const job = await ra.loadRun(container.postgresClient, id, userId);
    if (!job) {
      return NextResponse.json({ ok: false, error: "Analysis not found." }, { status: 404 });
    }
    return NextResponse.json(ra.publicAnalysisJob(job));
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status || 500;
    const message = err instanceof Error ? err.message : "Failed to read analysis status";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
