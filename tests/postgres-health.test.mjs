// tests/postgres-health.test.mjs — Honest Postgres ping / readiness semantics
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "path";
import { pathToFileURL } from "url";
import { ROOT } from "./helpers.mjs";

const CLIENT_MOD = pathToFileURL(join(ROOT, "lib/saas/database/postgres-client.mjs")).href;
const LIFECYCLE_MOD = pathToFileURL(join(ROOT, "lib/saas/lifecycle/service-lifecycle.mjs")).href;
const SAAS_MOD = pathToFileURL(join(ROOT, "lib/saas/saas-container.mjs")).href;

describe("postgres health honesty", () => {
  it("ping is unhealthy without DATABASE_URL (mock client)", async () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const { PostgresClient } = await import(CLIENT_MOD);
      const client = new PostgresClient({ connectionString: null });
      assert.equal(client.isMock, true);
      const ok = await client.ping();
      assert.equal(ok, false);
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
    }
  });

  it("ping is unhealthy with an invalid DATABASE_URL", async () => {
    const { PostgresClient } = await import(CLIENT_MOD);
    const client = new PostgresClient({
      connectionString: "postgresql://no_such_user:bad@127.0.0.1:1/no_such_db",
    });
    assert.equal(client.isMock, false);
    const ok = await client.ping();
    assert.equal(ok, false);
    await client.close();
  });

  it("getReadiness reports database UNHEALTHY and ready=false without real DB", async () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const { SaaSContainer } = await import(SAAS_MOD);
      const { ServiceLifecycle } = await import(LIFECYCLE_MOD);
      const container = new SaaSContainer({ databaseUrl: null });
      const lifecycle = new ServiceLifecycle({ container });
      const live = lifecycle.getLiveness();
      const ready = await lifecycle.getReadiness();
      assert.equal(live.status, "OK");
      assert.equal(live.alive, true);
      assert.equal(ready.ready, false);
      assert.match(String(ready.checks.database), /UNHEALTHY/);
      assert.notEqual(ready.checks.database, "HEALTHY");
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
    }
  });
});
