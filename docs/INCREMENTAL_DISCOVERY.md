# Incremental Discovery

How StudentCareer AI fetches jobs and internships from external sources
without repeatedly downloading the same listings.

Companion documents:

- [OPPORTUNITY_STORAGE.md](OPPORTUNITY_STORAGE.md) — global Opportunity Store
- [SOURCE_CACHE.md](SOURCE_CACHE.md) — query cache, refresh policy, backend scheduler

## The model

```
INITIAL DISCOVERY      first time a source is configured:
                       fetch a controlled historical window (7/14/30 days)
                       → normalize → deduplicate → persist

INCREMENTAL DISCOVERY  every subsequent scan asks:
                       "what changed since our last successful fetch?"
                       → fetch only new/updated listings → persist the diff

SKIP                   source fetched within its refresh interval, or
                       rate-limited → serve from the database, zero API calls
```

After the initial import, the database is the primary opportunity store. The
frontend reads `GET /api/v1/opportunities` (database only) and never decides
whether a scan is needed — the backend does.

## Modules

All engine code lives in `lib/saas/discovery-engine/`:

| File | Purpose |
|------|---------|
| `discovery-strategy.mjs` | `DiscoveryStrategy` (per-source capabilities) + `planFetch()` (chooses initial / incremental / skip) |
| `discovery-state-store.mjs` | Per-source state, memory + Postgres (`discovery_state`, migration 012) |
| `rate-limiter.mjs` | `SourceRateLimiter` (concurrency, spacing, budgets), `fetchWithBackoff` (exponential backoff + jitter), Retry-After parsing |
| `engine.mjs` | `DiscoveryEngine.runSource()` — plan → fetch → dedupe/persist → record |
| `scheduler.mjs` | Backend scheduler: periodic incremental re-runs per user |

## Per-source discovery state

One row per source in `discovery_state` (Postgres) or in memory when no
database is configured:

```
sourceId                 e.g. adzuna, pakistan-top100, international-top100, ats-round-robin
lastSuccessfulFetchAt    anchor for "what changed since?"
lastAttemptAt            last try, successful or not
lastCursor / lastPage    resume points for cursor/page-based sources
lastPublishedAt          newest posting seen — incremental window anchor
lastKnownOpportunityId   newest opportunity created from this source
lastError                last failure message
rateLimitResetAt         source is parked until this time passes
consecutiveFailures      failure streak (reset on success)
totalFetches             successful fetch count
```

## DiscoveryStrategy

Each source declares what it supports; the engine picks the best incremental
mechanism automatically:

```js
new DiscoveryStrategy({
  sourceId: 'adzuna',
  supportsCursor: false,
  supportsPublishedAfter: true,   // max_days_old + sort_by=date cutoff
  supportsUpdatedSince: false,
  supportsPagination: true,
  recommendedRefreshIntervalMs: 6 * HOUR,
  initialWindowDays: 14,          // INITIAL DISCOVERY window
  overlapHours: 24,               // conservative overlap for INCREMENTAL
  maxRequestsPerRun: 40,          // per-source request budget
})
```

`planFetch(strategy, state, { now, force })` decision order:

1. `rateLimitResetAt` in the future → **skip** (`rate_limited`) — even when forced.
2. Fetched within `recommendedRefreshIntervalMs` and not forced → **skip** (`fresh`).
3. No successful fetch yet → **initial** with the historical window.
4. Otherwise **incremental**:
   - cursor if supported and stored,
   - else `published_after` / `updated_since` window: `min(lastPublishedAt, lastSuccessfulFetchAt) − overlap`,
   - else (no incremental API at all) an **overlap window**: re-fetch what the
     source lists now and let the Opportunity Store deduplicate (`dedupeOnly`).

The overlap prevents missed listings: if the last scan was August 14, the next
incremental scan fetches from August 13/14 and the database absorbs the
duplicates.

## Source behavior in this app

| Source | Mechanism | Refresh interval |
|--------|-----------|------------------|
| Adzuna | `max_days_old` + `sort_by=date` + client-side `publishedAfter` cutoff | 6 h |
| Pakistan top-100 careers pages | overlap window + DB dedupe (`knownUrls` + `noteSeen`) | 12 h |
| International top-100 careers pages | overlap window + DB dedupe | 12 h |
| Configured ATS feeds (Greenhouse/Lever/…) | full feed + DB dedupe | 4 h |

Example: the first Adzuna scan imports the last 14 days (say 500 listings).
The second scan asks Adzuna only for postings inside the incremental window;
older postings returned anyway are cut off client-side (`skippedOld`) and the
store persists only the diff — e.g. 12 new, 7 updated (content-hash change),
everything else just gets `lastSeenAt` bumped. No duplicate rows, ever.

## Rate-limit protection

- **Throttling** — `SourceRateLimiter`: per-source concurrency cap, minimum
  spacing between request starts, hard per-run request budget
  (`maxRequestsPerRun` also truncates the Adzuna task list).
- **Exponential backoff** — `fetchWithBackoff`: transient errors retried with
  exponential delay + jitter.
- **Retry-After / 429** — a 429/403 raises `RateLimitError` with the parsed
  `Retry-After`; it is never retried through. The reset time is persisted to
  `discovery_state.rate_limit_reset_at`, and `planFetch` skips the source until
  the window passes — across process restarts.
- **Caching / incremental queries** — the freshness gate itself is the cache:
  requests while a source is fresh cost zero external calls; incremental
  windows keep each fetch small.

## Backend decides, never the frontend

The scan API (`POST /api/opportunities/scan`) consults
`container.discoveryStateStore` on every request:

- **Explicit full scans** (user clicks "Refresh scan") pass `force: true` —
  bypassing the freshness gate but still respecting rate-limit windows.
- **Light / auto-triggered scans** are fully gated: if every source is fresh,
  the request performs no external fetches and the UI is served from the DB.
- **Backend scheduler** (`ensureDiscoveryPipeline` in `global-tick.mjs`):
  process-wide, started at API/Next boot. The first tick waits one interval
  so a page load never fetches. Each tick runs `runGlobalDiscoveryTick`:
  skip when every source is fresh or rate-limited, otherwise fetch **new and
  updated** listings into the global Opportunity Store. Manual Refresh still
  uses dual-write (tenant feed + store). Scheduler ticks persist store-only.

Scan results expose the chosen plan per source in `stats.discovery`, e.g.
`{ adzuna: { mode: 'incremental', reason: 'published_after' } }`, and skipped
sources report `skipped_fresh` / `skipped_rate_limited`.

## Tests and verification

- `tests/discovery-pipeline.test.mjs` — scheduler does not fetch on
  boot/page-open; ticks are incremental (`force: false`, `requested:
  scheduler`); fresh sources skip; store ingest dedupes Google Intern vs
  Microsoft Intern.
- `tests/incremental-discovery.test.mjs` — plan selection (initial /
  incremental / skip / force / rate-limited), state round-trips, backoff and
  budget behavior, and the core FIRST SCAN vs SECOND SCAN check: 20 listings
  imported initially; after 3 new + 2 edited postings upstream, the second
  scan fetches only the incremental window and persists exactly 3 new + 2
  updated — 23 rows total, not 43. A third scan inside the refresh interval
  performs zero fetches.
- `scripts/verify-discovery-state.mjs` — one-shot check against the real
  Postgres database: attempt/success/failure round-trip, `skip (fresh)` right
  after a success, `skip (rate_limited)` while a reset window is active.

Run them:

```bash
node tests/incremental-discovery.test.mjs
node scripts/verify-discovery-state.mjs   # needs DATABASE_URL
```
