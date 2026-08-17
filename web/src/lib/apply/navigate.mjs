/**
 * Pure label rules for multi-step apply navigation.
 * Playwright clickers live in diagnose.ts; this file is unit-tested.
 */

export function normLabel(raw) {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
}

const SUBMIT =
  /^(submit application|send application|finish application|complete application|submit|apply and submit|apply & submit)$/i;
const GUEST =
  /^(apply as guest|continue as guest|continue without (an )?account|apply without (an )?account|guest apply|continue as a guest)$/i;
const SIGNUP_TAB = /^(create (an )?account|sign up|register|new user|join now)$/i;
const SSO_GOOGLE =
  /continue with google|sign in with google|log in with google|signin with google|sign up with google|apply with google|use google/i;
const NEXT =
  /^(next|continue|save and continue|save & continue|next step|continue to apply|continue application|save and next)$/i;
const APPLY =
  /^(apply now|apply for this (job|role|position)|start application|begin application|i'?m interested|apply here|apply to this job|^apply$)$/i;

/**
 * @param {string} raw
 * @param {{ hasApplicationFields?: boolean }} [opts]
 * @returns {'submit'|'guest'|'signup-tab'|'sso-google'|'next'|'apply'|'other'}
 */
export function classifyControlLabel(raw, opts = {}) {
  const t = normLabel(raw);
  if (!t) return "other";
  if (SUBMIT.test(t)) return "submit";
  if (GUEST.test(t)) return "guest";
  if (SSO_GOOGLE.test(t)) return "sso-google";
  if (SIGNUP_TAB.test(t)) return "signup-tab";
  if (NEXT.test(t)) return "next";
  if (APPLY.test(t)) return opts.hasApplicationFields ? "submit" : "apply";
  return "other";
}

export function isPasswordBlob(blob) {
  return /\b(pass ?word|passwd|passcode)\b/i.test(String(blob || ""));
}

export function isGoogleAccountsUrl(url) {
  return /accounts\.google\.com|google\.com\/(?:signin|oauth)/i.test(String(url || ""));
}

export function isCompanyLoginUrl(url) {
  return /login\.ibm\.com|ibm\.com\/account|okta\.com|auth0\.com|login\.microsoftonline|onelogin\.com/i.test(String(url || ""));
}
