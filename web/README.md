# StudentCareer AI — web app

Next.js UI and API for **StudentCareer AI**: internships, jobs, profile, tailored CVs, and guided URL apply.

## Quick start (your computer)

Requires **Node 18+**, **Docker Desktop** (for Postgres), and **Google Chrome**.

Apply runs Chrome **on this computer**, so Attach, Google Drive, Dropbox, and CAPTCHA work with your files and accounts. A cloud server cannot do that.

```bash
# from the repo root
cp config/env.production.example .env
# edit .env: POSTGRES_PASSWORD, SESSION_SECRET, JWT_SECRET, CSRF_SECRET, and an AI key

cp config/env.web.local.example web/.env.local
# copy DATABASE_URL + the same secrets into web/.env.local
# keep APPLY_HEADLESS=false

npm install
npm run saas:setup
cd web && npm install && npm run dev
```

Open **http://127.0.0.1:3000** — sign up, complete your profile (including a CV), then click **Apply** on a listing. Chrome should appear on your desktop. You still click Submit.

Full steps: [../docs/SAAS_LOCAL_SETUP.md](../docs/SAAS_LOCAL_SETUP.md)

## Safety

- **Never auto-submits.** Chrome fill stops before Submit.
- Secrets stay in `.env` / `.env.local` — never commit them.

## Production (server)

Headless Chromium on a VM cannot open your local files or your Google Drive. Use local setup above for Apply. Production compose is only for hosting the site:

```bash
docker compose -f ../docker-compose.production.yml up -d --build
```

See [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md).
