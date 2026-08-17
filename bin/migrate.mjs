#!/usr/bin/env node
/**
 * migrate.mjs — Apply PostgreSQL schema migrations
 *
 * Requires DATABASE_URL. Fails honestly if missing or unreachable.
 */

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PostgresClient } from "../lib/saas/database/postgres-client.mjs";
import { MigrationRunner } from "../lib/saas/database/migration-runner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("[migrate] DATABASE_URL is not set. Refusing to run migrations against a mock client.");
    process.exit(1);
  }

  const client = new PostgresClient({ connectionString: process.env.DATABASE_URL });
  if (client.isMock) {
    console.error("[migrate] PostgresClient is in mock mode. Set a valid DATABASE_URL.");
    process.exit(1);
  }

  const ok = await client.ping();
  if (!ok) {
    console.error("[migrate] Database ping failed (SELECT 1). Is Postgres running and reachable?");
    await client.close().catch(() => {});
    process.exit(1);
  }

  const runner = new MigrationRunner({ client });
  const results = await runner.runMigrations();
  for (const r of results) {
    console.log(`[migrate] ${r.status}: ${r.name}`);
  }
  await client.close();
  console.log("[migrate] Done.");
}

main().catch(async (err) => {
  console.error("[migrate] Fatal:", err.message || err);
  process.exit(1);
});
