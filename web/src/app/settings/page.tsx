"use client";

import { useEffect, useState } from "react";
import {
  Sliders,
  ShieldAlert,
  Cpu,
  Target,
  Clock,
  MapPin,
  Save,
  CheckCircle2,
  AlertTriangle,
  Lock,
  RefreshCw
} from "lucide-react";
import { cn } from "@/lib/cn";

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [settings, setSettings] = useState({
    autonomousMode: false,
    autoSubmit: false,
    applicationsPerDay: 10,
    minScore: 70,
    scanIntervalMinutes: 30,
    autoScanEnabled: false,
    locations: ["Lahore, Pakistan", "Karachi, Pakistan", "Remote", "Global"],
    remote: "Hybrid / Remote Preferred",
    targetRoles: ["Software Engineer Intern", "AI/ML Intern", "Backend Engineer Intern", "Data Analyst Intern"],
    safety: {
      requireEligibility: true,
      requireConfidentAnswers: true,
      pauseOnError: true,
      pauseOnCaptcha: true,
      pauseOnAuthFailure: true,
      pauseOnUnexpectedForm: true,
      pauseOnSensitiveQuestion: true,
    },
  });

  const fetchSettings = () => {
    setLoading(true);
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        setSettings((prev) => ({
          ...prev,
          ...d,
          safety: { ...prev.safety, ...(d.safety || {}) },
        }));
      })
      .catch((err) => console.error("Error fetching settings:", err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      console.error("Error saving settings:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8 space-y-8 max-sm:pb-24">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-brand/10 text-brand px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider">
              Control Center
            </span>
          </div>
          <h1 className="text-3xl font-bold text-foreground mt-2 tracking-tight flex items-center gap-2.5">
            <Sliders className="size-8 text-brand" />
            System & Safety Settings
          </h1>
          <p className="text-sm text-muted mt-1 max-w-2xl">
            Configure application rates, minimum match score thresholds, portal scan cadences, and fail-safe safety guards.
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold shadow-sm transition-all",
            saved
              ? "bg-emerald-600 text-white"
              : "bg-brand text-brand-foreground hover:bg-brand-200 active:scale-95"
          )}
        >
          {saved ? (
            <>
              <CheckCircle2 className="size-4" /> Settings Saved
            </>
          ) : saving ? (
            "Saving..."
          ) : (
            <>
              <Save className="size-4" /> Save Changes
            </>
          )}
        </button>
      </div>

      <div className="space-y-6">
            {/* Section 1: Autonomous Mode & Submission Review Gating */}
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-xs space-y-5">
          <h3 className="text-base font-bold text-foreground flex items-center gap-2">
            <Cpu className="size-4 text-brand" />
            Application Agent Controls
          </h3>

          <div className="space-y-4 text-xs">
            {/* AUTONOMOUS_MODE */}
            <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-surface-hover/30 p-4">
              <div>
                <span className="font-bold text-foreground block text-sm">Autonomous Background Mode</span>
                <span className="text-muted">
                  When enabled, the agent discovers, classifies, checks eligibility, scores, tailors CVs, and processes opportunities in the background.
                </span>
              </div>
              <input
                type="checkbox"
                checked={settings.autonomousMode}
                onChange={(e) => setSettings({ ...settings, autonomousMode: e.target.checked })}
                className="size-5 accent-brand rounded cursor-pointer mt-1"
              />
            </div>

            {/* AUTO_SUBMIT */}
            <div className="flex items-start justify-between gap-4 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
              <div>
                <span className="font-bold text-blue-800 dark:text-blue-300 block text-sm flex items-center gap-1.5">
                  <AlertTriangle className="size-4 text-blue-500" />
                  Final Submit Mode
                </span>
                <span className="text-muted">
                  Default is <strong>review first for background hunting</strong>. Clicking Apply for me on a listing always submits that application. Enable this only if you also want unattended background submissions.
                </span>
              </div>
              <input
                type="checkbox"
                checked={settings.autoSubmit}
                onChange={(e) => setSettings({ ...settings, autoSubmit: e.target.checked })}
                className="size-5 accent-blue-600 rounded cursor-pointer mt-1"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Quotas & Matching Thresholds */}
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-xs space-y-5">
          <h3 className="text-base font-bold text-foreground flex items-center gap-2">
            <Target className="size-4 text-brand" />
            Application Quotas & Matching Thresholds
          </h3>

          <div className="grid gap-4 sm:grid-cols-3 text-xs">
            {/* applicationsPerDay */}
            <div className="rounded-xl border border-border bg-surface-hover/30 p-4 space-y-2">
              <label className="font-semibold text-foreground block">Max Applications / Day</label>
              <input
                type="number"
                min="1"
                max="50"
                value={settings.applicationsPerDay}
                onChange={(e) => setSettings({ ...settings, applicationsPerDay: Number(e.target.value) })}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground font-bold focus:border-brand focus:outline-hidden"
              />
              <span className="text-[11px] text-faint block">Protects ATS reputation & daily token budget.</span>
            </div>

            {/* minScore */}
            <div className="rounded-xl border border-border bg-surface-hover/30 p-4 space-y-2">
              <label className="font-semibold text-foreground block">Min Match Score (%)</label>
              <input
                type="number"
                min="50"
                max="95"
                value={settings.minScore}
                onChange={(e) => setSettings({ ...settings, minScore: Number(e.target.value) })}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground font-bold focus:border-brand focus:outline-hidden"
              />
              <span className="text-[11px] text-faint block">Only roles meeting threshold proceed to CV tailoring.</span>
            </div>

            {/* scanIntervalMinutes */}
            <div className="rounded-xl border border-border bg-surface-hover/30 p-4 space-y-2">
              <label className="font-semibold text-foreground block">Scan Interval (Mins)</label>
              <input
                type="number"
                min="5"
                max="360"
                value={settings.scanIntervalMinutes}
                onChange={(e) => setSettings({ ...settings, scanIntervalMinutes: Number(e.target.value) })}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground font-bold focus:border-brand focus:outline-hidden"
              />
              <span className="text-[11px] text-faint block">How often the backend scheduler checks whether a source is due. Opening the app never scans.</span>
            </div>

            <div className="rounded-xl border border-border bg-surface-hover/30 p-4 space-y-2 sm:col-span-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.autoScanEnabled !== false}
                  onChange={(e) => setSettings({ ...settings, autoScanEnabled: e.target.checked })}
                  className="size-4 rounded border-border text-brand focus:ring-brand"
                />
                <span className="font-semibold text-foreground">Automatic refresh scan</span>
              </label>
              <span className="text-[11px] text-faint block pl-7">
                Continuously hunt CS/tech internships and jobs from verified employer boards on the server (default: every {settings.scanIntervalMinutes} minutes). Opening Dashboard, Jobs, or Internships never starts a scan.
              </span>
            </div>
          </div>
        </div>

        {/* Section 3: Safety Invariants & Auto-Pause Switches */}
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-xs space-y-4">
          <h3 className="text-base font-bold text-foreground flex items-center gap-2">
            <ShieldAlert className="size-4 text-brand" />
            Safety Invariants & Auto-Pause Triggers
          </h3>

          <div className="grid gap-3 sm:grid-cols-2 text-xs">
            {[
              {
                id: "requireEligibility",
                label: "Require Strict Eligibility",
                desc: "Never apply to ineligible opportunities.",
              },
              {
                id: "requireConfidentAnswers",
                label: "Require Confident Answers",
                desc: "Pause if form answers have <70% confidence.",
              },
              {
                id: "pauseOnCaptcha",
                label: "Pause on CAPTCHA / Cloudflare",
                desc: "Never attempt to bypass security challenges.",
              },
              {
                id: "pauseOnAuthFailure",
                label: "Pause on Authentication Wall",
                desc: "Never bypass login / SSO barriers.",
              },
              {
                id: "pauseOnUnexpectedForm",
                label: "Pause on Unexpected Fields",
                desc: "Pause when novel unmapped fields appear.",
              },
              {
                id: "pauseOnSensitiveQuestion",
                label: "Pause on Sensitive Questions",
                desc: "Pause if visa, salary, or legal questions appear.",
              },
              {
                id: "pauseOnError",
                label: "Pause on Unhandled Error",
                desc: "Transition to ERROR state safely on exceptions.",
              },
            ].map((rule) => {
              const checked = (settings.safety as any)[rule.id];
              return (
                <div
                  key={rule.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-border bg-surface-hover/20 p-3.5"
                >
                  <div>
                    <span className="font-semibold text-foreground block">{rule.label}</span>
                    <span className="text-muted text-[11px]">{rule.desc}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        safety: { ...settings.safety, [rule.id]: e.target.checked },
                      })
                    }
                    className="size-4 accent-brand rounded cursor-pointer mt-0.5"
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
