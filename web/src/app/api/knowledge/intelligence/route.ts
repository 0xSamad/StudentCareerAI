import { NextResponse } from "next/server";
import { requireUserSession } from "@/lib/user-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { authContext, container } = await requireUserSession(req);
    const intel = container.candidateIntelligenceService;
    if (!intel) {
      return NextResponse.json({ ok: false, error: "Candidate intelligence is not available." }, { status: 503 });
    }
    const profile = await intel.getIntelligenceProfile(authContext);
    return NextResponse.json({ ok: true, profile });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ ok: false, error: err.message || "Failed to load intelligence profile" }, { status });
  }
}
