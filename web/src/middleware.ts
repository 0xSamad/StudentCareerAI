import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "sc_session";

const PUBLIC_EXACT = new Set(["/login", "/signup"]);
const PUBLIC_PREFIXES = ["/api/auth/", "/api/admin/health"];

const PROTECTED_PAGE_PREFIXES = [
  "/",
  "/internships",
  "/jobs",
  "/applications",
  "/profile",
  "/role-analyzer",
  "/settings",
  "/agent",
];

const PROTECTED_API_PREFIXES = [
  "/api/profile",
  "/api/opportunities",
  "/api/applications",
  "/api/autonomous",
  "/api/settings",
  "/api/dashboard",
  "/api/role-analyzer",
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

function isProtectedPage(pathname: string): boolean {
  if (pathname === "/") return true;
  return PROTECTED_PAGE_PREFIXES.filter((p) => p !== "/").some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

function isProtectedApi(pathname: string): boolean {
  return PROTECTED_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.match(/\.(ico|png|jpg|jpeg|svg|css|js|woff2?)$/)
  ) {
    return NextResponse.next();
  }

  if (isPublic(pathname)) {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    const authed = Boolean(token && token.length > 0);
    if (authed && (pathname === "/login" || pathname === "/signup")) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const authed = Boolean(token && token.length > 0);

  if (isProtectedApi(pathname)) {
    if (!authed) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (isProtectedPage(pathname)) {
    if (!authed) {
      const login = new URL("/login", req.url);
      login.searchParams.set("next", pathname);
      return NextResponse.redirect(login);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/internships/:path*",
    "/jobs/:path*",
    "/applications/:path*",
    "/profile/:path*",
    "/role-analyzer/:path*",
    "/settings/:path*",
    "/agent/:path*",
    "/login",
    "/signup",
    "/api/profile/:path*",
    "/api/opportunities/:path*",
    "/api/applications/:path*",
    "/api/autonomous/:path*",
    "/api/settings/:path*",
    "/api/dashboard/:path*",
    "/api/role-analyzer/:path*",
    "/api/auth/:path*",
    "/api/admin/health",
  ],
};
