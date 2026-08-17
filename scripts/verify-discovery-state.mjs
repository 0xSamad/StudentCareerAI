// scripts/verify-discovery-state.mjs — one-shot check against the real DB:
// per-source discovery state round-trip (attempt → success → failure →
// rate-limit reset), plus planFetch reading the persisted row. Cleans up.
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgresClient } from '../lib/saas/database/postgres-client.mjs';
import { PgDiscoveryStateStore } from '../lib/saas/discovery-engine/discovery-state-store.mjs';
import { STRATEGIES, planFetch } from '../lib/saas/discovery-engine/discovery-strategy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const client = new PostgresClient({ connectionString: process.env.DATABASE_URL });
if (client.isMock) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const store = new PgDiscoveryStateStore(client);
const sourceId = `verify-state-${Date.now()}`;

console.log(`empty state: ${await store.get(sourceId)}`);

await store.recordAttempt(sourceId);
const afterAttempt = await store.get(sourceId);
console.log(`attempt recorded: lastAttemptAt=${!!afterAttempt.lastAttemptAt} lastSuccess=${afterAttempt.lastSuccessfulFetchAt}`);

await store.recordSuccess(sourceId, {
  lastPublishedAt: '2026-08-14T09:00:00Z',
  lastPage: 2,
  lastKnownOpportunityId: 'opp_test_1',
});
const afterSuccess = await store.get(sourceId);
console.log(
  `success recorded: lastSuccess=${!!afterSuccess.lastSuccessfulFetchAt} lastPublishedAt=${new Date(afterSuccess.lastPublishedAt).toISOString()} page=${afterSuccess.lastPage} fetches=${afterSuccess.totalFetches}`
);

// planFetch on the persisted row: just fetched → skip (fresh).
const plan = planFetch(STRATEGIES.adzuna, { ...afterSuccess }, {});
console.log(`plan right after success: mode=${plan.mode} reason=${plan.reason} (expected skip/fresh)`);

await store.recordFailure(sourceId, 'adzuna_429', { rateLimitResetAt: new Date(Date.now() + 3600_000).toISOString() });
const afterFailure = await store.get(sourceId);
console.log(
  `failure recorded: error=${afterFailure.lastError} failures=${afterFailure.consecutiveFailures} resetAt=${!!afterFailure.rateLimitResetAt} lastSuccess kept=${!!afterFailure.lastSuccessfulFetchAt}`
);
const gatedPlan = planFetch(STRATEGIES.adzuna, { ...afterFailure }, { force: true });
console.log(`plan while rate-limited (forced): mode=${gatedPlan.mode} reason=${gatedPlan.reason} (expected skip/rate_limited)`);

await client.query(`DELETE FROM discovery_state WHERE source_id = $1`, [sourceId]);
await client.close();
console.log('cleanup done');
