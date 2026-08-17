/**
 * Guess company/role from a pasted job URL when the listing is not in the queue.
 * Reformulation only — never claims the user works at that company.
 */

export function normalizeApplyUrl(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:\/\//i.test(s)) return "";
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    if (!u.hostname) return "";
    return u.href;
  } catch {
    return "";
  }
}

function titleCase(slug) {
  return String(slug || "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Parent careers page when the pasted URL is .../role/apply */
export function listingUrlFromApplyUrl(url) {
  const href = normalizeApplyUrl(url);
  if (!href) return "";
  try {
    const u = new URL(href);
    const trimmed = u.pathname.replace(/\/+$/, "");
    if (!/\/apply$/i.test(trimmed)) return "";
    u.pathname = trimmed.replace(/\/apply$/i, "") || "/";
    u.hash = "";
    return u.href;
  } catch {
    return "";
  }
}

export function guessListingFromUrl(url) {
  const href = normalizeApplyUrl(url);
  if (!href) return { company: "", role: "" };
  let host = "";
  let path = "";
  try {
    const u = new URL(href);
    host = u.hostname.replace(/^www\./i, "").toLowerCase();
    path = u.pathname;
  } catch {
    return { company: "", role: "" };
  }
  const segs = path.split("/").filter(Boolean);

  if (/greenhouse\.io$/.test(host)) {
    const skip = /^(boards|job-boards|jobs|job|embed)$/i;
    const companySeg = segs.find((s) => s && !skip.test(s) && !/^\d+$/.test(s)) || "";
    const idx = segs.indexOf(companySeg);
    const after = idx >= 0 ? segs.slice(idx + 1).filter((s) => !skip.test(s) && !/^\d+$/.test(s)) : [];
    return { company: titleCase(companySeg), role: titleCase(after[0] || "") };
  }
  if (/lever\.co$/.test(host) && segs[0]) {
    return { company: titleCase(segs[0]), role: titleCase(segs.slice(1).join(" ") || "") };
  }
  if (/ashbyhq\.com$/.test(host) && segs[0]) {
    return { company: titleCase(segs[0]), role: titleCase(segs.slice(1).join(" ") || "") };
  }
  if (/myworkdayjobs\.com$/.test(host)) {
    const tenant = host.split(".")[0];
    const jobSeg = segs.find((s) => /job/i.test(s));
    const afterJob = jobSeg ? segs[segs.indexOf(jobSeg) + 1] : segs.at(-1);
    return { company: titleCase(tenant), role: titleCase(String(afterJob || "").replace(/_r-?\d.*$/i, "")) };
  }

  const labels = host.split(".");
  const skip = new Set(["com", "co", "io", "org", "net", "edu", "gov", "uk", "us", "in", "pk", "jobs", "careers", "login", "www"]);
  const brand = labels.find((p) => p && !skip.has(p) && p.length > 1) || labels[0];
  const last = segs.at(-1) || "";
  const role = /^(job|jobs|apply|application|careers|login)$/i.test(last) ? "" : titleCase(last.replace(/[_-]+/g, " "));
  return { company: titleCase(brand), role };
}
