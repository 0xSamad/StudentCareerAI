# Discovery metrics

Recorded **2026-08-14** against the production discovery engine
(`lib/saas/discovery-engine/engine.mjs`) and Opportunity Store. Numbers are
from real test runs, not invented.

This environment did **not** execute a live Adzuna HTTP crawl for this pass
(no production traffic against Adzuna from the reliability suite). The same
upsert/dedupe/incremental/rate-limit code is what Adzuna and career-site
adapters call. Live Adzuna counts will differ by query, country, and how
many listings were already stored.

Command:

```bash
node tests/discovery-reliability.test.mjs
node tests/incremental-discovery.test.mjs
node tests/source-cache.test.mjs
node tests/application-queue.test.mjs
```

## Discovery test — five internships (fixture board)

Google, Microsoft, Jazz, Systems Limited, Company X.

### FIRST SCAN

```
Fetched: 5
Normalized: 5
New: 5
Updated: 0
Duplicates: 0
Failed: 0
```

Store size after first scan: **5**.

### SECOND SCAN

(one new listing, one description change, four unchanged)

```
Fetched: 6
Normalized: 6
New: 1
Updated: 1
Duplicates: 4
Failed: 0
```

Store size after second scan: **6** (not 11). Previously stored
opportunities were not inserted again.

## Discovery test — incremental window (20-posting fixture)

From `tests/incremental-discovery.test.mjs` (bounded `publishedAfter` window).

### FIRST SCAN

```
Fetched: 20
Normalized: 20
New: 20
Updated: 0
Duplicates: 0
Failed: 0
```

### SECOND SCAN

3 new postings + 2 edited; the fetcher only returned the incremental window
(fewer than 23 items).

```
New: 3
Updated: 2
Store size: 23 (not 43)
```

A third scan inside the refresh interval: **SKIP**, fetcher not called.

## Cache test

| Check | Result |
|-------|--------|
| `listPersistedOpportunitiesForUi` + search `"google"` | Served from `opportunity_store`; external fetch count **0** |
| Identical Adzuna query 10 minutes later | `maybeSkipCachedQuery` → skip |
| `AutoScanRunner` | No-op; does not `POST /api/opportunities/scan` |
| User search (`requested: 'search'`) | Never fetches (`source-cache.test.mjs`) |

Opening the Jobs page uses `GET /api/opportunities`, which reads the store
and discovery **state**. It does not call Adzuna.

## Refresh test

| Check | Result |
|-------|--------|
| Manual refresh while every source is inside its min interval | `evaluateRefresh` → `allowed: false`; message shows cached age |
| Manual refresh while sources are rate-limited | `allowed: false` (rate limits are not bypassed) |
| First-ever refresh (no prior fetch) | `allowed: true` |

`POST /api/opportunities/scan` returns `servedFromCache: true` when denied.

## Application test

| Step | Result |
|------|--------|
| Persist 5 internships | Store count 5 |
| Snapshot + new store (`exportAll` / `importAll`, standing in for a backend restart) | Same 5 ids/URLs |
| Select all → Add to Applications | `addedCount: 5`, `opportunityId` only |
| Apply All | `processed: 5`, discovery scan runs **0**, no fake `SUBMITTED` |

## User test

| Actor | Result |
|-------|--------|
| User A saves Google internship | `saved_opportunities` row for A |
| User B lists the store | Sees the **global** Google listing |
| User B `userState` | `null` (does not inherit A's save) |
| User B application queue | Empty; cannot read A's queue row, notes, or CV |

## Source failure test

Adzuna fetcher threw `"Adzuna is currently unavailable"`.

| Check | Result |
|-------|--------|
| Store after failure | Still **5** listings |
| UI list | Still **5** internships |
| Banner | `Showing previously discovered opportunities. Adzuna is currently unavailable.` |
| Recovery fetch of one new listing | Store **6**; previous five kept |

## Checklist (honest)

What this pass **demonstrated in tests and code**:

- [x] Opportunities persist (store + restart snapshot)
- [x] Duplicates are prevented (second scan did not grow 5→11 or 20→43)
- [x] Incremental scanning works (engine `INITIAL` / `INCREMENTAL` / `SKIP`)
- [x] Cache works (query skip + Jobs list does not fetch)
- [x] Rate limits are respected (manual refresh cannot bypass 429/backoff)
- [x] Source failures do not destroy existing data
- [x] Saved opportunities persist (per-user, listing remains if source drops)
- [x] Application queue persists (`applications.opportunity_id`)
- [x] Application works without a new discovery scan
- [x] Multiple users are isolated (queue, saved state, CV/notes)
- [x] UI is wired to the database (`GET /api/opportunities` store-first)
- [x] Demo listings are not mixed in as real (`includeDemo` defaults false; discovery writes `is_demo: false`)

Not claimed here:

- A live Adzuna production crawl with hundreds of jobs was **not** run in this session. Do not treat the fixture `Fetched: 5` as Adzuna volume.
- End-to-end browser submit against a real employer ATS was **not** part of this reliability pass; the orchestrator path is covered by `tests/application-orchestrator.test.mjs` with mocked pages.
