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
    if (job.status !== "COMPLETE") {
      return NextResponse.json({
        ok: true,
        id: job.id,
        status: job.status,
        running: job.status === "RUNNING" || job.status === "PENDING",
        result: null,
        error: job.error || null,
        message: job.message,
      });
    }
    return NextResponse.json({
      ok: true,
      id: job.id,
      status: "COMPLETE",
      running: false,
      result: job.result,
    });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status || 500;
    const message = err instanceof Error ? err.message : "Failed to load analysis results";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
