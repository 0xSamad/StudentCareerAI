import { NextResponse } from "next/server";
import { getAuthContainer, SESSION_COOKIE_NAME, tokenFromRequest } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const token = tokenFromRequest(req);
    const container = getAuthContainer();
    if (token) await container.authService.logout(token);

    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return res;
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Logout failed" }, { status: 400 });
  }
}
