# Capstone Architecture Analysis

**Target Product:** Autonomous AI Career Agent for Students & Job Seekers  
**Modes:** INTERNSHIPS (primary focus) · JOBS  
**Based on:** career-ops codebase audit — August 2026

---

## 1. Existing Architecture

### Runtime Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥ 18 (ESM, `.mjs` scripts) |
| Web UI | Next.js 16.3 (App Router, React 19, TypeScript) |
| Styling | Tailwind CSS v4 |
| Browser Automation | Playwright 1.62.1 + Chromium |
| AI/LLM | AI-CLI agnostic prompt files (`modes/*.md`); standalone evals via `@google/generative-ai`, OpenAI-compatible, Ollama |
| Config | YAML (`portals.yml`, `config/profile.yml`) |
| Storage | Flat files (Markdown tables, TSV logs); SQLite as derived index only |
| Deployment | Docker (Playwright base image) + optional Nix flake |
| Dashboard | Optional Go TUI (`dashboard/`) |

### Data Architecture (Two-Layer)

```
SYSTEM LAYER (auto-updatable)          USER LAYER (never auto-touched)
──────────────────────────────         ─────────────────────────────────
modes/*.md      (AI prompt files)      cv.md               (candidate CV)
*.mjs           (Node scripts)         config/profile.yml  (identity/targets)
providers/*.mjs (ATS connectors)       modes/_profile.md   (archetypes/narrative)
templates/      (CV/letter templates)  modes/_custom.md    (house rules)
batch/          (batch runner)         data/applications.md (tracker)
web/            (Next.js UI)           data/pipeline.md    (job inbox)
                                       reports/*.md        (evaluations)
                                       output/*.pdf        (generated CVs)
```

**Core doctrine:** flat Markdown files are the permanent source of truth. SQLite is a derived query index only and will never become primary store.

---

## 2. Existing Workflow

### Full Auto-Pipeline (`modes/auto-pipeline.md`)

```
URL/JD Input
    │
    ▼
Step 0: Extract JD (Playwright → WebFetch → WebSearch)
    │
    ▼
Step 0.5: Liveness gate (is posting still active?)
    │
    ▼
Step 0.6: Blacklist gate (company on do-not-apply list?)
    │
    ▼
Step 1: A–G Evaluation (oferta.md + _shared.md scoring)
    │   Block A: Role summary, geo-mismatch, work-auth
    │   Block B: CV match (skills, proof points, gaps)
    │   Block C: Level strategy
    │   Block D: Comp & market demand
    │   Block E: CV customization plan
    │   Block F: STAR interview stories
    │   Block G: Posting legitimacy signals (12 checks)
    │
    ▼
Step 2: Save report → reports/{NNN}-{company}-{date}.md
    │
    ▼
Step 3: Generate tailored PDF CV (generate-pdf.mjs via Playwright/Chromium)
    │
    ▼
Step 4: Draft application answers (only if score ≥ 4.5)
    │
    ▼
Step 5: Update tracker → data/applications.md
```

### Job Discovery Pipeline (`scan.mjs` + `providers/`)

```
portals.yml (config)
    │
    ├─► Level 0: Zero-token ATS APIs
    │   81 provider modules: Greenhouse, Ashby, Lever, Workday,
    │   BambooHR, Teamtailor, Breezy, iCIMS, Workable,
    │   SmartRecruiters, Personio, Jobvite, Radancy...
    │
    ├─► Level 1: Playwright scraping (SPA pages)
    │
    ├─► Level 2: ATS API/RSS feeds (complementary)
    │
    └─► Level 3: WebSearch (broad discovery, stale)
         │
         ▼
    Filters: title_filter, location_filter, content_filter,
             country_eligibility_filter, visa_filter,
             salary_filter, posting_age_filter, cooldown_filter
         │
         ▼
    Dedup: scan-history.tsv + applications.md + pipeline.md
         │
         ▼
    data/pipeline.md (pending evaluation queue)
```

### Application Submission Flow (`modes/apply.md`)

Human-in-the-loop by design. The agent:
1. Detects the form (Playwright snapshot or screenshot)
2. Pre-scans for knock-out questions
3. Generates copy-paste answers per field
4. **Never clicks Submit** — candidate reviews and submits manually

---

## 3. Reusable Components (High Value, Keep As-Is)

| Component | File(s) | Why Reusable |
|---|---|---|
| ATS Provider Layer | `providers/*.mjs` (81 modules) | Complete coverage of every major job board. Zero-token, production-hardened. Direct reuse for internship boards using same ATSs. |
| Scan Engine | `scan.mjs` | Title/location/visa/salary/age/cooldown filters, dedup, cross-listing detection, 4-level discovery hierarchy. |
| Full-ATS Sweep | `scan-ats-full.mjs` | Reverse-ATS keyword scanner over full public datasets — extremely powerful for internship discovery. |
| PDF Generation | `generate-pdf.mjs` | Playwright HTML→PDF, ATS-safe Unicode normalization, font inlining, page budget enforcement. |
| CV Templates | `templates/cv-template.html` | Clean, ATS-parseable HTML template with CSS theming hooks. |
| Scoring System | `modes/_shared.md` | 6-dimension 1–5 scoring, archetype detection, cultural signals, compensation reliability tiers. |
| Job Evaluation | `modes/oferta.md` | 12-signal legitimacy checks, work-auth analysis, geo-mismatch, compensation decomposition. |
| Cover Letter Gen | `generate-cover-letter.mjs` | Templated cover letter generation. |
| Tracker | `tracker-parse.mjs`, `set-status.mjs`, `tracker-utils.mjs` | Atomic writes, locking, state machine, TSV-backed append-log. |
| Liveness Check | `liveness-core.mjs`, `check-liveness.mjs` | Zero-token posting expiry detection. |
| Pattern Analysis | `analyze-patterns.mjs` | Per-ATS advance rate, rejection pattern analysis. |
| Eligibility Filters | `buildCountryEligibilityFilter()`, `buildVisaFilter()` in `scan.mjs` | Work-auth, visa sponsorship, country eligibility — critical for student/graduate targeting. |
| Application Answers | `application-answers.mjs`, `modes/apply.md` | Form-filling with ATS quirks (Greenhouse, Lever, Ashby, Workday, Workable). |
| Browser Automation | `browser-extract.mjs` | Compact JD extraction — saves tokens vs full Playwright snapshot. |
| Plugin Engine | `plugins/*.mjs` | Extensible provider plugin layer. |
| Next.js Web UI | `web/` | Full dashboard — pipeline view, job explorer, CV editor, follow-ups, portals, config. |

---

## 4. Components Requiring Modification

### 4a. Scoring System — Add Internship/Student Dimensions

**File:** `modes/_shared.md`, `modes/oferta.md`

Current scoring is designed for senior professionals. For students/interns:
- Remove: "sell senior without lying" framing (Block C)
- Add: GPA relevance, degree program match, graduation timeline
- Add: stipend/hourly rate evaluation (not annual salary)
- Add: duration scoring (3-month vs 6-month vs 12-month co-op)
- Add: academic credit eligibility flag
- Add: remote-friendliness weighting (students often can't relocate)
- Modify: experience thresholds — 0–2 years is the target range, not 5–10

### 4b. Job Discovery — Add Internship-Specific Sources

**File:** `portals.yml`, `providers/` (new modules needed)

Current providers target professional roles. Must add:
- Handshake (primary university internship platform — requires login, plugin layer)
- WayUp, Chegg Internships, InternMatch
- LinkedIn Early Career / Student Jobs filter
- College-specific career portals (Symplicity, 12Twenty)
- Government internship portals (USAJobs student programs, Interamt for Germany)
- STEM-specific boards (NASA, DOE, NSF)
- Company-specific intern programs (Google STEP, Microsoft Explore, etc.)

### 4c. Eligibility Check — Student-Specific

**File:** `modes/oferta.md` Block A, `scan.mjs` filters

Add:
- Graduation year / enrollment status verification against JD
- Degree/major requirement matching
- GPA cutoff detection (many intern JDs state "3.0+ GPA")
- Credit-bearing internship flag
- OPT/CPT eligibility for international students
- Start date flexibility (summer vs. semester vs. year-round)

### 4d. CV System — Student CV Profile

**File:** `modes/pdf.md`, `templates/cv-template.html`, `modes/_profile.md`

Student CVs differ fundamentally:
- Lead with Education (not Experience)
- Coursework, projects, hackathons, clubs are primary content
- GPA, relevant coursework section
- Skills section is more prominent
- 1-page target (not 2-page)
- Add a dedicated "Projects" first layout

### 4e. Auto-Submit Gate — Configurable Submission Limits

**File:** `modes/apply.md`

Current design is **hard human-in-the-loop**: agent never submits.

For the product vision of autonomous submission:
- Add `auto_submit` config flag in `config/profile.yml`
- Add `daily_submit_limit` and `total_submit_limit` caps
- Add per-ATS submission capability (currently only fills, never clicks)
- Add pre-submission confirmation queue (user approves batch)
- Requires new `submission-log.tsv` audit trail

### 4f. Modes — Add INTERNSHIPS / JOBS Mode Switch

**File:** New `modes/internship.md`, modified `modes/_shared.md`

Add top-level mode selector:
- `INTERNSHIPS` mode: student scoring weights, intern sources, student CV template
- `JOBS` mode: existing professional flow (current behavior)
- Mode flag in `config/profile.yml`: `search_mode: internships | jobs`

---

## 5. New Components Required

### 5a. Eligibility Engine

**New file:** `eligibility-check.mjs`

Structured eligibility gate before evaluation:
```
JD text → parse requirements:
  - enrollment_required: true/false
  - graduation_year_range: [2025, 2027]
  - gpa_min: 3.0
  - major_filter: ["CS", "ECE", "Math"]
  - duration_months: 3
  - credit_eligible: true/false
  
Candidate profile → compare:
  - graduation_year, major, gpa, enrollment_status
  
Output: { eligible: bool, hard_blocks: [], soft_mismatches: [] }
```

### 5b. Internship-Specific Providers

**New files:** `providers/handshake.mjs`, `providers/wayup.mjs`, `providers/chegg-internships.mjs`, `providers/linkedin-intern.mjs`, `providers/usajobs-student.mjs`

Handshake requires OAuth — must go in the plugin layer (auth-gated sources are intentionally out of core).

### 5c. Student CV Builder

**New file:** `templates/cv-template-student.html`, `modes/pdf-student.md`

Student-optimized layout:
- Education section first
- Projects as primary experience proxy
- Coursework / relevant classes section
- Single-page target
- GPA display logic

### 5d. Application Submission Module

**New file:** `auto-submit.mjs`

Extends `modes/apply.md` with:
- Per-ATS submit automation (Greenhouse, Ashby, Lever, Workday)
- Submit limit enforcement (`daily_limit`, `total_limit`, `per_company_limit`)
- Pre-submit confirmation queue (user sees pending batch, approves)
- `data/submissions.tsv` audit log
- Rollback/withdraw capability where ATS supports it

### 5e. Scheduling / Continuous Discovery

**New file:** `scheduler.mjs` or OS-level cron integration

Current: scan runs manually.  
Required: autonomous continuous discovery.

Options:
- Node.js `setInterval`-based daemon
- OS cron recipe (Windows Task Scheduler / launchd / cron)
- Docker container with scheduled entrypoint
- Next.js API route with a background job

Suggested config in `profile.yml`:
```yaml
scheduler:
  scan_interval_hours: 12
  eval_on_discovery: true
  auto_submit_if_score_gte: 4.5
  daily_submit_limit: 3
```

### 5f. Student Profile Schema

**New fields in `config/profile.yml`:**
```yaml
student:
  university: "MIT"
  major: "Computer Science"
  graduation_year: 2026
  graduation_semester: "Spring"
  gpa: 3.8
  enrollment_status: "full-time"
  credit_hours: 15
  authorized_for_cpt: true
  authorized_for_opt: false
  target_internship_duration: [3, 6]  # months
  preferred_start: "Summer 2026"
```

### 5g. Internship Tracker Extension

**New columns in `data/applications.md`:**
```
| # | Date | Company | Role | Type | Duration | Stipend | Score | Status | PDF | Report | Notes |
```

Where `Type` = `Internship | Co-op | Part-time | Full-time`

### 5h. Deadline Tracker

**New file:** `data/deadlines.md`, `deadline-monitor.mjs`

Many internship programs have hard application deadlines (e.g., Google STEP closes in October for summer). Needs:
- Deadline ingestion from JD parsing
- Deadline alert system (days remaining)
- Priority queue sorted by deadline proximity

---

## 6. Current Limitations

| Limitation | Impact on Target Product |
|---|---|
| **No autonomous submission** — hard HITL design principle in `modes/apply.md` | Core product requirement blocked. Must be added as opt-in config, not default. |
| **No scheduling** — scans run manually | "Continuously discovers" requirement unmet. Need daemon/cron layer. |
| **Auth-gated sources excluded** — Handshake, LinkedIn intern portal require login | Primary intern platform (Handshake) is unavailable. Plugin layer is the path. |
| **No student profile schema** — profile.yml designed for professionals | GPA, major, enrollment status, graduation year have no structured home. |
| **Scoring tuned for senior professionals** — Block C "sell senior without lying", salary in $120K–200K range | Completely wrong framing for students. Active misdirection. |
| **CV templates assume 2 pages and lead with Experience** | Student CVs lead with Education and are 1 page. Template redesign required. |
| **No deadline tracking** — internship applications have hard deadlines unlike job openings | Students miss critical windows without deadline awareness. |
| **No co-op / dual-enrollment awareness** — assumes singular job search | Universities have structured co-op programs with fixed semester cycles. |
| **Flat-file storage limits query performance at scale** — 1,000+ applications strain `applications.md` parsing | Students applying to 200+ internships in one season will hit performance walls. |
| **Single-user local-first design** — no multi-device sync | Students often work across devices (laptop, university lab). |
| **No GPA/transcript parsing** — eligibility check can't be automated without structured academic data | Manual profile entry required; no document parsing. |
| **Playwright requires display/browser installed** — server-side scheduling needs headless setup | CI/CD or cloud deployment needs explicit headless chromium config (Docker handles it). |
| **No cover-letter brand for student voice** — `voice-dna.md` assumes professional tone | Student cover letters require different framing (eagerness to learn, not "I'm choosing you"). |

---

## 7. Potential Scalability Issues

| Issue | Risk Level | Detail |
|---|---|---|
| **Markdown tracker at high volume** | Medium | `data/applications.md` parsed as text on every operation. At 500+ rows, grep-based lookups slow down. SQLite derived index helps but is not auto-maintained. |
| **Playwright concurrency** | High | `_shared.md` explicitly states "NEVER 2+ agents with Playwright in parallel." Autonomous submission + scan + liveness checks all need Playwright. Single browser instance is a bottleneck. |
| **scan-history.tsv grows unbounded** | Low-Medium | No pruning strategy. At 10K+ rows, dedup lookups are O(n). Needs periodic archival or index. |
| **Token cost per evaluation** | Medium | Full A–G evaluation is expensive (5 WebSearch queries + Playwright + LLM). At 50 auto-discovered jobs/day, cost compounds quickly without triage gate. (Triage mode `modes/triage.md` exists but is opt-in.) |
| **No job queue / backpressure** | Medium | If 200 URLs land in `pipeline.md` overnight, the pipeline runs them all sequentially with no rate limiting. |
| **Single `portals.yml` config file** | Low | Works well for one user. Multi-mode (internship + jobs) needs either two config files or mode-scoped sections. |
| **Report file naming collisions** | Low | `reserve-report-num.mjs` uses file-based atomic locking. Fine for single user; breaks under concurrent multi-process writes. |
| **Next.js web UI reads files directly** | Medium | API routes read `data/applications.md` and `reports/` via filesystem. On a deployed server this requires a persistent volume, not ephemeral storage. |
| **No authentication on web UI** | High | `web/` has no auth layer. If deployed remotely (not localhost), all personal career data is publicly accessible. |

---

## 8. Licensing Considerations

| Item | Detail |
|---|---|
| **Base license** | MIT — original `career-ops` by Santiago Fernández de Valderrama. Permissive: fork, modify, distribute, commercialize freely. |
| **Obligations** | Must retain the original copyright notice (`Copyright (c) 2026 Santiago Fernández de Valderrama`) in derivative works. Single line in `LICENSE`. |
| **Your additions** | All new code you write is yours. You can apply any license to the combined work, provided MIT attribution is preserved. |
| **Commercial use** | MIT explicitly permits commercial use. No royalties, no copyleft. |
| **Provider modules** | Each provider scrapes or calls a public API. Terms of Service of each job board apply at runtime (not to the code itself). Review ToS of Handshake, LinkedIn, etc. before building auth-gated plugins. |
| **Playwright** | Apache 2.0 — compatible with MIT. |
| **Third-party deps** | `@google/generative-ai` (Apache 2.0), `js-yaml` (MIT), `dotenv` (BSD-2), Next.js (MIT), React (MIT), lucide-react (ISC). All permissive. |
| **Font assets** | `fonts/` directory — verify individual font licenses (Inter: OFL, common free fonts: OFL/MIT). Do not assume they are all MIT. |
| **Recommendation** | Keep `LICENSE` as MIT. Add your own copyright line: `Copyright (c) 2026 [Your Name]`. Dual-copyright notice is standard practice for derived MIT works. |

---

## 9. Recommended Implementation Order

### Phase 0 — Project Rename & Identity (DONE)
- [x] Remove original Git history
- [x] Create fresh repo with clean initial commit
- [x] Create `VERSION` and `.gitignore`
- [ ] Rename project in `package.json` and `web/package.json`
- [ ] Update `LICENSE` with dual copyright notice

---

### Phase 1 — Student/Internship Profile Foundation (Week 1–2)

1. **Extend `config/profile.yml` schema** — add `student:` block (university, major, GPA, graduation year, enrollment status, co-op eligibility, CPT/OPT flags)
2. **Add `search_mode` config** — `internships | jobs` flag that gates which modes/templates/scoring apply
3. **Create `modes/_profile.md` template for students** — internship archetypes, narrative framing, target companies, target program types
4. **Create student CV template** — `templates/cv-template-student.html` (Education first, Projects prominent, 1-page, GPA display)

---

### Phase 2 — Eligibility Engine (Week 2–3)

5. **Build `eligibility-check.mjs`** — parse JD for enrollment requirement, graduation year, GPA cutoff, major filter, duration, start date
6. **Integrate into scan filters** — add eligibility pre-filter to `scan.mjs` (parallel to `buildTitleFilter`, `buildVisaFilter`, etc.)
7. **Integrate into evaluation** — add Block A eligibility check in internship mode (similar to work-auth check)
8. **Add CPT/OPT flag handling** — international student work authorization is a common intern knock-out

---

### Phase 3 — Internship Discovery Sources (Week 3–4)

9. **Add free/public internship providers** — WayUp RSS/API, Chegg Internships, public university job boards
10. **Extend `portals.example.yml`** — add internship-specific tracked companies (Google STEP, Microsoft Explore, Amazon SDE Intern, Meta University, Apple, etc.)
11. **Add `scan-ats-full.mjs` internship keywords** — title filters for "intern", "internship", "co-op", "apprentice", "early career", "new grad"
12. **Handshake plugin** — auth-gated, goes in `plugins/` layer, not core

---

### Phase 4 — Scoring Overhaul for Interns (Week 4–5)

13. **Create `modes/internship-eval.md`** — internship-specific A–G evaluation replacing `oferta.md` for internship mode
    - Remove "sell senior" framing
    - Add GPA/coursework match dimension
    - Replace salary scoring with stipend/hourly evaluation
    - Add duration/timeline fit scoring
    - Add learning opportunity scoring (mentorship, training programs)
    - Adjust legitimacy signals for internship context (longer postings are normal)
14. **Create `modes/internship-cv.md`** — student CV customization plan (projects over experience, coursework relevance)

---

### Phase 5 — Deadline Tracking (Week 5)

15. **Build `deadline-monitor.mjs`** — parse JD for application deadlines, store in `data/deadlines.md`
16. **Add deadline urgency to scoring** — weight deadlines in pipeline priority
17. **Add deadline column to tracker** — `data/applications.md` gets `Deadline` column in internship mode
18. **Deadline alert in pipeline summary** — surface "⚠️ Deadline in 7 days" at top of pipeline output

---

### Phase 6 — Scheduling & Autonomous Discovery (Week 6)

19. **Build `scheduler.mjs`** — Node.js daemon wrapping `scan.mjs` on configurable interval
20. **Add scheduler config** — `config/profile.yml` → `scheduler:` block (interval, eval_on_discovery, quiet_hours)
21. **Add Windows Task Scheduler recipe** — `docs/AUTOMATION.md` already exists, add Windows-specific instructions
22. **Build discovery → evaluation pipeline** — auto-triage discovered internships, queue for approval

---

### Phase 7 — Autonomous Submission (Week 7–8, opt-in)

> ⚠️ This phase requires careful ethical and ToS review per job board before implementation.

23. **Add `auto_submit` config gate** — disabled by default; requires explicit `auto_submit: true` + limit settings
24. **Build submission log** — `data/submissions.tsv` with timestamp, company, role, ATS, confirmation URL
25. **Extend `modes/apply.md`** — add Playwright click-submit path for Greenhouse, Ashby, Lever (most reliable APIs)
26. **Add pre-submit confirmation queue** — user sees pending batch (`data/submit-queue.md`), must approve before any submission fires
27. **Add daily/total limit enforcement** — hard stop when limits reached, notify user

---

### Phase 8 — Web UI Internship Mode (Week 9–10)

28. **Add mode toggle to web UI** — INTERNSHIPS / JOBS switcher in top nav
29. **Add eligibility column to job explorer** — show eligibility status alongside match score
30. **Add deadline calendar view** — visual deadline tracking in the pipeline page
31. **Add student dashboard** — summary: applications sent this week, deadlines this month, response rate
32. **Add auth layer** — basic auth or local-only enforcement before any remote deployment

---

### Phase 9 — Polish & Capstone Presentation (Week 10–12)

33. **End-to-end demo flow** — student profile → autonomous scan → eligibility filter → evaluation → CV generation → application submission
34. **Metrics dashboard** — acceptance rate, response rate, time-to-offer, submissions per week
35. **Documentation** — user guide, setup guide, capstone writeup
36. **Demo data** — anonymized sample data for presentation

---

## 10. Completed Core Modules (Verified & Tested)

### 10a. Student Profile System (`lib/student-profile.mjs`)
- Comprehensive profile loader and validator for `config/student-profile.yml`
- Handles Identity, Education (GPA, degree, coursework), Skills, Experience (internships/jobs/volunteer), Projects, and Preferences
- Zero-fabrication design (treats missing optional data as `null`, validates all required constraints)
- Full test suite: 91 passing tests (`tests/student-profile.test.mjs`)

### 10b. Opportunity Classification Engine (`lib/classify-opportunity.mjs`)
- Classifies discovered roles into `INTERNSHIP`, `JOB`, or `OTHER`
- Multi-signal weighted scoring across Title, Description, Employment Type, Student/Education Requirements, Duration, and Multilingual indicators (e.g. Werkstudent, Praktikum, Stagiaire)
- Full test suite: 66 passing tests (`tests/classify-opportunity.test.mjs`)

### 10c. Hard-Gate Eligibility Engine (`lib/eligibility-engine.mjs`)
- Zero-assumption hard gate evaluating 14 criteria: degree, major, enrollment, graduation date, academic year, skills, experience, GPA, work auth, citizenship, age, duration, deadline, and location
- Categorizes each requirement as `PASS`, `FAIL`, or `UNKNOWN`
- Resulting status: `ELIGIBLE` (all pass), `NOT_ELIGIBLE` (mandatory failure), or `REQUIRES_REVIEW` (unknown mandatory requirements)
- Full test suite: 61 passing tests (`tests/eligibility-engine.test.mjs`)

### 10d. Source Adapters & Normalization (`lib/source-adapters.mjs`)
- Normalizes raw opportunities into a uniform CareerOS schema
- Pakistan-aware country inference (Karachi, Lahore, Islamabad, etc. → Pakistan) and global city mapping
- Remote eligibility detection
- URL-based and fuzzy (title + company) deduplication
- Full test suite: 111 passing tests (`tests/source-adapters.test.mjs`)

### 10e. Source Integration & Transparency Policy (`config/pakistan-portals.yml`)

| Source / Company | ATS / Platform | Integration Method | Status |
|---|---|---|---|
| **Careem** | Greenhouse | Direct ATS API (`providers/greenhouse.mjs`) | Verified Working ✅ |
| **10Pearls** | Workable | Direct ATS API (`providers/workable.mjs`) | Verified Working ✅ |
| **OpenAI / Stripe** | Greenhouse | Direct ATS API (`providers/greenhouse.mjs`) | Verified Working ✅ |
| **Anthropic** | Ashby | Direct ATS API (`providers/ashby.mjs`) | Verified Working ✅ |
| **NVIDIA** | Workday | Direct ATS API (`providers/workday.mjs`) | Verified Working ✅ |
| **Amazon / AWS** | amazon.jobs API | Direct Provider (`providers/amazon.mjs`) | Verified Working ✅ |
| **IBM** | IBM Search API | Direct Provider (`providers/ibm.mjs`) | Verified Working ✅ |
| **Rozee.pk / Mustakbil** | Proprietary (No public API) | Web Search Query | Verified Fallback 🔍 |
| **Jazz / Zong / Nayatel** | Custom Career Portals | Web Search Query | Verified Fallback 🔍 |
| **Systems Ltd / NETSOL / Daraz** | Custom Career Portals | Web Search Query | Verified Fallback 🔍 |
| **Google / Microsoft / Meta / Apple** | Custom Portals / Closed APIs | Web Search Query | Verified Fallback 🔍 |
| **Tesla** | Proprietary (No public API) | Web Search Query | Verified Fallback 🔍 |
| **Pakistani Universities (LUMS, NUST, FAST)** | Career Services | Web Search Query | Verified Fallback 🔍 |

### 10f. AI Opportunity Matching Engine (`lib/match-engine.mjs` & `lib/ai-provider.mjs`)
- Configurable AI provider abstraction supporting Google Gemini (`gemini-3.6-flash`), OpenAI (`gpt-4o-mini`), and local Ollama (`llama3.2`) with automatic env detection.
- Evaluates opportunity fit across 6 weighted dimensions: Skills Match (30%), Project Relevance (20%), Education Fit (15%), Experience Relevance (15%), Role/Industry Fit (10%), and Location/Logistics (10%).
- Strict Hard-Gate separation: throws `EligibilityGateError` on `NOT_ELIGIBLE` — a high match score can **never** override failed eligibility.
- Categorizes scores into configurable tiers: `EXCELLENT` (90–100), `STRONG` (80–89), `GOOD` (70–79), `WEAK` (60–69), and `SKIP` (<60).
- Detailed explanation reporting: extracts `strengths`, `missing_skills`, `relevant_experience`, `relevant_projects`, `concerns`, and a concise `recommendation`.
- Full test suite: 104 passing tests with dependency-injected mock AI calls (`tests/match-engine.test.mjs`).

### 10g. Intelligent CV Tailoring Engine (`lib/cv-tailor.mjs`)
- Source-fact extraction registry (`extractSourceFacts`): programmatically extracts verifiable companies, project names, YYYY-MM dates, skills, metrics, and degrees from profile + master CV text before AI invocation.
- Post-generation fabrication validation (`validateAgainstSourceFacts`): programmatically validates generated draft entities against source facts — throws `FabricationError` on invented companies, projects, dates, metrics (%, $, K/M numbers), or skills.
- Multi-provider AI tailoring (`tailorCV`): reorders, rewrites, and emphasizes experience/projects/competencies to match the target JD without inventing facts.
- ATS-safe HTML rendering (`renderTailoredHTML`): populates `cv-template.html` with student-optimized layout (Education first, Projects before experience).
- Audit-ready `TailoredCVRecord`: preserves `opportunity_id`, `tailored_at`, `provider_used`, `model_used`, `source_facts`, `validation_result` (`CLEAN` / `FLAGGED` / `REJECTED`), `original_cv`, and rendered HTML.
- Full test suite: 77 passing tests including explicit fabrication prevention cases (`tests/cv-tailor.test.mjs`).

### 10h. Application Content Generator (`lib/application-generator.mjs`)
- Generates complete application packages per selected opportunity: tailored CV, cover letter, application summary, and application form answers with confidence scores.
- Sensitive-category hard gate (`SENSITIVE_CATEGORIES`): 8 high-risk categories (`work_authorization`, `sponsorship`, `salary`, `demographic`, `disability`, `criminal_legal`, `citizenship`, `relocation`) **always** return `REQUIRES_USER_INPUT` (confidence 0.0) without calling AI.
- Deterministic profile derivation: auto-answers basic questions (`name`, `email`, `phone`, `university`, `degree`, `graduation`, `gpa`, `linkedin`, `github`) with 1.0 confidence directly from profile data.
- AI cover letter generation (`generateCoverLetter`): produces tailored 3-paragraph cover letters (<250 words) adhering strictly to profile facts.
- Deterministic application summary (`generateApplicationSummary`): generates student profile + target role application overview.
- Comprehensive `ApplicationRecord`: captures `opportunity_id`, `provider_used`, `model_used`, `tailored_cv`, `cover_letter`, `application_summary`, `application_answers`, `requires_user_input` flag, and `pending_questions` audit trail.
- Full test suite: 216 passing tests (`tests/application-generator.test.mjs`).

### 10i. Browser-Based Application Agent (`lib/application-agent.mjs`)
- Playwright-driven browser agent managing application lifecycle from pre-flight to dry-run fill logging.
- `ApplicationSession` auditing: tracks `session_id`, `opportunity_id`, `url`, `company`, `job`, `ats`, `start_time`, `end_time`, `fields`, `unanswered_fields`, `fill_log`, `upload_log`, `validation_errors`, `errors`, `screenshots`, and `final_status`.
- ATS support: handles `greenhouse`, `lever`, `ashby`, `workday`, and `generic` career portal formats.
- Non-bypassable security controls: detects CAPTCHA (reCAPTCHA/hCaptcha/Turnstile), MFA, Cloudflare anti-bot challenges, and auth walls, flagging session as `BLOCKED`.
- Pre-flight checklist: validates target URL, company name match, job title match, CV availability, cover letter availability, eligibility status, and duplicate submission guard.
- Strict DRY_RUN mode: enforces `dry_run: true` — logs planned form fill actions and file uploads without triggering DOM inputs or submit actions.
- Pre-submission validation: verifies all required fields are satisfied, checks generated answers for hallucination against `SourceFacts`, and enforces `REQUIRES_USER_INPUT` for unmapped or sensitive fields.
- Full test suite: 56 passing tests (`tests/application-agent.test.mjs`).

### 10j. Autonomous Application Manager (`lib/application-manager.mjs`)
- Persisted application queue state machine supporting 12 explicit states: `DISCOVERED`, `ELIGIBILITY_CHECK`, `NOT_ELIGIBLE`, `ELIGIBLE`, `MATCHED`, `SELECTED`, `CV_GENERATED`, `APPLICATION_READY`, `APPLYING`, `APPLIED`, `FAILED`, and `REQUIRES_USER_INPUT`.
- Configurable independent daily limits: `internship_applications_per_day` (default 10) and `job_applications_per_day` (default 10), stored persistently in `data/daily-applications.json`.
- Timezone-aware daily reset: automatically resets application counters at midnight in the user's configured timezone (`Intl.DateTimeFormat` compliant).
- Atomic concurrency locking (`reserveSlot`): prevents race conditions across multi-threaded or concurrent worker processes via atomic file lock guards (`withPipelineLock`).
- Selection priority engine (`calculatePriorityScore`): ranks candidate opportunities by (1) eligibility, (2) earliest deadline, (3) match score, (4) user preference alignment, (5) post/discovery date freshness, and (6) ATS source reliability.
- Duplicate prevention: rejects duplicate applications by exact URL or `(company + title)` key.
- Full test suite: 34 passing tests covering restarts, concurrent workers, duplicate rejection, daily resets, and limit enforcement (`tests/application-manager.test.mjs`).

---

## Summary: What You're Building vs. What Exists

```
EXISTING (reuse directly):
  ✅ 81 ATS provider modules covering every major job board
  ✅ Full evaluation pipeline (A-G scoring, 12 legitimacy checks)
  ✅ PDF generation (Playwright, ATS-safe, font inlining)
  ✅ Work-auth / visa / country eligibility filters
  ✅ Application form automation (Playwright, ATS quirks documented)
  ✅ Cover letter generation
  ✅ Next.js web UI (pipeline, CV editor, portals, follow-ups)
  ✅ Tracker + follow-up cadence system
  ✅ Pattern analysis, skill gap detection

MODIFY:
  🔧 Scoring weights (student/intern dimensions)
  🔧 CV templates (student layout, 1-page, Education first)
  🔧 Profile schema (add student fields)
  🔧 Apply mode (add opt-in submit capability)
  🔧 portals.yml (add internship companies/sources)

BUILD NEW:
  🆕 Eligibility engine (GPA, major, graduation year, CPT/OPT)
  🆕 Internship evaluation mode (internship-eval.md)
  🆕 Internship-specific providers (Handshake plugin, WayUp, Chegg)
  🆕 Deadline tracker
  🆕 Scheduler / continuous discovery daemon
  🆕 Autonomous submission module (opt-in, with limits)
  🆕 Student dashboard in web UI
  🆕 Auth layer for web UI
```

**Estimated reuse:** ~65% of existing codebase is directly usable.  
**Estimated new build:** ~35% net-new components on top of the existing foundation.
