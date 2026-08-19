"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { CoMark } from "@/components/co-mark";
import { MobileNav } from "@/components/mobile-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { JobsProvider } from "@/components/jobs/job-store";
import { PipelineProvider } from "@/components/pipeline/pipeline-provider";
import { ApplyProvider } from "@/components/apply/apply-provider";
import { ExploreProvider } from "@/components/explore/explore-provider";
import { FirstScoreView } from "@/components/explore/first-score-view";
import { BetaBanner } from "@/components/beta/beta-banner";
import { WorkerPills } from "@/components/jobs/worker-pills";
import { UsageMeter } from "@/components/usage-meter";
import { LogoutButton } from "@/components/logout-button";
import { AuthGate } from "@/components/auth-gate";
import { NAV_ITEMS, isActivePath } from "@/lib/nav-items";

const AUTH_PAGES = new Set(["/login", "/signup"]);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (AUTH_PAGES.has(pathname)) {
    return <>{children}</>;
  }

  if (pathname.startsWith("/apply/review") || pathname.startsWith("/apply/live")) {
    return <AuthGate>{children}</AuthGate>;
  }

  return (
    <AuthGate>
    <JobsProvider>
      <PipelineProvider>
      <ApplyProvider>
      <ExploreProvider>
      <MobileNav />
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface/50 backdrop-blur-sm p-5 md:flex">
          <Link href="/" className="mb-8 flex items-center gap-3 px-1 group">
            <CoMark size={36} />
            <div className="flex flex-col min-w-0">
              <span className="text-[15px] font-semibold tracking-tight text-foreground truncate">
                StudentCareer AI
              </span>
              <span className="text-[11px] text-muted">Student career platform</span>
            </div>
          </Link>
          <nav className="flex flex-col gap-0.5" aria-label="Main navigation">
            {NAV_ITEMS.map(({ href, label, icon: Icon, chip }) => {
              const active = isActivePath(href, pathname);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-brand-soft text-brand-text"
                      : "text-muted hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                  {chip && (
                    <span className="ml-auto rounded-full border border-brand/30 bg-brand-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-text">
                      {chip}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          <WorkerPills />

          <div className="mt-auto space-y-3 pt-4">
            <UsageMeter />
            <LogoutButton />
            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] text-faint uppercase tracking-wider">Secure session</span>
              <ThemeToggle />
            </div>
          </div>
        </aside>
        <main className="flex-1 overflow-x-hidden">{children}</main>
        <FirstScoreView />
        <BetaBanner />
      </div>
      </ExploreProvider>
      </ApplyProvider>
      </PipelineProvider>
    </JobsProvider>
    </AuthGate>
  );
}
