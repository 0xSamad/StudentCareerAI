"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getUrlApplicationBatch, resumeUrlApplication } from "@/lib/opportunity-client";
import { cn } from "@/lib/cn";

type Job = {
  id: string;
  url: string;
  company?: string;
  role?: string;
  phase: string;
  message?: string;
  sessionId?: string | null;
  preview?: string | null;
  progress?: number;
  waitingFields?: { fieldId: string; label: string; reason?: string }[];
  actionRequired?: {
    question?: { fieldId: string; label: string; reason?: string } | null;
    body?: string;
    needsJd?: boolean;
  } | null;
};

function isWaiting(phase: string) {
  return (
    phase === "WAITING_FOR_USER" ||
    phase === "CAPTCHA_REQUIRED" ||
    phase === "INFORMATION_REQUIRED" ||
    phase === "LOGIN_REQUIRED" ||
    phase === "EMAIL_VERIFICATION_REQUIRED"
  );
}

function pickJob(jobs: Job[], selected: string) {
  if (selected && jobs.some((job) => job.id === selected)) return jobs.find((job) => job.id === selected) as Job;
  return (
    jobs.find((job) => job.phase === "RUNNING" || job.phase === "APPLYING") ||
    jobs.find((job) => isWaiting(job.phase)) ||
    jobs[0]
  );
}

function coords(img: HTMLImageElement, event: PointerEvent | React.PointerEvent) {
  const rect = img.getBoundingClientRect();
  const x = (event.clientX - rect.left) / Math.max(1, rect.width);
  const y = (event.clientY - rect.top) / Math.max(1, rect.height);
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function ApplyLiveWindow({ batchId }: { batchId: string }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState("");
  const [frame, setFrame] = useState<{
    preview?: string | null;
    pageUrl?: string;
    sessionId?: string | null;
    message?: string;
    waitingFields?: Job["waitingFields"];
    actionRequired?: Job["actionRequired"];
  }>({});
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState("");
  const [acting, setActing] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const queue = useRef<{ type: string; x?: number; y?: number; key?: string; deltaY?: number }[]>([]);
  const sending = useRef(false);
  const lastMoveAt = useRef(0);
  const previewUrl = useRef<string | null>(null);

  const job = useMemo(() => pickJob(jobs, selected), [jobs, selected]);

  useEffect(() => {
    if (!batchId || batchId === "starting") return;
    let stop = false;
    const poll = async () => {
      while (!stop) {
        try {
          const data = await getUrlApplicationBatch(batchId);
          if (!stop && data.batch?.jobs) setJobs(data.batch.jobs);
        } catch {
          /* keep polling */
        }
        await sleep(2000);
      }
    };
    void poll();
    return () => {
      stop = true;
    };
  }, [batchId]);

  useEffect(() => {
    if (!batchId || !job?.id) return;
    let stop = false;
    const poll = async () => {
      while (!stop) {
        try {
          const res = await fetch(
            `/api/apply/live?batchId=${encodeURIComponent(batchId)}&jobId=${encodeURIComponent(job.id)}`,
          );
          const data = await res.json();
          if (stop) return;
          if (data.ok === false) {
            setError(data.error || "");
          } else {
            setError("");
            setFrame((prev) => ({
              ...prev,
              pageUrl: data.pageUrl || job.url,
              sessionId: data.sessionId || job.sessionId,
              message: data.message || job.message,
              waitingFields: data.waitingFields || job.waitingFields,
              actionRequired: data.actionRequired || job.actionRequired,
            }));
          }
        } catch {
          /* keep polling */
        }
        await sleep(job.phase === "RUNNING" || isWaiting(job.phase) ? 1500 : 2500);
      }
    };
    void poll();
    return () => {
      stop = true;
    };
  }, [batchId, job?.id, job?.phase, job?.sessionId, job?.url, job?.message]);

  useEffect(() => {
    if (!batchId || !job?.id) return;
    let stop = false;
    let etag = "";
    const poll = async () => {
      while (!stop) {
        try {
          const res = await fetch(
            `/api/apply/live?batchId=${encodeURIComponent(batchId)}&jobId=${encodeURIComponent(job.id)}&image=1`,
            {
              cache: "no-store",
              headers: etag ? { "If-None-Match": etag } : undefined,
            },
          );
          if (stop) return;
          if (res.status === 200) {
            etag = res.headers.get("ETag") || "";
            const blob = await res.blob();
            const next = URL.createObjectURL(blob);
            const pageUrl = res.headers.get("X-Apply-Url");
            setFrame((prev) => ({
              ...prev,
              preview: next,
              pageUrl: pageUrl ? decodeURIComponent(pageUrl) : prev.pageUrl,
            }));
            if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
            previewUrl.current = next;
          } else if (res.status !== 304 && res.status !== 204) {
            await sleep(400);
          }
        } catch {
          await sleep(250);
        }
        await sleep(job.phase === "RUNNING" || isWaiting(job.phase) ? 90 : 280);
      }
    };
    void poll();
    return () => {
      stop = true;
      if (previewUrl.current) {
        URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = null;
      }
    };
  }, [batchId, job?.id, job?.phase]);

  const flush = async () => {
    if (sending.current || !job || !queue.current.length) return;
    sending.current = true;
    const events = queue.current.splice(0, 40);
    try {
      await fetch("/api/apply/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId, jobId: job.id, sessionId: frame.sessionId || job.sessionId, events }),
      });
    } catch {
      /* keep trying */
    } finally {
      sending.current = false;
      if (queue.current.length) void flush();
    }
  };

  const send = (type: string, event?: React.PointerEvent<HTMLImageElement> | React.WheelEvent<HTMLImageElement> | React.KeyboardEvent) => {
    const img = imgRef.current;
    if (!img || !job) return;
    if (type === "move") {
      const now = Date.now();
      if (now - lastMoveAt.current < 40) return;
      lastMoveAt.current = now;
    }
    if (type === "key" && event && "key" in event) {
      event.preventDefault();
      queue.current.push({ type: "key", key: (event as React.KeyboardEvent).key });
    } else if (type === "scroll" && event && "deltaY" in event) {
      event.preventDefault();
      queue.current.push({ type: "scroll", deltaY: (event as React.WheelEvent).deltaY });
    } else if (event && "clientX" in event) {
      event.preventDefault();
      queue.current.push({ type, ...coords(img, event as React.PointerEvent) });
    }
    void flush();
  };

  const waiting = job ? isWaiting(job.phase) : false;
  const title = job ? [job.company, job.role].filter(Boolean).join(" — ") || "Application" : "Starting application";
  const question = job?.actionRequired?.question || frame.actionRequired?.question || job?.waitingFields?.[0] || frame.waitingFields?.[0];

  return (
    <div className="flex h-dvh flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center gap-3 border-b border-white/10 bg-zinc-900 px-3 py-2">
        <span className="size-2.5 rounded-full bg-red-400/90" aria-hidden />
        <span className="size-2.5 rounded-full bg-amber-400/90" aria-hidden />
        <span className="size-2.5 rounded-full bg-emerald-400/90" aria-hidden />
        <p className="min-w-0 flex-1 truncate rounded-md bg-zinc-800 px-3 py-1 text-xs text-zinc-300">
          {frame.pageUrl || job?.url || "Opening the employer form…"}
        </p>
        {job?.phase === "RUNNING" ? (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">Filling</span>
        ) : null}
      </header>

      {jobs.length > 1 ? (
        <div className="flex gap-1 overflow-x-auto border-b border-white/10 bg-zinc-900 px-2 py-1">
          {jobs.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => setSelected(row.id)}
              className={cn(
                "shrink-0 rounded-md px-2 py-1 text-[11px]",
                (job?.id === row.id ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white"),
              )}
            >
              {row.company || `Job ${row.id.slice(-4)}`}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="truncate text-[11px] text-zinc-400">{frame.message || job?.message || "Preparing your application. The form will appear here."}</p>
        </div>
        {waiting ? (
          <p className="shrink-0 text-[11px] font-medium text-amber-300">Your click is needed in this window</p>
        ) : null}
      </div>

      <div
        className="relative min-h-0 flex-1 bg-zinc-900"
        tabIndex={0}
        onKeyDown={(event) => send("key", event)}
      >
        {frame.preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imgRef}
            src={frame.preview}
            alt={title}
            className="h-full w-full cursor-crosshair object-contain object-top"
            draggable={false}
            onPointerDown={(event) => {
              (event.currentTarget as HTMLImageElement).setPointerCapture(event.pointerId);
              send("down", event);
            }}
            onPointerMove={(event) => {
              if (event.buttons) send("move", event);
            }}
            onPointerUp={(event) => send("up", event)}
            onWheel={(event) => send("scroll", event)}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-zinc-400">
            {error || "Opening the employer form in this window…"}
          </div>
        )}
      </div>
      {question ? (
        <form
          className="flex flex-wrap items-end gap-2 border-t border-amber-500/30 bg-amber-950/40 px-3 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = answer.trim();
            if (!question || !value || !batchId || !job) return;
            setActing(true);
            void resumeUrlApplication(batchId, job.id, {
              action: "answer",
              answers: [{ fieldId: question.fieldId, label: question.label, value }],
            })
              .then(() => setAnswer(""))
              .catch((err) => setError(err instanceof Error ? err.message : "Could not save that answer."))
              .finally(() => setActing(false));
          }}
        >
          <label className="min-w-0 flex-1 text-[11px] text-amber-100">
            {question.label || "Your answer"}
            <input
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              className="mt-1 w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-sm text-white"
              placeholder="Type the answer, or click the field in the form above"
            />
          </label>
          <button
            type="submit"
            disabled={acting || !answer.trim()}
            className="rounded-md bg-amber-400 px-3 py-1.5 text-xs font-semibold text-zinc-950 disabled:opacity-50"
          >
            {acting ? "Saving…" : "Continue"}
          </button>
        </form>
      ) : null}
      <p className="border-t border-white/10 px-3 py-2 text-[11px] text-zinc-500">
        This is the live application. Watch it fill, and solve CAPTCHAs here. Nothing is submitted for you.
      </p>
    </div>
  );
}
