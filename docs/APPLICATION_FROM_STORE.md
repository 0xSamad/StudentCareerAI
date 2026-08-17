# Application from the Opportunity Store

Discovery and application are **separate systems**.

```
DISCOVER → PERSIST → DISPLAY → SELECT → SAVE TO APPLICATIONS → APPLY
```

A listing that was discovered once lives in the global Opportunity Store. The
student can open it, save it, queue it, and apply tomorrow without running
another discovery scan. The scan ending never deletes persisted opportunities.

## Source of truth

| Concern | Lives in |
|---------|----------|
| The real-world listing | `opportunity_store` (`container.opportunityStore`) |
| Student bookmark | `saved_opportunities` (status `SAVED` / `IGNORED` / `APPLIED` / `HIDDEN`) |
| Application queue | `applications.opportunity_id` → store id |

The queue stores **`opportunityId`**, plus denormalized company/title for the
queue UI. Apply **re-loads** the listing from the store. It does not treat a
copied blob from the last scan as source of truth.

## User flow

1. **Discover (scheduler)** — Adzuna, ATS portals, company portals, and other
   sources are fetched for **new and updated** listings only. Results are
   normalized, deduplicated, and written to the Opportunity DB. Opening a page
   never starts this fetch.
2. **Display** — Jobs, Internships, Dashboard, and Saved read the database
   (`GET /api/opportunities`, `GET /api/v1/opportunities/saved`).
3. **Select** — one or many cards, or **Add 5**. Example: Google, Microsoft,
   Jazz internships → **Add to Applications**.
4. **Save** — bookmark stays in Saved Opportunities even if the source later
   drops the posting. Badges: **ACTIVE**, **CLOSED**, **EXPIRED**.
5. **Apply All** — hydrate each queued id from the store, then run the AI
   application agent. No discovery scan.

## Apply-time checks

Before submit, the system:

1. Loads the persisted opportunity (`getById`, then `getByUrl`).
2. Confirms it is still `ACTIVE`.
3. Confirms an application URL exists.
4. Confirms the deadline has not passed.
5. Checks for a duplicate submitted application.
6. Runs eligibility, matching, candidate context, CV, cover letter, form fill,
   validation, and (when allowed) submit — `ApplicationOrchestrator`.
7. Records the result on the queue row.

Stale listings are **not deleted**. Apply bumps `lastCheckedAt`. If the URL is
dead or the posting no longer accepts applications, `status` becomes `CLOSED`
(or `EXPIRED` when the deadline passed) and the workflow **does not submit**.

## API

| Call | Behavior |
|------|----------|
| `POST /api/applications` `{ opportunityIds }` | Enqueue by store id only |
| `POST /api/applications/apply` `{ ids }` or `{ all: true }` | Apply queued items; hydrates from the store |
| `POST /api/opportunities/apply` `{ opportunityId }` | Enqueue-if-needed, then apply that persisted id |
| `POST /api/v1/opportunities/saved` | Bookmark; listing remains if the source disappears |

## Code

- Resolve / map: `lib/saas/opportunity-store/resolve-opportunity.mjs`
- Lightweight verify: `lib/saas/opportunity-store/verify-persisted.mjs`
- Queue + apply: `lib/saas/application-queue.mjs`
  (`enqueueOpportunities`, `applyQueueItems`, `applyPersistedOpportunities`)
