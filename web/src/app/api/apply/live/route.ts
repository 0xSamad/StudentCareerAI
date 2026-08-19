import { NextResponse } from "next/server";
import { requireUserSession } from "@/lib/user-session";
import { getUrlApplyBatch } from "@/lib/apply/multi-url-apply.mjs";
import { dispatchApplyPointerBatch, latestLiveJpeg } from "@/lib/apply/session";
import { setHitlPersistPath, loadHitlPersist } from "@/lib/apply/hitl-state.mjs";
import path from "node:path";
import { studentCareerRoot } from "@/lib/student-career-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let persistWired = false;
let batchPersistReady: Promise<void> | null = null;

async function wirePersist() {
  if (persistWired) return;
  setHitlPersistPath(path.join(studentCareerRoot(), "data", "apply-hitl-state.json"));
  loadHitlPersist();
  batchPersistReady ??= import("@/lib/apply/application-manager.mjs").then(({ setBatchPersistPath }) => {
    setBatchPersistPath(path.join(studentCareerRoot(), "data", "apply-batches.json"));
  });
  await batchPersistReady;
  persistWired = true;
}

async function ownedJob(req: Request, batchId: string, jobId: string) {
  const { userId } = await requireUserSession(req);
  await wirePersist();
  const batch = getUrlApplyBatch(batchId, { userId });
  const job = (batch?.jobs || []).find((row: { id: string }) => row.id === jobId);
  if (!batch || !job) return null;
  return { batch, job };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const batchId = url.searchParams.get("batchId") || "";
    const jobId = url.searchParams.get("jobId") || "";
    if (!batchId || !jobId) {
      return NextResponse.json({ ok: false, error: "batchId and jobId are required" }, { status: 400 });
    }
    const owned = await ownedJob(req, batchId, jobId);
    if (!owned) return NextResponse.json({ ok: false, error: "Application not found." }, { status: 404 });
    const sessionId = String(owned.job.sessionId || "");
    const wantsImage = url.searchParams.get("image") === "1" || (req.headers.get("accept") || "").includes("image/jpeg");

    if (wantsImage) {
      if (!sessionId) return new NextResponse(null, { status: 204 });
      const live = await latestLiveJpeg(sessionId);
      if (!live) return new NextResponse(null, { status: 204 });
      const etag = `"${live.at}"`;
      if (req.headers.get("if-none-match") === etag) {
        return new NextResponse(null, { status: 304, headers: { ETag: etag, "Cache-Control": "no-store" } });
      }
      return new NextResponse(new Uint8Array(live.buf), {
        status: 200,
        headers: {
          "Content-Type": "image/jpeg",
          ETag: etag,
          "Cache-Control": "no-store",
          "X-Apply-Url": encodeURIComponent(live.url || ""),
        },
      });
    }

    return NextResponse.json({
      ok: true,
      pageUrl: owned.job.url,
      title: owned.job.role,
      sessionId: sessionId || null,
      phase: owned.job.phase,
      message: owned.job.message,
      waitingFields: owned.job.waitingFields || [],
      actionRequired: owned.job.actionRequired || null,
    });
  } catch (err: unknown) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as { status?: number }).status) || 500 : 500;
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Could not load the application window." },
      { status },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const batchId = String(body.batchId || "").trim();
    const jobId = String(body.jobId || "").trim();
    const owned = await ownedJob(req, batchId, jobId);
    if (!owned) return NextResponse.json({ ok: false, error: "Application not found." }, { status: 404 });
    const sessionId = String(body.sessionId || owned.job.sessionId || "");
    if (!sessionId) return NextResponse.json({ ok: false, error: "The form is not open yet." }, { status: 409 });
    const events = Array.isArray(body.events) ? body.events : [body];
    await dispatchApplyPointerBatch(sessionId, events.slice(0, 40));
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as { status?: number }).status) || 500 : 500;
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Could not send that click." },
      { status },
    );
  }
}
