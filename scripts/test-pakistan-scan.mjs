#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverPakistanCompanies } from '../lib/saas/pakistan-company-discovery.mjs';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const stats = await discoverPakistanCompanies({
  repoRoot,
  profile: { identity: { name: 'Test' } },
  opportunityRepository: {
    upsertDiscovered: async (r) => ({ ...r, id: 'test' }),
  },
  authContext: { tenantId: 'default', userId: 'test' },
  options: { maxCompanies: 3, maxJobs: 10, maxPerCompany: 3, startIndex: 67 },
});

console.log(JSON.stringify(stats, null, 2));
