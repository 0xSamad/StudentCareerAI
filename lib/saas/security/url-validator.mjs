/**
 * url-validator.mjs — SSRF Prevention & Safe URL Fetcher
 *
 * Blocks requests to private IP ranges, loopback, cloud metadata services,
 * and disallowed protocols to prevent Server-Side Request Forgery (SSRF).
 */

import { URL } from "node:url";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "169.254.169.254", // AWS/GCP/Azure link-local metadata
  "metadata.google.internal",
  "instance-data",
]);

export class URLValidator {
  /**
   * Check if a URL is safe to fetch from an external worker.
   *
   * @param {string} candidateUrl
   * @returns {{ safe: boolean, error: string|null, url: URL|null }}
   */
  static validate(candidateUrl) {
    if (!candidateUrl || typeof candidateUrl !== "string") {
      return { safe: false, error: "Empty or invalid URL provided", url: null };
    }

    let parsed;
    try {
      parsed = new URL(candidateUrl);
    } catch {
      return { safe: false, error: "Malformed URL syntax", url: null };
    }

    // 1. Protocol Allowlist: only http: and https:
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { safe: false, error: `Disallowed protocol: '${parsed.protocol}'. Only http/https allowed.`, url: null };
    }

    const hostname = parsed.hostname.toLowerCase();

    // 2. Exact Blocklist
    if (BLOCKED_HOSTS.has(hostname)) {
      return { safe: false, error: `Access to private/metadata host '${hostname}' is strictly blocked (SSRF defense)`, url: null };
    }

    // 3. Loopback & RFC1918 Private IPv4 Ranges
    if (
      hostname.startsWith("127.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("169.254.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
      return { safe: false, error: `Access to private subnet '${hostname}' is strictly blocked (SSRF defense)`, url: null };
    }

    // 4. IPv6 Loopback / Link-Local
    if (hostname.startsWith("[::") || hostname.startsWith("[fe80:") || hostname.startsWith("[fc") || hostname.startsWith("[fd")) {
      return { safe: false, error: `Access to private IPv6 range '${hostname}' is strictly blocked (SSRF defense)`, url: null };
    }

    return { safe: true, error: null, url: parsed };
  }
}
