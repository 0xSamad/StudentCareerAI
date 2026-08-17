"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { clearSessionVerifiedCache } from "@/components/auth-gate";

export function LogoutButton({ className }: { className?: string }) {
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } catch {
      /* clearing cookie locally is enough for a stale session */
    } finally {
      clearSessionVerifiedCache();
      window.location.href = "/login";
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-60",
        className
      )}
    >
      <LogOut className="size-4" />
      {loading ? "Signing out…" : "Log out"}
    </button>
  );
}
