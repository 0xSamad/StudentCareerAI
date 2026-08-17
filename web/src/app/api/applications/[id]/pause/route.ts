import { NextResponse } from "next/server";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { studentCareerRoot } from "@/lib/student-career-ai";
import { requireUserSession } from "@/lib/user-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { authContext, container } = await requireUserSession(req);
    const body = await req.json().catch(() => ({}));
    const root = studentCareerRoot();
    const moduleUrl = pathToFileURL(path.join(root, "lib", "saas", "application-queue.mjs")).href;
    const { pauseQueueItem } = await import(/* webpackIgnore: true */ moduleUrl);
    const item = await pauseQueueItem({
      container,
      authContext,
      applicationId: id,
      reason: body.reason || "Paused by student",
    });
    return NextResponse.json({ ok: true, application: item });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ ok: false, error: err.message || "Failed to pause application" }, { status });
  }
}
