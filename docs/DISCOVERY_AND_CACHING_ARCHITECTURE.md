# Discovery and Caching Architecture

StudentCareer AI separates **discovery** from **application**. External sources
are fetched only when the backend scheduler (or a rate-limit-respecting
manual refresh) says a source is due. The UI always reads the database.

```
                 ┌── Adzuna
                 ├── ATS portals
Scheduler ───────┼── Company portals
                 └── Other sources
                       │
                       ▼
                  Fetch NEW
                  / UPDATED
                       │
                       ▼
                  Normalize
                       │
                       ▼
                  Deduplicate
                       │
                       ▼
              ┌─────────────────┐
              │ Opportunity DB  │
              │                 │
              │ Google Intern   │
              │ Microsoft Intern│
              │ Jazz Intern     │
              │ ...             │
              └────────┬────────┘
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
         User Search          User Saved
             │                   │
             └─────────┬─────────┘
                       ▼
                Select 5 Jobs
                       │
                       ▼
               Application Queue
                       │
                       ▼
                   Apply All
                       │
                       ▼
            AI Application Agent
```

The backend scheduler (`ensureDiscoveryPipeline`) is the only process that
fetches Adzuna, ATS feeds, company career pages, and other sources. Each tick
asks which sources are due, then fetches **new and updated** listings only.
Opening Dashboard, Jobs, Internships, or Search **never** calls those APIs.
`AutoScanRunner` is a no-op. Search and Saved filter the Opportunity DB.
Select → Add to Applications stores `opportunityId` only. Apply All hydrates
from that id and runs the AI application agent — no discovery scan.

Companion docs: [OPPORTUNITY_STORAGE.md](OPPORTUNITY_STORAGE.md),
[INCREMENTAL_DISCOVERY.md](INCREMENTAL_DISCOVERY.md),
[SOURCE_CACHE.md](SOURCE_CACHE.md),
[APPLICATION_FROM_STORE.md](APPLICATION_FROM_STORE.md),
[DISCOVERY_METRICS.md](DISCOVERY_METRICS.md).

## Database schema

| Table | Role |
|-------|------|
| `opportunity_store` (migration `011`) | **Global** listing: one row per real-world job/internship. Shared by every user. |
| `saved_opportunities` (`011`) | Per-user bookmark: `SAVED` / `IGNORED` / `APPLIED` / `HIDDEN`. |
| `opportunities` | Per-tenant feed copy (dual-write). Apply hydrates from the global store first. |
| `applications` (`004`/`005`) | Per-user queue. Source of truth for apply is `opportunity_id`, not a copied blob. |
| `discovery_state` (`012`/`013`) | Per-source cursor, last success, 429/backoff, last new/updated counts. |
| `source_cache` (`013`) | Per-query fingerprint: ETag, Last-Modified, `next_fetch_at`, result count. |

`opportunity_store` columns that matter for lifecycle:

`id`, `dedupe_key`, `url_key`, `source`, `source_id`, `application_url`,
`company`, `title`, `description`, `first_discovered_at`, `last_seen_at`,
`last_checked_at`, `status` (`ACTIVE`/`EXPIRED`/`CLOSED`/`REMOVED`/`UNKNOWN`),
`is_active`.

Rows are **never deleted** by a scan. Closed postings are a status change.

## Opportunity lifecycle

```
FETCH → NORMALIZE → DEDUPLICATE → PERSIST → SERVE FROM DATABASE → INCREMENTAL REFRESH
```

1. An adapter (Adzuna, Pakistan Top 100 careers pages, international Top 100,
   ATS round-robin) returns raw listings.
2. `normalizeOpportunity()` produces a canonical record and `dedupe_key`.
3. `opportunityStore.upsert()` matches by `dedupe_key` or `url_key`.
4. New → insert (`isNew: true`). Same listing → bump `lastSeenAt` /
   `lastCheckedAt`; if `contentHash` changed, update description/deadline
   (`changed: true`); otherwise it is a **duplicate** (no second row).
5. The UI lists from `opportunity_store` (`GET /api/opportunities`).
6. Save writes `saved_opportunities` only. Apply writes `applications`
   with `opportunity_id`.

A listing discovered today can be applied tomorrow without another scan.

## Deduplication

Precedence in `lib/saas/opportunity-store/opportunity-record.mjs`:

1. `src:{source}:{sourceId}` when both exist.
2. `url:{normalizedUrl}` (lowercase, no query/fragment/trailing slash).
3. `fp:{sha256(company|title|location)}`.

The same Google internship arriving via Adzuna and via the careers page
collapses to one global row when the URL matches. Re-fetching never inserts
a second row.

## Caching

`source_cache` stores one row per `(sourceId, parametersHash)`.

If the exact query was fetched recently (`next_fetch_at` in the future),
the fetcher is skipped. Search always uses `requested: 'search'`, which
**never** fetches (`neverFetchOnSearch: true` in
`config/discovery-refresh.yml`).

Conditional HTTP: `conditionalFetch()` sends `If-None-Match` /
`If-Modified-Since`. A `304` bumps `last_checked_at` only.

## Incremental discovery

Each source has a `DiscoveryStrategy` (`planFetch`):

| Mode | When |
|------|------|
| `INITIAL` | First successful fetch: bounded historical window (`max_days_old` / overlap). |
| `INCREMENTAL` | After that: `publishedAfter` / `max_days_old` so only new and updated listings are requested. |
| `SKIP` | Source is still fresh, or rate-limited / backing off. **Even `force` cannot bypass rate limits.** |

Career pages without a date API use a conservative overlap window and let
the store dedupe.

Scan metrics (every run):

`fetched`, `normalized`, `new`, `updated`, `duplicates`, `failed`.

## Source scheduling

`ensureGlobalDiscoveryScheduler()` is process-wide. The first tick waits one
interval (`runImmediately: false`). Tick interval defaults to 5 minutes;
each source has its own refresh priority:

| Priority | Scheduler interval | Min even on manual refresh | Sources |
|----------|--------------------|----------------------------|---------|
| high | 30 min | 10 min | ATS round-robin |
| normal | 2 h | 30 min | Adzuna |
| low | 6 h | 2 h | Pakistan / international career sites |

## Rate-limit handling

`SourceRateLimiter` + `fetchWithBackoff` honor `Retry-After` and `429`.
`discovery_state` stores `rate_limit_reset_at`, `backoff_until`,
`last_429_at`, `requests_made`, `requests_remaining`.

Manual **Refresh Opportunities** calls `evaluateRefresh()`. If no source is
due, the API returns `servedFromCache: true` and the existing listings.
Copy: *Fresh data is not available yet. Showing results from X minutes ago.*

## Source health

`GET /api/discovery/status` and `GET /api/opportunities` read only persisted
state. They never fetch Adzuna.

If Adzuna fails (or is disabled) **and** listings already exist, the UI
shows:

> Showing previously discovered opportunities. Adzuna is currently unavailable.

The store is not emptied. When Adzuna recovers, incremental discovery
resumes (`lastPublishedAt` / cache still apply).

## User saved opportunities

`POST /api/v1/opportunities/saved` bookmarks a **global** id. The listing
stays on **Saved** even if the source later drops it. Badges:
`ACTIVE` / `CLOSED` / `EXPIRED`.

User A saving Google does not hide it from User B. User B does not see
User A's `SAVED` flag, notes, CV, or application history.

## Application queue

`POST /api/applications` accepts `{ opportunityIds }` only. The queue row
stores `opportunity_id` plus denormalized company/title for display.
Apply re-loads the listing from `opportunity_store`.

## Application workflow

`Apply` / `Apply Selected` / `Apply All` → `applyQueueItems` →
`ApplicationOrchestrator.processApplication()`:

1. Load persisted opportunity (no scan).
2. Lightweight verify: still active, URL, deadline, liveness.
3. Duplicate submitted application check.
4. Eligibility → matching → candidate knowledge.
5. CV engine (reuse or tailor) and cover letter if required.
6. Browser agent against the **actual** application URL.
7. Validate; submit only when allowed.
8. Record result on `applications`. Closed listings are marked `CLOSED`
   in the store and are not submitted.

## UI

Pipeline status bar:

- Last updated: X minutes ago
- New since last visit: X
- Saved: X
- Applications: X
- **Refresh Opportunities** — “Refresh checks configured sources for new or updated opportunities.”

It does **not** claim the system downloads everything again.
