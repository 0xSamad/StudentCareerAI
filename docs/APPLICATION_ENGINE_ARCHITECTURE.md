# StudentCareer AI — Application Engine Architecture

**Date:** 2026-08-13  
**Rule:** Do not rebuild browser/application automation. Reuse the existing career-ops apply engine.

This document traces the real code path from a job URL to a recorded result, names what already exists, and states what is reusable, broken, or still missing for StudentCareer AI.

---

## Canonical execution path

```
job URL
  → browser (Playwright Chromium)
  → application page (consent dismiss, Apply click, iframe settle)
  → form discovery (richest frame, not just main document)
  → field extraction (DOM + a11y labels + optional Greenhouse schema)
  → field mapping (profile + generated answers; sensitive categories blocked)
  → profile / CV / cover letter context
  → document attach (resume file input; cover letter weak)
  → validation (required unanswered, fabrication, CAPTCHA/MFA/login)
  → submission gate (original engine NEVER clicks Submit)
  → result + queue/audit/application record
```

There are **two stacks** in this repo. Only the first one actually drives a real form.

| Stack | Role | Submits? |
|---|---|---|
| **A. career-ops apply engine** `web/src/lib/apply/*` | Production-grade Playwright session: open, extract, fill, hand off | **Never** |
| **B. StudentCareer overlay** `lib/autonomous-pipeline.mjs` + `lib/application-agent.mjs` + SaaS browser worker | Orchestrates eligibility → CV → answers → agent; worker is a stub | Overlay can click Submit if `liveSubmit`/`AUTO_SUBMIT` is true |

StudentCareer AI must call stack A (or the same Playwright session it owns). It must not invent a third filler.

---

## 1. Existing application engine

### 1.1 Production apply session (reuse this)

Headed Chrome, persistent session, human submits:

| Step | Module | Function |
|---|---|---|
| Open URL, 3-attempt nav | `web/src/lib/apply/session.ts` | `gotoResilient`, `openSession` |
| Cookie/consent overlay | `web/src/lib/apply/diagnose.ts` | `dismissConsent` |
| Click Apply (not Submit) | `diagnose.ts` | `tryApplyTrigger` |
| Pick richest iframe | `session.ts` | `pickFormFrame` |
| Extract + tag `data-co-field` | `web/src/lib/apply/extract.ts` | `extractForm` |
| Greenhouse schema enrich | `web/src/lib/apply/greenhouse.ts` | `parseGreenhouse`, `fetchGreenhouseSchema` |
| Empty-form diagnosis | `diagnose.ts` | `classifyEmpty`, `captchaWarning`, `statusBlock` |
| Agentic navigate-to-form | `web/src/lib/apply/drive.ts` | drive loop; **no submit in action vocab** |
| AI field interpretation | `web/src/lib/apply/agent-interpret.ts` | `agentInterpretForm` |
| Fill text/select/checkbox/file | `session.ts` | `fillSession` |
| Attach tailored CV PDF | `web/src/lib/apply/cv.ts` + `fillSession` | `resolveTailoredCv`, `setInputFiles` |
| Bring Chrome on-screen | `session.ts` | `handoffSession` |
| Close session | `session.ts` | `closeSession` |

HTTP surface (Next.js):

- `POST /api/apply/session` — open + extract
- `POST /api/apply/drive` — agentic navigation to the form
- `POST /api/apply/prefill` — LLM drafts answers for extracted fields
- `POST /api/apply/fill` — fill + optional handoff; **no submit path**
- `POST /api/apply/close` — teardown

CLI (no browser; Greenhouse / Ashby / Lever hosts only):

- `node prepare-application.mjs --url <apply_url> --pdf output/<cv>.pdf`  
  Prints a prefill summary. Never POSTs.

Human-in-the-loop mode (agent instructions, not executable code):

- `modes/apply.md` — detect tab → load report → knock-out pre-scan → draft answers → candidate clicks Submit
- `docs/APPLY_AUTOFILL.md` — Ashby email-merge, Lever captcha-on-checkbox, Workable SPA paste, react-select quirks

### 1.2 StudentCareer overlay (orchestration)

Nine-stage `AutonomousPipeline.processOpportunity` in `lib/autonomous-pipeline.mjs`:

1. Discover / deduplicate (`ApplicationManager.addToQueue`)
2. Classify (`classifyOpportunity`)
3. Eligibility (`eligibility-engine.mjs`)
4. Match (`match-engine.mjs`)
5. Tailor CV (`cv-tailor.mjs`)
6. Generate answers + cover letter (`application-generator.mjs`)
7. Application ready / confident-answer gate
8. Browser agent (`runApplicationAgent`)
9. Track result (`QUEUE_STATES` + audit log)

SaaS entry: `web/src/app/api/opportunities/apply/route.ts` constructs `AutonomousPipeline` and calls `processOpportunity`. Persist via `lib/saas/persist-application.mjs`.

### 1.3 What DRY_RUN means

| Layer | DRY_RUN behavior |
|---|---|
| Original apply engine | Fill the live form, attach CV, **never click Submit**, hand off to human |
| `runApplicationAgent` | Map fields, log `DRY_RUN: would fill` / `would attach`, return `READY_TO_SUBMIT` |
| Pipeline | `AUTO_SUBMIT: false` (default) → queue state `DRY_RUN` |
| `BrowserWorker.executeApplication` | Returns fake `DRY_RUN_COMPLETED` **without Playwright** |

The overlay’s DRY_RUN is only real if a Playwright `page` is passed in. Until the pipeline opens a browser in DRY_RUN, the agent falls back to two simulated fields (`first_name`, `email`).

---

## 2. Existing AI components

| Component | Path | What it does |
|---|---|---|
| Provider abstraction | `lib/ai-provider.mjs` | `gemini` / `openai` / `ollama`; `callAI(config, system, user)` returns text only |
| Match scoring | `lib/match-engine.mjs` | Scores opportunity vs profile |
| CV tailor | `lib/cv-tailor.mjs` | Reorder/reframe only; `extractSourceFacts` + `validateAgainstSourceFacts` reject fabrication |
| Application generator | `lib/application-generator.mjs` | Cover letter + per-question answers; sensitive categories always `REQUIRES_USER_INPUT` |
| Apply-session interpreter | `web/src/lib/apply/agent-interpret.ts` | LLM reads a live form when DOM heuristics fail |
| Apply drive planner | `web/src/lib/apply/drive.ts` | CLI-backed observe → one action loop |
| Prefill API | `web/src/app/api/apply/prefill/route.ts` | Drafts answers for extracted fields from profile/CV/report |
| Mode prompts | `modes/apply.md`, `modes/cover.md`, `modes/pdf.md` | Human-facing apply/cover/CV workflows |

**Fabrication contract (enforced in code):** keywords may be reformulated, never invented. Sensitive categories (`work_authorization`, `sponsorship`, `salary`, `demographic`, `disability`, `criminal_legal`, `citizenship`, `relocation`) cannot be auto-answered.

---

## 3. Existing browser automation

### 3.1 Real Playwright (use this)

| Use | Path |
|---|---|
| Apply session (headed Chrome, residential IP) | `web/src/lib/apply/session.ts` `headedBrowser()` |
| Overlay agent fill/click (headless, optional) | `lib/autonomous-pipeline.mjs` `chromium.launch` + `lib/application-agent.mjs` |
| Liveness / URL safety | `liveness-browser.mjs`, `liveness-core.mjs`, `check-liveness.mjs` |
| JD extract | `browser-extract.mjs` |
| CV HTML → PDF | `generate-pdf.mjs` |
| Interamt.de scanner | `scan-interamt.mjs` |

Retries already exist:

- Apply session: `gotoResilient` — 3 attempts, backoff
- Overlay pipeline: single `goto` with 25s timeout; launch failure is audited as `BROWSER_LAUNCH_FAILED` and the run continues without a page

### 3.2 SaaS isolation layer (directories only — not a browser)

| Module | Reality |
|---|---|
| `lib/saas/browser/isolated-browser-context.mjs` | Creates `user_data` / `downloads` / `uploads` dirs + in-memory cookie maps. **Does not launch Chromium with `userDataDir`.** |
| `lib/saas/browser/browser-worker-pool.mjs` | Pool + acquire/release. `executeApplication` does **not** call Playwright. Dry-run returns a canned success; live returns canned `SUBMITTED`. |
| `lib/saas/browser/security-detector.mjs` | String match on URL + description (not live HTML) |
| `lib/saas/queue/job-handlers.mjs` | `RUN_BROWSER_APPLICATION` → stub worker |

`docs/BROWSER_AUTOMATION_SECURITY.md` describes the intended isolation contract. The worker does not yet implement it with a real browser.

---

## 4. Existing ATS integrations

### 4.1 Form-time (application)

| ATS | Detection | Form behavior |
|---|---|---|
| Greenhouse | Host `greenhouse.io` / `boards.greenhouse.io`; `parseGreenhouse` | Public question schema enrich; react-select combobox fill in `fillSession` |
| Lever | `jobs.lever.co`, `jobs.eu.lever.co` | Extract + fill; docs warn: programmatic checkbox/radio can trigger hCaptcha — original apply mode skips those |
| Ashby | `jobs.ashbyhq.com` | Extract + fill; email-merge quirk documented in `APPLY_AUTOFILL.md` |
| Workday | `myworkdayjobs.com` | Best-effort extract; often an auth wall |
| Generic | anything else | DOM/a11y extract; agentic drive fallback |

Host maps also live in `lib/application-agent.mjs` `ATS_HOSTS` (greenhouse, lever, ashby, workday).

`prepare-application.mjs` allowlist: Greenhouse, Ashby, Lever HTTPS hosts only.

### 4.2 Discovery-time (not apply)

Zero-token / API scanners — **job finding**, not form filling:

- `scan.mjs` — Greenhouse / Ashby / Lever public APIs
- `scan-ats-full.mjs` — reverse-ATS keyword sweep
- `lib/saas/web-opportunity-scan.mjs` — indexed search → Pakistan Top 100 → International Top 100 → Adzuna
- `lib/saas/web-search-discovery.mjs`, `pakistan-company-discovery.mjs`, `international-company-discovery.mjs`, `adzuna-discovery.mjs`

Do not confuse discovery adapters with the apply engine.

---

## 5. Existing profile / context system

**User-layer sources of truth** (never fabricate beyond these + the current conversation):

| File / store | Role |
|---|---|
| `cv.md` | Canonical CV |
| `config/profile.yml` | Identity, targeting, spend tier (legacy career-ops) |
| `config/student-profile.yml` | StudentCareer profile (`lib/student-profile.mjs`) |
| `modes/_profile.md` | Archetypes / narrative |
| `article-digest.md` | Proof points |
| `writing-samples/`, `voice-dna.md` | Voice only |
| SaaS Postgres profile | `lib/saas/database/pg-user-store.mjs` + profile repository; uploaded CV via `web/src/app/api/profile/upload` |
| `lib/profile-parser.mjs` | Honest extraction from uploaded CV text (missing → null) |

Pipeline loads profile from the SaaS `shapeProfile()` helper in the apply route, or from YAML in `autonomous-runner.mjs`.

Field mapping order in `mapFieldToAnswer` (`application-agent.mjs`):

1. Sensitive category → `REQUIRES_USER_INPUT`
2. Pre-generated `application_answers` (fabrication check vs `sourceFacts`)
3. Deterministic `deriveFromProfile`
4. Unmapped → `REQUIRES_USER_INPUT`

---

## 6. Existing CV generation

```
profile + cv.md
  → extractSourceFacts
  → tailorCV (AI rewrite, then programmatic fact check)
  → HTML via templates/cv-template.html
  → generate-pdf.mjs (Playwright Chromium)
  → output/<name>.pdf
  → resolveTailoredCv(company) attaches that PDF to résumé file inputs
```

Cover letters: `application-generator.mjs` produces `cover_letter.body`. The original `fillSession` auto-attaches **resume** file fields only (`isResumeField`). Cover-letter file inputs are left for the human. The overlay logs `DRY_RUN: would insert/attach cover letter` and does not locate a cover-letter `<input type=file>`.

---

## 7. Existing application states

### 7.1 Queue (`lib/application-manager.mjs` `QUEUE_STATES`)

`DISCOVERED` → `ELIGIBILITY_CHECK` → `NOT_ELIGIBLE` | `ELIGIBLE` → `MATCHED` → `SELECTED` → `CV_GENERATED` → `APPLICATION_READY` → `APPLYING` → `DRY_RUN` | `SUBMITTED` | `REQUIRES_USER_INPUT` | `FAILED` | `BLOCKED`

Prepared (not sent): `PREPARED`, `DRY_RUN`, `APPLICATION_READY`  
Actually sent: `SUBMITTED`, `APPLIED` (legacy alias)

History: each queue item has `state_history[]`. Audit: `data/autonomous-audit.json`. Tracker: `data/applications.md` (career-ops) and SaaS `applicationRepository`.

### 7.2 Agent session (`SESSION_STATUS`)

`READY_TO_SUBMIT` | `SUBMITTED` | `REQUIRES_USER_INPUT` | `ERROR` | `BLOCKED` | `SKIPPED`

### 7.3 Pipeline agent (`AGENT_STATES`)

`RUNNING` | `PAUSED` | `STOPPED` | `ERROR`

Safety defaults (`DEFAULT_CONFIG`): `AUTO_SUBMIT: false`, `PAUSE_ON_CAPTCHA`, `PAUSE_ON_AUTH_FAILURE`, `PAUSE_ON_UNEXPECTED_FORM`, `REQUIRE_CONFIDENT_ANSWERS`.

### 7.4 CAPTCHA / MFA / login

| Detector | Input | Action |
|---|---|---|
| `diagnose.ts` `captchaWarning` / `statusBlock` | Live page + HTTP status | Warn or abort session; never solve |
| `application-agent.mjs` `detectSecurityObstacles` | Page HTML | `BLOCKED` |
| `application-agent.mjs` `looksLikeLoginWall` | Page HTML | `REQUIRES_USER_INPUT` when `liveSubmit` |
| `SecurityDetector` | URL + description strings | Worker `PAUSED` (no live DOM) |

Retries: navigation only (apply session). No submit retry loop. Worker crash recycle after 3 crashes (pool metadata only).

---

## 8. What can be reused

Reuse these; do not rewrite them:

1. **`web/src/lib/apply/session.ts`** — open, extract, fill, handoff, close
2. **`extract.ts` / `diagnose.ts` / `drive.ts` / `greenhouse.ts` / `cv.ts`**
3. **`/api/apply/*` routes** — already the correct HTTP contract
4. **`lib/cv-tailor.mjs` + `lib/application-generator.mjs` + `lib/ai-provider.mjs`** — package generation
5. **`lib/student-profile.mjs` + `lib/profile-parser.mjs` + SaaS profile store**
6. **`lib/application-manager.mjs` queue + states + daily caps**
7. **`lib/autonomous-pipeline.mjs` stages 1–7** (discover through APPLICATION_READY)
8. **`prepare-application.mjs`** for Greenhouse/Ashby/Lever API-shaped prefills
9. **`generate-pdf.mjs` + `templates/cv-template.html`**
10. **Security policy:** pause on CAPTCHA/MFA/SSO; never bypass

Stage 8 of the pipeline should **hand a Playwright page into the existing apply session** (or call `openSession`/`fillSession`), not grow a second DOM filler.

---

## 9. What is broken

These defects prevent the existing engine from functioning as a real apply path. They are wiring/honesty bugs, not missing product ideas.

### Fixed in this pass

1. **DRY_RUN never opened a browser.**  
   Pipeline now launches Playwright whenever a URL exists and `SKIP_BROWSER` is not set (DRY_RUN and live). Unit tests set `CAREER_OPS_SKIP_BROWSER=1` so they stay offline.

2. **Simulated fields hid missing forms.**  
   `runApplicationAgent` no longer invents `first_name`/`email` when a live `page` is present and extraction returns nothing.

3. **Security check ran before the page existed.**  
   CAPTCHA/MFA detection now runs on the opened page’s HTML, then the agent runs.

4. **Apply API treated omitted `confirmSubmit` as live submit.**  
   Live submit now requires `confirmSubmit === true`. Default is DRY_RUN (`AUTO_SUBMIT: false`).

### Still broken / not wired

5. **SaaS Apply API never calls `openSession` / `fillSession`.**  
   `web/src/app/api/opportunities/apply/route.ts` only calls `AutonomousPipeline.processOpportunity`. The production form engine in `web/src/lib/apply/` is unused by StudentCareer UI.

6. **`BrowserWorker.executeApplication` is a stub.**  
   Dry-run claims “Form fields filled & validated in isolated sandbox” without a browser. Live returns `SUBMITTED` without a click. `validateFormFields` returns a hardcoded list. Isolation dirs are never passed to Chromium.

7. **Two fill implementations.**  
   Overlay `fillFieldOnPage` / `clickSubmitOnPage` duplicate a weaker subset of `fillSession` (no iframe, no react-select, no `data-co-field`, no verify-fill). Original engine forbids submit; overlay added submit clicking.

8. **Cover letter upload is not implemented** in either real filler (resume-only in `fillSession`).

9. **Headed apply sessions are process-global** (`globalThis.__coApplySessions`). That is correct for a single-user desktop CLI, not multi-tenant SaaS. Isolated dirs exist but are unused.

10. **Web UI currently posts `confirmSubmit: true`**, which opts the overlay into live submit. That contradicts the original career-ops contract (“candidate always clicks Submit”) and skips the proven handoff path.

---

## 10. What is missing for StudentCareer AI

Build by **wiring**, not by cloning:

1. **Connect SaaS Apply → stack A.**  
   After pipeline stages 1–7, call `openSession(url)` → map answers → `fillSession` → persist `DRY_RUN` / `APPLICATION_READY` → `handoffSession` for the student’s last click. Do not call `clickSubmitOnPage` as the default.

2. **Give DRY_RUN a real page.**  
   Pipeline must launch (or attach) Playwright whenever a URL exists, including `AUTO_SUBMIT: false`.

3. **Replace the worker stub with the same session**, using `IsolatedBrowserContext.userDataDir` as Playwright `launchPersistentContext` so tenant isolation is real.

4. **Cover-letter file inputs** — extend `fillSession` with a cover-letter detector parallel to `isResumeField`, using generated `cover_letter.body` written to a temp file.

5. **Multi-step ATS** (Workday, multi-page Greenhouse). `multiStepInfo` warns; drive loop can advance; StudentCareer has no durable per-step state across pages.

6. **Session resume / MFA continuation** — pause, notify student, resume the same browser context after they solve CAPTCHA/MFA. Directories exist; Chromium persistence does not.

7. **Honest UI copy** — “Ready to review” must open the filled apply session (handoff), not the raw job URL.

8. **Do not add** another ATS detector, another form extractor, another CV tailor, or another queue state machine.

---

## Target DRY_RUN path (StudentCareer)

```
student clicks Apply
  → POST /api/opportunities/apply  { confirmSubmit: false }     # default
  → AutonomousPipeline.processOpportunity  AUTO_SUBMIT=false
  → stages 1–7: eligibility, match, tailor CV, generate answers
  → Playwright opens job URL (headless or headed-offscreen)
  → security pause if CAPTCHA / MFA / login wall
  → extractForm (reuse web/src/lib/apply) OR agent evaluate on that page
  → mapFieldToAnswer from profile + application_answers
  → log fills; optionally fillSession without Submit
  → attach resume if file input present
  → session READY_TO_SUBMIT → queue DRY_RUN
  → persist application record + artifacts
  → student reviews package; last click is handoffSession / human Submit
```

`AUTO_SUBMIT` / `confirmSubmit: true` remains an explicit override. Default is DRY_RUN.

---

## File index

```
web/src/lib/apply/session.ts          open / fill / handoff (real engine)
web/src/lib/apply/extract.ts          form discovery + data-co-field
web/src/lib/apply/diagnose.ts         CAPTCHA, consent, status, empty-form
web/src/lib/apply/drive.ts            agentic navigate to form (no submit)
web/src/lib/apply/greenhouse.ts       Greenhouse public schema
web/src/lib/apply/cv.ts               tailored PDF resolution
web/src/app/api/apply/*/route.ts      session, drive, prefill, fill, close

lib/autonomous-pipeline.mjs           9-stage orchestrator
lib/application-agent.mjs             overlay agent (needs a real page)
lib/application-manager.mjs           queue + QUEUE_STATES
lib/application-generator.mjs         answers + cover letter
lib/cv-tailor.mjs                     tailored CV
lib/ai-provider.mjs                   gemini / openai / ollama
lib/student-profile.mjs               YAML profile
lib/profile-parser.mjs                CV text parse
prepare-application.mjs               Greenhouse/Ashby/Lever CLI prefill
generate-pdf.mjs                      HTML → PDF

lib/saas/browser/browser-worker-pool.mjs      STUB — do not treat as engine
lib/saas/browser/isolated-browser-context.mjs dirs only
lib/saas/browser/security-detector.mjs        URL/description strings
```
