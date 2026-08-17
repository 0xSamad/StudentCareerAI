/**
 * rate-limiter.mjs — Protection against hammering external APIs.
 *
 * - SourceRateLimiter: per-source concurrency cap + minimum spacing between
 *   requests + hard per-run request budget.
 * - fetchWithBackoff: exponential backoff with jitter; honors Retry-After /
 *   HTTP 429 by surfacing rateLimitResetAt so the discovery state store can
 *   park the source until the window resets.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class RateLimitError extends Error {
  constructor(message, { rateLimitResetAt } = {}) {
    super(message);
    this.name = 'RateLimitError';
    this.rateLimited = true;
    this.rateLimitResetAt = rateLimitResetAt || null;
  }
}

/** Parse a Retry-After header (seconds or HTTP date) into an ISO reset time. */
export function retryAfterToIso(retryAfter, { now = Date.now(), defaultMs = 15 * 60 * 1000 } = {}) {
  if (retryAfter == null || retryAfter === '') return new Date(now + defaultMs).toISOString();
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return new Date(now + seconds * 1000).toISOString();
  }
  const asDate = new Date(retryAfter);
  if (!Number.isNaN(asDate.getTime())) return asDate.toISOString();
  return new Date(now + defaultMs).toISOString();
}

/**
 * Per-source throttle: at most `maxConcurrent` requests in flight, at least
 * `minIntervalMs` between request starts, and at most `maxRequests` per run.
 */
export class SourceRateLimiter {
  constructor({ minIntervalMs = 250, maxConcurrent = 4, maxRequests = Infinity } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.maxConcurrent = maxConcurrent;
    this.maxRequests = maxRequests;
    this.inFlight = 0;
    this.started = 0;
    this.lastStartAt = 0;
    this.queue = [];
  }

  get exhausted() {
    return this.started >= this.maxRequests;
  }

  async schedule(fn) {
    if (this.exhausted) throw new Error('request_budget_exhausted');
    await new Promise((resolve) => {
      this.queue.push(resolve);
      this._drain();
    });
    try {
      return await fn();
    } finally {
      this.inFlight -= 1;
      this._drain();
    }
  }

  _drain() {
    while (this.queue.length > 0 && this.inFlight < this.maxConcurrent && !this.exhausted) {
      const wait = Math.max(0, this.lastStartAt + this.minIntervalMs - Date.now());
      const resolve = this.queue.shift();
      this.inFlight += 1;
      this.started += 1;
      this.lastStartAt = Date.now() + wait;
      if (wait > 0) setTimeout(resolve, wait);
      else resolve();
    }
  }
}

/**
 * Run fn with exponential backoff + jitter. fn may throw a RateLimitError (or
 * any error with .rateLimited) to abort retries immediately — rate limits are
 * respected, never retried through.
 *
 * @param {() => Promise<any>} fn
 * @param {{ retries?: number, baseDelayMs?: number, maxDelayMs?: number, sleepFn?: (ms:number)=>Promise<void> }} [opts]
 */
export async function fetchWithBackoff(fn, opts = {}) {
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 800;
  const maxDelayMs = opts.maxDelayMs ?? 15_000;
  const doSleep = opts.sleepFn || sleep;

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (err?.rateLimited) throw err; // park the source, do not hammer
      if (attempt === retries) break;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      await doSleep(delay + Math.floor(Math.random() * (delay / 2)));
    }
  }
  throw lastError;
}
