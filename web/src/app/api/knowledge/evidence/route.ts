import { NextResponse } from "next/server";
import { requireUserSession } from "@/lib/user-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { authContext, container } = await requireUserSession(req);
    const url = new URL(req.url);
    const q = url.searchParams.get("q") || url.searchParams.get("query") || "";
    if (!q.trim()) {
      return NextResponse.json({
        status: "UNKNOWN",
        query: q,
        evidence: [],
        facts: [],
        reason: "UNKNOWN: empty query.",
      });
    }
    const result = await container.candidateKnowledgeService.retrieveRelevantEvidence(q, authContext);
    return NextResponse.json(result);
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ status: "UNKNOWN", error: err.message || "Evidence lookup failed" }, { status });
  }
}
