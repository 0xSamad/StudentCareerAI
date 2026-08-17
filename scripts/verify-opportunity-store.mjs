// scripts/verify-opportunity-store.mjs — one-shot check against the real DB:
// same job upserted twice → one row, lastSeenAt updated. Cleans up after itself.
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgresClient } from '../lib/saas/database/postgres-client.mjs';
import { PgOpportunityStore } from '../lib/saas/opportunity-store/pg-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const client = new PostgresClient({ connectionString: process.env.DATABASE_URL });
if (client.isMock) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const store = new PgOpportunityStore(client);
const testUrl = `https://example.com/careers/verify-store-${Date.now()}`;
const job = {
  title: 'Verification Intern',
  company: 'StoreCheck Inc',
  url: testUrl,
  source_name: 'verify-script',
  description: 'Round-trip check.',
};

const backfilled = await store.count();
console.log(`rows in opportunity_store after backfill: ${backfilled}`);

const first = await store.upsert(job);
console.log(`first upsert: isNew=${first.isNew} id=${first.opportunity.id}`);
await new Promise((r) => setTimeout(r, 1100));
const second = await store.upsert(job);
console.log(`second upsert: isNew=${second.isNew} sameId=${second.opportunity.id === first.opportunity.id}`);
console.log(
  `lastSeenAt advanced: ${new Date(second.opportunity.lastSeenAt) > new Date(first.opportunity.lastSeenAt)}`
);
console.log(
  `firstDiscoveredAt stable: ${String(second.opportunity.firstDiscoveredAt) === String(first.opportunity.firstDiscoveredAt)}`
);

const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM opportunity_store WHERE url_key LIKE $1`, [
  `%verify-store-%`,
]);
console.log(`verification rows in table: ${rows[0].n} (expected 1)`);

await client.query(`DELETE FROM opportunity_store WHERE source = 'verify-script'`);
await client.close();
console.log('cleanup done');
