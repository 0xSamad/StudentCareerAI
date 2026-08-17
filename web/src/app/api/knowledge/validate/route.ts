import { NextResponse } from "next/server";
import { requireUserSession } from "@/lib/user-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { authContext, container } = await requireUserSession(req);
    const body = await req.json().catch(() => ({}));
    const claim = body.claim ?? body.text ?? body;
    const result = await container.candidateKnowledgeService.validateGeneratedClaim(claim, authContext);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ ok: false, error: err.message || "Validation failed" }, { status });
  }
}
