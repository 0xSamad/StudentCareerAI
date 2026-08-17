/**
 * security-detector.mjs — Anti-Bypass Security & Human-Verification Detector
 *
 * Implements strict anti-bypass detection for:
 * - CAPTCHAs (reCAPTCHA, hCaptcha, Turnstile, Arkose)
 * - MFA / 2FA verification prompts (SMS, Authenticator, Push)
 * - Authentication & SSO walls (Okta, Workday, Google Auth, SAML)
 * - Cloudflare / WAF challenge pages
 *
 * HARD INVARIANT: The system NEVER attempts to bypass security controls.
 * It immediately pauses the application, notifies the candidate, and waits for user intervention.
 */

export const ChallengeType = Object.freeze({
  CAPTCHA: "CAPTCHA",
  MFA: "MFA",
  AUTH_WALL: "AUTH_WALL",
  CLOUDFLARE_WAF: "CLOUDFLARE_WAF",
});

export class SecurityDetector {
  /**
   * Analyze page content, URL, or API response for security challenges.
   *
   * @param {string} pageUrl - Current target URL
   * @param {string} [pageContent=""] - HTML / DOM content of the page
   * @returns {{ challengeDetected: boolean, type: string|null, reason: string|null, userActionRequired: string|null }}
   */
  static detectChallenge(pageUrl = "", pageContent = "") {
    const text = `${pageUrl} ${pageContent}`.toLowerCase();

    // 1. CAPTCHA Detection
    if (
      text.includes("captcha") ||
      text.includes("recaptcha") ||
      text.includes("hcaptcha") ||
      text.includes("turnstile") ||
      text.includes("cf-challenge") ||
      text.includes("please verify you are a human") ||
      text.includes("human verification required")
    ) {
      return {
        challengeDetected: true,
        type: ChallengeType.CAPTCHA,
        reason: "Security challenge detected (CAPTCHA / Human Verification)",
        userActionRequired: "Please open the application link and complete the human verification check.",
      };
    }

    // 2. MFA / Two-Factor Authentication Detection
    if (
      text.includes("two-factor") ||
      text.includes("multi-factor") ||
      text.includes("2fa") ||
      text.includes("enter verification code") ||
      text.includes("authenticator code") ||
      text.includes("sms verification")
    ) {
      return {
        challengeDetected: true,
        type: ChallengeType.MFA,
        reason: "Multi-Factor Authentication (MFA / 2FA) prompt encountered",
        userActionRequired: "Please approve the two-factor authentication prompt on your device.",
      };
    }

    // 3. SSO / Enterprise Login Wall Detection
    if (
      text.includes("auth-required") ||
      text.includes("sso login required") ||
      text.includes("sign in with okta") ||
      text.includes("workday login") ||
      text.includes("enterprise credentials required") ||
      text.includes("login.microsoftonline.com")
    ) {
      return {
        challengeDetected: true,
        type: ChallengeType.AUTH_WALL,
        reason: "Enterprise Authentication Wall (SSO / Login required)",
        userActionRequired: "Please sign in to your enterprise account to authorize application submission.",
      };
    }

    // 4. Cloudflare / WAF Block
    if (
      text.includes("checking your browser before accessing") ||
      text.includes("cloudflare ray id") ||
      text.includes("waf block")
    ) {
      return {
        challengeDetected: true,
        type: ChallengeType.CLOUDFLARE_WAF,
        reason: "Web Application Firewall (WAF) challenge screen encountered",
        userActionRequired: "Please access the link directly in your browser to pass firewall challenge.",
      };
    }

    return {
      challengeDetected: false,
      type: null,
      reason: null,
      userActionRequired: null,
    };
  }
}
