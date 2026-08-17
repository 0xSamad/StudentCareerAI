# StudentCareer AI

Student career platform built on the career-ops engine: job discovery, profile-based matching, tailored CVs, multi-URL apply (Chrome fill — never auto-submit), and application tracking.

## Run locally

```bash
cd web
npm install
npm run dev
```

Open **http://127.0.0.1:3000**

Optional: set `STUDENT_CAREER_AI_ROOT` in `web/.env.local` if project data lives outside the default parent directory.

## Deploy (recommended split)

| Layer | Role |
|-------|------|
| `web/` | Next.js UI + API routes |
| Postgres | Users, opportunities, applications (`DATABASE_URL`) |
| Object storage | Tailored PDFs / apply artifacts |
| Worker VM | Playwright URL-apply jobs (long-running; not serverless) |

See `docs/DEPLOYMENT.md` and `docs/SAAS_LOCAL_SETUP.md` for details.

## Project layout (essentials)

```
student-career-ai/
├── web/                 # StudentCareer AI app (deploy this + lib/)
├── lib/saas/            # Auth, discovery, apply orchestration
├── lib/                 # CV tailoring, matching, engines
├── providers/           # Job board scanners
├── modes/               # Evaluation / apply prompts
├── templates/           # CV templates
├── config/              # Example profile & company lists
├── scripts/verify-*.mjs # Operational health checks
└── tests/               # CI test suite
```

Upstream career-ops CLI docs remain in `README.md` for reference; the product name in this repo is **StudentCareer AI**.
