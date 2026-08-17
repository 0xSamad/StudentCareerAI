# StudentCareer AI — web app

Next.js UI and API for **StudentCareer AI**: internships, jobs, profile, tailored CVs, and guided URL apply.

## Quick start

Requires Node 18+.

```bash
cd web
npm install
npm run dev
```

Open **http://127.0.0.1:3000**

The app uses the repo root (parent of `web/`) for `lib/`, `providers/`, and config. Optional: set `STUDENT_CAREER_AI_ROOT` in `.env.local` if the root is elsewhere.

For persistent login, set `DATABASE_URL` (see [../docs/SAAS_LOCAL_SETUP.md](../docs/SAAS_LOCAL_SETUP.md)).

## Safety

- **Never auto-submits.** Chrome fill stops before Submit.
- Secrets stay in `.env` / `.env.local` — never commit them.

## Production

Deploy with the repo-root compose file:

```bash
docker compose -f ../docker-compose.production.yml up -d --build
```

See [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md).
