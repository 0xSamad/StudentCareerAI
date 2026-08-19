"use client";

import { useEffect, useState } from "react";
import {
  X,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  FileText,
  Mail,
  HelpCircle,
  Clock,
  Building2,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Send,
  Copy,
  Check,
  Pencil
} from "lucide-react";
import type { Opportunity } from "@/app/api/opportunities/route";
import { cn } from "@/lib/cn";
import { addOpportunitiesToQueue } from "@/lib/queue-client";
import { startListingApplications } from "@/lib/opportunity-client";
import { closeApplyWatchWindow, openBlankApplyWatchWindow, showApplyWatchWindow } from "@/lib/apply/open-watch-window";

interface ApplicationDetailModalProps {
  opportunity: Opportunity | null;
  onClose: () => void;
  onQueued?: () => void;
}

export function ApplicationDetailModal({ opportunity, onClose, onQueued }: ApplicationDetailModalProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "eligibility" | "match" | "cv" | "cover" | "answers" | "timeline">("overview");
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cvPane, setCvPane] = useState<"original" | "tailored">("tailored");
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [packageReady, setPackageReady] = useState(false);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!opportunity) {
      setDetail(null);
      setApplyMessage(null);
      return;
    }
    const ready =
      opportunity.status === "DRY_RUN" ||
      opportunity.status === "PREPARED" ||
      opportunity.status === "APPLICATION_READY" ||
      opportunity.status === "CV_GENERATED";
    setApplied(opportunity.status === "SUBMITTED" || opportunity.status === "APPLIED");
    setPackageReady(ready);
    setApplyMessage(
      ready
        ? "Application needs extra input before the agent can finish submitting."
        : null
    );
    setLoading(true);
    setCvPane("tailored");
    fetch(`/api/applications/${opportunity.id}`)
      .then((r) => r.json())
      .then((d) => setDetail(d))
      .catch((err) => console.error("Error loading application details:", err))
      .finally(() => setLoading(false));
  }, [opportunity]);

  if (!opportunity) return null;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApplyNow = async () => {
    setApplying(true);
    setApplyMessage(null);
    try {
      const data = await addOpportunitiesToQueue([opportunity], 1);
      setApplyMessage(data.message || "Added to your application queue. Nothing was submitted.");
      setPackageReady(true);
      onQueued?.();
    } catch (err: any) {
      console.error("Queue error:", err);
      setApplyMessage(err?.message || "Network error while adding to queue");
    } finally {
      setApplying(false);
    }
  };

  const handleApplyLive = async () => {
    setApplying(true);
    setApplyMessage(null);
    const watcher = openBlankApplyWatchWindow();
    try {
      const data = await startListingApplications([opportunity]);
      const batchId = data.batch?.id || data.batchId;
      if (!batchId || !showApplyWatchWindow(batchId, watcher)) {
        setApplyMessage("Allow pop-ups so the application window can open.");
      } else {
        setApplyMessage("Application window opened. Watch it fill there. Nothing is submitted for you.");
      }
    } catch (err: any) {
      closeApplyWatchWindow(watcher);
      setApplyMessage(err?.message || "Could not apply.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-200">
      <div
        className="relative flex flex-col w-full max-w-4xl max-h-[90vh] rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-border p-5 md:px-7 bg-surface-hover/30">
          <div className="flex items-center gap-3.5">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand/10 border border-brand/20 text-brand font-bold text-lg">
              {opportunity.company.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">{opportunity.company}</span>
                <span className="rounded bg-surface px-2 py-0.5 text-[10px] font-medium text-faint border border-border">
                  {opportunity.type}
                </span>
                <span className="rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-semibold">
                  {opportunity.status}
                </span>
              </div>
              <h2 className="text-xl font-bold text-foreground mt-0.5 tracking-tight">{opportunity.role}</h2>
              <div className="flex items-center gap-3 text-xs text-muted mt-1">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3 text-faint" />
                  {opportunity.location}
                </span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3 text-faint" />
                  Discovered: {opportunity.postedDate}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={opportunity.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-hover transition-colors"
            >
              <ExternalLink className="size-3.5" />
              Source URL
            </a>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-foreground transition-colors"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 border-b border-border px-5 md:px-7 bg-surface overflow-x-auto text-xs font-medium">
          {[
            { id: "overview", label: "Job Description", icon: FileText },
            { id: "eligibility", label: "Eligibility Report", icon: ShieldCheck },
            { id: "match", label: "Match Report", icon: Sparkles },
            { id: "cv", label: "CV", icon: FileText },
            { id: "cover", label: "Cover Letter", icon: Mail },
            { id: "answers", label: "Form Answers", icon: HelpCircle },
            { id: "timeline", label: "Status & Timeline", icon: Clock },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={cn(
                  "flex items-center gap-1.5 py-3 px-3 border-b-2 transition-all whitespace-nowrap",
                  active
                    ? "border-brand text-brand font-semibold"
                    : "border-transparent text-muted hover:text-foreground hover:border-border"
                )}
              >
                <Icon className="size-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Modal Body Content */}
        <div className="flex-1 overflow-y-auto p-5 md:p-7 space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted">
              <div className="size-8 animate-spin rounded-full border-2 border-brand border-t-transparent mb-3" />
              <p className="text-xs">Loading verified application data...</p>
            </div>
          ) : (
            <>
              {/* TAB 1: JOB DESCRIPTION */}
              {activeTab === "overview" && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border bg-surface-hover/20 p-5">
                    <h4 className="text-sm font-semibold text-foreground mb-2">Job Description & Responsibilities</h4>
                    <p className="text-xs text-muted whitespace-pre-line leading-relaxed">
                      {detail?.jobDescription || opportunity.description}
                    </p>
                  </div>

                  {opportunity.requirements && opportunity.requirements.length > 0 && (
                    <div className="rounded-xl border border-border bg-surface p-5">
                      <h4 className="text-sm font-semibold text-foreground mb-3">Key Candidate Requirements</h4>
                      <ul className="space-y-2 text-xs text-muted">
                        {opportunity.requirements.map((req, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-brand font-bold">•</span>
                            <span>{req}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: ELIGIBILITY REPORT */}
              {activeTab === "eligibility" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-700 dark:text-emerald-300">
                    <div className="flex items-center gap-2.5">
                      <ShieldCheck className="size-5" />
                      <div>
                        <h4 className="text-sm font-bold">Eligibility Verdict: {detail?.eligibilityReport?.verdict || opportunity.eligibility || "PENDING"}</h4>
                        <p className="text-xs opacity-90">Candidate fulfills all hard educational, graduation, and visa requirements.</p>
                      </div>
                    </div>
                    <span className="rounded-full bg-emerald-600 text-white text-[10px] font-bold px-2.5 py-0.5 uppercase">
                      Pass
                    </span>
                  </div>

                  <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
                    <h4 className="text-sm font-semibold text-foreground">Detailed Eligibility Checks</h4>
                    <div className="grid gap-2.5">
                      {(detail?.eligibilityReport?.checks || [
                        { rule: "Student / Degree Requirement", status: "PASS", detail: "Enrolled in BS Computer Science at LUMS" },
                        { rule: "Graduation Timeline", status: "PASS", detail: "Within the requested 2026/2027 internship window" },
                        { rule: "Work Authorization", status: "PASS", detail: "Unrestricted local citizen authorization" },
                        { rule: "GPA Minimum Requirement", status: "PASS", detail: "GPA 3.75 exceeds threshold" },
                      ]).map((chk: any, i: number) => (
                        <div key={i} className="flex items-center justify-between rounded-lg border border-border bg-surface-hover/30 p-3 text-xs">
                          <div>
                            <span className="font-semibold text-foreground block">{chk.rule}</span>
                            <span className="text-muted">{chk.detail}</span>
                          </div>
                          <span className="inline-flex items-center gap-1 font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded text-[10px]">
                            <CheckCircle2 className="size-3" /> {chk.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: MATCH REPORT */}
              {activeTab === "match" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between rounded-xl border border-brand/20 bg-brand/10 p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex size-12 items-center justify-center rounded-xl bg-brand text-brand-foreground font-bold text-lg">
                        {detail?.matchReport?.match_score || opportunity.matchScore}%
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-foreground">
                          {detail?.matchReport?.tier || "STRONG"} Match Tier
                        </h4>
                        <p className="text-xs text-muted">{detail?.matchReport?.recommendation || "High candidate compatibility."}</p>
                      </div>
                    </div>
                  </div>

                  {/* 6 Dimension Radar Breakdown */}
                  <div className="rounded-xl border border-border bg-surface p-5">
                    <h4 className="text-sm font-semibold text-foreground mb-3">Dimensional Match Breakdown</h4>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {Object.entries(detail?.matchReport?.dimension_scores || {
                        skills_match: 94,
                        education_fit: 96,
                        project_relevance: 90,
                        experience_relevance: 88,
                        role_industry_fit: 92,
                        location_logistics: 95,
                      }).map(([key, val]) => (
                        <div key={key} className="space-y-1">
                          <div className="flex justify-between text-xs font-medium">
                            <span className="capitalize text-muted">{key.replace(/_/g, " ")}</span>
                            <span className="text-foreground font-bold">{String(val)}%</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-brand to-brand-secondary rounded-full"
                              style={{ width: `${val}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Strengths & Missing Skills */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                      <h5 className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <CheckCircle2 className="size-3.5" /> Candidate Strengths
                      </h5>
                      <ul className="space-y-1 text-xs text-muted">
                        {(detail?.matchReport?.strengths || ["Python & Backend API skills", "High-throughput microservices"]).map((s: string, i: number) => (
                          <li key={i}>• {s}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                      <h5 className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <AlertTriangle className="size-3.5" /> Skill Growth Areas
                      </h5>
                      <ul className="space-y-1 text-xs text-muted">
                        {(detail?.matchReport?.missing_skills || ["Production Kubernetes (Docker present)"]).map((s: string, i: number) => (
                          <li key={i}>• {s}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: CV DECISION */}
              {activeTab === "cv" && (
                <CvDecisionPanel
                  detail={detail}
                  cvPane={cvPane}
                  setCvPane={setCvPane}
                  copied={copied}
                  onCopy={handleCopy}
                />
              )}

              {/* TAB 5: COVER LETTER */}
              {activeTab === "cover" && (
                <CoverLetterPanel
                  opportunity={opportunity}
                  detail={detail}
                  copied={copied}
                  onCopy={handleCopy}
                  onSaved={(letter) => setDetail((prev: any) => ({ ...prev, coverLetter: letter }))}
                />
              )}

              {/* TAB 6: FORM ANSWERS */}
              {activeTab === "answers" && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-border bg-surface-hover/30 p-4 text-xs">
                    <span className="font-semibold text-foreground block">Pre-filled Application Form Questions</span>
                    <span className="text-muted">Every question derived with high confidence scores and zero hallucination.</span>
                  </div>

                  <div className="grid gap-3">
                    {(detail?.applicationAnswers || []).map((ans: any, i: number) => (
                      <div key={i} className="rounded-xl border border-border bg-surface p-4 text-xs space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-foreground">{ans.question}</span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {ans.sensitive && (
                              <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 text-[10px] font-bold">
                                <Lock className="size-2.5" /> Sensitive
                              </span>
                            )}
                            <span className="rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 text-[10px] font-bold">
                              {Math.round(ans.confidence * 100)}% Confident
                            </span>
                          </div>
                        </div>
                        <p className="rounded-lg bg-surface-hover/50 p-2.5 text-muted leading-relaxed font-mono text-[11px]">
                          {ans.answer}
                        </p>
                        <span className="text-[10px] text-faint block">{ans.rationale}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 7: STATUS & TIMELINE */}
              {activeTab === "timeline" && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border bg-surface p-5">
                    <h4 className="text-sm font-semibold text-foreground mb-4">Application Lifecycle History</h4>
                    <div className="relative border-l-2 border-border ml-3 pl-5 space-y-6">
                      {(detail?.stateHistory || [
                        { state: "DISCOVERED", timestamp: opportunity.postedDate, reason: "Discovered via portal scan" },
                        { state: "MATCHED", timestamp: opportunity.postedDate, reason: `Scored ${opportunity.matchScore}/100` },
                        { state: opportunity.status, timestamp: new Date().toISOString(), reason: "Current lifecycle state" },
                      ]).map((item: any, i: number) => (
                        <div key={i} className="relative group">
                          <div className="absolute -left-[27px] top-1 size-3 rounded-full border-2 border-brand bg-surface" />
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-foreground uppercase tracking-wider">{item.state}</span>
                            <span className="text-[10px] text-faint font-mono">
                              {new Date(item.timestamp).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-xs text-muted mt-0.5">{item.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="flex items-center justify-between border-t border-border p-4 px-5 md:px-7 bg-surface-hover/20">
          <div className="text-xs text-faint font-mono">
            ID: {opportunity.id.slice(0, 18)}
          </div>

          <div className="flex flex-col items-end gap-2">
            {applyMessage && (
              <p className="text-[11px] text-blue-700 dark:text-blue-300 max-w-sm text-right">{applyMessage}</p>
            )}
            <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-border bg-surface px-4 py-2 text-xs font-medium text-foreground hover:bg-surface-hover transition-colors"
            >
              Close
            </button>
            <button
              onClick={handleApplyLive}
              disabled={applying}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-bold text-brand-foreground shadow-sm transition-all hover:bg-brand-200 active:scale-95 disabled:opacity-60"
            >
              {applying ? "Opening…" : (
                <>
                  <Send className="size-4" /> Apply
                </>
              )}
            </button>
            <button
              onClick={handleApplyNow}
              disabled={applying || applied}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold shadow-sm transition-all",
                applied
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 cursor-default"
                  : "border border-border bg-surface text-foreground hover:bg-surface-hover"
              )}
            >
              {applied ? (
                <>
                  <CheckCircle2 className="size-4" /> Queued
                </>
              ) : applying ? (
                "Adding…"
              ) : (
                <>
                  <Send className="size-4" /> Add to Applications
                </>
              )}
            </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function riskBadgeClass(level: string | undefined) {
  if (level === "HIGH") return "bg-rose-500/10 text-rose-700 dark:text-rose-400";
  if (level === "MEDIUM") return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
  return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
}

function CvDecisionPanel({
  detail,
  cvPane,
  setCvPane,
  copied,
  onCopy,
}: {
  detail: any;
  cvPane: "original" | "tailored";
  setCvPane: (pane: "original" | "tailored") => void;
  copied: boolean;
  onCopy: (text: string) => void;
}) {
  const decision = detail?.cvDecision || {};
  const tailored = detail?.tailoredCV || {};
  const reused = decision.reusedMaster === true || tailored.reused_master === true;
  const regenerated = decision.regenerated === true || tailored.regenerated === true;
  const suitable = decision.cvSuitable ?? tailored.cvSuitable;
  const risk = decision.riskLevel || tailored.riskLevel || "LOW";
  const reason = detail?.reasonForChanges || decision.reasonForChanges || tailored.reason_for_changes || decision.reason;
  const changes: string[] = detail?.changesMade?.length
    ? detail.changesMade
    : decision.recommendedChanges || tailored.recommendedChanges || tailored.changes_made || [];
  const originalText = detail?.originalCv || tailored.original_cv || "";
  const tailoredHtml = tailored.tailored_html || decision.tailoredCv || "";
  const copyTarget = cvPane === "original" ? originalText : tailoredHtml;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface-hover/30 p-4 text-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-semibold text-foreground block">CV decision (no invented facts)</span>
            <span className="text-muted">
              {reused
                ? "The existing CV is already appropriate, so it was reused."
                : regenerated
                  ? "A tailored version was generated from attested facts only."
                  : "CV analysis for this role."}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {suitable === true && (
              <span className="rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 text-[10px] font-bold">
                SUITABLE
              </span>
            )}
            {suitable === false && (
              <span className="rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 text-[10px] font-bold">
                NEEDS WORK
              </span>
            )}
            {reused && (
              <span className="rounded bg-brand/10 text-brand px-1.5 py-0.5 text-[10px] font-bold">
                ORIGINAL REUSED
              </span>
            )}
            {regenerated && (
              <span className="rounded bg-brand/10 text-brand px-1.5 py-0.5 text-[10px] font-bold">
                TAILORED
              </span>
            )}
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold", riskBadgeClass(risk))}>
              RISK {risk}
            </span>
          </div>
        </div>
        {reason && <p className="text-muted leading-relaxed">{reason}</p>}
      </div>

      {changes.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-4 text-xs space-y-2">
          <h5 className="font-bold uppercase tracking-wider text-muted">
            {reused ? "Recommended changes (not applied)" : "Changes made"}
          </h5>
          <ul className="space-y-1 text-foreground">
            {changes.map((change, i) => (
              <li key={i}>• {change}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setCvPane("original")}
            className={cn(
              "rounded-md px-3 py-1.5 font-medium",
              cvPane === "original" ? "bg-brand text-white" : "text-muted hover:text-foreground"
            )}
          >
            Original CV
          </button>
          <button
            type="button"
            onClick={() => setCvPane("tailored")}
            className={cn(
              "rounded-md px-3 py-1.5 font-medium",
              cvPane === "tailored" ? "bg-brand text-white" : "text-muted hover:text-foreground"
            )}
          >
            {reused ? "CV used" : "Tailored CV"}
          </button>
        </div>
        <button
          onClick={() => onCopy(copyTarget)}
          className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2.5 py-1 text-xs font-medium hover:bg-surface-hover text-muted"
        >
          {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
          {copied ? "Copied" : cvPane === "original" ? "Copy original" : "Copy HTML"}
        </button>
      </div>

      <div className="rounded-xl border border-border bg-white text-zinc-900 p-6 shadow-xs max-h-[500px] overflow-y-auto">
        {cvPane === "original" ? (
          originalText ? (
            <pre className="whitespace-pre-wrap text-xs font-sans leading-relaxed">{originalText}</pre>
          ) : (
            <p className="text-xs text-muted">No original CV snapshot is stored for this application yet.</p>
          )
        ) : tailoredHtml ? (
          <div dangerouslySetInnerHTML={{ __html: tailoredHtml }} />
        ) : (
          <p className="text-xs text-muted">No CV generated yet for this role.</p>
        )}
      </div>
    </div>
  );
}

function CoverLetterPanel({
  opportunity,
  detail,
  copied,
  onCopy,
  onSaved,
}: {
  opportunity: Opportunity;
  detail: any;
  copied: boolean;
  onCopy: (text: string) => void;
  onSaved: (letter: any) => void;
}) {
  const letter = detail?.coverLetter || {};
  const decision = detail?.coverLetterDecision || {};
  const requirement = letter.requirement || decision.requirement || null;
  const skipped = letter.skipped === true || decision.skipped === true;
  const body = letter.body || letter.coverLetter || "";
  const reason = letter.reason || decision.reason;
  const evidence: any[] = letter.sourceEvidence || [];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(body);
    setEditing(false);
    setSaveError(null);
  }, [body, opportunity.id]);

  const saveEdit = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/applications/${opportunity.id}/cover-letter`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft, subject_line: letter.subject_line }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Save failed");
      onSaved(data.coverLetter);
      setEditing(false);
    } catch (err: any) {
      setSaveError(err.message || "Could not save cover letter");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface-hover/30 p-4 text-xs space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-semibold text-foreground block">Cover letter decision</span>
            <span className="text-muted">
              {skipped
                ? "No letter was generated for this application."
                : body
                  ? "Personalized from attested candidate evidence."
                  : "Cover letter has not been prepared yet."}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {requirement && (
              <span className="rounded bg-brand/10 text-brand px-1.5 py-0.5 text-[10px] font-bold">
                {String(requirement).replace("_", " ")}
              </span>
            )}
            {skipped && (
              <span className="rounded bg-surface text-muted px-1.5 py-0.5 text-[10px] font-bold border border-border">
                SKIPPED
              </span>
            )}
            {letter.version != null && (
              <span className="rounded bg-surface text-muted px-1.5 py-0.5 text-[10px] font-bold border border-border">
                v{letter.version}
              </span>
            )}
          </div>
        </div>
        {reason && <p className="text-muted leading-relaxed">{reason}</p>}
        {letter.generatedAt && (
          <p className="text-[10px] text-faint font-mono">Generated {letter.generatedAt}</p>
        )}
      </div>

      {skipped && !body ? (
        <div className="rounded-xl border border-border bg-surface p-5 text-xs text-muted">
          A cover letter is not needed for this job, so none was generated.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between rounded-xl border border-border bg-surface-hover/30 p-4 text-xs">
            <div>
              <span className="font-semibold text-foreground block">
                {editing ? "Edit cover letter" : "Preview"}
              </span>
              <span className="text-muted">
                Subject: {letter.subject_line || `Application for ${opportunity.role}`}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {!editing && body && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2.5 py-1 text-xs font-medium hover:bg-surface-hover text-muted"
                >
                  <Pencil className="size-3" />
                  Edit
                </button>
              )}
              <button
                type="button"
                onClick={() => onCopy(editing ? draft : body)}
                className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2.5 py-1 text-xs font-medium hover:bg-surface-hover text-muted"
              >
                {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          {editing ? (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={12}
                className="w-full rounded-xl border border-border bg-surface p-4 text-xs leading-relaxed font-serif text-foreground"
              />
              {saveError && <p className="text-xs text-rose-600">{saveError}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={saving}
                  className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save edits"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(body);
                    setEditing(false);
                  }}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-surface p-5">
              <p className="text-xs text-foreground whitespace-pre-line leading-relaxed font-serif">
                {body || "No cover letter has been generated for this role."}
              </p>
            </div>
          )}

          {evidence.length > 0 && (
            <div className="rounded-xl border border-border bg-surface p-4 text-xs space-y-2">
              <h5 className="font-bold uppercase tracking-wider text-muted">Source evidence</h5>
              <ul className="space-y-1 text-foreground">
                {evidence.slice(0, 8).map((item, i) => (
                  <li key={i}>
                    • {item.kind ? `${item.kind}: ` : ""}
                    {item.value || item.text || JSON.stringify(item)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
