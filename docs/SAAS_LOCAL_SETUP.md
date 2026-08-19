# SaaS local development — Docker + PostgreSQL + Chrome on this computer

## Why local

Apply fills employer forms in **Google Chrome on the machine that runs `npm run dev`**. That is how Attach, Dropbox, Google Drive, and reCAPTCHA work. Hosting the site on a cloud VM cannot see files on a visitor's PC.

## Quick start

**Prerequisites:** Docker Desktop, Node 18+, Google Chrome.

```bash
git clone https://github.com/0xSamad/StudentCareerAI.git
cd StudentCareerAI

# 1. Copy secrets (once)
cp config/env.production.example .env
# Edit .env: set POSTGRES_PASSWORD, SESSION_SECRET, JWT_SECRET, CSRF_SECRET,
# and GEMINI_API_KEY or OPENAI_API_KEY / OPENROUTER_API_KEY

# 2. Web app env (Apply must stay headed)
cp config/env.web.local.example web/.env.local
# Mirror DATABASE_URL (use 127.0.0.1, not hostname postgres) and the same secrets.
# Keep APPLY_HEADLESS=false

# 3. Start Postgres + apply schema
npm install
npm run saas:setup

# 4. Run the web app
cd web && npm install && npm run dev
```

Open http://127.0.0.1:3000/signup — accounts persist in **PostgreSQL**. Click **Apply** on a job: Chrome opens on this computer. Nothing is submitted for you.

## Commands

| Command | Action |
|---------|--------|
| `npm run db:up` | Start Postgres container (`docker-compose.dev.yml`) |
| `npm run db:migrate` | Apply SQL migrations |
| `npm run saas:setup` | `db:up` + `db:migrate` |
| `npm run db:down` | Stop Postgres container |
| `npm run db:logs` | Tail Postgres logs |

## Architecture (local)

```
Browser → Next.js (host :3000) → PostgreSQL (Docker :5432)
                ↓
         lib/saas/* (PgUserStore, PgStudentProfileRepository, …)
```

Production deploy uses the same Postgres schema via `docker-compose.production.yml` (full stack: API, workers, frontend). See [DEPLOYMENT.md](./DEPLOYMENT.md).

## Offline fallback

If `DATABASE_URL` is unset, auth falls back to in-memory mode (not for production).  
Set `AUTH_STORE=file` to persist to `data/saas-auth/store.json` without Docker.

## Troubleshooting

- **Docker daemon not running** — open Docker Desktop, wait for “running”, retry `npm run db:up`.
- **Port 5432 in use** — stop local PostgreSQL service or change `POSTGRES_PORT` in `.env`.
- **Login fails after env change** — restart `npm run dev` so the SaaS container reconnects to Postgres.
- **Apply does not open Chrome** — install Google Chrome, keep `APPLY_HEADLESS=false` in `web/.env.local`, and run `npm run dev` (not the production Docker stack). If Chrome is already open with the same profile locked, Apply uses a separate StudentCareer Chrome window.
- **Attach / Google Drive does nothing on the cloud demo** — that browser is on the server. Clone and run locally instead.
