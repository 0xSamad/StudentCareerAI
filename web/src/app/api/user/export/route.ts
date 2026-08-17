import { NextResponse } from "next/server";
import { getSaaSContainer } from "../../../../../../lib/saas/saas-container.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const container = getSaaSContainer();
    const url = new URL(req.url);
    const userId = url.searchParams.get("userId") || req.headers.get("x-user-id") || "current_user";
    const tenantId = url.searchParams.get("tenantId") || req.headers.get("x-tenant-id") || "default";

    const exportData = await container.dataPrivacyService.exportUserData({
      tenantId,
      userId,
      role: "user",
    });

    return NextResponse.json(exportData, {
      headers: {
        "Content-Disposition": `attachment; filename="studentcareer_data_${userId}.json"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to export user data" },
      { status: err.statusCode || 400 }
    );
  }
}
