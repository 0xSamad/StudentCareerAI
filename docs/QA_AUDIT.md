# StudentCareer AI — QA Audit

**Audit date:** 2026-08-12  
**Auditor mode:** Read-only inspection + local runtime verification (no product code fixes in this phase)  
**Product claim:** Multi-user SaaS — “Find suitable internships/jobs and apply automatically”  
**Repo reality:** Hybrid of (1) career-ops local CLI toolkit, (2) Next.js local-first web UI branded StudentCareer AI, (3) in-process SaaS prototype under `lib/saas/`

---

## 0. Executive verdict

| Dimension | Verdict |
|-----------|---------|
| **Overall product status** | **PARTIALLY WORKING** as a local single-user career agent demo; **NOT WORKING** as a multi-user SaaS |
| **Can a new student self-serve end-to-end without developer help?** | **No** |
| **Safe to deploy as multi-tenant production SaaS?** | **No — blocked** |
| **Core engines (eligibility, classify, CV fact-gate, daily limits)** | **Working in unit tests / local file path** |
| **User-facing autonomous “Start Agent → apply” journey** | **Broken / misleading in live runtime** |

**One-sentence summary:** Strong domain engines and safety unit tests exist, but the product shell overclaims SaaS readiness, serves mock/hardcoded opportunity data, has no real signup/isolation, and the live agent has repeatedly crashed in this environment.

---

## 1. What was inspected and how

### Code & docs
- Root career-ops scripts, `providers/` (72 ATS modules), `modes/`, `lib/` engines
- `lib/saas/` (container, queue, browser, discovery, AI, notifications, storage, DB)
- `web/` Next.js 16 app (routes, APIs, dashboard, internships, agent, settings, profile)
- Docs: `PRODUCTION_ARCHITECTURE.md`, `DATABASE_ARCHITECTURE.md`, `AUTH_ARCHITECTURE.md`, `DEPLOYMENT.md`, `CAPSTONE_ARCHITECTURE.md`
- Docker: `docker-compose.production.yml`, `docker/Dockerfile.*`, `bin/*-process.mjs`, `bin/api-server.mjs`
- Schema: `lib/saas/database/migrations/001_initial_schema.sql`, `002_triggers_procedures.sql`
- Env: `.env.example`, `config/env.production.example`, `web/.env.local` (key names only)

### Runtime verification (this machine)
- `node doctor.mjs --json` → onboarding needed (`config/profile.yml`, `portals.yml` missing)
- Core unit tests: **9/9 suites passed** (eligibility, match, classify, application-manager, cv-tailor, autonomous-pipeline, auth-security, saas-architecture, capstone-workflow)
- API server `bin/api-server.mjs` on `:4000` → `/healthz` OK; `/readyz` reports database HEALTHY **without Postgres**
- Web already on `:3000` → home/internships/settings/profile/agent **200**; `/signup` **404**
- Live APIs: `/api/opportunities`, `/api/dashboard/stats`, `/api/autonomous/status`, `/api/profile`
- `web` typecheck: **fails** (`Cannot find module .../lib/autonomous-pipeline.mjs`)
- `web` `next build`: **fails** on this Windows host (SWC native bindings invalid; Turbopack not supported without native bindings; `package.json` `build` does not pass `--webpack`)
- `pg` package: **not installed**; `PostgresClient.isMock === true`; `SELECT 1` returns empty mock result
- `lib/saas/auth/` gitignored by `.gitignore` line `auth/` → **not tracked by git** (`git ls-files lib/saas/auth/` empty)

---

## 2. Architecture truth table

| Layer | Documented | Actual |
|-------|------------|--------|
| Frontend | Multi-tenant Next.js SaaS | Local-first AppShell; no landing; no auth UI |
| API Gateway :4000 | REST auth + rate limit + `/api/v1` | Health/ready/metrics only; marketing stub for everything else |
| Auth | JWT + sessions + email verify | In-memory AuthService **on disk but gitignored**; web uses **no auth** |
| Database | PostgreSQL + RLS | SQL migrations exist; app uses **Maps / files**; no `pg` driver |
| Queue | Redis / BullMQ | In-process `Map` queue; workers do not share state across containers |
| Discovery (SaaS) | Pluggable ATS | Default **`MockJobSource`** (Careem/Arbisoft fixtures) |
| Discovery (career-ops) | 70+ real providers | **Real** Greenhouse/Lever/Ashby/Workday/etc. via `scan.mjs` — **not wired as the default web agent loop** |
| AI (SaaS) | OpenRouter/OpenAI | Default **`MockAIProvider`** |
| Browser workers | Playwright pool | Dry-run stubs + CAPTCHA string heuristics; no real Playwright launch in SaaS pool |
| Notifications | Email + in-app | In-memory in-app only; no SMTP channel |
| Storage | S3 / GCS | Local FS under `data/storage/` |
| Primary web data plane | Postgres tenants | **Flat files:** `cv.md`, `config/student-profile.yml`, `data/pipeline.md`, `data/application-queue.json`, `data/autonomous-state.json` |

---

## 3. What works

### A. Domain engines (local `lib/`, tested)
| Capability | Evidence |
|------------|----------|
| Eligibility gate (`ELIGIBLE` / `NOT_ELIGIBLE` / `REQUIRES_REVIEW`) | `lib/eligibility-engine.mjs` + 61 assertions green |
| Match scoring 0–100 with eligibility hard gate | `lib/match-engine.mjs` + 104 assertions green |
| Internship vs job classification (multi-signal) | `lib/classify-opportunity.mjs` — does **not** treat “young professional / graduate / entry level” alone as internship |
| CV hallucination / fabrication rejection | `lib/cv-tailor.mjs` FabricationError path + tests |
| Cover letter + fact gate | `generate-cover-letter.mjs`, `verify-cv-facts.mjs`, tests |
| Application answers + sensitive → `REQUIRES_USER_INPUT` | `lib/application-generator.mjs` |
| Daily application limits + file lock concurrency | `lib/application-manager.mjs` (timezone-aware; concurrent reserve tested) |
| CAPTCHA/MFA/auth barrier → pause (no bypass) | Autonomous pipeline + browser security tests |
| Safe defaults | `AUTO_SUBMIT=false`, `REQUIRE_ELIGIBILITY=true`, pause-on-* flags default true |
| ATS provider library | 72 real provider modules + extensive provider tests |
| Web shell pages load | `/`, `/internships`, `/jobs`, `/applications`, `/profile`, `/settings`, `/agent` return 200 |
| Profile API returns structured student profile | Live `/api/profile` OK |
| Agent status API | Live `/api/autonomous/status` returns state, config, dailyStats, audit |

### B. Safety posture that is genuinely good
- Ethical rule in AGENTS.md: never auto-submit without human review (career-ops core)
- Fabrication rejection is enforced in unit-tested tailor path
- CAPTCHA/MFA detection deliberately does not attempt to defeat challenges
- AccessGuard / TenantContext patterns exist and pass in-memory isolation tests

---

## 4. What partially works

| Area | What works | What’s incomplete |
|------|------------|-------------------|
| **Internship mode** | First-class nav/default; classifier solid | Autonomous loop does **not** filter by `search_mode`; SaaS classify handler is title-regex stub |
| **Job mode** | `/jobs` page + classifier | Mode switch does not cleanly re-scope discovery/agent ranking in the live loop |
| **Dashboard** | Agent bar, stats grid, opportunity feed | Stats can disagree with queue; activity feed mixes raw stack traces; decorative vs trustworthy |
| **CV workflow** | Paste/upload paths (`/api/cv`, ingest, profile upload) | Best first-run CV drop UI (`FirstRunHome`) **not mounted**; profile vs `cv.md` can diverge |
| **Agent “Start”** | Sets `RUNNING` + persists state | **Does not process work** until `run-once` / continuous loop; UI implies 24/7 work |
| **Eligibility in UI** | Engine exists | Opportunities API hardcodes `eligibility: "ELIGIBLE"` and synthetic match scores from title heuristics |
| **Daily limit** | File-backed enforcement works | UI config `MAX_APPLICATIONS_PER_DAY: 5` vs `dailyStats.limits` still showing 10 — **desynced** |
| **Browser apply** | Headed manual prefill never submits | Autonomous “1-Click” messages claim “submitted” even in dry-run |
| **SaaS container** | DI + mock E2E cycle tests pass | Not connected to real web auth, DB, Redis, or ATS |
| **Docker compose** | Files exist; Postgres can init schema | App containers do not share a queue; browser-worker has no work loop; auth missing from git clone |
| **Notifications** | In-memory channel API | No preferences UI, no email, no persistence across restart |
| **Pakistan + international coverage** | International ATS providers are real | No dedicated Jazz/Zong/Nayatel/Handshake/WayUp sources; Pakistan names appear mainly as **mock fixtures** |
| **Security docs** | Prompt guard / URL validator modules exist | Job content treated as data in prompts for core engines; SaaS mock path still weak; stack traces exposed to clients |

---

## 5. What is broken (verified)

### CRITICAL
1. **No signup / login / multi-user product path** — `/signup` → 404; no middleware; single shared local checkout. Product promise of multi-user SaaS is unmet.
2. **Auth module not shippable** — `lib/saas/auth/` ignored by `.gitignore` `auth/`; clean clone cannot import `SaaSContainer` auth wiring.
3. **PostgreSQL not actually used** — no `pg` dependency; `PostgresClient` always mock-returns empty rows; readiness lies with `database: HEALTHY`.
4. **Fake / overclaimed opportunities in UI** — when pipeline empty, `/api/opportunities` injects curated Careem/Arbisoft/10Pearls/Systems Limited listings with fabricated eligibility + scores. When pipeline has URLs, scores/eligibility are still **heuristic hardcoded** (intern title → 88, always ELIGIBLE), not engine output.
5. **Live agent crashes in this environment** — audit log shows repeated failures:
   - `MatchProviderError: No AI provider configured…` (even with Gemini keys in web `.env.local` — env not reaching root pipeline correctly at crash time)
   - `TypeError: Cannot read properties of undefined (reading 'name')` in `cv-tailor.mjs` / `application-generator.mjs`
6. **Apply success overclaim** — `/api/opportunities/apply` forces queue state `APPLIED` and message “successfully … submitted” while product defaults to dry-run / no live submit.
7. **Production web build broken on this host** — SWC binary invalid; `next build` fails unless `--webpack` (and script doesn’t set it).

### HIGH
8. **Start Agent does not run the pipeline** — `AutonomousPipeline.start()` only flips state; discovery depends on `data/pipeline.md`, not live portal scan.
9. **Onboarding UX disconnected** — `OnboardingBanner` and `FirstRunHome` exist but are **not imported** on `/`; new users land on operational dashboard.
10. **Profile / CV identity split** — live profile YAML (LUMS CS, AI/ML, Lahore) vs `cv.md` (IMS Peshawar Software Engineering, cybersecurity focus). Agent can tailor from inconsistent sources.
11. **Demo defaults (“Ali Hassan”)** still present in profile page defaults and application detail HTML — risk of leaking demo identity into artifacts.
12. **Match failure soft-fakes score 75** — `autonomous-pipeline.mjs` catch sets `{ match_score: 75, tier: 'GOOD' }` on match errors (silent fabrication of match quality).
13. **SaaS match/classify stubs** — title contains “ai” → 94/95 fake scores in SaaS handlers.
14. **API “gateway” has no product routes** — cannot register, create profile, or drive agent via `:4000`.
15. **Cross-container workers are useless** — each process owns its own in-memory queue; scheduler enqueues into a Map the worker never sees.
16. **Privacy export auth model** — `/api/user/export` accepts spoofable `x-user-id` / `x-tenant-id` (or query params); not session-bound.

### MEDIUM
17. **Status vocabulary fragmented** across `templates/states.yml`, `application-manager` queue states, and Postgres CHECK constraints (`ELIGIBILITY_REVIEW` / `CV_READY` / `INTERVIEW` naming mismatches).
18. **Score scale conflict** — student-profile validates `min_match_score` 1.0–5.0; autonomous uses 0–100 (default 70); Postgres schema CHECK also 1.0–5.0.
19. **REQUIRES_REVIEW semantics diverge** — `assertEligible` blocks review; match-engine allows apply with `eligible_to_apply: true`.
20. **Doctor/setup incomplete** — missing `config/profile.yml` + `portals.yml`; doctor API timed out during audit probe.
21. **Typecheck failure** for autonomous logs route module resolution.
22. **Raw stack traces** returned in autonomous status `recentLogs` to the browser.
23. **Power-user routes orphaned** from nav (`/explore`, `/pipeline`, `/cv`, `/config`, `/followups`) while still required for CLI/ingest setup.
24. **Daily limit early reservation** can burn slots before eligibility/match complete.

### LOW
25. Branding inconsistency: StudentCareer AI / CareerOS / career-ops mixed in package names and UI.
26. Sidebar UsageMeter shows Claude token windows, not applications remaining.
27. Playwright image pin mismatch in Docker vs package.json versions.
28. Upstream career-ops update available (local `0.1.0` vs remote `1.26.0`) — system layer drift risk.

---

## 6. What is missing (product gaps)

| Required for SaaS promise | Status |
|---------------------------|--------|
| Landing → Sign up → Email verify → Login | **Missing** |
| Guided onboarding wizard (personal / education / skills / experience / projects / preferences) | **Partial UI only; not first-run gated** |
| Durable multi-tenant Postgres + migrations applied by app | **Schema only** |
| Session/JWT middleware on all APIs | **Missing** |
| Real shared job queue (Redis/BullMQ) | **Missing** |
| Email / push notifications + preferences | **Missing** |
| User-scoped browser sessions / CV storage isolation in web path | **Missing** (single machine files) |
| Internship-specific sources (Handshake, WayUp, university portals, PK company boards) | **Missing / NOT_SUPPORTED** |
| Subscription / usage metering for SaaS | Env keys only (Stripe) |
| Honest empty states when sources fail | Partial; often replaced by mocks |
| Unified application lifecycle UI matching required statuses | Missing |
| Continuous 24/7 worker with crash recovery of `APPLYING` items | Missing |
| Automated E2E journeys for signup→apply (Playwright product tests) | Missing (unit/mock heavy) |

---

## 7. What is unsafe

| Issue | Risk |
|-------|------|
| No authentication on web APIs | Anyone with network access to the machine can read/write the local career data plane |
| Spoofable tenant/user headers on privacy routes | Cross-user data access if SaaS Maps ever hold real data |
| Mock opportunities presented as real Greenhouse/Lever/Ashby jobs | Students may “apply” to non-existent postings |
| Apply API claiming submission | Legal/ethical risk + false trust |
| Stack traces in client-visible audit logs | Information disclosure |
| Auth directory gitignored | Production deploy may ship without auth code, or developers copy secrets into ignored paths inconsistently |
| Readyz false HEALTHY | Orchestrators will route traffic to a hollow API |
| Soft match score 75 on AI failure | Agent may prioritize wrong roles after silent degradation |
| Job JD prompt-injection defenses exist in core rules, but web mock path + overclaim reduce overall safety posture | Mixed |

---

## 8. Confusing from a user perspective

1. Lands on a full “Live Agent” dashboard with no explanation of what to upload first.
2. Sees internship cards that look real; unclear which are from `pipeline.md` vs mocks vs real scans.
3. “Start Agent” shows RUNNING but may do nothing until a separate run-once/loop path.
4. “Submitted” applications that were never submitted.
5. Profile shows one university/major; CV text shows another.
6. Settings daily limit vs remaining counter disagree.
7. Eligibility always green on cards — no PASS/FAIL/UNKNOWN breakdown visible as product promise describes.
8. Terminology mix: career-ops statuses vs StudentCareer queue states vs SaaS schema.
9. Important setup (`/config` CLI selection) hidden from primary nav.
10. Footer says “local-first · v0” while marketing metadata says autonomous SaaS platform.

---

## 9. New-user journey dry run (as of audit)

| Step | Expected | Observed |
|------|----------|----------|
| Landing | Marketing + Sign up | Immediate app shell; no landing |
| Sign up | Create account | **404** |
| Onboarding | Structured wizard | Not mounted; doctor incomplete |
| Profile | Persist personal/education/skills | Editable; demo defaults risk; persists to YAML |
| CV | Upload/view/replace master CV | Possible via profile upload / `/cv`; first-run hero dead |
| Preferences | Mode, locations, limits | Settings page works (file-backed) |
| Internship search | Discover real internships | Reads pipeline + **mocks/heuristics**; `portals.yml` missing so scanner not configured |
| AI agent | Discover→eligibility→match→apply loop | Start flips flag; live runs crashed; AI provider wiring fragile |
| Results | Explain eligibility + match | Cards show hardcoded ELIGIBLE + synthetic scores |
| Applications | Honest lifecycle | Overstates APPLIED; tracker exists |
| Tracking | Clear status + next action | Partial; raw errors in audit |

**Cannot create a fresh isolated test user** in the SaaS sense — only one local workspace.

---

## 10. Core workflow status matrix

| Workflow | Status | Notes |
|----------|--------|-------|
| Registration | **NOT WORKING** | No routes |
| Profile | **PARTIALLY WORKING** | Local YAML; demo defaults; CV mismatch |
| CV | **PARTIALLY WORKING** | File-based; UX disconnected |
| Internship discovery | **PARTIALLY WORKING** | Real providers exist; web path mocks/heuristics; portals missing |
| Job discovery | **PARTIALLY WORKING** | Same as above |
| Eligibility | **WORKING** (engine) / **BROKEN** (UI wiring) | Engine solid; API hardcodes ELIGIBLE |
| AI matching | **WORKING** (engine) / **PARTIALLY** (runtime) | Soft-fail score 75; provider env issues |
| CV tailoring | **WORKING** (tests) / **BROKEN** (live crashes on undefined name) | |
| Cover letters | **WORKING** (engine/tests) | |
| Application answers | **WORKING** (engine/tests) | |
| Browser automation | **PARTIALLY WORKING** | Manual headed prefill OK; SaaS pool stub; dry-run default |
| Auto-apply | **PARTIALLY WORKING** | Default off (good); UI can overclaim |
| Daily limits | **WORKING** (file lock) / **PARTIALLY** (UI desync) | Not multi-host Postgres-safe |
| 24/7 agent | **NOT WORKING** as claimed | Start ≠ loop; recovery incomplete |
| Notifications | **NOT WORKING** for product | In-memory only |
| Multi-user isolation | **NOT WORKING** in web product | In-memory SaaS tests only |
| Security | **PARTIALLY WORKING** | Good engines; bad auth/deploy/honesty |
| Deployment | **NOT READY** | Compose scaffolding; hollow API; auth gitignore; build failures |

---

## 11. Unsupported / unverified sources (honesty list)

Mark as **NOT_SUPPORTED** for StudentCareer AI product claims until wired + verified end-to-end in the web/agent path:

- Handshake, WayUp, Chegg Internships, InternMatch
- University portals (Symplicity, 12Twenty)
- Pakistan-specific company career sites as first-class sources: Jazz, Zong, Nayatel, Huawei Pakistan, Systems Limited, NETSOL, 10Pearls, Careem, Daraz (Careem/10Pearls/Systems appear as **UI mocks**, not verified live integrations)
- SaaS `MockJobSource` fixtures (must never be shown as live jobs)

**Actually supported at career-ops scanner layer (when `portals.yml` configured):** Greenhouse, Lever, Ashby, Workday, and ~70 other boards listed in `docs/SUPPORTED_JOB_BOARDS.md` — but this is **CLI scan**, not the default StudentCareer agent discovery loop.

---

## 12. Production blockers

1. No real multi-user authentication wired to the web app  
2. Auth source code not in git (gitignore trap)  
3. No real Postgres driver / repository path  
4. No shared durable queue across API/worker/scheduler/browser-worker  
5. API gateway has no product API surface  
6. Fake job listings + false “submitted” semantics (trust/compliance)  
7. Web production build fails on current Windows toolchain without script fixes  
8. Agent start/loop/discovery not production-autonomous  
9. Secrets/env not consistently loaded into root pipeline from web runtime  
10. Readyz lies; observability incomplete for multi-process deploy  

---

## 13. Test automation assessment

| Area | Coverage today | Gap |
|------|----------------|-----|
| Eligibility / match / classify / tailor / limits / CAPTCHA pause | Strong unit tests | Need UI/API integration tests |
| SaaS architecture / auth / privacy | Strong **in-memory** tests | Do not prove Postgres/Redis/multi-node |
| Capstone workflow | Partial unit assertions | Not a full browser E2E |
| Registration / multi-user isolation via HTTP | Missing | Required |
| Real ATS + dry-run browser journeys | Provider unit tests; limited product E2E | Need mocked ATS HTTP + Playwright dry-run suite |
| “Do not cheat” risk | Some tests validate mocks by design | Deployment-readiness tests assert file presence more than live behavior |

---

## 14. Recommended fix priority (for next phase)

### P0 — Honesty + safety (stop lying to users)
1. Remove mock opportunity fallback from product UI **or** label explicitly as “Sample / Demo — not live”  
2. Stop marking dry-runs as `APPLIED` / “submitted”  
3. Stop soft-faking match_score `75` on AI failure — surface ERROR / REQUIRES_REVIEW  
4. Strip stack traces from client-facing audit payloads  
5. Fix `.gitignore` so `lib/saas/auth/` is tracked (or relocate out of `auth/`)

### P1 — Make the local student journey work
6. Mount first-run onboarding + CV ingest on `/` when setup incomplete  
7. Wire opportunities API to real eligibility + match engines (or show UNKNOWN)  
8. Make Start Agent start continuous loop **or** rename UI to “Enable agent” + explicit “Run cycle”  
9. Unify profile + CV source of truth; remove Ali Hassan demo defaults  
10. Sync daily limit settings with `application-manager` limits  
11. Fix AI provider env propagation from web → root `lib/`  
12. Fix `undefined .name` crashes in tailor/generator  

### P2 — Real multi-user SaaS foundation
13. Add `pg`, real client, migration runner against live DB  
14. Session middleware on all web/API routes  
15. Shared Redis queue; fix worker/scheduler processes  
16. Implement `/api/v1` auth + profile + agent routes on gateway  
17. Replace SaaS mocks with adapters to real providers/engines  

### P3 — Product completeness
18. Notifications + preferences  
19. Pakistan + internship source adapters (honest NOT_SUPPORTED until done)  
20. Unified lifecycle status model + dashboard explanations  
21. Playwright E2E for critical journeys with deterministic mocks  
22. Fix Windows `next build --webpack` script  

---

## 15. Evidence index (key paths)

- Web home: `web/src/app/page.tsx` → `DashboardView` (no first-run)
- Mock opps: `web/src/app/api/opportunities/route.ts`
- False submit: `web/src/app/api/opportunities/apply/route.ts`
- Agent start (state only): `lib/autonomous-pipeline.mjs` `start()`
- Soft match fake: `lib/autonomous-pipeline.mjs` (~line 402)
- Hollow API: `bin/api-server.mjs`
- Fake PG: `lib/saas/database/postgres-client.mjs`
- Auth gitignore: `.gitignore` (`auth/`)
- Eligibility engine: `lib/eligibility-engine.mjs`
- Match engine: `lib/match-engine.mjs`
- Production docs (aspirational): `docs/PRODUCTION_ARCHITECTURE.md`, `docs/DEPLOYMENT.md`

---

## 16. Audit phase status

- [x] Inspect entire application surface  
- [x] Run locally (web + API)  
- [x] Run core existing tests  
- [x] Attempt typecheck/build  
- [x] Inspect schema / env / routes / workers  
- [x] Document findings in `docs/QA_AUDIT.md`  
- [ ] **Next (authorized after this audit):** create `docs/BUGS_FOUND.md`, fix P0/P1 issues, re-test, then `docs/FINAL_QA_REPORT.md`

---

*This audit deliberately does not change product behavior. Findings above are based on code inspection plus live probes on 2026-08-12.*
