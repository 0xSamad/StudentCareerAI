import type { Opportunity } from "@/app/api/opportunities/route";

export async function addOpportunitiesToQueue(items: Opportunity[], count = items.length) {
  const payload = Array.isArray(items) ? items.filter(Boolean) : [];
  const opportunityIds = payload.map((o) => o.id).filter(Boolean);
  const res = await fetch("/api/applications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      opportunityIds,
      count,
    }),
  });
  const data = await res.json().catch(() => ({}));
  const addedCount = Number(data.addedCount || 0);
  const skippedCount = Number(data.skippedCount || 0);
  if (!res.ok || data.ok === false || (addedCount === 0 && skippedCount === 0)) {
    throw new Error(data.error || data.message || "Could not add to applications.");
  }
  return data;
}
