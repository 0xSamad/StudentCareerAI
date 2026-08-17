# StudentCareer AI — Repair Baseline

**Recorded:** 2026-08-12  
**Purpose:** Stable checkpoint before repair work. Do not apply career-ops v1.26.0 or unrelated dependency upgrades during this repair.

---

## Git

| Field | Value |
|-------|-------|
| Branch | `main` |
| Baseline commit (pre-repair HEAD) | `ae13e6c28dc242431043760aa6698857a8fef73f` |
| Baseline message | `feat: implement Eligibility Engine (hard gate, 14 criteria, 61 tests)` |
| Checkpoint commit | `260611660181bc6c6431850fbf43b8ffe5b2b8d4` (`chore: baseline checkpoint before StudentCareer SaaS repair`) |

Working tree at baseline included substantial **uncommitted** StudentCareer SaaS work (`lib/saas/`, web product routes, docs, docker). Phase 0 commits that work as a named checkpoint so regressions are measurable.

---

## Test status (pre-repair)

| Suite | Result |
|-------|--------|
| `tests/eligibility-engine.test.mjs` | PASS |
| Core StudentCareer suite (eligibility, match, classify, application-manager, cv-tailor, autonomous-pipeline, auth-security, saas-architecture, capstone) | **9/9 PASS** (verified 2026-08-12) |
| Full `tests/**` matrix | Not fully re-run at baseline; known green for StudentCareer engines |

---

## Build status (pre-repair)

| Check | Result |
|-------|--------|
| `web` `npm run typecheck` | **FAIL** — `Cannot find module '../../../../../lib/autonomous-pipeline.mjs'` (`api/autonomous/logs/route.ts`) |
| `web` `npm run build` | **FAIL** on Windows — invalid `@next/swc-win32-x64-msvc` native binary; Turbopack requires native bindings; script does not pass `--webpack` |
| `web` `npm run dev --webpack` | Works when port free (EADDRINUSE if :3000 occupied) |
| Root `node bin/api-server.mjs` | Starts; `/healthz` OK; `/readyz` falsely reports DB HEALTHY |

---

## Known failures (from QA audit — verified facts)

1. No signup/login (`/signup` → 404)
2. `lib/saas/auth/` gitignored by `.gitignore` line `auth/`
3. PostgreSQL not implemented (`pg` missing; mock client)
4. Mock/heuristic opportunities shown as real
5. Apply API claims “submitted” under dry-run
6. Start Agent only sets RUNNING (no loop)
7. Live agent crashes (AI provider wiring + undefined `.name`)
8. Production web build fails without `--webpack`
9. Doctor missing `config/profile.yml` / `portals.yml` (CLI legacy; blocks SaaS onboarding story)
10. API `:4000` has no product `/api/v1` routes

---

## Environment requirements (baseline)

| Requirement | Baseline expectation |
|-------------|----------------------|
| Node.js | ≥ 18 (web prefers ≥ 20) |
| OS | Windows 10+ verified; Linux Docker compose present |
| AI keys (optional for engine unit tests) | `GEMINI_API_KEY` / `OPENAI_API_KEY` in `.env` |
| PostgreSQL | Documented in `config/env.production.example` but **not required/used** at baseline |
| Redis | Documented, **not used** |
| Playwright Chromium | Used by career-ops PDF/browser paths |

---

## Explicit non-goals for this repair window

- Do **not** apply upstream career-ops `v1.26.0` update yet
- Do **not** upgrade unrelated dependencies for convenience
- Do **not** fake job listings or successful submissions to make demos look good
