# SaaS local development — Docker + PostgreSQL

## Quick start

**Prerequisites:** Docker Desktop running.

```bash
# 1. Copy secrets (once)
cp config/env.production.example .env
# Edit .env: set POSTGRES_PASSWORD, SESSION_SECRET, JWT_SECRET, CSRF_SECRET, GEMINI_API_KEY

# 2. Mirror DATABASE_URL + auth secrets into web/.env.local

# 3. Start Postgres + apply schema
npm run saas:setup

# 4. Run the web app
cd web && npm run dev
```

Open http://localhost:3000/signup — accounts persist in **PostgreSQL**, survive restarts.

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
