"use client";

import { useState } from "react";
import {
  Check,
  ChevronDown,
  ExternalLink,
  Flag,
  Target,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RoadmapTimeline } from "@/components/role-analyzer/roadmap-timeline";
import {
  DemandBars,
  MarketSplitTable,
  MetricHint,
  ReadinessRadar,
  YouVsMarket,
} from "@/components/role-analyzer/intelligence-charts";
import { instrumentSerif } from "@/lib/fonts";
import { cn } from "@/lib/cn";
import {
  demandCounts,
  demandPercent,
  formatLongDate,
  safeHttpUrl,
  type AnalysisResult,
  type RoadmapPayload,
} from "@/lib/role-analyzer-view";

function scoreOf(block: { score?: number | null; percent?: number | null } | null | undefined) {
  if (!block) return null;
  if (typeof block.score === "number") return Math.round(block.score);
  if (typeof block.percent === "number") return Math.round(block.percent);
  return null;
}

function priorityTone(priority?: string) {
  if (priority === "CRITICAL") return "bad" as const;
  if (priority === "HIGH") return "warn" as const;
  if (priority === "MEDIUM") return "info" as const;
  return "muted" as const;
}

export function CoachReport({
  analysis,
  roadmap,
  completed,
  onToggleWeek,
  busy,
  durationId,
  onDurationChange,
  roadmapBusy,
}: {
  analysis: AnalysisResult;
  roadmap: RoadmapPayload;
  completed: Set<string>;
  onToggleWeek: (key: string, next: boolean) => void;
  busy?: boolean;
  durationId?: string;
  onDurationChange?: (id: "2" | "4" | "6" | "custom") => void;
  roadmapBusy?: boolean;
}) {
  const [postingsOpen, setPostingsOpen] = useState(false);
  const coach = roadmap.coach;
  const intel = coach?.intelligence;
  const meta = analysis.metadata;
  const postingCount = analysis.total_postings ?? meta?.postingCount ?? 0;
  const pkCount = analysis.pakistan_postings ?? meta?.pakistanCount ?? 0;
  const intlCount = analysis.international_postings ?? meta?.internationalCount ?? 0;
  const lastAnalyzed = analysis.last_updated || meta?.researchedAt || meta?.lastAnalyzedLabel;
  const quality = analysis.data_quality || meta?.sampleQuality;
  const unavailable = meta?.unavailableSources || [];
  const sources = analysis.sources || meta?.sources || [];
  const skillReadiness = scoreOf(analysis.readiness_score || intel?.scores?.skillReadiness);
  const marketMatch = scoreOf(analysis.market_match_score || intel?.scores?.marketMatch);
  const competitiveness = scoreOf(
    analysis.job_competitiveness_score || intel?.scores?.jobCompetitiveness || { score: analysis.readinessScore?.score }
  );
  const positionText = intel?.positionNarrative || coach?.currentPosition?.summary;
  const strengths = intel?.strengths?.length
    ? intel.strengths
    : (coach?.currentPosition?.alreadyHave || []).map((skill) => ({ skill, evidence: "On your profile", why: "" }));
  const gaps = intel?.rankedGaps?.length ? intel.rankedGaps : (coach?.biggestGaps || []).map((g, i) => ({
    rank: i + 1,
    skill: g.skill,
    priority: g.priority,
    demandPercent: g.marketPercent,
    evidence: "No evidence found",
    why: g.why,
    howToClose: g.whatToBuild,
    whatToLearn: g.whatToLearn,
  }));
  const demandRows = (analysis.skillDemand || [])
    .filter((row) => demandPercent(row) != null)
    .slice(0, 10)
    .map((row) => {
      const { count, total } = demandCounts(row);
      return { skill: row.skill, percent: demandPercent(row) as number, count, total };
    });
  const youVs = intel?.youVsMarket || [];
  const split = intel?.pakistanInternational || { ok: false, message: "Insufficient Pakistan postings to make a reliable comparison.", rows: [] };
  const dimensions = intel?.dimensions || (roadmap.readiness.breakdown || []).map((b) => ({
    label: b.label,
    percent: b.percent ?? 0,
  }));
  const next7 = intel?.next7Days || [];
  const interview = intel?.interviewPrep?.sections?.length
    ? intel.interviewPrep
    : {
        note: roadmap.interviewPlan.note,
        sections: (roadmap.interviewPlan.sections || []).length
          ? roadmap.interviewPlan.sections
          : (roadmap.interviewPlan.phases || []).map((p) => ({ title: p.phase, items: [p.focus] })),
      };
  const action = intel?.careerActionPlan?.length ? intel.careerActionPlan : coach?.actionPlan || [];
  const pathway = intel?.recommendedPathway || (roadmap.jobTargets.stretch || []).slice(0, 2).join(" / ") || analysis.role;
  const postingNoun = analysis.search_type === "internships" || analysis.employment_type === "Internship" ? "internships" : "jobs";
  const limited = postingCount < 20;

  return (
    <div className="space-y-12">
      {quality?.warning || limited ? (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
          {limited ? `Limited market sample: ${postingCount} relevant posting${postingCount === 1 ? "" : "s"} found.` : quality?.message}
        </p>
      ) : null}
      {unavailable.length ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
          Some sources were unavailable. {unavailable.slice(0, 3).map((s) => s.source || "source").join(", ")}
          {unavailable.length > 3 ? ` +${unavailable.length - 3}` : ""}. They were not treated as analyzed jobs.
        </p>
      ) : null}

      <section className="space-y-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-text">Career intelligence</p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Target role</p>
            <h2 className={cn("text-4xl tracking-tight text-foreground", instrumentSerif.className)}>{analysis.role}</h2>
          </div>
          {analysis.employment_type ? (
            <Badge tone="info">{analysis.employment_type} · {analysis.search_type || "jobs"}</Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted">
          Recommended pathway: <span className="font-medium text-foreground">{pathway}</span>
        </p>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div className="rounded-xl border border-border bg-surface/60 px-4 py-3">
            <dt className="text-xs uppercase tracking-wide text-muted">Market analyzed</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{postingCount} relevant {postingNoun}</dd>
          </div>
          <div className="rounded-xl border border-border bg-surface/60 px-4 py-3">
            <dt className="text-xs uppercase tracking-wide text-muted">Pakistan</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{pkCount === 0 ? "Insufficient data" : pkCount}</dd>
          </div>
          <div className="rounded-xl border border-border bg-surface/60 px-4 py-3">
            <dt className="text-xs uppercase tracking-wide text-muted">International</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{intlCount === 0 ? "Insufficient data" : intlCount}</dd>
          </div>
          <div className="rounded-xl border border-border bg-surface/60 px-4 py-3">
            <dt className="text-xs uppercase tracking-wide text-muted">Last analyzed</dt>
            <dd className="mt-1 text-lg font-semibold">{formatLongDate(lastAnalyzed)}</dd>
          </div>
        </dl>
        <div className="grid gap-4 md:grid-cols-3">
          <MetricHint
            featured
            label="Skill readiness"
            value={skillReadiness ?? "—"}
            suffix="/100"
            hint="How strong your current foundation is for this role’s core skills, from attested profile evidence only. Not a job offer."
          />
          <MetricHint
            label="Market match"
            value={marketMatch == null ? "—" : marketMatch}
            suffix={marketMatch == null ? "" : "%"}
            hint="How much of this sample’s stated requirements you cover. Uses the same posting set as the counts above. Null if there is no market sample."
          />
          <MetricHint
            label="Job competitiveness"
            value={competitiveness ?? "—"}
            suffix="/100"
            hint="Skills + projects + experience, scored in code. Conservative: coursework is not treated as job-ready. Does not guarantee interviews or employment."
          />
        </div>
        <p className="text-xs text-faint">None of these scores is a promise of employment or an interview.</p>
      </section>

      <section className="rounded-2xl border border-brand/25 bg-brand-soft/40 px-5 py-5">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-text">
          <Target className="size-4" /> Current position
        </p>
        <p className="mt-2 max-w-3xl text-lg leading-snug text-foreground">{positionText}</p>
      </section>

      {next7.length ? (
        <section className="space-y-4">
          <div>
            <h3 className="text-xl font-semibold">Your next 7 days</h3>
            <p className="mt-1 text-sm text-muted">Start tomorrow. Each day is one concrete action from week 1 of this plan.</p>
          </div>
          <ol className="grid gap-3 md:grid-cols-2">
            {next7.map((day) => (
              <li key={day.day} className="rounded-xl border border-border bg-surface/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-text">Day {day.day} · {day.title}</p>
                <p className="mt-1 text-sm text-foreground">{day.work}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="space-y-4">
        <h3 className="text-xl font-semibold">Your strongest skills</h3>
        {strengths.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {strengths.map((s) => (
              <Card key={s.skill} className="space-y-2">
                <p className="flex items-center gap-2 font-semibold">
                  <Check className="size-4 text-emerald-600" aria-hidden />
                  {s.skill}
                </p>
                {s.marketPercent != null ? (
                  <p className="text-xs text-muted">
                    Market demand: {s.marketPercent}%
                    {s.marketTotal ? ` (${s.marketCount}/${s.marketTotal})` : ""}
                  </p>
                ) : (
                  <p className="text-xs text-muted">Role baseline — not a percentage from a tiny sample.</p>
                )}
                <p className="text-xs text-muted">Your evidence: {s.evidence}</p>
                {s.why ? <p className="text-sm">{s.why}</p> : null}
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No strong attested skills for this role yet. The gaps below are the starting line.</p>
        )}
      </section>

      <section className="space-y-4">
        <h3 className="text-xl font-semibold">Top skill gaps</h3>
        <p className="text-sm text-muted">Ranked by market demand × importance × current weakness.</p>
        <div className="space-y-3">
          {gaps.map((gap) => (
            <Card key={gap.skill} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">
                  Priority {gap.rank} — {gap.skill}
                </p>
                <Badge tone={priorityTone(gap.priority)}>{gap.priority || gap.importance || "GAP"}</Badge>
              </div>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted">Demand</dt>
                  <dd>
                    {gap.demandPercent == null
                      ? "Role baseline (not a %)"
                      : `${gap.demandPercent}%${gap.demandTotal ? ` (${gap.demandCount}/${gap.demandTotal})` : ""}`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted">Your evidence</dt>
                  <dd>{gap.evidence || "No evidence found"}</dd>
                </div>
              </dl>
              {gap.why ? (
                <p className="text-sm">
                  <span className="font-medium">Why it matters: </span>
                  {gap.why}
                </p>
              ) : null}
              {gap.howToClose ? (
                <p className="text-sm">
                  <span className="font-medium">How to close: </span>
                  {gap.howToClose}
                </p>
              ) : null}
            </Card>
          ))}
        </div>
      </section>

      <DemandBars rows={demandRows} />
      <YouVsMarket rows={youVs} />
      <MarketSplitTable comparison={split} />
      <ReadinessRadar dimensions={dimensions} />

      <section className="space-y-4">
        <h3 className="text-xl font-semibold">Projects that will increase your readiness</h3>
        <div className="grid gap-4 lg:grid-cols-2">
          {(roadmap.projects || []).map((project, i) => (
            <Card key={project.id} className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Project {i + 1}</p>
              <h4 className="text-lg font-semibold">{project.title}</h4>
              <p className="text-sm text-muted">{project.problem}</p>
              <p className="text-sm">
                <span className="font-medium">Why: </span>
                {project.portfolioValue}
              </p>
              <p className="text-sm">
                <span className="font-medium">Skills: </span>
                {(project.skillsDemonstrated || project.demonstrates || []).join(", ")}
              </p>
              <p className="text-sm">
                <span className="font-medium">Difficulty: </span>
                {project.levelLabel || project.difficulty}
              </p>
              <p className="text-sm">
                <span className="font-medium">Deliverable: </span>
                {(project.github || []).join(", ") || "GitHub artifact a recruiter can run"}
              </p>
              <p className="text-sm">
                <span className="font-medium">Expected career value: </span>
                {project.portfolioValue}
              </p>
            </Card>
          ))}
        </div>
        {!roadmap.projects?.length ? <p className="text-sm text-muted">Harden an existing project before starting a new one.</p> : null}
      </section>

      <section className="space-y-4" id="roadmap">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold">Roadmap</h3>
            <p className="mt-1 text-sm text-muted">
              {roadmap.weeklyHours?.label} per week. 2 / 4 / 6 month plans are different lengths with different depth — not a stretched copy.
            </p>
          </div>
          {onDurationChange ? (
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Roadmap duration">
              {(["2", "4", "6", "custom"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={durationId === id}
                  disabled={roadmapBusy}
                  onClick={() => onDurationChange(id)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium",
                    durationId === id ? "border-brand/40 bg-brand-soft text-brand-text" : "border-border text-muted hover:bg-surface-hover"
                  )}
                >
                  {id === "custom" ? "Custom" : `${id} months`}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {(roadmap.roadmaps.phases || []).length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {(roadmap.roadmaps.phases || []).map((p) => (
              <Card key={p.id}>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {p.name} · weeks {p.start}–{p.end}
                </p>
                <p className="mt-1 text-sm">{p.goal}</p>
              </Card>
            ))}
          </div>
        ) : null}
        {roadmap.roadmaps.weeks?.length ? (
          <RoadmapTimeline weeks={roadmap.roadmaps.weeks} completed={completed} onToggle={onToggleWeek} busy={busy} />
        ) : null}
      </section>

      <section className="space-y-4">
        <h3 className="text-xl font-semibold">Interview preparation</h3>
        <p className="text-sm text-muted">{interview.note || "Role-specific themes. Answer from your own labs and projects."}</p>
        <div className="grid gap-3 md:grid-cols-2">
          {(interview.sections || []).map((section) => (
            <Card key={section.title} className="space-y-2">
              <p className="font-semibold">{section.title}</p>
              <ul className="list-disc space-y-1 pl-4 text-sm text-muted">
                {(section.items || []).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-xl font-semibold">Job search strategy</h3>
        <p className="text-sm text-muted">{roadmap.jobTargets.note || "Titles only — not a promise that any company will interview or hire you."}</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Apply now</p>
            <ul className="mt-2 space-y-1 text-sm">{(roadmap.jobTargets.goodFit || roadmap.jobTargets.now || []).map((t) => <li key={t}>{t}</li>)}</ul>
            <p className="mt-2 text-xs text-muted">{roadmap.jobTargets.why?.goodFit}</p>
          </Card>
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">After 2 months</p>
            <ul className="mt-2 space-y-1 text-sm">{(roadmap.jobTargets.after2Months || []).map((t) => <li key={t}>{t}</li>)}</ul>
            <p className="mt-2 text-xs text-muted">{roadmap.jobTargets.why?.stretch}</p>
          </Card>
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">After 4 months</p>
            <ul className="mt-2 space-y-1 text-sm">{(roadmap.jobTargets.after4Months || []).map((t) => <li key={t}>{t}</li>)}</ul>
          </Card>
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">After 6 months</p>
            <ul className="mt-2 space-y-1 text-sm">{(roadmap.jobTargets.after6Months || roadmap.jobTargets.afterRoadmap || []).map((t) => <li key={t}>{t}</li>)}</ul>
            <p className="mt-2 text-xs text-muted">{roadmap.jobTargets.why?.notYet}</p>
          </Card>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xl font-semibold">Data sources</h3>
        <p className="text-sm text-muted">
          {postingCount} {postingNoun} analyzed · {pkCount === 0 ? "Insufficient Pakistan data" : `${pkCount} Pakistan`} · {intlCount === 0 ? "Insufficient international data" : `${intlCount} international`}
          {sources.length ? ` · ${sources.join(", ")}` : ""}
        </p>
        <button
          type="button"
          className="inline-flex items-center gap-2 text-sm font-medium text-brand-text hover:underline"
          onClick={() => setPostingsOpen((v) => !v)}
          aria-expanded={postingsOpen}
        >
          <ChevronDown className={cn("size-4 transition-transform", postingsOpen && "rotate-180")} />
          View analyzed postings
        </button>
        {postingsOpen ? (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="bg-surface-hover text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Company</th>
                  <th className="px-3 py-2 font-medium">Job title</th>
                  <th className="px-3 py-2 font-medium">Country</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {(analysis.analyzedJobs || []).map((job, i) => {
                  const href = safeHttpUrl(job.url);
                  return (
                  <tr key={`${job.url || job.jobTitle}-${i}`} className="border-t border-border">
                    <td className="px-3 py-2">{job.company}</td>
                    <td className="px-3 py-2">
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-text hover:underline">
                          {job.jobTitle} <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        job.jobTitle
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted">{job.country || job.location || "—"}</td>
                    <td className="px-3 py-2 text-muted">{job.source}</td>
                    <td className="px-3 py-2 text-muted">{formatLongDate(job.dateDiscovered)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-brand/30 bg-brand-soft px-5 py-6 space-y-4">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-text">
          <Flag className="size-4" /> Your career action plan
        </p>
        <ol className="space-y-2">
          {action.map((item, i) => (
            <li key={item} className="flex gap-3 text-sm">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-semibold tabular-nums">
                {i + 1}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
        <p className="text-xs text-faint">Action from this analysis — not generic advice, and not a guarantee of a job.</p>
      </section>
    </div>
  );
}
