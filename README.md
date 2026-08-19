# StudentCareer AI

A local student career app: internships and jobs, profile matching, tailored CVs, and guided Apply. **Chrome on your computer** fills attested fields. **You** click Submit. Nothing is sent for you.

Apply must run on the same machine as your files and Google account. That is why this guide is local-only.

---

## What you will have

| You can | What happens |
|---------|----------------|
| Sign up and build a profile | Your GPA, skills, and CV stay in your Postgres |
| Browse internships and jobs | Listings from employer career pages |
| Match scores | Fit vs **your** attested profile — no invented skills |
| Apply from a listing or a pasted URL | Chrome opens on **this PC**, fills what it can, then waits |
| Application Center | Progress bar, tailored CV / cover letter status, pauses (Location, CAPTCHA) |
| Attach / Drive / Dropbox / CAPTCHA | You complete those in the Chrome window that opened |

**Rules:** never invent CV facts. Never auto-submit. Low-fit roles should be skipped.

---

## 1. What you need

Install these **before** cloning:

1. **Node.js 18 or newer** — [https://nodejs.org](https://nodejs.org)
2. **Docker Desktop** — running (green) so Postgres can start  
   [https://www.docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop)
3. **Google Chrome** — Apply opens Chrome on this computer
4. **Git**
5. An **AI API key** (one is enough):  
   [Google AI Studio](https://aistudio.google.com/apikey) (`GEMINI_API_KEY`), or OpenAI, or [OpenRouter](https://openrouter.ai)

Windows, macOS, and Linux all work. Commands below are for a terminal in the repo folder (Git Bash, PowerShell, or macOS Terminal).

---

## 2. Clone the repo

```bash
git clone https://github.com/0xSamad/StudentCareerAI.git
cd StudentCareerAI
```

---

## 3. Create your env files (once)

Do **not** commit these files.

**macOS / Linux / Git Bash:**

```bash
cp config/env.production.example .env
cp config/env.web.local.example web/.env.local
```

**Windows PowerShell:**

```powershell
copy config\env.production.example .env
copy config\env.web.local.example web\.env.local
```

### 3a. Edit `.env` (repo root)

Set at least:

| Variable | What to put |
|----------|-------------|
| `POSTGRES_PASSWORD` | A password you choose (no spaces) |
| `POSTGRES_USER` | Keep `career_prod_user` unless you change it everywhere |
| `POSTGRES_DB` | Keep `student_career_ai_prod` unless you change it everywhere |
| `SESSION_SECRET` | Long random string |
| `JWT_SECRET` | A **different** long random string |
| `CSRF_SECRET` | A **third** long random string |
| `GEMINI_API_KEY` **or** `OPENAI_API_KEY` **or** `OPENROUTER_API_KEY` | Your key |
| `DEFAULT_AI_PROVIDER` | `gemini`, `openai`, or `openrouter` to match the key |
| `APPLY_HEADLESS` | `false` |
| `COOKIE_SECURE` | `false` |

Random secrets (Git Bash / macOS / Linux):

```bash
openssl rand -hex 32
```

On Windows without OpenSSL, use any long random hex/password (64+ characters) for each secret.

Leave other example keys (Stripe, S3, …) as placeholders. You do not need them to run locally.

### 3b. Edit `web/.env.local`

Keep these **exactly**:

```
APPLY_HEADLESS=false
NEXT_PUBLIC_APPLY_LIVE_WINDOW=false
STUDENT_CAREER_AI_ROOT=..
COOKIE_SECURE=false
```

Then copy **the same** `SESSION_SECRET`, `JWT_SECRET`, and `CSRF_SECRET` as in `.env`.

Set `DATABASE_URL` so the web app talks to Postgres on **this computer** (`127.0.0.1`), using the user, password, and database from `.env`:

```
DATABASE_URL=postgresql://career_prod_user:YOUR_POSTGRES_PASSWORD@127.0.0.1:5432/student_career_ai_prod
```

Replace `YOUR_POSTGRES_PASSWORD` with the value of `POSTGRES_PASSWORD`. If you changed user or database name, change them here too.

`APPLY_HEADLESS=false` is required. If it is `true`, Chrome will not open on your desktop and file Attach will not work.

---

## 4. Install and start the database

From the **repo root** (`StudentCareerAI`):

```bash
npm install
npm run saas:setup
```

That starts Postgres in Docker and applies the schema.

If this fails:

- Open **Docker Desktop** and wait until it is running, then run `npm run saas:setup` again.
- If port **5432** is already used, stop other Postgres apps or set `POSTGRES_PORT` in `.env` and use that port in `DATABASE_URL`.

---

## 5. Start the website

```bash
cd web
npm install
npm run dev
```

Leave this terminal open. Open:

**http://127.0.0.1:3000**

The first page load can take a minute while Next.js compiles.

Later days, you only need:

1. Docker Desktop running  
2. `npm run db:up` from the repo root (if Postgres is stopped)  
3. `cd web && npm run dev`

---

## 6. Use the app

### Create your account

1. Open **http://127.0.0.1:3000/signup**
2. Create an account and log in

### Complete your profile

1. Open **Profile**
2. Add your name and the facts you want on applications
3. Upload your **CV** (this is the source of truth — Apply will not invent experience)

Matching and form fill only use what you put here (and in that CV).

### Find roles

1. Open **Internships** or **Jobs** (or the **Dashboard**)
2. Use **Refresh** if the list is empty (needs a completed profile and your AI key)
3. Optionally **Save** roles you care about

### Apply from a listing

1. Click **Apply** on a job or internship card (or Apply inside the job detail)
2. The page scrolls to **Application Center** — progress, tailored CV, cover letter, current stage
3. **Google Chrome** opens on this computer and fills attested fields
4. When it pauses (Location, CAPTCHA, file Attach, Google Drive), finish that step **in Chrome**
5. You click **Submit** yourself. The app never does.

You can also tick several listings and use the toolbar apply action — each URL is its own application in Application Center.

### Apply from a pasted URL

1. On Dashboard, Jobs, or Internships, use **APPLY TO JOBS**
2. Paste one or more full job/application URLs
3. Click **Start Applying**
4. Watch **Application Center** the same way as listing Apply

---

## 7. Daily commands

| Command | Where | What it does |
|---------|--------|----------------|
| `npm run saas:setup` | repo root | First time: Postgres + schema |
| `npm run db:up` | repo root | Start Postgres again |
| `npm run db:down` | repo root | Stop Postgres |
| `cd web && npm run dev` | `web/` | Run the site at http://127.0.0.1:3000 |

Never commit `.env` or `web/.env.local`.

---

## 8. If something goes wrong

| Problem | What to try |
|---------|-------------|
| `saas:setup` / Docker error | Start Docker Desktop, wait, retry |
| Site will not load | Confirm `npm run dev` is still running; use **127.0.0.1:3000**, not another host |
| Login forgotten after restart | `DATABASE_URL` in `web/.env.local` must match Postgres password; restart `npm run dev` after env edits |
| Apply does not open Chrome | Install Google Chrome; `APPLY_HEADLESS=false` in `web/.env.local`; run `npm run dev` from `web/` |
| Chrome opens but Attach / Drive fails | Use the **Chrome window Apply opened**, not only the website tab |
| “Complete your profile” | Add name + CV on Profile, then Apply again |
| Progress bar only on pasted URLs | Refresh the page; listing **Apply** should scroll to Application Center |

---

## Safety

- The agent **fills** forms. **You** submit.
- CAPTCHA, passwords, and legal checkboxes stay with you.
- Keywords are rephrased from your CV. They are never fabricated.

---

## License

MIT — see [LICENSE](LICENSE).
