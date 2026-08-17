import type { ReactNode } from "react";
import { CoMark } from "@/components/co-mark";
import { Lock, ShieldCheck, Globe } from "lucide-react";

type AuthLayoutProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <main className="min-h-[100dvh] grid lg:grid-cols-2 bg-background">
      {/* Brand panel */}
      <section className="hidden lg:flex flex-col justify-between border-r border-border bg-surface/40 px-12 py-14">
        <div>
          <div className="flex items-center gap-3 mb-10">
            <CoMark size={40} />
            <div>
              <p className="font-display text-2xl text-foreground tracking-tight">StudentCareer AI</p>
              <p className="text-sm text-muted">Career intelligence platform for students</p>
            </div>
          </div>

          <h2 className="font-display text-3xl text-foreground leading-snug max-w-md">
            Verified opportunities. Profile-matched applications. Student-first security.
          </h2>
          <p className="mt-4 text-sm text-muted max-w-md leading-relaxed">
            Discover internships and graduate roles from official employer career pages,
            matched to your profile with eligibility checks before anything is shown.
          </p>
        </div>

        <ul className="space-y-3 text-sm text-muted">
          <li className="flex items-center gap-2.5">
            <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            Multi-tenant isolation — your data stays in your account
          </li>
          <li className="flex items-center gap-2.5">
            <Lock className="size-4 text-brand shrink-0" />
            PBKDF2 password hashing, HttpOnly sessions, rate-limited login
          </li>
          <li className="flex items-center gap-2.5">
            <Globe className="size-4 text-brand shrink-0" />
            National & international ATS sources (Greenhouse, Lever, Ashby, Workable)
          </li>
        </ul>
      </section>

      {/* Form panel */}
      <section className="flex flex-col justify-center px-6 py-12 sm:px-10 lg:px-16">
        <div className="mx-auto w-full max-w-md">
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <CoMark size={32} />
            <span className="font-display text-xl text-foreground">StudentCareer AI</span>
          </div>

          <header className="mb-8">
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">{title}</h1>
            <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
          </header>

          <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
            {children}
          </div>

          {footer ? <div className="mt-6 text-center text-sm text-muted">{footer}</div> : null}

          <p className="mt-8 text-center text-[11px] text-faint leading-relaxed">
            By continuing you agree to use this platform responsibly. Applications are prepared for your review;
            live submission requires explicit confirmation.
          </p>
        </div>
      </section>
    </main>
  );
}
