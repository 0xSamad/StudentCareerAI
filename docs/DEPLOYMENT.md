# StudentCareer AI — Production Deployment & Cloud Architecture Guide

## 1. Recommended Initial Startup Architecture (Lean & Scalable)

For an early-stage production launch serving initial cohorts of university students, **do not over-engineer Kubernetes clusters**. 

A single dedicated cloud instance with **Docker Compose** and **Caddy** (for automatic HTTPS/TLS) provides a robust, low-maintenance, and cost-effective foundation ($20–$40/month) that can effortlessly scale to thousands of daily evaluations.

```
                    [ HTTPS Traffic (Port 443) ]
                               │
                               ▼
                ┌───────────────────────────────┐
                │   Caddy Reverse Proxy + SSL   │
                └───────┬───────────────┬───────┘
                        │               │
      ┌─────────────────▼──┐         ┌──▼────────────────┐
      │  Next.js Frontend  │         │    API Gateway    │
      │   (Port 3000)      │         │    (Port 4000)    │
      └────────────────────┘         └──┬───────┬───────┬┘
                                        │       │       │
             ┌──────────────────────────┘       │       └──────────────────────────┐
             ▼                                  ▼                                  ▼
  ┌───────────────────────┐          ┌───────────────────────┐          ┌───────────────────────┐
  │ Background Job Worker │          │  Cron Task Scheduler  │          │    Browser Worker     │
  └──────────┬────────────┘          └──────────┬────────────┘          └──────────┬────────────┘
             │                                  │                                  │
             └──────────────────────────────────┼──────────────────────────────────┘
                                                │
                                                ▼
                                   ┌─────────────────────────┐
                                   │  PostgreSQL Database    │
                                   │       (Port 5432)       │
                                   └─────────────────────────┘
```

---

## 2. Infrastructure Hosting Recommendations

| Provider | Recommended Spec | Est. Monthly Cost | Why It Fits |
|---|---|---|---|
| **Hetzner Cloud (Recommended)** | CPX31 (4 vCPU, 8GB RAM) | ~€15 / month | Unbeatable price-to-performance, fast NVMe, high bandwidth |
| **DigitalOcean** | Basic Droplet (4GB / 2 vCPU) | ~$24 / month | 1-Click Docker image, simple snapshots, managed backups |
| **AWS Lightsail** | 4GB RAM, 2 vCPU Instance | ~$20 / month | Simple flat-rate billing, easy AWS service integration |
| **Railway / Render** | Pro Team Plan | ~$25–$50 / month | Fully managed PaaS deployment if zero-DevOps is preferred |

---

## 3. Containerized Decoupled Services

The stack is composed of 5 decoupled containerized services:

1. **`frontend` (`docker/Dockerfile.frontend`)**: Multi-stage Next.js production web dashboard.
2. **`api` (`docker/Dockerfile.api`)**: Node.js API Gateway handling candidate authentication, routes, and queue dispatch.
3. **`worker` (`docker/Dockerfile.worker`)**: Autonomous job queue processor handling AI matching, CV tailoring, and application generation.
4. **`scheduler` (`docker/Dockerfile.scheduler`)**: Cron daemon triggering periodic ATS portal scans and notification summaries.
5. **`browser-worker` (`docker/Dockerfile.browser-worker`)**: Playwright container executing browser automation in isolated ephemeral sandboxes.
6. **`postgres` (`postgres:16-alpine`)**: Relational database with automated sequential migration init.

---

## 4. Step-by-Step Deployment Guide

### Step 1: Provision Server & Install Docker
On your Ubuntu/Debian server:
```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

### Step 2: Clone Repository & Configure Secrets
```bash
git clone https://github.com/your-org/student-career-ai.git /app/student-career-ai
cd /app/student-career-ai
cp config/env.production.example .env
```

Generate secure cryptographic keys and fill `.env`:
```bash
# Generate 64-char secrets
openssl rand -hex 32
```
Edit `.env` and set:
- `SESSION_SECRET`, `JWT_SECRET`, `CSRF_SECRET`
- `POSTGRES_PASSWORD`
- `OPENROUTER_API_KEY` or `OPENAI_API_KEY`
- `STRIPE_SECRET_KEY` (if billing enabled)

### Step 3: Launch Production Stack
```bash
docker compose -f docker-compose.production.yml up -d --build
```

### Step 4: Verify Service Health & Readiness
```bash
# Liveness Probe
curl http://localhost:4000/healthz

# Readiness Probe
curl http://localhost:4000/readyz
```

---

## 5. Reverse Proxy & SSL Setup (Caddy)

Install Caddy for automatic Zero-Config Let's Encrypt SSL certificates:
```caddy
# /etc/caddy/Caddyfile
app.studentcareer.ai {
    reverse_proxy localhost:3000
}

api.studentcareer.ai {
    reverse_proxy localhost:4000
}
```
Reload Caddy:
```bash
sudo systemctl reload caddy
```

---

## 6. Backup & Disaster Recovery Strategy

Automate daily database snapshots:
```bash
# Daily Cron at 02:00 UTC
0 2 * * * docker exec studentcareer-postgres pg_dump -U career_prod_user student_career_ai_prod | gzip > /backups/db_$(date +\%F).sql.gz
```

---

## 7. Scaling Roadmap

```
[ Phase 1: Startup (0 - 5,000 Users) ]
Single 8GB VM running docker-compose.production.yml ($20/mo)

[ Phase 2: Growth (5,000 - 50,000 Users) ]
Separate Managed Postgres (e.g. AWS RDS / Neon / Supabase) + 2x Worker Nodes

[ Phase 3: Scale (50,000+ Users) ]
AWS ECS Fargate / Kubernetes with autoscaling worker pods and SQS queue
```
