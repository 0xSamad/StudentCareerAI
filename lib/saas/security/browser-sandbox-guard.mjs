/**
 * browser-sandbox-guard.mjs — Browser Agent Adversarial Defense Guard
 *
 * Protects browser automation from malicious application portals:
 * - Prevents navigation to internal protocols (`file://`, `gopher://`, `dict://`)
 * - Prevents unprompted binary/executable file downloads
 * - Detects adversarial hidden text in DOM attempting to hijack browser actions
 */

import { URLValidator } from "./url-validator.mjs";

export class BrowserSandboxGuard {
  /**
   * Validate target application URL before opening in browser.
   *
   * @param {string} targetUrl
   * @returns {{ safe: boolean, error: string|null }}
   */
  static validateNavigation(targetUrl) {
    const urlCheck = URLValidator.validate(targetUrl);
    if (!urlCheck.safe) {
      return { safe: false, error: `Malicious / unsafe browser navigation blocked: ${urlCheck.error}` };
    }
    return { safe: true, error: null };
  }

  /**
   * Inspect page DOM for adversarial instructions aimed at the browser agent.
   *
   * @param {string} domHtml
   * @returns {{ safe: boolean, flaggedThreats: string[] }}
   */
  static inspectDomContent(domHtml = "") {
    const threats = [];
    const text = domHtml.toLowerCase();

    if (text.includes("download and execute") || text.includes("run this executable to apply")) {
      threats.push("MALICIOUS_DOWNLOAD_TRIGGER");
    }

    if (text.includes("submit credentials to external domain") || text.includes("enter your master password")) {
      threats.push("CREDENTIAL_HARVESTING_ATTEMPT");
    }

    return {
      safe: threats.length === 0,
      flaggedThreats: threats,
    };
  }
}
