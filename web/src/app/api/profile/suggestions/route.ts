import { NextResponse } from "next/server";
import { requireUserSession } from "@/lib/user-session";
import { applyProfileSuggestions } from "../../../../../../lib/saas/knowledge/profile-suggestions.mjs";
import { stripProfileSecrets } from "../../../../../../lib/saas/database/merge-profile.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { userId, tenantId, container } = await requireUserSession(req);
    const usesPg = Boolean(container.postgresClient && !container.postgresClient.isMock);
    if (!usesPg) {
      return NextResponse.json(
        { ok: false, error: "Database is not connected. Profile was not updated." },
        { status: 503 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const accepted = body.suggestions || body.accepted || body;
    const stored = (await container.profileRepository.getByUserId(userId, tenantId)) || {};
    const merged = applyProfileSuggestions(stored, accepted);
    const saved = await container.profileRepository.upsertProfile(userId, tenantId, {
      ...merged,
      cvText: stored.cvText,
    });

    return NextResponse.json({
      ok: true,
      message: "Selected evidence was added to your Profile.",
      profile: stripProfileSecrets(saved),
    });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ ok: false, error: err.message || "Could not add evidence to Profile" }, { status });
  }
}
