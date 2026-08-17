# Opportunity Storage Architecture

StudentCareer AI persists every real job or internship it discovers. The
pipeline is:

```
FETCH → NORMALIZE → DEDUPLICATE → PERSIST → SERVE FROM DATABASE → INCREMENTAL REFRESH
```

The database is the primary source for opportunities shown in the app. Opening
the Jobs or Internships page **never** triggers an external scan — pages read
saved rows. External discovery (Adzuna, Pakistan Top 100 career sites,
international Top 100 career sites, ATS feeds) runs as a separate background
operation.

## Components

| Piece | Location |
|-------|----------|
| Normalization, dedupe keys, content hash | `lib/saas/opportunity-store/opportunity-record.mjs` |
| In-memory store (offline dev/tests) | `lib/saas/opportunity-store/memory-store.mjs` |
| Postgres store | `lib/saas/opportunity-store/pg-store.mjs` |
| Discovery bridge (dual-write) | `lib/saas/opportunity-store/dual-write.mjs` |
| Schema + backfill | `lib/saas/database/migrations/011_opportunity_store.sql` |
| Container wiring (`container.opportunityStore`) | `lib/saas/saas-container.mjs` |
| Read API | `web/src/app/api/v1/opportunities/route.ts` |
| Saved-state API | `web/src/app/api/v1/opportunities/saved/route.ts` |
| Tests | `tests/opportunity-store.test.mjs` |

## Global vs user data

**Global — `opportunity_store`.** One row per real-world listing, shared by all
users. A Google internship discovered once is stored once; it is never
re-fetched separately for every user.

**User-specific — `saved_opportunities`.** A user's relationship to a global
opportunity: `SAVED`, `IGNORED`, `APPLIED`, or `HIDDEN`
(`UNIQUE (user_id, opportunity_id)`). User A applying never changes what user B
sees; user B hiding a listing hides it only for user B. Application artifacts
and queue state continue to live in the existing `applications` table.

## Opportunity record

Each `opportunity_store` row carries:

`id`, `source`, `sourceType` (`API` / `ATS` / `CAREERS_PAGE` / `WEB_SEARCH` /
`MANUAL` / `UNKNOWN`), `sourceId`, `sourceUrl`, `applicationUrl`, `company`,
`title`, `description`, `location`, `country`, `opportunityType`
(`INTERNSHIP` / `JOB` / `OTHER` / `UNKNOWN`), `employmentType`, `remote`,
`postedAt`, `deadline`, `salary`, `rawData` (original payload, JSONB),
`contentHash`, `firstDiscoveredAt`, `lastSeenAt`, `lastCheckedAt`, `status`
(`ACTIVE` / `EXPIRED` / `CLOSED` / `REMOVED` / `UNKNOWN`), `isActive`,
`createdAt`, `updatedAt` — plus the internal `dedupeKey` and `urlKey`.

## Deduplication

`normalizeOpportunity()` produces a deterministic `dedupeKey`:

1. **`src:{source}:{sourceId}`** when both are present — the same requisition
   seen again through the same source is always the same key.
2. **`url:{normalizedUrl}`** otherwise — the application/source URL lowercased,
   with query string, fragment, and trailing slashes stripped (tracking
   parameters like `?utm_source=` do not create duplicates).
3. **`fp:{sha256(company|title|location)}`** as a last resort, over normalized
   (lowercased, punctuation-collapsed) text.

On upsert the store matches by `dedupeKey` **or** `urlKey`, so the same job
arriving via Adzuna and via the employer's careers page still collapses into
one row.

**Re-fetching an existing listing never creates a record.** It updates:

- `lastSeenAt`, `lastCheckedAt` — always
- `description`, `salary` — when `contentHash` changed
- `deadline` — when newly provided
- `status` / `isActive` — when the source reports a change (e.g. `EXPIRED`)

`firstDiscoveredAt` is never overwritten. Old listings are never deleted by a
scan; expiry is a status change, not a row removal.

## Write path (discovery)

The scan (`web/src/app/api/opportunities/scan/route.ts`) wraps the per-tenant
repository with `createDualWriteRepository({ repository, store })`, so every
listing saved by any discovery module also lands in the global store — no
discovery module needed changes. When an incremental scan skips a URL it
already knows, `saveDiscoveredListing` calls `noteSeen(url)`, which bumps
`lastSeenAt`/`lastCheckedAt` in the global store (`touchSeenByUrl`).

## Read path (serving)

`GET /api/v1/opportunities` reads from the database only. Filters:

```
type=INTERNSHIP|JOB|OTHER|UNKNOWN   search=<text>      country=<text>
remote=true|false                   status=ACTIVE|…    savedOnly=true
includeHidden=true                  includeInactive=true
limit=<n> offset=<n>
```

Rows come back newest-`lastSeenAt` first, each annotated with the caller's
`userState` (`SAVED`/`IGNORED`/`APPLIED`/`HIDDEN` or `null`). `HIDDEN` rows are
excluded unless `includeHidden=true`.

`/api/v1/opportunities/saved`:

- `GET` — list this user's states with the joined opportunity
- `POST {opportunityId, status}` — save / ignore / mark applied / hide
- `DELETE ?opportunityId=…` — unsave (removes the state row)

## Migration & backfill

`011_opportunity_store.sql` creates both tables and backfills the global store
from the pre-existing tenant `opportunities` table using the same dedupe-key
precedence (SQL mirrors the JS normalization), collapsing duplicates across
tenants with `ON CONFLICT (dedupe_key) DO NOTHING`. Run migrations with
`node bin/migrate.mjs`.

When `DATABASE_URL` is unset, the container falls back to
`MemoryOpportunityStore` with the identical contract, so offline dev and tests
run without Postgres.

## Verified behavior (tests/opportunity-store.test.mjs)

- Fetching the same job twice → **one** record; `lastSeenAt` updated;
  `firstDiscoveredAt` unchanged.
- Same URL via a different source → deduplicated.
- Changed description/deadline/status → updated in place, no duplicate.
- One global record serves multiple users; saved/hidden/applied states are
  fully isolated per user.

## Application workflow

Discovery finds opportunities. Application acts on persisted opportunities.
See [APPLICATION_FROM_STORE.md](APPLICATION_FROM_STORE.md).

```
DISCOVER → PERSIST → DISPLAY → SELECT → SAVE TO APPLICATIONS → APPLY
```

The application queue stores `opportunityId` only as source of truth. Apply
re-loads the listing from this store, verifies it is still active (URL,
deadline, liveness), and never starts a discovery scan. Closed/expired rows
are marked `CLOSED` / `EXPIRED` in place — never deleted. User **Save** keeps
the listing on the Saved page even after the source drops it.

