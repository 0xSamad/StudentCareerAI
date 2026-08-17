/**
 * ats-adapters.mjs — Optional ATS schema enrichment. Never required for filling.
 * Failures fall back to semantic DOM extraction.
 */

function greenhouseParse(url = "") {
  try {
    const u = new URL(url);
    if (!/(^|\.)greenhouse\.io$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/\/([^/]+)\/jobs\/(\d+)/);
    if (m) return { token: m[1], jobId: m[2] };
    const forToken = u.searchParams.get("for");
    const jobId = u.searchParams.get("token");
    if (forToken && jobId) return { token: forToken, jobId };
  } catch {
    /* ignore */
  }
  return null;
}

async function fetchGreenhouseSchema(token, jobId) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs/${encodeURIComponent(jobId)}?questions=true`;
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = await res.json();
  const map = new Map();
  for (const q of data.questions || []) {
    const label = String(q.label || "").replace(/\s*\*+\s*$/, "").trim();
    for (const f of q.fields || []) {
      if (!f.name) continue;
      const rec = {
        label,
        required: !!q.required,
        options: (f.values || []).map((v) => String(v.label || "").trim()).filter(Boolean),
        type: f.type || null,
      };
      map.set(f.name, rec);
      if (label) map.set(`label:${label.toLowerCase()}`, rec);
    }
  }
  return map.size ? map : null;
}

function mergeSchema(fields, schema) {
  if (!schema) return fields;
  return fields.map((f) => {
    const hit =
      (f.nativeName && schema.get(f.nativeName)) ||
      (f.name && schema.get(f.name)) ||
      (f.nativeId && schema.get(f.nativeId)) ||
      (f.id && schema.get(f.id)) ||
      (f.label && schema.get(`label:${String(f.label).toLowerCase()}`));
    if (!hit) return f;
    return {
      ...f,
      label: hit.label || f.label,
      required: f.required || hit.required,
      options: f.options?.length ? f.options : hit.options || [],
    };
  });
}

/**
 * Enrich extracted fields with a public ATS question schema when the URL matches.
 */
export async function enrichFieldsFromAtsAdapter(url, fields, platform = "generic") {
  try {
    if (platform === "greenhouse" || /greenhouse/i.test(url || "")) {
      const parsed = greenhouseParse(url);
      if (!parsed) return fields;
      const schema = await fetchGreenhouseSchema(parsed.token, parsed.jobId);
      return mergeSchema(fields, schema);
    }
  } catch {
    return fields;
  }
  return fields;
}
