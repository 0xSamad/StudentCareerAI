/**
 * conditional-fetch.mjs — HTTP ETag / Last-Modified + 429 handling.
 *
 * When the source supports it:
 *   If-None-Match: <etag>
 *   If-Modified-Since: <last-modified>
 * A 304 Not Modified means: do not reprocess opportunities; only bump
 * lastCheckedAt on the SourceCache.
 */

import { RateLimitError, retryAfterToIso } from './rate-limiter.mjs';

/**
 * @param {string} url
 * @param {{
 *   etag?: string|null,
 *   lastModified?: string|null,
 *   headers?: Record<string,string>,
 *   timeoutMs?: number,
 *   parse?: 'json'|'text',
 * }} [opts]
 * @returns {Promise<{
 *   notModified: boolean,
 *   status: number,
 *   body: any,
 *   etag: string|null,
 *   lastModified: string|null,
 *   requestsRemaining: number|null,
 *   rateLimitResetAt: string|null,
 * }>}
 */
export async function conditionalFetch(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.etag) headers['if-none-match'] = opts.etag;
  if (opts.lastModified) headers['if-modified-since'] = opts.lastModified;

  const res = await fetch(url, {
    headers,
    redirect: opts.redirect || 'follow',
    signal: AbortSignal.timeout(opts.timeoutMs || 12_000),
  });

  const etag = res.headers.get('etag');
  const lastModified = res.headers.get('last-modified');
  const remainingRaw = res.headers.get('x-ratelimit-remaining') || res.headers.get('x-rate-limit-remaining');
  const remaining = remainingRaw != null && remainingRaw !== '' ? Number(remainingRaw) : null;
  const resetHeader = res.headers.get('x-ratelimit-reset') || res.headers.get('retry-after');

  if (res.status === 429 || res.status === 403) {
    throw new RateLimitError(`${opts.label || 'http'}_${res.status}`, {
      rateLimitResetAt: retryAfterToIso(res.headers.get('retry-after')),
    });
  }

  if (res.status === 304) {
    return {
      notModified: true,
      status: 304,
      body: null,
      etag: etag || opts.etag || null,
      lastModified: lastModified || opts.lastModified || null,
      requestsRemaining: Number.isFinite(remaining) ? remaining : null,
      rateLimitResetAt: resetHeader ? retryAfterToIso(resetHeader) : null,
    };
  }

  if (!res.ok) {
    const err = new Error(`${opts.label || 'http'}_${res.status}`);
    err.status = res.status;
    throw err;
  }

  const parse = opts.parse || 'text';
  const body = parse === 'json' ? await res.json() : await res.text();
  return {
    notModified: false,
    status: res.status,
    body,
    etag: etag || null,
    lastModified: lastModified || null,
    requestsRemaining: Number.isFinite(remaining) ? remaining : null,
    rateLimitResetAt: null,
  };
}
