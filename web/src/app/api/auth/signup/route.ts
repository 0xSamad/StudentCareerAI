import { NextResponse } from "next/server";
import { getAuthContainer, SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth-server";
import { authErrorMessage } from "../auth-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "Student";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json({ error: "name, email, and password are required" }, { status: 400 });
    }

    const container = getAuthContainer();
    await container.authService.ensureDefaultTenant();
    const reg = await container.authService.signup({ name, email, password });
    const login = await container.authService.authenticateUser(email, password, "default", {
      userAgent: req.headers.get("user-agent") || "web",
      ipAddress: "127.0.0.1",
    });

    const res = NextResponse.json({
      ok: true,
      user: login.user,
      expiresAt: login.expiresAt,
      verificationToken: reg.verificationToken,
    });
    res.cookies.set(SESSION_COOKIE_NAME, String(login.token), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 });
    return res;
  } catch (err: unknown) {
    return NextResponse.json({ error: authErrorMessage(err, "Signup failed") }, { status: 400 });
  }
}
