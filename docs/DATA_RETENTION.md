# StudentCareer AI — Data Retention & Lifecycle Policy

**Effective Date:** August 11, 2026  
**Last Updated:** August 11, 2026

## 1. Overview

This Data Retention Policy outlines the storage duration, lifecycle management, and automatic purge schedules for data processed by **StudentCareer AI**. We adhere to data minimization principles under GDPR Article 5(1)(e) and CCPA standards.

---

## 2. Data Retention Schedules

| Data Category | Retention Schedule | Deletion / Purge Mechanism |
|---|---|---|
| **Active User Account Data** | Retained for the lifetime of the active account | Explicit user deletion or 24-month inactivity purge |
| **Master CV & Profile** | Retained until updated or deleted by candidate | Immediate permanent deletion upon user request |
| **Tailored CV Artifacts (HTML/PDF)**| Retained for active applications; 90 days for inactive | Automated purge after 90 days or user CV purge |
| **Application Tracker & Q&A Answers**| Retained until cleared by user | Bulk history deletion available in candidate settings |
| **Ephemeral Browser Sandboxes** | Max 5 minutes (per application run) | Deterministic destruction in `finally` teardown block |
| **Audit Logs & Telemetry** | 90 days sliding window | Automated rolling truncation |
| **Soft-Deleted User Records** | 30-day grace period | Hard permanent deletion after 30 days |
| **Authentication & Reset Tokens** | Email Verification: 24 hours<br>Password Reset: 1 hour<br>Session Tokens: 24 hours | Expired tokens invalidated immediately and purged |

---

## 3. User-Initiated Data Erasure Lifecycle

When a candidate requests data deletion:

```
[ Candidate Requests Data Erasure in Settings ]
                     │
       ┌─────────────┴─────────────┐
       ▼                           ▼
[ Account Deletion ]       [ Selective Deletion ]
       │                           │
       ├─► Anonymize user record   ├─► Clear Master CV & Tailored PDFs
       ├─► Wipe login credentials  ├─► Purge application tracker rows
       ├─► Revoke active sessions  └─► Remove form answers & Q&A notes
       ├─► Delete storage sandbox
       └─► Eradicate all CV files
```

---

## 4. Automated Purge Operations

The `AutoRecoveryEngine` and automated cron tasks execute scheduled purges:

1. **Daily Cleanup (03:00 UTC):**
   - Hard-deletes soft-deleted database rows older than 30 days.
   - Cleans orphaned temporary upload files.
   - Invalidates expired authentication tokens.
2. **Real-time Ephemeral Sandbox Destruction:**
   - Temporary browser profile directories (`/tmp/browser_sessions/...`) are destroyed immediately upon task completion.

---

## 5. Right to Data Portability (Export)

Before requesting erasure, candidates can download a complete, machine-readable JSON archive containing all personal data, education records, work history, projects, skills, CV data, and application tracking history.

For data retention inquiries or manual purge verification, contact `dpo@studentcareer.ai`.
