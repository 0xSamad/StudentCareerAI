"use client";

import { groupWeeksByMonth, type RoadmapWeek } from "@/lib/role-analyzer-view";

export function RoadmapTimeline({
  weeks,
  completed,
  onToggle,
  busy,
}: {
  weeks: RoadmapWeek[];
  completed: Set<string>;
  onToggle: (key: string, next: boolean) => void;
  busy?: boolean;
}) {
  const months = groupWeeksByMonth(weeks);

  return (
    <div className="space-y-8">
      {months.map(({ month, weeks: monthWeeks }) => (
        <section key={month} aria-labelledby={`month-${month}`}>
          <h3 id={`month-${month}`} className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Month {month}
          </h3>
          <ol className="relative space-y-3 border-l border-border pl-4 sm:pl-5">
            {monthWeeks.map((week) => {
              const key = `week:${week.week}`;
              const done = completed.has(key);
              return (
                <li key={week.week} className="relative">
                  <span className="absolute -left-[1.35rem] top-3 size-2.5 rounded-full border border-border bg-background sm:-left-[1.6rem]" aria-hidden />
                  <details className="rounded-xl border border-border bg-surface/60 open:bg-surface">
                    <summary className="cursor-pointer list-none px-4 py-3 marker:content-none [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          {week.phaseName ? (
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-text">{week.phaseName}</p>
                          ) : null}
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Week {week.week}</p>
                          <p className="text-sm font-medium text-foreground">{week.objective}</p>
                          {week.skills?.length ? (
                            <p className="mt-1 text-xs text-muted">{week.skills.join(" · ")}</p>
                          ) : null}
                        </div>
                        <span className="text-xs tabular-nums text-faint">{week.estimatedHours}</span>
                      </div>
                    </summary>
                    <div className="space-y-3 border-t border-border px-4 py-3 text-sm">
                      {week.learn?.length || week.topics?.length ? (
                        <p>
                          <span className="font-medium">Learn: </span>
                          {(week.learn || week.topics || []).join(", ")}
                        </p>
                      ) : null}
                      {(week.practice || week.practicalTasks)?.length ? (
                        <p>
                          <span className="font-medium">Practice: </span>
                          {(week.practice || week.practicalTasks).join(" ")}
                        </p>
                      ) : null}
                      {week.build || week.projectWork ? (
                        <p>
                          <span className="font-medium">Project: </span>
                          {week.build || week.projectWork}
                        </p>
                      ) : null}
                      {(week.deliverable || week.deliverables)?.length ? (
                        <p>
                          <span className="font-medium">Deliverable: </span>
                          {(week.deliverable || week.deliverables).join("; ")}
                        </p>
                      ) : null}
                      {week.resources?.length ? (
                        <div>
                          <p className="font-medium">Resources</p>
                          <ul className="mt-1 space-y-1">
                            {week.resources.map((r) => (
                              <li key={r.url || r.title}>
                                {r.url ? (
                                  <a href={r.url} target="_blank" rel="noreferrer" className="text-brand-text hover:underline">
                                    {r.title}
                                  </a>
                                ) : (
                                  r.title
                                )}
                                {r.why ? <span className="text-muted"> — {r.why}</span> : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {(week.interview || week.interviewPreparation)?.length ? (
                        <p>
                          <span className="font-medium">Interview: </span>
                          {(week.interview || week.interviewPreparation).join(" ")}
                        </p>
                      ) : null}
                      <p>
                        <span className="font-medium">Milestone: </span>
                        {week.successCriteria || week.milestone}
                      </p>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-4 accent-[hsl(26_73%_51%)]"
                          checked={done}
                          disabled={busy}
                          onChange={(e) => onToggle(key, e.target.checked)}
                        />
                        Mark week {week.week} complete
                      </label>
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
