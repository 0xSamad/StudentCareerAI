# StudentCareer AI — Production SaaS Architecture

## 1. Executive Summary

**StudentCareer AI** is engineered as an enterprise-grade, multi-tenant Software-as-a-Service (SaaS) platform. The platform automates student career discovery, eligibility verification, CV tailoring (with zero fabrication), application generation, and submission tracking across university cohorts and enterprise organizations.

---

## 2. High-Level System Topology (11 Decoupled Tiers)

```
                                  [ WEB CLIENTS / DASHBOARD ]
                                               │
                                               ▼
                              ┌─────────────────────────────────┐
                              │       1. FRONTEND TIER          │
                              │  Next.js 16 Multi-Tenant UI     │
                              └────────────────┬────────────────┘
                                               │
                                               ▼
                              ┌─────────────────────────────────┐
                              │       2. API GATEWAY            │
                              │  REST / JSON Auth & Rate Limit  │
                              └───────┬─────────────────┬───────┘
                                      │                 │
              ┌───────────────────────┴──────┐   ┌──────┴──────────────────────┐
              ▼                              ▼   ▼                             ▼
┌───────────────────────────┐ ┌───────────────────────────┐ ┌───────────────────────────┐
│   3. AUTHENTICATION       │ │      4. DATABASE          │ │     10. FILE STORAGE      │
│ Multi-Tenant Context & JWT│ │ Tenant-Partitioned Stores │ │ S3 / GCS / Local Scoped   │
└───────────────────────────┘ └───────────────────────────┘ └───────────────────────────┘
              │                              │                                 │
              ▼                              ▼                                 ▼
┌───────────────────────────┐ ┌───────────────────────────┐ ┌───────────────────────────┐
│     5. JOB DISCOVERY      │ │    6. AI WORKERS          │ │  7. APPLICATION WORKERS   │
│ Pluggable ATS Scrapers    │ │ Model Routing & Quotas    │ │ Tailoring & STAR Engine   │
└─────────────┬─────────────┘ └──────────────┬────────────┘ └─────────────┬─────────────┘
              │                              │                            │
              ▼                              ▼                            ▼
┌───────────────────────────┐ ┌───────────────────────────┐ ┌───────────────────────────┐
│      8. SCHEDULER         │ │   9. BROWSER WORKERS      │ │    11. NOTIFICATIONS      │
│ Background Sweeps & Crons │ │ Headless Pool (Dry-Run)   │ │ In-App, Webhooks & Email  │
└───────────────────────────┘ └───────────────────────────┘ └───────────────────────────┘
```

---

## 3. Multi-Tenancy & Data Isolation Model

### Strict Isolation Invariants
1. **Zero Global User State:** No candidate, application, or credential data is ever stored in global memory.
2. **Context Propagation:** All asynchronous operations execute within `TenantContext.run({ tenantId, userId, role }, fn)` using Node.js `AsyncLocalStorage`.
3. **Partitioned Storage:** File artifacts (tailored CVs, cover letters, PDFs) are isolated in path structures scoped to `tenants/{tenantId}/users/{userId}/`.
4. **Tenant-Filtered Queries:** All database operations strictly filter by the calling tenant ID:
   ```sql
   SELECT * FROM applications WHERE tenant_id = $1 AND user_id = $2;
   ```

---

## 4. Pluggable Service Interfaces

The architecture defines clean, abstract contracts across all operational boundaries:

### A. Authentication (`lib/saas/auth/`)
```typescript
interface IAuthService {
  registerTenant(tenantData): Promise<Tenant>;
  registerUser(userData): Promise<User>;
  authenticateUser(email, password, tenantId): Promise<{ user, token }>;
  generateApiKey(userId, tenantId): Promise<string>;
  verifyApiKey(apiKey): Promise<AuthContext>;
  verifyToken(token): Promise<AuthContext>;
}
```

### B. Database Repositories (`lib/saas/database/`)
```typescript
interface IStudentProfileRepository {
  getByUserId(userId, tenantId): Promise<StudentProfile>;
  upsertProfile(userId, tenantId, profileData): Promise<StudentProfile>;
}

interface IApplicationRepository {
  create(data, context): Promise<Application>;
  findMany(query, context): Promise<Application[]>;
  updateApplicationState(appId, state, metadata, context): Promise<Application>;
  getMetrics(userId, tenantId): Promise<MetricsSummary>;
}
```

### C. File Storage (`lib/saas/storage/`)
```typescript
interface IStorageService {
  saveFile(pathKey, bufferOrString, metadata, context): Promise<StorageResult>;
  getFile(pathKey, context): Promise<Buffer>;
  deleteFile(pathKey, context): Promise<boolean>;
  getSignedUrl(pathKey, expiresInSeconds, context): Promise<string>;
}
```

### D. Job Discovery (`lib/saas/discovery/`)
```typescript
interface IJobSource {
  name: string;
  fetchOpportunities(queryOptions, context): Promise<Opportunity[]>;
  fetchJobDetails(jobUrl, context): Promise<JobDetails>;
}
```

### E. AI Worker Pool (`lib/saas/ai/`)
```typescript
interface IAIProvider {
  name: string;
  generateText(params, context): Promise<string>;
  generateStructuredJSON(params, context): Promise<object>;
}
```

### F. Browser Worker Pool (`lib/saas/browser/`)
```typescript
interface IBrowserWorker {
  executeApplication({ opportunity, answers, attachments, autoSubmit }, context): Promise<ExecutionResult>;
  validateFormFields(pageUrl, context): Promise<ValidationResult>;
}
```

### G. Notifications (`lib/saas/notifications/`)
```typescript
interface INotificationService {
  notify(notification, context): Promise<DeliveryResult[]>;
  getInAppNotifications(userId, tenantId): Promise<Notification[]>;
}
```

### H. Scheduler (`lib/saas/scheduler/`)
```typescript
interface ISchedulerService {
  scheduleTask(name, intervalMs, handler, context): string;
  cancelTask(taskId): boolean;
  triggerTask(taskId, context): Promise<any>;
}
```

---

## 5. Security & Safety Invariants

| Invariant | Implementation Mechanism | Failure Mode |
|---|---|---|
| **Eligibility Pre-Flight** | Checked FIRST in `lib/eligibility-engine.mjs` before token spend | Role immediately marked `REJECTED (INELIGIBLE)` |
| **Zero CV Fabrication** | `extractSourceFacts` & `validateAgainstSourceFacts` | Hard exception; generation fails rather than inventing facts |
| **Safe Dry-Run Submissions** | `AUTO_SUBMIT=false` by default in `IBrowserWorker` | Form completed in dry-run; submit button never clicked |
| **Anti-Bot Obstacles** | CAPTCHA / Cloudflare challenge detection | State transitions to `PAUSED` with alert |
| **Authentication Barrier** | SSO / Enterprise login wall detection | State transitions to `PAUSED` for user action |
| **Low Confidence Answers** | Minimum threshold (70%) + Sensitive Question Gating | Form marked `REQUIRES_USER_INPUT` |

---

## 6. Horizontal Scaling & Deployment Blueprint

```
[ DNS / Cloudflare CDN ]
          │
          ▼
[ Load Balancer (HTTPS / TLS 1.3) ]
          │
  ┌───────┴───────────────────────┐
  ▼                               ▼
[ Stateless Web Nodes (xN) ]    [ Stateless API Nodes (xN) ]
          │                               │
          └───────────────┬───────────────┘
                          │
          ┌───────────────┼───────────────────────────────┐
          ▼               ▼                               ▼
[ Redis Queue / Cache ] [ PostgreSQL Primary + Replicas ] [ AWS S3 / Cloud Storage ]
          │
  ┌───────┴───────────────────────┐
  ▼                               ▼
[ AI Worker Queue Workers (xN) ] [ Headless Browser Workers (xN) ]
```

1. **Web & API Nodes:** Completely stateless, autoscale based on CPU and HTTP request queue length.
2. **Asynchronous Job Queues:** Heavy operations (ATS sweeps, CV tailoring, browser form filling) run as decoupled background tasks via Redis/BullMQ.
3. **Database Tier:** Multi-tenant PostgreSQL with row-level security (RLS) policies and read replicas.
4. **Storage Tier:** S3-compatible object storage with signed URL access and KMS envelope encryption.
