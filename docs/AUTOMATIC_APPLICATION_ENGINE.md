# StudentCareer AI — Automatic Application Engine

**Date:** 2026-08-13  
**Rule:** Orchestrate the existing Career-OPS engines. Do not rebuild ATS adapters, CV/cover-letter generation, knowledge retrieval, or Playwright filling.

This is the canonical apply path. Every selected job or internship runs it independently:

```
                    JOB / INTERNSHIP
                           │
                           ▼
                 ┌───────────────────┐
                 │ Eligibility Engine │
                 └─────────┬─────────┘
                           │
                     ELIGIBLE?
                      /          \
                    NO            YES
                    │              │
                  STOP             ▼
                          ┌─────────────────┐
                          │ Matching Engine │
                          └────────┬────────┘
                                   │
                                   ▼
                         Candidate Knowledge
                              Retrieval
                                   │
                    ┌──────────────┴──────────────┐
                    ▼                             ▼
              CV Intelligence              Cover Letter AI
                    │                             │
             reuse / tailor                required / optional
                    │                             │
                    └──────────────┬──────────────┘
                                   ▼
                         Application Agent
                                   │
                                   ▼
                           ATS / Job Website
                                   │
                                   ▼
                         Semantic Form Analysis
                                   │
                                   ▼
                         Candidate Data Retrieval
                                   │
                                   ▼
                              Validation
                                   │
                         ┌─────────┴─────────┐
                         ▼                   ▼
                       SAFE              BLOCKED
                         │                   │
                         ▼                   ▼
                     SUBMIT            USER INPUT
                         │
                         ▼
                    APPLICATION
                      TRACKER
```

`NOT_ELIGIBLE` never reaches matching, knowledge, CV, cover letter, or the browser. CV Intelligence and Cover Letter AI run in parallel after knowledge retrieval. Validation is a deterministic safety gate: CAPTCHA, MFA, auth walls, unknown required answers, and sensitive questions force **USER INPUT**. Submit is recorded on the tracker only with a real `submitted_at`.

Every selected application runs this pipeline **in isolation**. One failure never stops the remaining items. `SUBMITTED` is recorded only with a real `submitted_at`.

---

## Architecture

| Layer | Module | Role |
|---|---|---|
| Queue UX | `web/src/app/applications/page.tsx` | Card queue, Apply to All / Selected / Remove, live stage labels |
| Queue API | `web/src/app/api/applications/*` | Enqueue, list, apply, pause, retry, remove |
| Queue machine | `lib/saas/application-queue.mjs` | `SELECTED → ANALYZING → … → READY / PAUSED / SKIPPED / SUBMITTED` |
| **Orchestrator** | `lib/saas/application-orchestrator.mjs` | `ApplicationOrchestrator` — named steps, retries, safety overrides |
| Gates | `lib/saas/application-workflow-core.mjs` | Deadline, duplicate, status labels |
| Eligibility | `lib/eligibility-engine.mjs` | Hard gate. Mandatory mismatch → `NOT_ELIGIBLE` |
| Match | `lib/match-engine.mjs` | Soft score after eligibility |
| Knowledge | `lib/saas/knowledge/*` | Opportunity-specific `CandidateContextBuilder` |
| CV | `lib/saas/cv/*` | Reuse master or tailor after claim validation |
| Cover letter | `lib/saas/cover-letter/*` | Generate only when required/recommended (or optional with attested benefit) |
| Agent | `lib/application-agent.mjs` | Semantic fill, ATS adapters, CAPTCHA/MFA pause |
| Apply session (headed, never submits) | `web/src/lib/apply/*` | Human-in-the-loop Chrome session |

`runApplicationWorkflow` / `runApplicationBatch` remain as compatibility wrappers around `ApplicationOrchestrator`.

---

## Orchestration

`ApplicationOrchestrator` methods (each application, independently):

| Method | What it does |
|---|---|
| `processApplication()` | Full isolated run |
| `processBatch()` | Sequential isolation; catch-and-continue |
| `analyzeEligibility()` | Deterministic eligibility; AI hint cannot override a failed mandatory requirement |
| `analyzeMatch()` | AI score with retry; heuristic fallback if AI fails |
| `buildCandidateContext()` | Opportunity-specific evidence packets — never the full private corpus |
| `analyzeCV()` | Whether the master CV already fits |
| `prepareDocuments()` | Runs CV Intelligence and Cover Letter AI in parallel, then packages answers |
| `prepareCV()` | Reuse master CV or tailor after claim validation |
| `prepareCoverLetter()` | Generate only when required/recommended (or optional with attested benefit) |
| `launchBrowser()` | Open the apply URL; retry on failure; continue as DRY_RUN package if the browser is down |
| `analyzeForm()` | Semantic classification + optional ATS schema |
| `fillForm()` | Knowledge-grounded fill; unknown/sensitive → do not guess |
| `validateApplication()` | Safety gate before any submit |
| `submitApplication()` | Clicks Submit only when `AUTO_APPLY` is on **and** `canSafelySubmit` passes |
| `recordResult()` | Exact outcome: submitted / ready / paused / skipped / failed |

User-visible stages (queue cards poll these while Apply is running):

- Analyzing...
- Preparing CV...
- Preparing cover letter...
- Opening application...
- Filling application...
- Waiting for verification...
- Submitted ✓
- Ready to Apply

---

## AI decisions vs deterministic safety

AI may propose eligibility, a match score, CV edits, answers, or “submit now”.

**Safety rules always win.**

| AI says | Deterministic evidence | Final decision |
|---|---|---|
| Eligible | A mandatory requirement explicitly fails (GPA, degree, work auth, …) | `NOT_ELIGIBLE` — skip that application |
| Submit | CAPTCHA / Turnstile / hCaptcha on the page | `PAUSE` — never bypass |
| Submit | MFA / verification code | `PAUSE` — never bypass |
| Submit | Auth wall / login | `PAUSE` — never bypass |
| Submit | Required field UNKNOWN or sensitive unanswered | `PAUSE` — never fabricate |
| Submit | `AUTO_APPLY` off or `dry_run` | `READY` — not submitted |
| Candidate knows technology X | No attested evidence in knowledge/CV/profile | `UNKNOWN` — not a fact |
| Cover letter needed | Job/application has no requirement and no attested benefit | Do not generate |
| Tailor the CV | Master CV already suitable | Reuse master |
| This job is new | Same URL/company+title already `SUBMITTED` with `submitted_at` | Duplicate — skip |
| Still open | Liveness `expired` or deadline passed | Unavailable / skipped |

Helpers: `applyEligibilitySafety`, `applySubmitSafety`, `applyKnowledgeSafety`, `retrySafely`.

---

## Candidate knowledge

- Facts are authoritative only when **user-supplied**, extracted from a **trusted user document**, or **explicitly confirmed**.
- AI-generated CV/cover-letter/answer text stays `GENERATED` until the user confirms or corrects it.
- `CandidateContextBuilder.build(opportunity)` returns a **minimal** packet (matching skills/projects, preferred roles, approved/rejected answers, a few evidence chunks).
- The full private document collection is never concatenated into a prompt (`fullCorpusIncluded: false`).

---

## Browser automation

- Live fill uses Playwright via `runApplicationAgent`.
- Launch is retried once on failure. Persistent failure → package stays `READY` (not `SUBMITTED`).
- Headed Career-OPS apply session (`web/src/lib/apply/session.ts`) still **never clicks Submit**; it hands off to the student.
- Overlay submit is allowed only when `AUTO_APPLY` / `liveSubmit` is true **and** safety checks pass.

Never:

- bypass CAPTCHA, MFA, authentication, or anti-bot systems
- fabricate candidate facts or answers
- upload a file that was not the prepared CV/cover letter for this application
- log API keys, cookies, or passwords (`Sanitizer`)

---

## ATS adapters

Detection from URL (`detectATS`): Greenhouse, Lever, Ashby, Workday, else generic.

Filling is **semantic** (labels, ARIA, accessible names), not hardcoded `#id` lists. Greenhouse may enrich labels from the public boards API; adapter failure falls back to the DOM. Workday/Lever/generic use the same classifier.

---

## Failure recovery

| Failure | Behaviour |
|---|---|
| One application throws | Caught; that item `FAILED`; batch continues |
| AI timeout / throw | Retry once; then heuristic match / skip invented answers |
| Browser launch/nav fail | Retry once; continue with prepared package, not submitted |
| CAPTCHA / MFA / auth | Pause **that** application |
| Unknown required / sensitive | Pause **that** application |
| Job 404 / expired listing | `SKIPPED` / unavailable |
| Past deadline | `SKIPPED` |
| Already submitted | Duplicate blocked |
| Ineligible | `SKIPPED` — no CV, no browser |
| Optional unknown field (e.g. LinkedIn) | Leave blank — do not pause, do not invent |
| Required resume file in DRY_RUN | Package stays READY; attach happens on the live form |

`SUBMITTED` is recorded only with a real `submitted_at`. DRY_RUN never submits. File fields are not treated as UNKNOWN answers — they are uploads of the prepared CV/cover letter, never an invented file.

---

## Privacy model

- Tenant + user isolation on queue, knowledge, intelligence, CV versions, cover letters.
- Opportunity-specific retrieval only.
- PII in candidate context is minimized except for the application-agent purpose (contact fields).
- GDPR export includes profile, applications, knowledge, and intelligence (sanitized).
- Account deletion wipes knowledge + intelligence stores.
- DRY_RUN is the default: fill and prepare, do not submit.

---

## How to run

1. Discover internships/jobs.
2. Select opportunities → **Add to Applications**.
3. Open **Application queue**.
4. **Apply to Selected** or **Apply to All**.
5. Watch per-card stages. Nothing is submitted unless AUTO_APPLY is enabled and safety checks pass.

Tests: `node test-all.mjs --only application-orchestrator`  
Five ATS-shaped mocks live in `tests/fixtures/mock-applications.mjs` (Greenhouse, Lever, Workday, generic, unexpected sensitive question).
