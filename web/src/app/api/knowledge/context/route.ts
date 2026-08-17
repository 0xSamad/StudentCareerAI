import { NextResponse } from "next/server";
import { requireUserSession } from "@/lib/user-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { authContext, container } = await requireUserSession(req);
    const body = await req.json().catch(() => ({}));
    const opportunity = body.opportunity || body;
    const purpose = body.purpose || "matching";
    const builder = container.candidateContextBuilder;
    const result = builder
      ? await builder.build(opportunity, authContext, { purpose })
      : await container.candidateKnowledgeService.getCandidateContextForOpportunity(
          opportunity,
          authContext,
          { purpose }
        );
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ ok: false, error: err.message || "Context retrieval failed" }, { status });
  }
}
