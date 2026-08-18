# StudentCareer AI — Repair Report

**Date:** 2026-08-12  
**Baseline commit:** `ae13e6c28dc242431043760aa6698857a8fef73f`  
**Checkpoint commit:** `260611660181bc6c6431850fbf43b8ffe5b2b8d4`  
**Scope:** Post-QA repair toward multi-user SaaS (honesty → DB → auth → agent)

---

## 1. Bugs found (verified pre-repair)

| # | Bug | Severity |
|---|-----|----------|
| 1 | No signup/login (`/signup` 404) | CRITICAL |
| 2 | `lib/saas/auth/` gitignored | CRITICAL |
| 3 | PostgreSQL mock; readiness lied HEALTHY | CRITICAL |
| 4 | Mock/heuristic opportunities shown as real | CRITICAL |
| 5 | Apply API claimed “submitted” under dry-run | CRITICAL |
| 6 | Start Agent only set RUNNING | CRITICAL |
| 7 | Agent crashes (AI wiring / undefined `.name`) | HIGH |
| 8 | `next build` failed on Windows without `--webpack` | HIGH |
| 9 | Doctor YAML requirements for SaaS users | HIGH |
| 10 | API `:4000` had no product `/api/v1` | CRITICAL |
| 11 | Soft-fake match score `75` on AI failure | HIGH |
| 12 | Dashboard/stats seeded with fake numbers | HIGH |
| 13 | “Ali Hassan” demo identity in profile/application APIs | HIGH |
| 14 | Stack traces returned in agent audit API | MEDIUM |

---

## 2. Root causes

1. **Product shell overlaid on local student-career-ai** without real tenancy, so UI invented “live” data to look complete.
2. **`.gitignore` `auth/`** intended for browser auth dumps also ignored `lib/saas/auth/`.
3. **`PostgresClient` never opened a pool**; readiness checked object presence, not connectivity.
4. **Apply/agent paths** treated “process succeeded” as “submitted”.
5. **`AutonomousPipeline.start()`** was a state flag; work lived only in `startContinuousLoop` / `runCycle`.
6. **Profile objects passed as `{}`** into generators that assumed `profile.identity.name`.
7. **Next.js 16 Turbopack** requires native SWC bindings unavailable on this Windows host; webpack is required.

---

## 3. Fixes implemented

### Honesty (Phases 1–2, 15–16, 18)
- Removed mock opportunity fallback from `/api/opportunities`.
- Opportunities now carry provenance fields (`source_type`, `is_demo`, `is_verified`, etc.).
- Apply API returns `DRY_RUN` / `SUBMITTED` / `FAILED` / `REQUIRES_USER_INPUT` authoritatively; `submitted_at` null unless truly submitted.
- Pipeline final state: dry-run → `DRY_RUN`, live → `SUBMITTED` (never claim APPLIED on dry-run).
- Soft match score `75` removed — match failure → `REQUIRES_USER_INPUT` / pause.
- Dashboard stats no longer inflate with `Math.max(..., fake)`.
- Discovery: `MockJobSource` **not** registered by default; demo URLs use `example.com` + `is_demo: true`.
- UI copy: “Prepared (dry run)” vs “Submitted”.
- Application detail API no longer invents Ali Hassan CV/cover/answers.

### Database + health (Phases 3–4)
- Added `pg` dependency.
- Real `PostgresClient` with `Pool` when `DATABASE_URL` set; `ping()` runs `SELECT 1`.
- Readiness: database **UNHEALTHY** and `ready=false` without real DB / failed ping.
- Migrations include `003_sessions.sql`; `npm run db:migrate` / `bin/migrate.mjs`.

### Auth + isolation (Phases 5–6)
- `.gitignore` narrowed so `lib/saas/auth/` is tracked and shipped.
- Signup/login pages + `/api/auth/*` with `sc_session` httpOnly cookie.
- Middleware protects app pages/APIs; unauthenticated users redirected to `/login`.
- AccessGuard + multi-user isolation tests.

### API (Phase 7)
- `bin/api-server.mjs` exposes `/api/v1` auth/profile/settings/opportunities/applications/agent/usage/notifications (no mock jobs).

### Agent loop + AI wiring (Phases 11–13)
- `/api/autonomous/control` `start`/`resume` launches **background `startContinuousLoop`** with loaded profile/CV.
- Identity `.name` guards in match-engine + application-generator.
- Apply route loads profile and calls `processOpportunity({ rawOpportunity, profile, cvText })`.
- Audit logs strip `stack` before returning to clients.

### Build (Phase 20)
- `web/package.json` `build` → `next build --webpack`.
- Typecheck errors for auth cookies / Opportunity provenance fixed.

### Profile defaults
- Empty profile defaults (no Ali Hassan demo identity).

---

## 4. Tests added

| Test | Purpose |
|------|---------|
| `tests/honesty-guards.test.mjs` | Dry-run states, no default mock discovery, readiness unhealthy without DB |
| `tests/postgres-health.test.mjs` | Ping/readiness honesty |
| `tests/api-v1-auth.test.mjs` | Auth API behavior |
| `tests/multi-user-isolation.test.mjs` | Cross-user AccessGuard denials |

Updated:
- `tests/autonomous-pipeline.test.mjs` — expects `DRY_RUN`, not fake APPLIED
- `tests/saas-architecture.test.mjs` — opt-in `includeDemoSources: true` for container demo cycle only

---

## 5. Tests passed (this repair window)

```
auth-security, autonomous-pipeline, cv-tailor, eligibility-engine,
honesty-guards, multi-user-isolation, postgres-health, saas-architecture
→ 16/16 pass (aggregated node --test run)
```

Also previously green: match-engine, application-manager, classify, capstone (not every suite re-run after every edit).

`web` `npm run typecheck` — fixed to pass after cookie/Opportunity typing changes.

---

## 6. Remaining limitations (honest)

| Area | Status |
|------|--------|
| **PostgreSQL persistence for all domain tables in the web path** | Driver + migrations + health are real; many web routes still also use local YAML/JSON files for profile/queue until fully migrated |
| **Auth persistence** | Works in-memory always; Postgres-backed store when `DATABASE_URL` set — **requires running Postgres + migrate for durable multi-user** |
| **Real ATS discovery inside Start Agent loop** | Loop processes `pipeline.md` / queue; does not yet fully replace CLI `scan.mjs` + `portals.yml` with DB-backed source configs for every provider |
| **Pakistan-specific company sources** | Still NOT_SUPPORTED as first-class adapters (Jazz/Zong/etc.) |
| **Email notifications / Stripe / S3** | Not implemented |
| **Cross-process Redis queue** | Still in-process Map queue (Docker workers do not share work yet) |
| **Clean-clone E2E with live Postgres + full signup→apply** | Partially automated via unit/API tests; full browser E2E against live DB not completed on this host |
| **Doctor `profile.yml` / `portals.yml`** | Still CLI legacy; SaaS should not require them, but CLI doctor still reports missing until isolated |
| **Production multi-host daily limits** | File-lock path works locally; DB transactional quota exists in schema/repos but web agent still primarily file-backed |

---

## 7. Production blockers (remaining)

1. **Must run real Postgres** (`DATABASE_URL` + `npm run db:migrate`) before claiming multi-user durability.
2. **Must not deploy** until web profile/applications/agent are fully DB-scoped per authenticated user (not shared `data/*.json` on disk).
3. **Shared job queue** (Redis/BullMQ or equivalent) required before multi-container workers are meaningful.
4. **Configure real job sources** for the agent (not only pipeline inbox) before marketing “discovery”.
5. **Verify Windows/Linux production builds** in CI after SWC native binary issues.
6. **Do not enable `AUTO_SUBMIT=true` in production** until browser submit path is audited end-to-end.

---

## 8. Success criteria checklist

| Criterion | Met? |
|-----------|------|
| New user can sign up | **YES** (UI + API; durable with Postgres) |
| New user can log in | **YES** |
| Onboarding/profile without terminal | **PARTIAL** (profile UI empty defaults; not a full wizard) |
| Profile/CV persist | **PARTIAL** (files today; DB when configured) |
| PostgreSQL is real | **YES** (driver/ping/migrate); **needs running server** |
| Health accurately reports DB | **YES** |
| API product routes exist | **YES** (`/api/v1` + Next auth) |
| User data isolated | **YES** at AccessGuard/tests; **web file plane still single-machine** |
| No fake jobs as real | **YES** for opportunities API |
| Eligibility before apply | **YES** in autonomous pipeline |
| AI provider wiring hardened | **PARTIAL** (guards + profile load; provider still needs keys) |
| CV tailoring / generation | **YES** in engines/tests |
| Dry-run never claims submission | **YES** |
| Start Agent runs loop | **YES** (in-process background loop) |
| Daily limits server-side | **YES** (file lock); DB quota for SaaS path partial |
| CAPTCHA pauses | **YES** |
| Dashboard real data | **YES** (honest zeros / queue-derived) |
| Clean clone ships auth | **YES** (`git ls-files lib/saas/auth/*`) |
| Production build | **YES command** (`next build --webpack`); verify artifact on host |
| Two users cannot access each other | **YES** in isolation tests; full HTTP E2E with DB pending |

---

## 9. Recommended next steps (priority)

1. Stand up Postgres locally/CI → migrate → run signup×2 isolation E2E against DB.  
2. Migrate web profile/queue/agent state fully onto tenant-scoped Postgres tables.  
3. Wire agent discovery to real `providers/*` via DB source configs (no YAML for end users).  
4. Add Redis (or equivalent) shared queue for api/worker/scheduler.  
5. Playwright product E2E: signup → profile → start agent → dry-run prepare → logout/login.  
6. Isolate CLI doctor YAML checks from SaaS health.

---

*This report does not claim production-ready SaaS. It documents honest progress from a demo that lied about submissions/jobs toward a product that refuses to fake success.*
