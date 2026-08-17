/**
 * honesty-guards.test.mjs — Ensures dry-run never claims submission and
 * discovery never injects demo jobs into the production path by default.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QUEUE_STATES, SUBMITTED_STATES, PREPARED_STATES } from "../lib/application-manager.mjs";
import { JobDiscoveryService, MockJobSource } from "../lib/saas/discovery/discovery-service.mjs";
import { ServiceLifecycle } from "../lib/saas/lifecycle/service-lifecycle.mjs";
import { PostgresClient } from "../lib/saas/database/postgres-client.mjs";
import { DEFAULT_CONFIG } from "../lib/autonomous-pipeline.mjs";

describe("honesty guards", () => {
  it("AUTO_SUBMIT defaults to false", () => {
    assert.equal(DEFAULT_CONFIG.AUTO_SUBMIT, false);
  });

  it("DRY_RUN / PREPARED are not submitted states", () => {
    assert.equal(SUBMITTED_STATES.has(QUEUE_STATES.DRY_RUN), false);
    assert.equal(SUBMITTED_STATES.has(QUEUE_STATES.PREPARED), false);
    assert.equal(PREPARED_STATES.has(QUEUE_STATES.DRY_RUN), true);
    assert.equal(SUBMITTED_STATES.has(QUEUE_STATES.SUBMITTED), true);
  });

  it("JobDiscoveryService does not register mock sources by default", async () => {
    const svc = new JobDiscoveryService();
    const results = await svc.discoverAll({});
    assert.equal(results.length, 0);
  });

  it("MockJobSource marks fixtures as demo", async () => {
    const mock = new MockJobSource();
    const opps = await mock.fetchOpportunities();
    assert.ok(opps.length >= 1);
    for (const opp of opps) {
      assert.equal(opp.is_demo, true);
      assert.match(String(opp.url), /example\.com|demo/i);
    }
  });

  it("readiness is UNHEALTHY without a real database", async () => {
    delete process.env.DATABASE_URL;
    const client = new PostgresClient();
    assert.equal(client.isMock, true);
    const lifecycle = new ServiceLifecycle({
      container: { postgresClient: client, profileRepository: {}, storageService: {}, workerPool: {} },
    });
    const ready = await lifecycle.getReadiness();
    assert.equal(ready.ready, false);
    assert.match(String(ready.checks.database), /UNHEALTHY|NOT_CONFIGURED|MOCK/i);
  });
});
