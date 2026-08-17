# Source cache and discovery scheduler

How StudentCareer AI avoids hitting external job APIs when a user opens the
app, searches, or refreshes the browser.

Companion documents:

- [OPPORTUNITY_STORAGE.md](OPPORTUNITY_STORAGE.md) — global Opportunity Store
- [INCREMENTAL_DISCOVERY.md](INCREMENTAL_DISCOVERY.md) — initial vs incremental fetch windows

## Order of operations

```
1. DATABASE / SOURCE CACHE     always, on every page load and search
2. EXTERNAL SOURCE             only when the backend says a source is due
3. SCHEDULER                   process-wide; ticks due sources on an interval
```

Opening Dashboard, Jobs, or Internships, refreshing the browser, or typing a
search **never** starts an external scan. `AutoScanRunner` is a no-op.

## SourceCache

One row per `(sourceId, parametersHash)` in `source_cache` (migration 013):

| Field | Role |
|-------|------|
| sourceId, query, country, opportunityType | What was asked |
| parametersHash | Deterministic fingerprint of those fields |
| lastFetchedAt / lastCheckedAt / nextFetchAt | Freshness window |
| resultCount | How many listings that query returned |
| etag / lastModified | Conditional HTTP (If-None-Match / If-Modified-Since) |
| cursor | Resume point when the source supports it |
| status | `ok` · `not_modified` · `rate_limited` · `error` |

If the exact query was fetched recently (`nextFetchAt` in the future), the
fetcher is skipped and the UI is served from PostgreSQL.

Adzuna queries are cached per `(country, query, opportunityType, page)`.
Employer career pages are cached per company URL.

## Refresh policy

Configurable in `config/discovery-refresh.yml` (env overrides
`DISCOVERY_INTERVAL_{HIGH,NORMAL,LOW}_MS` and `DISCOVERY_MIN_REFRESH_*_MS`):

| Priority | Interval (scheduler) | Minimum even on manual refresh | Sources |
|----------|----------------------|--------------------------------|---------|
| high | 30 minutes | 10 minutes | ATS round-robin |
| normal | 2 hours | 30 minutes | Adzuna |
| low | 6 hours | 2 hours | Pakistan / international career sites |

`canRefresh()` and `evaluateRefresh()` are the gates. Manual Refresh does
**not** blindly bypass them.

## Manual refresh

Before an external fetch the API checks last fetch time, rate-limit /
backoff state, source policy, and the minimum refresh interval.

If refresh is not allowed:

```
HTTP 200
servedFromCache: true
refreshAllowed: false
message: "Fresh data is not available yet. Showing results from 12 minutes ago."
```

The existing listings stay on screen. A `[Refresh]` control remains visible
so the user can retry later.

## User search

Searching "software engineering internship" filters the database. It does
not call Adzuna. The page shows `Last updated: 12 minutes ago`.

## ETag / Last-Modified

`conditionalFetch()` sends `If-None-Match` and `If-Modified-Since` when the
cache has them. A `304 Not Modified` does **not** reprocess opportunities;
only `lastCheckedAt` is updated (`touchChecked`).

## Rate-limit state

On `discovery_state` (per source, not per user):

`requestsMade` · `requestsRemaining` · `rateLimitResetAt` · `last429` · `backoffUntil`

HTTP 429 is never retried through. Retry-After is honored; otherwise
exponential backoff. `canRefresh` and `planFetch` skip the source until
`backoffUntil` passes — even on a forced manual refresh.

## Backend scheduler

`ensureGlobalDiscoveryScheduler()` starts once per process (survives HMR).
The first tick waits one interval, so booting the timer from a page-load
GET does not immediately scan. Each tick runs incremental discovery with
`force: false`, so fresh and rate-limited sources cost zero HTTP.

## Dashboard

`GET /api/discovery/status` (database only) powers:

- Last discovery: 10 minutes ago
- New opportunities: 17
- Updated: 5
- Sources healthy: 87/100
- Sources currently rate limited: 3

## Tests

```bash
node tests/source-cache.test.mjs
node tests/incremental-discovery.test.mjs
```
