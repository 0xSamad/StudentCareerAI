/**
 * /api/v1/opportunities/saved — per-user state on global opportunities.
 *
 * GET    → list this user's saved/ignored/applied/hidden opportunities
 * POST   → { opportunityId, status: SAVED|IGNORED|APPLIED|HIDDEN } (upsert)
 * DELETE → ?opportunityId=… or { opportunityId } (unsave: remove the state row)
 *
 * The opportunity itself stays in the global store — only this user's
 * relationship to it changes. Another user's state is never affected.
 */
import { NextResponse } from "next/server";
import { requireUserSession } from "@/lib/user-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { userId, container } = await requireUserSession(req);
    const saved = await container.opportunityStore.listUserStates(userId);
    return NextResponse.json({ ok: true, total: saved.length, saved });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message || "Failed to load saved opportunities" },
      { status: err?.status || 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const { userId, tenantId, container } = await requireUserSession(req);
    const body = await req.json().catch(() => ({}));
    const opportunityId = String(body.opportunityId || "").trim();
    if (!opportunityId) {
      return NextResponse.json({ ok: false, error: "opportunityId is required" }, { status: 400 });
    }
    const opportunity = await container.opportunityStore.getById(opportunityId);
    if (!opportunity) {
      return NextResponse.json({ ok: false, error: "Opportunity not found" }, { status: 404 });
    }
    const state = await container.opportunityStore.setUserState({
      userId,
      tenantId,
      opportunityId,
      status: body.status || "SAVED",
    });
    return NextResponse.json({ ok: true, state });
  } catch (err: any) {
    const status = /invalid saved status/i.test(err?.message || "") ? 400 : err?.status || 500;
    return NextResponse.json(
      { ok: false, error: err.message || "Failed to update saved opportunity" },
      { status }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const { userId, container } = await requireUserSession(req);
    const { searchParams } = new URL(req.url);
    let opportunityId = searchParams.get("opportunityId") || "";
    if (!opportunityId) {
      const body = await req.json().catch(() => ({}));
      opportunityId = String(body.opportunityId || "");
    }
    if (!opportunityId) {
      return NextResponse.json({ ok: false, error: "opportunityId is required" }, { status: 400 });
    }
    const removed = await container.opportunityStore.clearUserState({ userId, opportunityId });
    return NextResponse.json({ ok: true, removed });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message || "Failed to remove saved opportunity" },
      { status: err?.status || 500 }
    );
  }
}
