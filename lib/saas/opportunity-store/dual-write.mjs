/**
 * dual-write.mjs — Bridge between discovery and the global Opportunity Store.
 *
 * Wraps the existing per-tenant opportunityRepository so every discovered
 * listing is ALSO persisted into the global opportunity_store — without
 * modifying any discovery module. A store failure never breaks a scan.
 */

export function createDualWriteRepository({ repository, store }) {
  return {
    async upsertDiscovered(record, context = {}) {
      let globalResult = null;
      try {
        globalResult = await store.upsert(record);
      } catch {
        // Global store write is best-effort; the tenant feed write still happens.
      }
      const local = await repository.upsertDiscovered(record, context);
      return {
        ...local,
        isNew: globalResult ? globalResult.isNew : local?.isNew !== false,
        changed: Boolean(globalResult?.changed),
        globalOpportunityId: globalResult?.opportunity?.id || null,
        globalIsNew: globalResult ? globalResult.isNew : null,
      };
    },

    async listKnownUrls(context = {}) {
      const urls = new Set();
      if (typeof store.listKnownUrls === 'function') {
        try {
          for (const url of await store.listKnownUrls()) urls.add(url);
        } catch {
          // store URL index is optional
        }
      }
      if (typeof repository.listKnownUrls === 'function') {
        try {
          for (const url of await repository.listKnownUrls(context)) urls.add(url);
        } catch {
          // tenant URL index is optional
        }
      }
      return urls;
    },

    /** Called when an already-known URL is re-fetched: bump lastSeenAt globally. */
    async noteSeen(url) {
      try {
        return await store.touchSeenByUrl(url);
      } catch {
        return false;
      }
    },

    findByFilters: (...args) => repository.findByFilters(...args),
    findById: typeof repository.findById === 'function' ? (...args) => repository.findById(...args) : undefined,
  };
}

/**
 * Scheduler ingest path: persist into the global Opportunity Store only.
 * Manual user refresh still uses createDualWriteRepository (tenant + store).
 */
export function createStoreIngestRepository(store) {
  if (!store) return null;
  return {
    async upsertDiscovered(record) {
      const result = await store.upsert(record);
      return {
        ...(result.opportunity || {}),
        isNew: result.isNew,
        changed: Boolean(result.changed),
        globalOpportunityId: result.opportunity?.id || null,
        globalIsNew: result.isNew,
      };
    },

    async listKnownUrls() {
      if (typeof store.listKnownUrls === 'function') {
        return store.listKnownUrls();
      }
      return new Set();
    },

    async noteSeen(url) {
      try {
        return await store.touchSeenByUrl(url);
      } catch {
        return false;
      }
    },
  };
}
