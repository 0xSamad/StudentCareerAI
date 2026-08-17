/**
 * Structured role object used by search, scoring, and the API.
 * Internships and jobs stay separate. Domain never falls through to AI/ML.
 */

import { resolveRoleFamily, isInternshipFamily, inferDomainFromTokens, tokenizeRole } from './role-families.mjs';

export function normalizeRole(input) {
  const original_query = String(input || '').trim();
  const family = resolveRoleFamily(original_query);
  const intern = isInternshipFamily(family);
  const domain = family.domain || inferDomainFromTokens(tokenizeRole(original_query || family.canonical));
  return {
    original_query,
    normalized_role: family.canonical,
    family_id: family.id,
    domain,
    specialization: family.specialization || null,
    seniority: family.seniority || (intern ? 'Internship' : 'Entry-level/Junior'),
    employment_type: intern ? 'Internship' : 'Job',
    search_type: intern ? 'internships' : 'jobs',
    family,
  };
}

export function publicRoleContract(normalized) {
  return {
    original_query: normalized.original_query,
    normalized_role: normalized.normalized_role,
    family_id: normalized.family_id,
    domain: normalized.domain,
    specialization: normalized.specialization,
    seniority: normalized.seniority,
    employment_type: normalized.employment_type,
    search_type: normalized.search_type,
  };
}
