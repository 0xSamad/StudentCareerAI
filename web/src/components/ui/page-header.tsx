import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type PageHeaderProps = {
  title: string;
  description?: string;
  badge?: string;
  badgeVariant?: "brand" | "success" | "neutral";
  actions?: ReactNode;
  className?: string;
};

const badgeStyles = {
  brand: "bg-brand/10 text-brand border-brand/20",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
  neutral: "bg-surface-hover text-muted border-border",
};

export function PageHeader({
  title,
  description,
  badge,
  badgeVariant = "brand",
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6",
        className
      )}
    >
      <div className="space-y-2 max-w-3xl">
        {badge ? (
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
              badgeStyles[badgeVariant]
            )}
          >
            {badge}
          </span>
        ) : null}
        <h1 className="text-2xl md:text-3xl font-semibold text-foreground tracking-tight">{title}</h1>
        {description ? (
          <p className="text-sm text-muted leading-relaxed">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function FormField({
  label,
  hint,
  children,
  error,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  error?: string | null;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
      {hint && !error ? <span className="block text-xs text-faint">{hint}</span> : null}
      {error ? <span className="block text-xs text-red-600 dark:text-red-400">{error}</span> : null}
    </label>
  );
}

export const inputClassName =
  "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60";

export const buttonPrimaryClassName =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-200 disabled:opacity-60 disabled:cursor-not-allowed";

export const buttonSecondaryClassName =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-surface-hover disabled:opacity-60";
