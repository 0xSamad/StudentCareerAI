/**
 * engine.mjs — Incremental discovery engine.
 *
 * For each source: consult the persisted discovery state, let the strategy
 * plan INITIAL / INCREMENTAL / SKIP, run the fetcher under that plan, persist
 * results through the deduplicating Opportunity Store, and record the outcome
 * (success, failure, or rate-limit reset) back into the state store.
 */

import { planFetch } from './discovery-strategy.mjs';

export class DiscoveryEngine {
  /**
   * @param {object} deps
   * @param {object} deps.opportunityStore — global Opportunity Store (upsert/touchSeenByUrl)
   * @param {object} deps.stateStore — discovery state store (get/recordAttempt/recordSuccess/recordFailure)
   */
  constructor({ opportunityStore, stateStore }) {
    this.opportunityStore = opportunityStore;
    this.stateStore = stateStore;
  }

  /**
   * Run one source through plan → fetch → dedupe/persist → record.
   *
   * @param {object} params
   * @param {import('./discovery-strategy.mjs').DiscoveryStrategy} params.strategy
   * @param {(plan: object) => Promise<{ items?: any[], lastCursor?: string, lastPage?: number,
   *   lastPublishedAt?: string, rateLimitResetAt?: string }>} params.fetcher
   *   — receives the plan; must only return listings the plan asked for.
   * @param {{ now?: string|number|Date, force?: boolean }} [params.options]
   * @returns {Promise<object>} summary: { sourceId, mode, skipped?, reason, newCount, updatedCount, unchangedCount }
   */
  async runSource({ strategy, fetcher, options = {} }) {
    const sourceId = strategy.sourceId;
    const state = await this.stateStore.get(sourceId);
    const plan = planFetch(strategy, state, options);

    if (plan.mode === 'skip') {
      return { sourceId, mode: 'skip', skipped: true, reason: plan.reason, newCount: 0, updatedCount: 0, unchangedCount: 0 };
    }

    const nowIso = options.now ? new Date(options.now).toISOString() : undefined;
    await this.stateStore.recordAttempt(sourceId, { now: nowIso });
    try {
      const result = (await fetcher(plan)) || {};
      const items = Array.isArray(result.items) ? result.items : [];

      let newCount = 0;
      let updatedCount = 0;
      let unchangedCount = 0;
      let failedCount = 0;
      let newestPublishedAt = state?.lastPublishedAt || null;
      let lastKnownOpportunityId = state?.lastKnownOpportunityId || null;

      for (const item of items) {
        try {
          const { opportunity, isNew, changed } = await this.opportunityStore.upsert(item, { now: nowIso });
          if (isNew) {
            newCount += 1;
            lastKnownOpportunityId = opportunity.id;
          } else if (changed) {
            updatedCount += 1;
          } else {
            unchangedCount += 1;
          }
          const published = opportunity.postedAt || null;
          if (published && (!newestPublishedAt || new Date(published) > new Date(newestPublishedAt))) {
            newestPublishedAt = published;
          }
        } catch {
          failedCount += 1;
        }
      }

      await this.stateStore.recordSuccess(sourceId, {
        now: nowIso,
        lastCursor: result.lastCursor ?? null,
        lastPage: result.lastPage ?? null,
        lastPublishedAt: result.lastPublishedAt || newestPublishedAt || null,
        lastKnownOpportunityId,
        rateLimitResetAt: result.rateLimitResetAt || null,
        lastNewCount: newCount,
        lastUpdatedCount: updatedCount,
      });

      return {
        sourceId,
        mode: plan.mode,
        reason: plan.reason,
        fetched: items.length,
        newCount,
        updatedCount,
        unchangedCount,
        failedCount,
        metrics: {
          fetched: items.length,
          normalized: items.length,
          new: newCount,
          updated: updatedCount,
          duplicates: unchangedCount,
          failed: failedCount,
        },
      };
    } catch (err) {
      await this.stateStore.recordFailure(sourceId, err?.message || String(err), {
        now: nowIso,
        rateLimitResetAt: err?.rateLimitResetAt || null,
      });
      return {
        sourceId,
        mode: plan.mode,
        failed: true,
        reason: err?.rateLimited ? 'rate_limited' : 'error',
        error: err?.message || String(err),
        fetched: 0,
        newCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        failedCount: 1,
        metrics: { fetched: 0, normalized: 0, new: 0, updated: 0, duplicates: 0, failed: 1 },
      };
    }
  }
}
