/**
 * session-cookie.mjs — Shared session cookie helpers for Next.js + API server
 */

export const SESSION_COOKIE_NAME = "sc_session";

/**
 * Build a Set-Cookie header value for the auth session.
 * @param {string} token
 * @param {object} [options]
 * @param {string} [options.expiresAt] - ISO expiry
 * @param {boolean} [options.secure]
 * @param {string} [options.sameSite]
 * @param {string} [options.path]
 * @param {number} [options.maxAgeSeconds]
 */
export function buildSessionCookie(token, options = {}) {
  const {
    expiresAt,
    secure = process.env.NODE_ENV === "production",
    sameSite = "Lax",
    path = "/",
    maxAgeSeconds,
  } = options;

  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Path=${path}`,
    "HttpOnly",
    `SameSite=${sameSite}`,
  ];
  if (secure) parts.push("Secure");
  if (typeof maxAgeSeconds === "number") parts.push(`Max-Age=${maxAgeSeconds}`);
  if (expiresAt) parts.push(`Expires=${new Date(expiresAt).toUTCString()}`);
  return parts.join("; ");
}

/**
 * Build a clearing Set-Cookie header.
 */
export function clearSessionCookie(options = {}) {
  const { secure = process.env.NODE_ENV === "production", sameSite = "Lax", path = "/" } = options;
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    `Path=${path}`,
    "HttpOnly",
    `SameSite=${sameSite}`,
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Extract session token from Cookie header and/or Authorization Bearer.
 * @param {string|null|undefined} cookieHeader
 * @param {string|null|undefined} authorizationHeader
 * @returns {string|null}
 */
export function extractSessionToken(cookieHeader, authorizationHeader) {
  if (authorizationHeader && typeof authorizationHeader === "string") {
    const m = authorizationHeader.match(/^Bearer\s+(.+)$/i);
    if (m?.[1]) return m[1].trim();
  }
  if (!cookieHeader || typeof cookieHeader !== "string") return null;
  const parts = cookieHeader.split(";").map((p) => p.trim());
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === SESSION_COOKIE_NAME) {
      const raw = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}

/**
 * NextResponse-friendly cookie options object.
 */
export function sessionCookieOptions(expiresAt) {
  const maxAge = expiresAt
    ? Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
    : 60 * 60 * 24;
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  };
}
