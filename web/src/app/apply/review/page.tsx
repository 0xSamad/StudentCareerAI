"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

function ReviewBody() {
  const params = useSearchParams();
  const company = params.get("company") || "";
  const role = params.get("role") || "";
  const job = params.get("job") || "";
  const [cv, setCv] = useState("");
  const [html, setHtml] = useState("");
  const [cover, setCover] = useState("");
  const [coverHtml, setCoverHtml] = useState("");
  const [cvPdfUrl, setCvPdfUrl] = useState("");
  const [coverPdfUrl, setCoverPdfUrl] = useState("");
  const [tab, setTab] = useState<"cv" | "cover">("cv");
  const [error, setError] = useState("");
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!company && !job) return;
    const q = new URLSearchParams();
    if (company) q.set("company", company);
    if (role) q.set("role", role);
    if (job) q.set("job", job);
    fetch(`/api/apply/artifacts?${q.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setCv(data.cv || "");
        setHtml(data.html || "");
        setCover(data.coverLetter || "");
        setCoverHtml(data.coverHtml || "");
        setCvPdfUrl(data.cvPdfUrl || "");
        setCoverPdfUrl(data.coverPdfUrl || "");
        if (!data.cv && !data.coverLetter && !data.html && !data.coverHtml && !data.cvPdfUrl) {
          setError("No tailored files found yet. Apply once, then refresh this tab.");
        }
      })
      .catch(() => setError("Could not load the tailored files."));
  }, [company, role, job]);

  const pdfSrc = tab === "cv" ? cvPdfUrl : coverPdfUrl;
  const srcDoc = tab === "cv" ? html : coverHtml;
  const plain = tab === "cv" ? cv : cover;
  const fitFrame = useCallback(() => {
    if (pdfSrc) return;
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc) return;
    const height = Math.max(doc.documentElement?.scrollHeight || 0, doc.body?.scrollHeight || 0, 900);
    frame.style.height = `${height}px`;
  }, [pdfSrc]);

  useEffect(() => {
    const id = window.setTimeout(fitFrame, 120);
    return () => window.clearTimeout(id);
  }, [srcDoc, tab, fitFrame]);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#ececec] text-zinc-900">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur md:px-8">
        <p className="text-xs uppercase tracking-wide text-zinc-500">Tailored for this application</p>
        <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold md:text-2xl">
            {role || "Role"}
            {company ? ` · ${company}` : ""}
          </h1>
          <Link href="/" className="text-sm text-zinc-600 underline-offset-2 hover:underline">
            Back to dashboard
          </Link>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-zinc-600">
          This is the attached file — the same layout as your master CV, with wording tailored for this role. Nothing was submitted.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setTab("cv")}
            className={`rounded-md px-3 py-1.5 text-sm ${tab === "cv" ? "bg-brand text-white" : "border border-zinc-300 bg-white"}`}
          >
            Tailored CV
          </button>
          <button
            type="button"
            onClick={() => setTab("cover")}
            className={`rounded-md px-3 py-1.5 text-sm ${tab === "cover" ? "bg-brand text-white" : "border border-zinc-300 bg-white"}`}
          >
            Cover letter
          </button>
        </div>
      </header>
      {error ? <p className="px-4 py-4 text-sm text-red-600 md:px-8">{error}</p> : null}
      <section className="flex-1 px-3 py-6 md:px-8 md:py-8">
        {pdfSrc ? (
          <iframe
            title={tab === "cv" ? "Tailored CV" : "Cover letter"}
            className="mx-auto block h-[calc(100dvh-9.5rem)] w-full max-w-[900px] rounded-sm bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
            src={pdfSrc}
          />
        ) : srcDoc ? (
          <iframe
            ref={frameRef}
            title={tab === "cv" ? "Tailored CV" : "Cover letter"}
            className="mx-auto block w-full max-w-[820px] rounded-sm bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
            srcDoc={srcDoc}
            onLoad={fitFrame}
          />
        ) : (
          <article className="mx-auto w-full max-w-[820px] whitespace-pre-wrap rounded-sm bg-white px-12 py-14 text-[17px] leading-7 shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
            {plain || (tab === "cv" ? "No tailored CV yet." : "No cover letter yet.")}
          </article>
        )}
      </section>
    </div>
  );
}

export default function ApplyReviewPage() {
  return (
    <Suspense fallback={<main className="px-6 py-10 text-sm text-zinc-500">Loading tailored files…</main>}>
      <ReviewBody />
    </Suspense>
  );
}
