import { NextResponse } from "next/server";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { studentCareerRoot } from "@/lib/student-career-ai";
import { requireUserSession } from "@/lib/user-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadQueue() {
  const root = studentCareerRoot();
  const moduleUrl = pathToFileURL(path.join(root, "lib", "saas", "application-queue.mjs")).href;
  return import(/* webpackIgnore: true */ moduleUrl);
}

export async function GET(req: Request) {
  try {
    const { authContext, container } = await requireUserSession(req);
    const { listQueue } = await loadQueue();
    const applications = await listQueue({ container, authContext });
    return NextResponse.json({
      total: applications.length,
      applications,
      empty: applications.length === 0,
      empty_message:
        applications.length === 0
          ? "No applications in your queue yet. Open Internships or Jobs, select listings, then Add to Applications."
          : null,
    });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ error: err.message || "Failed to load applications" }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const { authContext, container } = await requireUserSession(req);
    const body = await req.json().catch(() => ({}));
    const { enqueueOpportunities } = await loadQueue();

    const opportunityIds: string[] = [
      ...(Array.isArray(body.opportunityIds) ? body.opportunityIds : []),
      ...(Array.isArray(body.ids) ? body.ids : []),
    ]
      .map((id: unknown) => String(id || "").trim())
      .filter(Boolean);

    if (opportunityIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Select at least one opportunity to add." },
        { status: 400 }
      );
    }

    const result = await enqueueOpportunities({
      container,
      authContext,
      opportunityIds,
      count: body.count,
    });

    return NextResponse.json({
      ok: true,
      submitted: false,
      message:
        result.addedCount === 0
          ? result.skipped?.some((s: { reason?: string }) => s.reason === "not_found")
            ? "Those listings were not found in the opportunity store."
            : "Those opportunities are already in your application queue."
          : `Added ${result.addedCount} to your application queue. Nothing was submitted.`,
      ...result,
    });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ ok: false, error: err.message || "Failed to add to queue" }, { status });
  }
}
