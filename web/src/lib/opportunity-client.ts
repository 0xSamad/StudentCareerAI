import type { Opportunity } from "@/app/api/opportunities/route";
import { guessListingFromUrl, normalizeApplyUrl } from "@/lib/apply/url-listing.mjs";

export async function saveOpportunity(opportunityId: string, status = "SAVED") {
  const res = await fetch("/api/v1/opportunities/saved", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ opportunityId, status }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || "Could not save this opportunity.");
  }
  return data;
}

export async function unsaveOpportunity(opportunityId: string) {
  const res = await fetch(`/api/v1/opportunities/saved?opportunityId=${encodeURIComponent(opportunityId)}`, {
    method: "DELETE",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || "Could not remove this saved opportunity.");
  }
  return data;
}

export async function applyQueuedOpportunities(ids: string[], all = false) {
  const res = await fetch("/api/applications/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(all ? { all: true } : { ids }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || data.message || "Could not apply.");
  }
  return data;
}

/** Enqueue by persisted id, then open the career-ops headed apply engine. */
export async function enqueueAndApply(items: Opportunity[]) {
  const payload = Array.isArray(items) ? items.filter((o) => o?.id || o?.url) : [];
  if (payload.length === 0) throw new Error("Select at least one opportunity.");
  const first = payload[0];
  const res = await fetch("/api/opportunities/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      opportunityId: first.id,
      url: first.url || first.source_url,
      company: first.company,
      role: first.role,
      jdText: [first.description, ...(Array.isArray(first.requirements) ? first.requirements : [])]
        .filter(Boolean)
        .join("\n"),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || data.message || "Could not apply.");
  }
  return data;
}

/** Apply a pasted URL that may not be in Jobs. Never submits. */
export async function applyByUrl({
  url,
  company = "",
  role = "",
  jdText = "",
}: {
  url: string;
  company?: string;
  role?: string;
  jdText?: string;
}) {
  const href = normalizeApplyUrl(url);
  if (!href) throw new Error("Paste a full job or application URL (https://…).");
  const guessed = guessListingFromUrl(href);
  const res = await fetch("/api/opportunities/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: href,
      company: String(company || guessed.company || "").trim(),
      role: String(role || guessed.role || "").trim(),
      jdText,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || data.message || "Could not apply from that URL.");
  }
  return data;
}

/** Start one independent application per pasted URL. Never submits. */
export async function startUrlApplications(
  urls: Array<string | { url: string; company?: string; role?: string; jdText?: string }>,
) {
  const res = await fetch("/api/opportunities/apply-urls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || data.message || "Could not start applications.");
  }
  return data;
}

export async function getUrlApplicationBatch(batchId: string) {
  const res = await fetch(`/api/opportunities/apply-urls?batchId=${encodeURIComponent(batchId)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || "Could not load application status.");
  }
  return data;
}

export async function resumeUrlApplication(
  batchId: string,
  jobId: string,
  body: { action?: "resume" | "answer" | "open"; answers?: unknown; jdText?: string; captchaCleared?: boolean } = {},
) {
  const res = await fetch("/api/opportunities/apply-urls", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batchId, jobId, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || "Could not resume that application.");
  }
  return data;
}
