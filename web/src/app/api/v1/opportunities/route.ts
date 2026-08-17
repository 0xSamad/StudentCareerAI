/**
 * GET /api/v1/opportunities — SERVE FROM DATABASE.
 *
 * Reads the global Opportunity Store (Postgres opportunity_store table, or the
 * in-memory store offline). Never triggers an external scan: discovery is a
 * separate background operation (POST /api/opportunities/scan).
 *
 * Query params:
 *   type=INTERNSHIP|JOB|OTHER|UNKNOWN
 *   search=<company/title/location substring>
 *   country=<substring>            remote=true|false
 *   status=ACTIVE|EXPIRED|CLOSED|REMOVED|UNKNOWN
 *   savedOnly=true                 includeHidden=true
 *   includeInactive=true           limit / offset
 */
import { NextResponse } from "next/server";
import { requireUserSession } from "@/lib/user-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { userId, container } = await requireUserSession(req);
    const { searchParams } = new URL(req.url);

    const remoteParam = searchParams.get("remote");
    const filters = {
      type: searchParams.get("type") || undefined,
      search: searchParams.get("search") || undefined,
      country: searchParams.get("country") || undefined,
      status: searchParams.get("status") || undefined,
      remote: remoteParam === null ? undefined : remoteParam === "true",
      savedOnly: searchParams.get("savedOnly") === "true",
      includeHidden: searchParams.get("includeHidden") === "true",
      includeInactive: searchParams.get("includeInactive") === "true",
      limit: Number(searchParams.get("limit") || 100),
      offset: Number(searchParams.get("offset") || 0),
    };

    const { total, opportunities } = await container.opportunityStore.list(filters, { userId });
    return NextResponse.json({
      ok: true,
      total,
      count: opportunities.length,
      opportunities,
      servedFrom: "database",
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message || "Failed to load opportunities" },
      { status: err?.status || 500 }
    );
  }
}
