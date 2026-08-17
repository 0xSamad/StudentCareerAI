/**
 * rate-limiter.mjs — Sliding Window Rate Limiting Engine
 *
 * Enforces per-IP, per-User, and per-Tenant limits on:
 * - Authentication attempts (5 per 15 min)
 * - AI completions (30 per hour)
 * - Portal scraping sweeps (10 per hour)
 * - API requests (120 per minute)
 */

export class RateLimiter {
  constructor() {
    this.windows = new Map(); // key -> timestamps array
  }

  /**
   * Check and consume rate limit quota.
   *
   * @param {string} key - Rate limit key (e.g. `auth:${ip}`, `ai:${userId}`)
   * @param {number} maxRequests - Max allowed in window
   * @param {number} windowMs - Window duration in milliseconds
   * @returns {{ allowed: boolean, remaining: number, resetInMs: number }}
   */
  consume(key, maxRequests, windowMs) {
    const now = Date.now();
    const windowStart = now - windowMs;

    let timestamps = this.windows.get(key) || [];
    // Filter timestamps inside current sliding window
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length >= maxRequests) {
      const oldest = timestamps[0];
      const resetInMs = Math.max(0, oldest + windowMs - now);
      this.windows.set(key, timestamps);
      return { allowed: false, remaining: 0, resetInMs };
    }

    timestamps.push(now);
    this.windows.set(key, timestamps);

    return {
      allowed: true,
      remaining: maxRequests - timestamps.length,
      resetInMs: windowMs,
    };
  }

  reset(key) {
    this.windows.delete(key);
  }
}
