/**
 * memory-store.mjs — In-process Opportunity Store.
 *
 * Same contract as PgOpportunityStore; used when DATABASE_URL is unset
 * (offline dev/tests). Opportunities are GLOBAL; user state (saved / hidden /
 * ignored / applied) lives in a separate per-user map, mirroring the
 * saved_opportunities table.
 */

import {
  normalizeOpportunity,
  newOpportunityId,
  SAVED_STATUSES,
  OPPORTUNITY_STATUSES,
  normalizeUrl,
} from './opportunity-record.mjs';
import { targetGeoRank } from '../listing-quality.mjs';

export class MemoryOpportunityStore {
  constructor() {
    this.byId = new Map();
    this.byKey = new Map(); // dedupeKey -> id
    this.byUrl = new Map(); // urlKey -> id
    this.userStates = new Map(); // `${userId}:${opportunityId}` -> state row
  }

  _find(record) {
    if (this.byKey.has(record.dedupeKey)) return this.byId.get(this.byKey.get(record.dedupeKey));
    if (record.urlKey && this.byUrl.has(record.urlKey)) return this.byId.get(this.byUrl.get(record.urlKey));
    return null;
  }

  /**
   * FETCH → NORMALIZE → DEDUPLICATE → PERSIST.
   * Returns { opportunity, isNew }. Re-fetching an existing listing updates
   * lastSeenAt/lastCheckedAt (and description/deadline/status when changed)
   * without creating a second record.
   */
  async upsert(raw, { now } = {}) {
    const record = normalizeOpportunity(raw);
    const ts = now || new Date().toISOString();
    const existing = this._find(record);

    if (existing) {
      const changed = record.contentHash !== existing.contentHash;
      existing.lastSeenAt = ts;
      existing.lastCheckedAt = ts;
      if (changed) {
        if (record.description) existing.description = record.description;
        if (record.salary) existing.salary = record.salary;
        existing.contentHash = record.contentHash;
      }
      if (record.deadline) existing.deadline = record.deadline;
      if (record.status && record.status !== 'UNKNOWN' && record.status !== existing.status) {
        existing.status = record.status;
        existing.isActive = record.status === 'ACTIVE';
      }
      existing.updatedAt = ts;
      return { opportunity: existing, isNew: false, changed };
    }

    const opportunity = {
      id: newOpportunityId(),
      ...record,
      firstDiscoveredAt: ts,
      lastSeenAt: ts,
      lastCheckedAt: ts,
      isActive: record.status === 'ACTIVE',
      createdAt: ts,
      updatedAt: ts,
    };
    this.byId.set(opportunity.id, opportunity);
    this.byKey.set(opportunity.dedupeKey, opportunity.id);
    if (opportunity.urlKey) this.byUrl.set(opportunity.urlKey, opportunity.id);
    return { opportunity, isNew: true, changed: false };
  }

  /** Bump lastSeenAt for a listing re-encountered by URL (incremental refresh). */
  async touchSeenByUrl(url, { now } = {}) {
    const key = normalizeOpportunity({ url }).urlKey;
    if (!key || !this.byUrl.has(key)) return false;
    const opp = this.byId.get(this.byUrl.get(key));
    if (!opp) return false;
    const ts = now || new Date().toISOString();
    opp.lastSeenAt = ts;
    opp.lastCheckedAt = ts;
    return true;
  }

  async getById(id) {
    return this.byId.get(id) || null;
  }

  async getByUrl(url) {
    const key = normalizeUrl(url);
    if (!key || !this.byUrl.has(key)) return null;
    return this.byId.get(this.byUrl.get(key)) || null;
  }

  async markStatus(id, status, { now } = {}) {
    const opp = this.byId.get(id);
    if (!opp) return null;
    const wanted = String(status || '').toUpperCase();
    if (!OPPORTUNITY_STATUSES.includes(wanted)) throw new Error(`Invalid opportunity status: ${status}`);
    const ts = now || new Date().toISOString();
    opp.status = wanted;
    opp.isActive = wanted === 'ACTIVE';
    opp.lastCheckedAt = ts;
    opp.updatedAt = ts;
    return opp;
  }

  /** Apply-time check: bump lastCheckedAt only. Never deletes. Never changes lastSeenAt. */
  async touchChecked(id, { now } = {}) {
    const opp = this.byId.get(id);
    if (!opp) return false;
    const ts = now || new Date().toISOString();
    opp.lastCheckedAt = ts;
    opp.updatedAt = ts;
    return true;
  }

  async count() {
    return this.byId.size;
  }

  async listKnownUrls() {
    const urls = new Set();
    for (const opp of this.byId.values()) {
      if (opp.applicationUrl) urls.add(opp.applicationUrl);
      if (opp.sourceUrl) urls.add(opp.sourceUrl);
    }
    return urls;
  }

  /** Snapshot for restart tests — the Postgres store is the real persistence. */
  exportAll() {
    return {
      opportunities: [...this.byId.values()].map((o) => ({ ...o })),
      userStates: [...this.userStates.values()].map((s) => ({ ...s })),
    };
  }

  importAll(snapshot = {}) {
    this.byId.clear();
    this.byKey.clear();
    this.byUrl.clear();
    this.userStates.clear();
    for (const opp of snapshot.opportunities || []) {
      const copy = { ...opp };
      this.byId.set(copy.id, copy);
      if (copy.dedupeKey) this.byKey.set(copy.dedupeKey, copy.id);
      if (copy.urlKey) this.byUrl.set(copy.urlKey, copy.id);
    }
    for (const row of snapshot.userStates || []) {
      this.userStates.set(`${row.userId}:${row.opportunityId}`, { ...row });
    }
  }

  /**
   * SERVE FROM DATABASE — list stored opportunities, newest-seen first.
   * When userId is given, each row carries userState and HIDDEN rows are
   * filtered out (unless includeHidden).
   */
  async list(filters = {}, { userId } = {}) {
    const limit = Math.min(Number(filters.limit) || 100, 2500);
    const offset = Math.max(Number(filters.offset) || 0, 0);
    const search = filters.search ? String(filters.search).toLowerCase() : null;
    const items = [];
    for (const opp of this.byId.values()) {
      if (!filters.includeInactive && !opp.isActive) continue;
      if (filters.type && opp.opportunityType !== String(filters.type).toUpperCase()) continue;
      if (filters.status && opp.status !== String(filters.status).toUpperCase()) continue;
      if (filters.country && !String(opp.country || '').toLowerCase().includes(String(filters.country).toLowerCase())) continue;
      if (filters.remote !== undefined && filters.remote !== null && opp.remote !== Boolean(filters.remote)) continue;
      if (search && !`${opp.company} ${opp.title} ${opp.location || ''}`.toLowerCase().includes(search)) continue;

      const state = userId ? this.userStates.get(`${userId}:${opp.id}`) || null : null;
      if (state?.status === 'HIDDEN' && !filters.includeHidden) continue;
      if (filters.savedOnly && !(state && (state.status === 'SAVED' || state.status === 'APPLIED'))) continue;
      items.push({ ...opp, userState: state?.status || null, userSavedAt: state?.savedAt || null });
    }
    items.sort((a, b) => {
      const rankA = targetGeoRank({
        title: a.title,
        location: a.location,
        country: a.country,
        remote: a.remote,
      });
      const rankB = targetGeoRank({
        title: b.title,
        location: b.location,
        country: b.country,
        remote: b.remote,
      });
      if (rankA !== rankB) return rankA - rankB;
      return new Date(b.lastSeenAt || 0).getTime() - new Date(a.lastSeenAt || 0).getTime();
    });
    return { total: items.length, opportunities: items.slice(offset, offset + limit) };
  }

  // ── User-specific state (saved_opportunities) ────────────────────────────

  async setUserState({ userId, tenantId = null, opportunityId, status }) {
    const wanted = String(status || 'SAVED').toUpperCase();
    if (!SAVED_STATUSES.includes(wanted)) throw new Error(`Invalid saved status: ${status}`);
    if (!userId || !opportunityId) throw new Error('userId and opportunityId are required');
    if (!this.byId.has(opportunityId)) throw new Error('Opportunity not found');
    const key = `${userId}:${opportunityId}`;
    const existing = this.userStates.get(key);
    const now = new Date().toISOString();
    const row = {
      userId,
      tenantId,
      opportunityId,
      status: wanted,
      savedAt: existing?.savedAt || now,
      updatedAt: now,
    };
    this.userStates.set(key, row);
    return row;
  }

  async clearUserState({ userId, opportunityId }) {
    return this.userStates.delete(`${userId}:${opportunityId}`);
  }

  async listUserStates(userId) {
    const rows = [];
    for (const row of this.userStates.values()) {
      if (row.userId !== userId) continue;
      const opportunity = this.byId.get(row.opportunityId) || null;
      rows.push({ ...row, opportunity });
    }
    rows.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return rows;
  }
}
