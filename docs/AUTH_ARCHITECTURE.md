# StudentCareer AI — Production Authentication & Authorization Architecture

## 1. Executive Summary

This document specifies the enterprise authentication and authorization architecture for **StudentCareer AI**. The architecture guarantees **zero cross-user and cross-tenant data leakage** by enforcing strict cryptographically backed authentication, session management, and service-layer authorization checks across all 8 sensitive resource domains.

---

## 2. Core Security & Isolation Invariants

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                             ISOLATION & ACCESS CONTROL MODEL                            │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ 1. Zero Global User State:   No credentials, session data or user profiles are global.  │
│ 2. Cryptographic Security:   PBKDF2 (100,000 rounds, SHA-512) with 32-byte salts.       │
│ 3. Single-Use Tokens:        Password reset and email verification tokens expire & burn.│
│ 4. Hard Service-Layer Guard: AccessGuard checks ownership on EVERY read/write/delete.   │
│ 5. Redaction at Rest/Log:    Passwords, tokens, hashes and secrets are never logged.    │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. The 8 Protected Resource Domains

A user can **NEVER** access, read, modify, or download another user's data across these 8 domains:

| Resource Domain | Guard Method | Enforcement Mechanism |
|---|---|---|
| **1. Student Profile** | `AccessGuard.canAccessProfile()` | Verified against calling `userId` and `tenantId` |
| **2. Master & Tailored CVs** | `AccessGuard.canAccessCV()` | Path & record level partition (`tenants/{t}/users/{u}`) |
| **3. Application Records** | `AccessGuard.canAccessApplication()` | Query filtered & verified on `application.userId` |
| **4. Generated Documents** | `AccessGuard.canAccessDocument()` | Signed URLs scoped to authenticated owner |
| **5. API Credentials** | `AccessGuard.canAccessApiKey()` | Salted hashing & strict tenant binding |
| **6. Browser Sessions** | `AccessGuard.canAccessBrowserSession()` | Worker execution isolation & safe dry-run sandbox |
| **7. Agent Configuration** | `AccessGuard.canAccessAgentConfig()` | Settings mutations gated by authenticated user |
| **8. Job History & Scans** | `AccessGuard.canAccessHistory()` | Deduplication logs and telemetry filtered by user |

---

## 4. Authentication Workflows

### A. Registration & Email Verification
```
[ User Submits Registration ]
              │
              ▼
[ Password Complexity Check ] ──(Fails)──► [ Return 400 Bad Request ]
              │ (Passes)
              ▼
[ Generate 32-byte Salt & PBKDF2 Hash ]
              │
              ▼
[ Create User Record (emailVerified = false) ]
              │
              ▼
[ Issue Single-Use Verification Token (Expires in 24h) ]
              │
              ▼
[ Email Dispatcher sends Verification Link ]
```

### B. Secure Login with Brute-Force Lockout
- **Rate Limiting:** Accounts are temporarily locked out for 15 minutes after 5 consecutive failed attempts.
- **Timing-Safe Equality:** Hashes are compared using `crypto.timingSafeEqual` to eliminate timing attacks.
- **Session Issuance:** Returns a cryptographically secure 64-char session token with user-agent and IP metadata.

### C. Password Reset Flow
```
[ 1. User Requests Reset ] ──► [ Generate Single-Use 64-char Token (Expires in 1 hr) ]
                                                      │
[ 2. User Submits New Password + Token ] ◄────────────┘
              │
              ▼
[ 3. Validate Token Expiration & Used Flag ]
              │
              ▼
[ 4. Hash New Password with Fresh Salt ]
              │
              ▼
[ 5. Invalidate / Delete Reset Token (Single-Use) ]
              │
              ▼
[ 6. Revoke ALL Active Sessions Across All Devices ]
```

### D. Logout & Session Revocation
- Specific session tokens can be revoked immediately on logout (`authService.logout(token)`).
- Full security reset revokes all active sessions for a user (`authService.revokeAllUserSessions(userId, tenantId)`).

---

## 5. Zero-Secret Logging & Redaction Policy

All log entries, audit events, and error stacks pass through `Sanitizer.sanitize(payload)` before being persisted or emitted to stdout:
- **Redacted Fields:** `password`, `passwordHash`, `salt`, `token`, `sessionToken`, `resetToken`, `verificationToken`, `apiKey`, `secret`, `authorization`, `cookie`, `set-cookie`.
- Redaction replacement string: `***REDACTED***`.

---

## 6. Access Control Guard Matrix

```javascript
// Example service-layer authorization check
export class StudentProfileService {
  async getProfile(targetUserId, context) {
    const profile = await this.repo.getByUserId(targetUserId, context.tenantId);
    
    // Hard Service-Layer Guard: Throws ForbiddenError if unauthorized
    AccessGuard.canAccessProfile(context, profile);
    
    return profile;
  }
}
```
