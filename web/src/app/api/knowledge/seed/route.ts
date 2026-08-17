import { NextResponse } from "next/server";
import { requireUserSession } from "@/lib/user-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { userId, tenantId, authContext, container } = await requireUserSession(req);
    const stored = await container.profileRepository.getByUserId(userId, tenantId);
    if (!stored) {
      return NextResponse.json(
        { ok: false, status: "UNKNOWN", error: "No saved profile to seed from." },
        { status: 404 }
      );
    }
    const result = await container.candidateKnowledgeService.seedFromProfile(
      stored,
      stored.cvText || "",
      authContext
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ ok: false, error: err.message || "Seed failed" }, { status });
  }
}
