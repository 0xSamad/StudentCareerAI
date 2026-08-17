import { NextResponse } from "next/server";
import { getAuthContainer, SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth-server";
import { authErrorMessage } from "../auth-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const tenantId = typeof body.tenantId === "string" ? body.tenantId : null;

    if (!email || !password) {
      return NextResponse.json({ error: "email and password are required" }, { status: 400 });
    }

    const container = getAuthContainer();
    const login = await container.authService.authenticateUser(email, password, tenantId, {
      userAgent: req.headers.get("user-agent") || "web",
      ipAddress: "127.0.0.1",
    });

    const res = NextResponse.json({
      ok: true,
      user: login.user,
      expiresAt: login.expiresAt,
    });
    res.cookies.set(SESSION_COOKIE_NAME, String(login.token), sessionCookieOptions(login.expiresAt, req));
    return res;
  } catch (err: unknown) {
    return NextResponse.json({ error: authErrorMessage(err, "Login failed") }, { status: 401 });
  }
}
