# StudentCareer AI — Hardened Multi-User Browser Automation Architecture

## 1. Executive Summary

In **StudentCareer AI**, browser automation is hardened for multi-tenant production. Every user application run executes within an **isolated ephemeral sandbox** with dedicated cookies, storage, and file directories. The architecture enforces a **zero-bypass security contract**: anti-bot challenges (CAPTCHA), multi-factor authentication (MFA), and enterprise login walls automatically pause the automation and request human candidate action.

---

## 2. Per-User Session Isolation Architecture

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                         MULTI-USER BROWSER ISOLATION MATRIX                              │
├─────────────────────────┬────────────────────────────────────────────────────────────────┤
│ ISOLATION DOMAIN        │ HARD GUARANTEE & LIFECYCLE                                     │
├─────────────────────────┼────────────────────────────────────────────────────────────────┤
│ 1. Cookies & Sessions   │ Dedicated ephemeral sandbox per run; destroyed on completion   │
│ 2. Local/Session Storage│ Scoped to unique `userDataDir`; never shared across users      │
│ 3. Uploaded Files & PDFs│ Temporary scratch files deleted in `finally` teardown blocks   │
│ 4. Authentication State │ Zero persistent shared login sessions or credentials           │
│ 5. Browser Profiles     │ Dynamic ephemeral profile generated per application cycle      │
└─────────────────────────┴────────────────────────────────────────────────────────────────┘
```

---

## 3. Anti-Bypass Security Invariants & Human Verification

The platform **NEVER** bypasses or circumvents security controls:

```
[ Browser Worker Navigates to ATS Portal ]
                    │
                    ▼
       [ SecurityDetector Analysis ]
                    │
      ┌─────────────┴─────────────┐
      │ Challenge Detected?       │
      ▼ (YES)                     ▼ (NO)
┌───────────────────────────┐ ┌───────────────────────────┐
│ • PAUSE Application       │ │ • Validate confidence     │
│ • Emit Security Telemetry │ │ • Safe DRY-RUN Fill       │
│ • Notify Candidate        │ │ • Execute or Complete     │
│ • Await User Intervention │ │ • Destroy Temporary Files │
└───────────────────────────┘ └───────────────────────────┘
```

### Challenge Detection Matrix (`SecurityDetector`)

| Challenge Type | Trigger Conditions | Automated Action |
|---|---|---|
| **CAPTCHA / Bot Defense** | reCAPTCHA, hCaptcha, Cloudflare Turnstile, Arkose | `PAUSE` $\rightarrow$ Alert: *"Human verification required on {company} application."* |
| **MFA / 2FA Prompt** | SMS code, Authenticator prompt, push verification | `PAUSE` $\rightarrow$ Alert: *"MFA verification prompt encountered on {company} portal."* |
| **Enterprise SSO Wall** | Okta, Workday, Google Auth, SAML login gate | `PAUSE` $\rightarrow$ Alert: *"Enterprise sign-in required to proceed."* |
| **Cloudflare / WAF Block**| WAF challenge screen, Cloudflare Ray ID | `PAUSE` $\rightarrow$ Alert: *"Firewall challenge screen encountered."* |

---

## 4. Deterministic Cleanup & Lifecycle Guards

1. **Ephemeral Sandboxes:** Created under `data/temp_browser_sessions/{tenantId}/{userId}/{sessionId}/`.
2. **Deterministic Destruction:** The `IsolatedBrowserContext.destroySession()` method executes in a `finally` block, wiping the session directory, cookies, and scratch uploads even if the job fails.
3. **Session TTL Expiration:** Sessions have a hard 5-minute maximum lifetime; stale sessions are pruned on every worker acquisition.
4. **Crash Recovery:** Worker processes that exit unexpectedly are caught, logged, and recycled cleanly without impacting neighboring jobs.
5. **Execution Timeouts:** All browser navigations execute within an `AbortController` timeout race (default: 180s).

---

## 5. Zero-Secret Logging Guarantee

All form inputs, parameters, and browser traces pass through `Sanitizer.sanitize()`. Sensitive fields (`password`, `sessionToken`, `cookie`, `apiKey`, `authorization`) are masked as `***REDACTED***` in both memory logs and disk artifacts.
