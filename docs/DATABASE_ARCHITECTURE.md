# StudentCareer AI — PostgreSQL Relational Database Architecture

## 1. Executive Summary

**StudentCareer AI** uses a normalized PostgreSQL relational database architecture designed for multi-tenant scalability, transactional data integrity, and strict isolation. All 21 core domain models are backed by foreign key constraints, targeted B-tree indexes, automatic timestamp triggers, soft deletion, and concurrency guards.

---

## 2. Entity-Relationship Overview (21 Relational Models)

```
┌─────────────┐
│   TENANTS   │◄────────────────────────────────────────────────────────┐
└──────┬──────┘                                                         │
       │ 1:N                                                            │
┌──────▼──────┐       1:1       ┌─────────────┐       1:N       ┌───────┴──────┐
│    USERS    ├────────────────►│  PROFILES   ├────────────────►│  EDUCATIONS  │
└──────┬──────┘                 └──────┬──────┘                 ├──────────────┤
       │ 1:N                           │ 1:N                    │ EXPERIENCES  │
       │                               │                        ├──────────────┤
       │                               │                        │   PROJECTS   │
       │                               │                        ├──────────────┤
       │                               │                        │    SKILLS    │
       │                               │                        ├──────────────┤
       │                               │                        │     CVS      │
       ▼                               ▼                        └──────────────┘
┌─────────────┐                 ┌─────────────┐
│   AGENTS    │                 │OPPORTUNITIES│◄───[ COMPANIES, JOB_SOURCES ]
└──────┬──────┘                 └──────┬──────┘
       │ 1:N                           │
┌──────▼──────┐                        │
│ AGENT_RUNS  │                        │
└─────────────┘                        │
                                       ▼
                     ┌───────────────────────────────────┐
                     │          APPLICATIONS             │
                     │ (Unique: tenant + user + opp_id)  │
                     └─┬──────────────┬────────────────┬─┘
                       │              │                │
                       ▼              ▼                ▼
            ┌──────────────────┐┌───────────┐┌───────────────────┐
            │ELIGIBILITY/MATCH ││TAILORED_CV││APPLICATION_ANSWERS│
            │     RESULTS      ││COVERLETTER││APPLICATION_EVENTS │
            └──────────────────┘└───────────┘└───────────────────┘
```

---

## 3. Complete Relational Data Dictionary

| # | Entity Table | Primary Key | Foreign Keys | Key Indexes & Unique Constraints |
|---|---|---|---|---|
| **1** | `tenants` | `id` (VARCHAR) | — | `idx_tenants_plan` |
| **2** | `users` | `id` (VARCHAR) | `tenant_id` $\rightarrow$ `tenants` | `UNIQUE(tenant_id, email)`, `idx_users_tenant` |
| **3** | `profiles` | `id` (VARCHAR) | `user_id` $\rightarrow$ `users` | `UNIQUE(tenant_id, user_id)` |
| **4** | `educations` | `id` (VARCHAR) | `profile_id` $\rightarrow$ `profiles` | `idx_educations_user` |
| **5** | `experiences` | `id` (VARCHAR) | `profile_id` $\rightarrow$ `profiles` | `idx_experiences_user` |
| **6** | `projects` | `id` (VARCHAR) | `profile_id` $\rightarrow$ `profiles` | `idx_projects_user` |
| **7** | `skills` | `id` (VARCHAR) | `profile_id` $\rightarrow$ `profiles` | `idx_skills_user` |
| **8** | `cvs` | `id` (VARCHAR) | `user_id` $\rightarrow$ `users` | `idx_cvs_user` |
| **9** | `companies` | `id` (VARCHAR) | — | `idx_companies_name` |
| **10** | `job_sources` | `id` (VARCHAR) | — | `UNIQUE(name)` |
| **11** | `opportunities`| `id` (VARCHAR) | `company_id`, `job_source_id` | `UNIQUE(url)`, `idx_opps_posted` |
| **12** | `eligibility_results`| `id` | `opportunity_id`, `user_id` | `idx_eligibility_user` |
| **13** | `match_results`| `id` (VARCHAR)| `opportunity_id`, `user_id` | `idx_match_user` |
| **14** | `tailored_cvs` | `id` (VARCHAR)| `opportunity_id`, `user_id` | `idx_tailored_cvs_user` |
| **15** | `cover_letters`| `id` (VARCHAR)| `opportunity_id`, `user_id` | `idx_cover_letters_user` |
| **16** | `applications` | `id` (VARCHAR)| `opportunity_id`, `user_id` | `UNIQUE(tenant_id, user_id, opportunity_id)` |
| **17** | `application_answers` | `id` | `application_id` $\rightarrow$ `apps` | `idx_answers_app` |
| **18** | `agents` | `id` (VARCHAR) | `user_id` $\rightarrow$ `users` | `idx_agents_user` |
| **19** | `agent_runs` | `id` (VARCHAR) | `agent_id` $\rightarrow$ `agents` | `idx_agent_runs_agent` |
| **20** | `application_events` | `id` | `application_id` $\rightarrow$ `apps` | `idx_app_events` |
| **21** | `usages` | `id` (VARCHAR) | `user_id` $\rightarrow$ `users` | `UNIQUE(tenant_id, user_id, usage_date)` |
| **22** | `subscriptions`| `id` (VARCHAR)| `user_id` $\rightarrow$ `users` | `idx_subscriptions_user` |

---

## 4. Concurrency Controls & Transactional Invariants

### A. Zero Duplicate Applications Across Concurrent Workers
The schema enforces a partial unique constraint:
```sql
CONSTRAINT uq_applications_tenant_user_opp UNIQUE (tenant_id, user_id, opportunity_id)
```
Any parallel worker thread attempting to apply to the same opportunity simultaneously is blocked at the database level with a `DuplicateApplicationError` (HTTP 409).

### B. Transactional Daily Quota Enforcement
Daily limits are transactionally locked using row-level locking (`SELECT ... FOR UPDATE`):
```sql
SELECT applications_count FROM usages 
WHERE tenant_id = $1 AND user_id = $2 AND usage_date = CURRENT_DATE 
FOR UPDATE;
```
If `applications_count >= maxDailyLimit`, the transaction is rolled back and a `DailyQuotaExceededError` (HTTP 429) is returned before any AI or browser automation is triggered.

---

## 5. Soft Deletion Policy
Entities supporting soft deletion (`users`, `profiles`, `educations`, `experiences`, `projects`, `skills`, `cvs`, `opportunities`, `applications`, `agents`, `subscriptions`) include a `deleted_at TIMESTAMP WITH TIME ZONE NULL` column. All queries filter active records with `WHERE deleted_at IS NULL`.

---

## 6. Migration Execution

Migrations are stored in `lib/saas/database/migrations/`:
- `001_initial_schema.sql` — Tables, constraints, foreign keys, and indexes.
- `002_triggers_procedures.sql` — Automatic timestamp updates and quota functions.

Execute migrations via the runner:
```bash
node -e "import('./lib/saas/database/migration-runner.mjs').then(m => new m.MigrationRunner().runMigrations())"
```
