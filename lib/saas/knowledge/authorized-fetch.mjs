/**
 * authorized-fetch.mjs — Legitimate public / user-authorized HTTP only.
 * Never bypasses auth walls, CAPTCHA, rate limits, or private hosts.
 */

import { URLValidator } from "../security/url-validator.mjs";

const MAX_BYTES = 500_000;
const TIMEOUT_MS = 12_000;
const BLOCKED_FETCH_HOSTS = new Set(["linkedin.com", "www.linkedin.com", "lnkd.in"]);

export function detectProtection({ status, headers = {}, body = "" } = {}) {
  if (status === 401 || status === 403) return "auth_required";
  if (status === 429) return "rate_limited";
  if (status === 404) return "not_found";
  const hay = `${String(body || "").slice(0, 6000)}\n${headers["cf-mitigated"] || ""}`.toLowerCase();
  if (/captcha|cf-challenge|hcaptcha|recaptcha|why do i have to complete a captcha/.test(hay)) return "captcha";
  if (/\b(authwall|login to continue|sign in to continue|join now to view)\b/.test(hay)) return "auth_wall";
  return null;
}

export function assertSafePublicUrl(candidateUrl, { allowHosts = null, denyHosts = BLOCKED_FETCH_HOSTS } = {}) {
  const checked = URLValidator.validate(candidateUrl);
  if (!checked.safe) {
    return { ok: false, status: "UNKNOWN", reason: checked.error, url: null };
  }
  const host = checked.url.hostname.toLowerCase().replace(/^www\./, "");
  const deny = new Set([...(denyHosts || [])].map((h) => String(h).replace(/^www\./, "")));
  if (deny.has(host) || deny.has(checked.url.hostname.toLowerCase())) {
    return {
      ok: false,
      status: "UNKNOWN",
      reason: `Automated fetch of ${checked.url.hostname} is not allowed.`,
      url: checked.url,
    };
  }
  if (Array.isArray(allowHosts) && allowHosts.length) {
    const allow = allowHosts.map((h) => h.toLowerCase());
    if (!allow.includes(checked.url.hostname.toLowerCase())) {
      return {
        ok: false,
        status: "UNKNOWN",
        reason: `Host ${checked.url.hostname} is not on the authorized allow-list.`,
        url: checked.url,
      };
    }
  }
  return { ok: true, status: "OK", url: checked.url };
}

/**
 * Single GET. Does not retry on 401/403/404/429/CAPTCHA.
 */
export async function authorizedGet(candidateUrl, {
  fetchFn = fetch,
  headers = {},
  allowHosts = null,
  denyHosts = BLOCKED_FETCH_HOSTS,
  timeoutMs = TIMEOUT_MS,
  redirectHops = 0,
} = {}) {
  const safe = assertSafePublicUrl(candidateUrl, { allowHosts, denyHosts });
  if (!safe.ok) {
    return { ok: false, status: "UNKNOWN", protection: "blocked", reason: safe.reason, body: "", httpStatus: 0 };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(safe.url.toString(), {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        "User-Agent": "StudentCareer-AI-CandidateKnowledge/1.0",
        ...headers,
      },
    });

    if (res.status >= 300 && res.status < 400) {
    const location = typeof res.headers?.get === "function"
      ? res.headers.get("location")
      : res.headers?.location;
      if (location && allowHosts && allowHosts.length && redirectHops < 2) {
        const next = assertSafePublicUrl(new URL(location, safe.url).toString(), { allowHosts, denyHosts });
        if (next.ok) {
          return authorizedGet(next.url.toString(), {
            fetchFn,
            headers,
            allowHosts,
            denyHosts,
            timeoutMs,
            redirectHops: redirectHops + 1,
          });
        }
      }
      return {
        ok: false,
        status: "UNKNOWN",
        protection: "redirect",
        reason: "Redirects are not followed automatically (prevents SSRF and auth bypass).",
        httpStatus: res.status,
        body: "",
      };
    }

    const buf = Buffer.from(await res.arrayBuffer());
    const body = buf.subarray(0, MAX_BYTES).toString("utf8");
    const headerMap = {};
    res.headers.forEach((v, k) => {
      headerMap[k.toLowerCase()] = v;
    });
    const protection = detectProtection({ status: res.status, headers: headerMap, body });
    if (protection || res.status >= 400) {
      return {
        ok: false,
        status: "UNKNOWN",
        protection: protection || `http_${res.status}`,
        reason: protection
          ? `Source returned ${protection}; the fetcher stopped instead of bypassing it.`
          : `HTTP ${res.status}`,
        httpStatus: res.status,
        body: "",
      };
    }
    return { ok: true, status: "OK", httpStatus: res.status, body, headers: headerMap, url: safe.url.toString() };
  } catch (err) {
    return {
      ok: false,
      status: "UNKNOWN",
      protection: err?.name === "AbortError" ? "timeout" : "network",
      reason: err?.message || "Fetch failed",
      body: "",
      httpStatus: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}
