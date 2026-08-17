import { NextResponse } from "next/server";
import { getSaaSContainer } from "../../../../../../../lib/saas/saas-container.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const container = getSaaSContainer();
    const body = await req.json().catch(() => ({}));
    const userId = body.userId || req.headers.get("x-user-id");
    const tenantId = body.tenantId || req.headers.get("x-tenant-id") || "default";

    if (!userId) {
      return NextResponse.json({ error: "userId is required for application history purge" }, { status: 400 });
    }

    const result = await container.dataPrivacyService.deleteApplicationHistory({
      tenantId,
      userId,
      role: "user",
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to purge application history" },
      { status: err.statusCode || 400 }
    );
  }
}
