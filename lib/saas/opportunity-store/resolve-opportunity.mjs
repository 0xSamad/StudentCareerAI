/**
 * resolve-opportunity.mjs — Load a persisted listing for queue/apply.
 *
 * Discovery and application are separate systems. Apply never starts a scan.
 * The queue stores opportunityId; this module hydrates the live record from
 * the global Opportunity Store (with a tenant-table fallback).
 */

import {
  isAllowedTargetListing,
  isGarbageTitle,
  isSearchOrCategoryUrl,
  targetGeoRank,
  cleanListingTitle,
  cleanListingText,
} from '../listing-quality.mjs';
import { isCredibleListingUrl } from '../listing-url.mjs';
import { distinctCompanyCount, matchesOpportunityFeed } from '../opportunity-feed.mjs';

function pick(row, ...keys) {
  if (!row || typeof row !== 'object') return null;
  for (const key of keys) {
    const value = row[key];
    if (value != null && value !== '') return value;
  }
  return null;
}

export function storeRecordToOpportunity(row, extras = {}) {
  if (!row) return null;
  const url =
    pick(row, 'applicationUrl', 'application_url', 'sourceUrl', 'source_url', 'url') ||
    pick(extras, 'url', 'applicationUrl', 'source_url', 'sourceUrl') ||
    '';
  const type = String(
    pick(row, 'opportunityType', 'opportunity_type', 'type') ||
      extras.type ||
      extras.opportunity_type ||
      'UNKNOWN'
  ).toUpperCase();
  const status = String(pick(row, 'status', 'listingStatus') || extras.status || 'UNKNOWN').toUpperCase();
  const userState = pick(row, 'userState', 'user_state') || extras.userState || null;
  const isActive =
    row.isActive !== false &&
    row.is_active !== false &&
    status !== 'CLOSED' &&
    status !== 'EXPIRED' &&
    status !== 'REMOVED';

  const rawTitle = pick(row, 'title', 'role') || extras.title || extras.role || 'Untitled role';
  const title = cleanListingTitle(rawTitle) || rawTitle;
  return {
    id: pick(row, 'id') || extras.id,
    company: pick(row, 'company', 'company_name') || extras.company || 'Unknown company',
    title,
    role: title,
    type,
    opportunity_type: type,
    location: pick(row, 'location') || extras.location || null,
    country: pick(row, 'country') || extras.country || null,
    description: cleanListingText(pick(row, 'description') || extras.description || '', 4000),
    url,
    applicationUrl: pick(row, 'applicationUrl', 'application_url') || url,
    sourceUrl: pick(row, 'sourceUrl', 'source_url') || url,
    source_url: pick(row, 'sourceUrl', 'source_url') || url,
    source: pick(row, 'source', 'source_name') || extras.source || null,
    source_name: pick(row, 'source', 'source_name') || extras.source_name || extras.source || null,
    source_id: pick(row, 'sourceId', 'source_id') || extras.source_id || null,
    deadline: pick(row, 'deadline') || extras.deadline || null,
    postedAt: pick(row, 'postedAt', 'posted_at', 'postedDate') || extras.postedAt || extras.postedDate || null,
    postedDate: pick(row, 'postedAt', 'posted_at', 'postedDate') || extras.postedDate || null,
    remote: row.remote === true || row.is_remote === true,
    workplace: row.remote === true || row.is_remote === true ? 'remote' : extras.workplace || 'on-site',
    salary: pick(row, 'salary') || extras.salary || null,
    status,
    listingStatus: status,
    isActive,
    lastSeenAt: pick(row, 'lastSeenAt', 'last_seen_at') || extras.lastSeenAt || null,
    lastCheckedAt: pick(row, 'lastCheckedAt', 'last_checked_at') || extras.lastCheckedAt || null,
    firstDiscoveredAt:
      pick(row, 'firstDiscoveredAt', 'first_discovered_at', 'discovered_at') || extras.discovered_at || null,
    userState,
    saved: userState === 'SAVED' || userState === 'APPLIED',
    market: extras.market || (pick(row, 'country') === 'Pakistan' ? 'NATIONAL' : extras.market) || 'INTERNATIONAL',
    matchScore: extras.matchScore ?? extras.match_score ?? row.matchScore ?? row.match_score ?? null,
    eligibility: extras.eligibility || extras.eligibility_status || row.eligibility_status || 'PENDING',
  };
}

function tenantRowToOpportunity(row) {
  if (!row) return null;
  return storeRecordToOpportunity(
    {
      id: row.id,
      company: row.company || row.company_name,
      title: row.title || row.role,
      opportunityType: row.type || row.opportunity_type,
      location: row.location,
      country: row.country,
      description: row.description,
      applicationUrl: row.url || row.source_url,
      sourceUrl: row.source_url || row.url,
      source: row.source_name || row.source,
      sourceId: row.source_id,
      deadline: row.deadline,
      postedAt: row.posted_at || row.postedDate,
      remote: row.remote || row.is_remote,
      status: row.listingStatus || (row.active === false ? 'CLOSED' : 'ACTIVE'),
      isActive: row.active !== false,
      lastSeenAt: row.last_seen_at || row.updatedAt,
      lastCheckedAt: row.last_checked_at || null,
      firstDiscoveredAt: row.discovered_at,
    },
    {
      matchScore: row.match_score ?? row.matchScore,
      eligibility: row.eligibility_status || row.eligibilityStatus,
      market: row.market || row.metadata?.market,
      workplace: row.workplace,
    }
  );
}

/**
 * Resolve a persisted opportunity by id or URL.
 * Prefers the global Opportunity Store; falls back to the tenant table.
 * Never triggers discovery. Does not treat a queue snapshot as source of truth
 * when the store is present.
 */
export async function resolvePersistedOpportunity(container, selector, authContext = {}) {
  const id = String(
    selector?.id || selector?.opportunityId || selector?.opportunity_id || (typeof selector === 'string' ? selector : '') || ''
  ).trim();
  const url = String(
    selector?.url || selector?.applicationUrl || selector?.source_url || selector?.sourceUrl || ''
  ).trim();
  const store = container?.opportunityStore;

  if (store) {
    if (id && typeof store.getById === 'function') {
      const byId = await store.getById(id);
      if (byId) return storeRecordToOpportunity(byId);
    }
    if (url && typeof store.getByUrl === 'function') {
      const byUrl = await store.getByUrl(url);
      if (byUrl) return storeRecordToOpportunity(byUrl);
    }
  }

  const repo = container?.opportunityRepository;
  if (id && typeof repo?.findById === 'function') {
    const tenant = await repo.findById(id, authContext);
    if (tenant) {
      if (store && typeof store.getByUrl === 'function') {
        const tenantUrl = tenant.url || tenant.source_url;
        if (tenantUrl) {
          const byUrl = await store.getByUrl(tenantUrl);
          if (byUrl) return storeRecordToOpportunity(byUrl, tenant);
        }
      }
      return tenantRowToOpportunity(tenant);
    }
  }

  // Tests / offline: no store — accept a full listing object as last resort.
  if (
    !store &&
    selector &&
    typeof selector === 'object' &&
    (selector.company || selector.title || selector.role)
  ) {
    return storeRecordToOpportunity(selector, selector);
  }
  return null;
}

export function toUiOpportunity(row) {
  const mapped =
    row && (row.opportunityType || row.opportunity_type || row.applicationUrl || row.application_url || row.lastSeenAt || row.last_seen_at)
      ? storeRecordToOpportunity(row)
      : tenantRowToOpportunity(row) || storeRecordToOpportunity(row);
  if (!mapped) return null;
  const type = mapped.type === 'JOB' ? 'JOB' : mapped.type === 'INTERNSHIP' ? 'INTERNSHIP' : mapped.type || 'UNKNOWN';
  const title = cleanListingTitle(mapped.title || mapped.role) || mapped.role;
  return {
    id: mapped.id,
    company: mapped.company,
    title,
    role: title,
    type,
    location: mapped.location || 'Location unknown',
    matchScore: mapped.matchScore,
    eligibility: mapped.eligibility || 'PENDING',
    source: mapped.source_name || mapped.source || 'Discovery',
    source_type: 'DISCOVERY',
    source_name: mapped.source_name || mapped.source || 'Discovery',
    source_url: mapped.source_url,
    source_id: mapped.source_id,
    discovered_at: mapped.firstDiscoveredAt,
    is_demo: false,
    is_verified: mapped.status === 'ACTIVE',
    postedDate: mapped.postedDate,
    deadline: mapped.deadline,
    status: mapped.status,
    listingStatus: mapped.listingStatus,
    url: mapped.url,
    description: mapped.description,
    market: mapped.market,
    country: mapped.country,
    workplace: mapped.workplace,
    saved: mapped.saved,
    userState: mapped.userState,
    lastSeenAt: mapped.lastSeenAt,
    lastCheckedAt: mapped.lastCheckedAt,
    isActive: mapped.isActive,
  };
}

export async function listPersistedOpportunitiesForUi(container, filters = {}, authContext = {}) {
  const store = container?.opportunityStore;
  if (!store || typeof store.list !== 'function') {
    return { opportunities: [], total: 0, servedFrom: 'none' };
  }
  const type = filters.type === 'INTERNSHIP' || filters.type === 'JOB' ? filters.type : undefined;
  const displayLimit = Number(filters.limit) || 400;
  // Quality/geo filters drop career hubs and foreign on-site rows. Pull a
  // larger window so Pakistan/remote postings are not buried under a fresh
  // Adzuna incremental refresh.
  const fetchLimit = Math.min(2500, Math.max(displayLimit * 5, 1500));
  const result = await store.list(
    {
      type,
      search: filters.search || undefined,
      includeInactive: filters.includeInactive === true,
      limit: fetchLimit,
      offset: filters.offset || 0,
    },
    { userId: authContext.userId }
  );
  const opportunities = (result.opportunities || []).map(toUiOpportunity).filter(Boolean);
  return {
    opportunities,
    total: result.total ?? opportunities.length,
    servedFrom: opportunities.length ? 'opportunity_store' : 'opportunity_store_empty',
  };
}

function inferWorkplace(item = {}) {
  const explicit = String(item.workplace || item.metadata?.workplace || '').toLowerCase().replace(/_/g, '-');
  if (explicit === 'remote' || explicit === 'hybrid' || explicit === 'on-site') return explicit;
  if (explicit === 'onsite' || explicit === 'office') return 'on-site';
  const loc = `${item.location || ''} ${item.title || item.role || ''} ${item.description || ''}`.toLowerCase();
  if (item.remote === true || item.is_remote === true || /\bremote\b/.test(loc)) return 'remote';
  if (/\bhybrid\b/.test(loc)) return 'hybrid';
  return 'on-site';
}

/**
 * Keep Pakistan/remote job postings; drop career hubs and foreign on-site rows.
 * Loaded through the Opportunity Store ESM graph so Next does not webpack-stub
 * listing-quality.mjs as an empty module.
 */
export function passesDisplayFilters(item = {}, { typeFilter, workplaceFilter } = {}) {
  const title = item.title || item.role || '';
  const url = item.url || item.source_url || '';
  const workplace = inferWorkplace(item);
  if (isGarbageTitle(title)) return false;
  if (isSearchOrCategoryUrl(url)) return false;
  if (!isCredibleListingUrl(url)) return false;
  if (
    !isAllowedTargetListing({
      title,
      url,
      location: item.location,
      market: item.market || item.metadata?.market,
      workplace,
      remote: item.remote,
      country: item.country,
    })
  ) {
    return false;
  }
  if (!matchesOpportunityFeed(item, typeFilter)) return false;
  if (workplaceFilter && workplaceFilter !== 'all' && workplace !== workplaceFilter) return false;
  return true;
}

export function rankDisplayableListing(item = {}) {
  return targetGeoRank({
    title: item.title || item.role,
    url: item.url || item.source_url,
    location: item.location,
    market: item.market || item.metadata?.market,
    workplace: inferWorkplace(item),
    remote: item.remote,
    country: item.country,
  });
}

export { distinctCompanyCount, inferWorkplace };
