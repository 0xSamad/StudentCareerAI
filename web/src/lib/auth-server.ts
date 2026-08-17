/**
 * Shared auth helpers for Next.js API routes — in-process AuthService.
 */
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";
import { getSaaSContainer } from "../../../lib/saas/saas-container.mjs";
import {
  SESSION_COOKIE_NAME,
  extractSessionToken,
  sessionCookieOptions as rawSessionCookieOptions,
} from "../../../lib/saas/auth/session-cookie.mjs";

export { SESSION_COOKIE_NAME, extractSessionToken };

export function sessionCookieOptions(expiresAt?: string | null, req?: Request): Partial<ResponseCookie> {
  const opts = rawSessionCookieOptions(expiresAt, req) as {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: string;
    path?: string;
    maxAge?: number;
  };
  return {
    httpOnly: true,
    secure: Boolean(opts.secure),
    sameSite: "lax" as const,
    path: "/",
    maxAge: typeof opts.maxAge === "number" ? opts.maxAge : 60 * 60 * 24,
  };
}

export function getAuthContainer() {
  return getSaaSContainer();
}

export function tokenFromRequest(req: Request): string | null {
  const cookie = req.headers.get("cookie");
  const authorization = req.headers.get("authorization");
  return extractSessionToken(cookie, authorization);
}

export async function requireSession(req: Request) {
  const token = tokenFromRequest(req);
  if (!token) {
    const err = new Error("Authentication required");
    (err as any).status = 401;
    throw err;
  }
  const container = getAuthContainer();
  try {
    const auth = await container.authService.verifyToken(token);
    return { ...auth, token, container };
  } catch (e: any) {
    const err = new Error(e?.message || "Invalid or expired session");
    (err as any).status = 401;
    throw err;
  }
}
