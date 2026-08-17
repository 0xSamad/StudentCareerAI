/**
 * global-tick.mjs — Scheduler fetch of NEW / UPDATED listings.
 *
 * The timer in scheduler.mjs is useless without this callback. Page loads
 * start the timer but must not fetch; each tick checks which sources are due,
 * then Fetch → Normalize → Deduplicate → Opportunity DB.
 *
 * This path is user-agnostic: listings are global. Search, Saved, and Apply
 * read the store afterwards and never trigger another source crawl.
 */

import { ensureGlobalDiscoveryScheduler } from './scheduler.mjs';
import { evaluateRefresh, loadRefreshPolicy } from './refresh-policy.mjs';

export const SYSTEM_DISCOVERY_AUTH = Object.freeze({
  userId: 'system:discovery',
  tenantId: 'system',
  role: 'system',
});

export const GLOBAL_DISCOVERY_PROFILE = Object.freeze({
  identity: {
    name: 'StudentCareer Discovery',
    email: '',
    phone: '',
    city: '',
    country: '',
    linkedin: '',
    github: '',
    portfolio: '',
  },
  education: [{ field: 'Computer Science' }],
  skills: {
    programming_languages: [],
    frameworks: [],
    ai_ml: [],
    databases: [],
    cloud: [],
    tools: [],
  },
  experience: { internships: [], jobs: [] },
  projects: [],
  preferences: {
    search_mode: 'BOTH',
    target_roles: ['Software Engineer Intern', 'Software Engineer', 'Internship'],
    locations: { preferred: [] },
    field_of_study: 'Computer Science',
  },
});

/**
 * One scheduler tick. Skips when every source is fresh or rate-limited.
 * `scanFn` is injectable for tests — production dynamically loads the real scan.
 */
export async function runGlobalDiscoveryTick({ container, repoRoot, scanFn } = {}) {
  if (!container) return { skipped: true, reason: 'no_container' };
  const policy = container.discoveryRefreshPolicy || loadRefreshPolicy(repoRoot);
  if (policy.scheduler?.enabled === false) return { skipped: true, reason: 'disabled' };

  const states =
    typeof container.discoveryStateStore?.list === 'function' ? await container.discoveryStateStore.list() : [];
  const cacheEntries =
    typeof container.sourceCache?.list === 'function' ? await container.sourceCache.list() : [];
  const verdict = evaluateRefresh({
    policy,
    states,
    cacheEntries,
    requested: 'scheduler',
  });
  if (!verdict.allowed) {
    return { skipped: true, reason: verdict.reason, lastFetchedAt: verdict.lastFetchedAt };
  }

  const scanOptions = {
    requested: 'scheduler',
    force: false,
  };
  if (typeof scanFn === 'function') {
    return scanFn(scanOptions);
  }

  const [{ scanOpportunitiesForUser }, { createStoreIngestRepository, createDualWriteRepository }] = await Promise.all([
    import('../web-opportunity-scan.mjs'),
    import('../opportunity-store/dual-write.mjs'),
  ]);

  const opportunityRepository =
    createStoreIngestRepository(container.opportunityStore) ||
    createDualWriteRepository({
      repository: container.opportunityRepository,
      store: container.opportunityStore,
    }) ||
    container.opportunityRepository;

  return scanOpportunitiesForUser({
    repoRoot,
    profile: GLOBAL_DISCOVERY_PROFILE,
    opportunityRepository,
    authContext: SYSTEM_DISCOVERY_AUTH,
    options: {
      maxCompanies: 40,
      maxJobs: 120,
      discoveryMode: 'cs_field',
      searchMode: 'BOTH',
      market: 'ALL',
      light: false,
      deadlineMs: 120_000,
      usePlaywright: true,
      playwrightBudget: 8,
      discoveryStateStore: container.discoveryStateStore,
      sourceCache: container.sourceCache,
      refreshPolicy: policy,
      force: false,
      requested: 'scheduler',
    },
  });
}

/**
 * Start (or refresh) the process-wide scheduler with a real fetch callback.
 * Does not run a tick immediately — the first fetch waits one interval.
 */
export function ensureDiscoveryPipeline({ container, repoRoot, scanFn } = {}) {
  const policy = container?.discoveryRefreshPolicy || loadRefreshPolicy(repoRoot);
  return ensureGlobalDiscoveryScheduler({
    intervalMs: policy.scheduler?.tickMs,
    policy,
    run: () => runGlobalDiscoveryTick({ container, repoRoot, scanFn }),
  });
}
