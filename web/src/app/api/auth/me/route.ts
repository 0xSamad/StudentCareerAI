import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = await requireSession(req);
    const user = await session.container.authService.getUserForAuth(session);
    return NextResponse.json({ ok: true, user });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Unauthenticated" },
      { status: err.status || 401 }
    );
  }
}
