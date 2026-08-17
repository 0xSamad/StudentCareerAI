/**
 * verify-persisted.mjs — Lightweight check before applying a saved listing.
 *
 * Does NOT run discovery. Does NOT delete the opportunity.
 * Updates lastCheckedAt; if the posting is gone, marks status CLOSED/EXPIRED.
 */

import { deadlineHasPassed } from '../application-workflow-core.mjs';
import { parseRequirements } from '../../eligibility-engine.mjs';

const CLOSED_STATUSES = new Set(['CLOSED', 'EXPIRED', 'REMOVED']);

/**
 * @returns {Promise<{
 *   ok: boolean,
 *   reason: string|null,
 *   skipReason: string|null,
 *   opportunity: object,
 *   markedStatus: string|null,
 * }>}
 */
export async function verifyPersistedOpportunity({
  opportunity,
  store = null,
  verifyLivenessFn = null,
  now = new Date(),
} = {}) {
  if (!opportunity?.id) {
    return {
      ok: false,
      reason: 'Opportunity is missing from the database.',
      skipReason: 'NOT_FOUND',
      opportunity,
      markedStatus: null,
    };
  }

  if (store && typeof store.touchChecked === 'function') {
    try {
      await store.touchChecked(opportunity.id, { now: now instanceof Date ? now.toISOString() : now });
    } catch {
      // lastCheckedAt bump is best-effort
    }
  }

  const storedStatus = String(opportunity.status || opportunity.listingStatus || '').toUpperCase();
  if (CLOSED_STATUSES.has(storedStatus)) {
    return {
      ok: false,
      reason: `This opportunity is ${storedStatus}.`,
      skipReason: storedStatus,
      opportunity: { ...opportunity, status: storedStatus, isActive: false },
      markedStatus: storedStatus,
    };
  }

  const url = opportunity.url || opportunity.applicationUrl || opportunity.sourceUrl;
  if (!url) {
    return {
      ok: false,
      reason: 'This listing has no application URL.',
      skipReason: 'MISSING_URL',
      opportunity,
      markedStatus: null,
    };
  }

  const requirements = parseRequirements(opportunity.description || '');
  const deadline = deadlineHasPassed(opportunity, requirements, now instanceof Date ? now : new Date(now));
  if (deadline.passed) {
    const marked = await mark(store, opportunity.id, 'EXPIRED');
    return {
      ok: false,
      reason: `Application deadline ${deadline.deadline} has passed.`,
      skipReason: 'DEADLINE_PASSED',
      opportunity: overlay(opportunity, marked, 'EXPIRED'),
      markedStatus: 'EXPIRED',
    };
  }

  if (typeof verifyLivenessFn === 'function') {
    let liveness;
    try {
      liveness = await verifyLivenessFn(url);
    } catch (err) {
      liveness = { verified: false, status: 'uncertain', reason: err.message };
    }
    if (liveness?.status === 'expired' || liveness?.result === 'expired') {
      const marked = await mark(store, opportunity.id, 'CLOSED');
      return {
        ok: false,
        reason: liveness.reason || 'This opportunity is no longer accepting applications.',
        skipReason: 'CLOSED',
        opportunity: overlay(opportunity, marked, 'CLOSED'),
        markedStatus: 'CLOSED',
      };
    }
  }

  return { ok: true, reason: null, skipReason: null, opportunity, markedStatus: null };
}

function overlay(opportunity, marked, status) {
  if (marked && marked.id) {
    return { ...opportunity, ...marked, status: marked.status || status, isActive: false };
  }
  return { ...opportunity, status, isActive: false };
}

async function mark(store, id, status) {
  if (!store || typeof store.markStatus !== 'function') return null;
  try {
    return await store.markStatus(id, status);
  } catch {
    return null;
  }
}
