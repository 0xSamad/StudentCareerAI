# StudentCareer AI

**Student career platform** for internships and early-career jobs: discovery, profile matching, tailored CVs, guided URL apply (Chrome fills the form — **never auto-submits**), and application tracking.

This is the product in this repo. The web app lives in `web/`. Clone, run locally, or deploy with Docker.

---

## What it does

| Feature | What students get |
|---------|-------------------|
| **Sign up / profile** | Per-student accounts, GPA, graduation, skills, CV |
| **Internships & jobs** | Listings from employer career pages and ATS boards |
| **Match scoring** | Fit vs the student’s attested profile — no invented skills |
| **Tailored CV / cover letter** | Keywords rephrased from the CV, never fabricated |
| **URL apply** | Opens the posting in Chrome, fills fields, **stops before Submit** |
| **Tracker** | Saved roles, applications, review artifacts |
| **Role analyzer** | Skill-gap and weekly plan from real postings + the student’s profile |

**Safety:** the agent fills forms; the student clicks Submit. CAPTCHAs stay with the human.

---

## Quick start (local)

Requires **Node.js 18+**.

```bash
git clone https://github.com/0xSamad/StudentCareerAI.git
cd StudentCareerAI
npm install
cd web && npm install && npm run dev
```

Open **http://127.0.0.1:3000**

**Apply:** Google Chrome must be installed. On local `npm run dev`, Chrome opens on this computer so you can attach files and complete CAPTCHA. The student still clicks Submit.

Sign up, complete a profile, then scan internships / jobs.

### Database (recommended)

Without `DATABASE_URL`, auth can fall back to in-memory (lost on restart). For persistent accounts:

```bash
# Docker Desktop running
cp config/env.production.example .env
# Set POSTGRES_PASSWORD, SESSION_SECRET, JWT_SECRET, CSRF_SECRET, and an AI key
npm run saas:setup
cd web && npm run dev
```

See [docs/SAAS_LOCAL_SETUP.md](docs/SAAS_LOCAL_SETUP.md).

---

## Deploy

**Full stack** (UI + Postgres + workers + Playwright apply) needs a **VM**, not Vercel-only.

```bash
git clone https://github.com/0xSamad/StudentCareerAI.git /app/student-career-ai
cd /app/student-career-ai
cp config/env.production.example .env
# Fill secrets — never commit .env
docker compose -f docker-compose.production.yml up -d --build
```

| Guide | When |
|-------|------|
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production Docker + Caddy / HTTPS |
| [docs/SAAS_LOCAL_SETUP.md](docs/SAAS_LOCAL_SETUP.md) | Local Postgres |

**Free-tier demo VM:** Oracle Cloud Always Free ARM (`VM.Standard.A1.Flex`, Ubuntu **aarch64**), public subnet + Internet Gateway, ports **22 / 80 / 443 / 3000**.

---

## Environment

Copy `config/env.production.example` → `.env` (gitignored). Minimum:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` / `JWT_SECRET` / `CSRF_SECRET` | Auth (`openssl rand -hex 32`) |
| `OPENAI_API_KEY` or `GEMINI_API_KEY` or `OPENROUTER_API_KEY` | Matching / tailoring |
| `DEFAULT_AI_PROVIDER` | e.g. `openai` or `gemini` |

Do not commit `.env` or `web/.env.local`.

---

## Project layout

```
student-career-ai/
├── web/                      # Next.js app (UI + API)
├── lib/saas/                 # Auth, discovery, apply orchestration
├── lib/                      # Matching, CV tailoring
├── providers/                # ATS / job-board scanners
├── modes/                    # Evaluation and apply instructions
├── templates/                # CV HTML / LaTeX templates
├── config/                   # Example env, portals, student lists
├── docker-compose.production.yml
├── docker-compose.dev.yml    # Postgres for local SaaS
└── tests/                    # Test suite
```

Agent skill entrypoint: `.agents/skills/student-career-ai/SKILL.md`  
(also under `.cursor/skills/student-career-ai/`, `.claude/skills/student-career-ai/`, …)

---

## Commands

| Command | Action |
|---------|--------|
| `cd web && npm run dev` | Local web app |
| `npm run saas:setup` | Start Postgres + migrate |
| `npm run db:migrate` | Apply SQL migrations |
| `npm run docker:prod` | Production compose up |
| `node demo-capstone.mjs` | Capstone DRY-RUN demo (if present) |

---

## Docs

- [Capstone demo](docs/CAPSTONE_DEMO.md)
- [Architecture / differentiation](docs/PROJECT_DIFFERENTIATION.md)
- [Deployment](docs/DEPLOYMENT.md)
- [SaaS local setup](docs/SAAS_LOCAL_SETUP.md)
- [Web app](web/README.md)

---

## Principles

1. **Never invent CV facts.** Reorder and rephrase only what the student attested.
2. **Never auto-submit** applications.
3. **Quality over volume.** Low-fit roles should be skipped, not blasted.

---

## License

MIT — see [LICENSE](LICENSE).
