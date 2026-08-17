"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const AUTH_PAGES = new Set(["/login", "/signup"]);

/**
 * Non-blocking session validation.
 * Middleware requires the session cookie; this confirms it server-side in the background.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    if (AUTH_PAGES.has(pathname)) return;

    let active = true;

    fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => {
        if (!active) return;
        if (res.ok) return;
        await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
        if (!active) return;
        const next = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
        window.location.href = `/login${next}`;
      })
      .catch(() => {
        /* Network error — middleware already checked cookie presence; keep UI usable. */
      });

    return () => {
      active = false;
    };
  }, [pathname]);

  return <>{children}</>;
}

/** Kept for logout-button compatibility (no-op). */
export function clearSessionVerifiedCache() {}
