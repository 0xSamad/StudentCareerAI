import { NextResponse } from "next/server";
import { requireUserSession } from "@/lib/user-session";
import { attachProfileSuggestions } from "../../../../../../lib/saas/knowledge/profile-suggestions.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { authContext, userId, tenantId, container } = await requireUserSession(req);
    const body = await req.json().catch(() => ({}));
    const source = String(body.source || body.kind || "").toLowerCase();

    const stored = await container.profileRepository.getByUserId(userId, tenantId);
    const incomingToken = String(body.token || body.githubToken || "").trim();
    if (incomingToken) {
      await container.profileRepository.upsertProfile(userId, tenantId, {
        ...stored,
        secrets: { githubToken: incomingToken },
        cvText: stored?.cvText,
      });
    }
    const token = incomingToken || stored?.secrets?.githubToken || "";

    let payload = {
      source,
      url: body.url || body.githubUrl || body.linkedinUrl || body.profileUrl,
      username: body.username || body.handle || body.login,
      text: body.text || body.paste || body.content,
      token,
    };

    const identity = stored?.identity || {};
    if (source === "github") payload.url = payload.url || identity.github;
    if (source === "linkedin") payload.url = payload.url || identity.linkedin;
    if (source === "portfolio" || source === "website") {
      payload.url = payload.url || identity.portfolio;
    }

    const result = await container.candidateKnowledgeService.enrichFromExternalProfile(payload, authContext);
    const { token: _omit, ...safe } = attachProfileSuggestions(result, stored, source);
    return NextResponse.json({
      ...safe,
      tokenStored: Boolean(token),
    }, { status: result.ok ? 200 : 400 });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ ok: false, status: "UNKNOWN", error: err.message || "Enrichment failed" }, { status });
  }
}
