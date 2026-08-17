"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PriorityBadge } from "@/components/role-analyzer/demand-chart";
import { buttonSecondaryClassName } from "@/components/ui/page-header";
import { learnPathFor, statusMark, type RoadmapProject, type SkillRow } from "@/lib/role-analyzer-view";

export function SkillDialog({
  skill,
  project,
  onClose,
}: {
  skill: SkillRow;
  project?: RoadmapProject | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mark = statusMark(skill.status);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [onClose]);

  const demand = skill.frequencyPercent ?? skill.percent ?? skill.marketPercent;
  const count = skill.postingCount ?? skill.count;
  const total = skill.postingTotal ?? skill.total;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="presentation" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-dialog-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="skill-dialog-title" className="text-lg font-semibold text-foreground">
              {skill.skill}
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
              <Badge tone={mark.tone}>
                {mark.glyph} {mark.label}
              </Badge>
              <PriorityBadge value={skill.priorityLabel || skill.priority} />
            </p>
          </div>
          <button type="button" onClick={onClose} className={buttonSecondaryClassName} aria-label="Close skill details">
            <X className="size-4" />
          </button>
        </div>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Why it matters</dt>
            <dd className="mt-1 text-foreground">{skill.reason || "This skill showed up in the job ads we looked at for this role."}</dd>
          </div>
          {demand != null && total ? (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">How often jobs ask for it</dt>
              <dd className="mt-1 tabular-nums">
                {demand}% of the ads we checked ({count} of {total})
                {skill.mandatoryCount ? ` · listed as required in ${skill.mandatoryCount}` : ""}
              </dd>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Pakistan jobs</dt>
              <dd className="mt-1 tabular-nums">
                {skill.pakistanPercent == null ? "Not enough Pakistan ads for this skill" : `${skill.pakistanPercent}%`}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">International jobs</dt>
              <dd className="mt-1 tabular-nums">
                {skill.internationalPercent == null ? "Not enough international ads for this skill" : `${skill.internationalPercent}%`}
              </dd>
            </div>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">On your profile</dt>
            <dd className="mt-1">
              {skill.evidence ? `Your profile already shows this: ${skill.evidence}.` : "This is not on your profile or CV yet."}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">What to learn</dt>
            <dd className="mt-1">{learnPathFor(skill)}</dd>
          </div>
          {skill.estimatedEffort?.label ? (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Estimated effort</dt>
              <dd className="mt-1">{skill.estimatedEffort.label}</dd>
            </div>
          ) : null}
          {project ? (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Recommended project</dt>
              <dd className="mt-1">
                <p className="font-medium text-foreground">{project.title}</p>
                <p className="text-muted">{project.problem}</p>
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
    </div>
  );
}
