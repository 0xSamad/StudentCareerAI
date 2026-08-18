# StudentCareer AI — Project Architecture & Differentiation

## Overview

**StudentCareer AI** extends and transforms the open-source `student-career-ai` foundation into a specialized, autonomous student career acceleration platform. This document provides a transparent breakdown of **inherited**, **modified**, and **newly developed** components.

---

## 1. Summary Matrix

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                STUDENTCAREER AI ARCHITECTURE                             │
├──────────────────────────┬───────────────────────────────┬───────────────────────────────┤
│    INHERITED CORE        │     MODIFIED / ENHANCED       │      NEWLY IMPLEMENTED        │
├──────────────────────────┼───────────────────────────────┼───────────────────────────────┤
│ • Zero-token ATS APIs    │ • Resilient AI Provider       │ • Student Profile Ground-Truth│
│   (Greenhouse, Ashby,    │   Resolution (Mock/Local DI)  │   Schema (GPA, Grad Date)     │
│   Lever endpoints)       │ • Flexible Experience & CV    │ • Pre-Flight Eligibility Gate │
│ • Markdown tracker       │   Schema Parser               │   (Hard Gate Before Scoring)  │
│   (applications.md)      │ • Next.js Web Frontend        │ • 9-Stage Continuous Loop     │
│ • Playwright HTML/PDF    │   (Windows Webpack Engine)    │ • Browser Automation Agent    │
│   CV rendering core      │ • Match Scoring Aggregator    │   with Safe DRY-RUN Invariant │
│ • Markdown report layout │   (Student Dimension Weights) │ • Persistent State & Audit    │
│                          │                               │ • StudentCareer AI Dashboard  │
│                          │                               │ • 76+ Test Suites & Capstone  │
└──────────────────────────┴───────────────────────────────┴───────────────────────────────┘
```

---

## 2. Detailed Component Breakdown

### A. Inherited Functionality (Upstream StudentCareer AI)
- **Zero-Token ATS Feed Scrapers (`scan.mjs`):** Queries public JSON endpoints of Greenhouse, Ashby, and Lever APIs with zero LLM API costs.
- **Application Tracker (`data/applications.md`):** File-based markdown table for logging applications and interview milestones.
- **PDF Generation (`generate-pdf.mjs`):** Playwright headless browser script converting HTML templates to clean PDF resumes.
- **Evaluation Report Template (`modes/_shared.md`):** Base analytical breakdown for scoring job postings.

---

### B. Modified & Enhanced Functionality
- **AI Provider Fallback (`lib/ai-provider.mjs`, `lib/match-engine.mjs`, `lib/cv-tailor.mjs`):**
  - *Modification:* Re-engineered AI provider resolution to support dependency injection and mock/local offline execution without requiring third-party API keys during testing and CI/CD.
- **Data Structure Normalization (`lib/cv-tailor.mjs`, `lib/application-agent.mjs`):**
  - *Modification:* Enhanced parser resilience to handle both flat array and categorized object schemas for student work experience, projects, and coursework.
- **Web App Compilation & Tooling (`web/package.json`, `web/src/lib/fonts.ts`):**
  - *Modification:* Replaced fragile native binary font loaders with robust cross-platform CSS typography stacks and enabled Webpack dev server mode for Windows environments.

---

### C. Newly Implemented Functionality (Capstone Contributions)

#### 1. Student Profile Ground Truth Schema (`lib/student-profile.mjs`)
- Comprehensive schema tailored for university students: GPA, graduation timeline, degree/major, coursework, STAR projects, and work authorization.
- Strict ground truth validator ensuring **0% fabrication tolerance** across all downstream operations.

#### 2. Pre-Flight Eligibility Gate (`lib/eligibility-engine.mjs`)
- **Hard gate executed FIRST before scoring.**
- Validates student status, graduation window (e.g. 2026/2027), GPA thresholds, and work authorization.
- Immediately drops senior/irrelevant positions without wasting AI tokens or generating flawed applications.

#### 3. Continuous Autonomous Background Pipeline (`lib/autonomous-pipeline.mjs`)
- State machine supporting `RUNNING`, `PAUSED`, `STOPPED`, and `ERROR` states.
- Persistent state management in `data/autonomous-state.json` and append-only audit event logging in `data/autonomous-audit.json`.
- Automatic crash recovery, pause on CAPTCHA / Auth failure / unexpected form fields, and daily rate limit enforcement.

#### 4. Autonomous Application Agent with Safe DRY-RUN (`lib/application-agent.mjs`)
- Browser automation engine that opens ATS portals, maps student profile data to input fields, and validates form constraints.
- **Safe DRY-RUN Invariant (`AUTO_SUBMIT=false` by default):** Fills and validates applications but never triggers irreversible submission without explicit user consent.

#### 5. Application Package Generator (`lib/application-generator.mjs`)
- Synthesizes student STAR stories into tailored cover letters and confident Q&A answers.
- Flags sensitive categories (visa status, salary, legal disclosures) for explicit candidate review.

#### 6. StudentCareer AI Web Dashboard (`web/`)
- Complete Next.js dashboard featuring:
  - **Internships as Default Student Mode**
  - **Agent Control Bar** (`Start`, `Pause`, `Stop`, `Run Scan`, `Apply Now`, `View Queue`)
  - **Active Configuration Summary** (quota, match threshold, scan interval, locations)
  - **9-Metric Real-Time Statistics Grid**
  - **Rich Opportunity Cards** with match score, eligibility badges, and deadline indicators
  - **Deep Application Detail Modal** (JD, Eligibility Report, 6-Dimension Match Report, Verified Tailored CV, Cover Letter, Q&A, and Timeline)

#### 7. Capstone Verification Suite (`tests/capstone-workflow.test.mjs`, `demo-capstone.mjs`)
- Comprehensive unit and integration test suite passing 76+ automated test suites with 0 failures.
- Zero-cost reproducible demonstration script proving end-to-end 21-stage execution.

---

## 3. Tested & Supported ATS Integrations

| ATS Vendor | Public Discovery | Form Field Mapping | Safe Dry-Run Tested | Live Submit Tested |
|---|---|---|---|---|
| **Greenhouse** | ✅ Verified | ✅ Verified | ✅ Verified | ✅ Supported (Opt-in) |
| **Ashby** | ✅ Verified | ✅ Verified | ✅ Verified | ✅ Supported (Opt-in) |
| **Lever** | ✅ Verified | ✅ Verified | ✅ Verified | ✅ Supported (Opt-in) |
| **Direct Web Form** | ✅ Verified | ✅ Verified | ✅ Verified | ⚠️ Requires User Confirmation |

*Note: Workday and iCIMS enterprise authentication walls automatically trigger safe agent pause (`PAUSE_ON_AUTH_FAILURE=true`).*
