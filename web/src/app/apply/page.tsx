import { Send } from "lucide-react";
import { ApplyView } from "@/components/apply-view";
import { ApplyBackdropMount } from "@/components/apply/apply-backdrop-mount";
import { UrlApplyBar } from "@/components/apply/url-apply-bar";
import { MultiUrlApplyPanel } from "@/components/apply/multi-url-apply-panel";

export const dynamic = "force-dynamic";

export default function ApplyPage() {
  return (
    <div className="relative min-h-screen">
      <ApplyBackdropMount />
      <div className="relative z-10 mx-auto max-w-4xl px-6 py-8 space-y-8">
        <div>
          <div className="flex items-center gap-3">
            <Send className="size-6 text-brand" />
            <h1 className="font-display text-2xl tracking-tight text-landing">Apply by URL</h1>
          </div>
          <p className="mt-1.5 max-w-xl text-sm text-muted">
            Paste one or more job links. Each URL is its own application with its own tailored documents and form. Chrome
            fills attested fields. You submit. Nothing is submitted for you.
          </p>
        </div>
        <MultiUrlApplyPanel />
        <UrlApplyBar />
        <details className="rounded-2xl border border-border bg-surface/60 p-4">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            Preview the form in this tab instead
          </summary>
          <p className="mt-2 mb-4 text-xs text-muted">
            Reads the employer form and shows it here in plain language. Prefer URL apply above when card Apply is flaky.
          </p>
          <ApplyView />
        </details>
      </div>
    </div>
  );
}

