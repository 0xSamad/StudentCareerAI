/**
 * opportunity-feed.mjs — Split discovered listings onto Internships vs Jobs.
 */

import { isInternshipTitle, isStudentOpportunityTitle } from "./cs-field-discovery.mjs";

export function listingTitle(item = {}) {
  return String(item.title || item.role || "");
}

export function storedOpportunityType(item = {}) {
  return String(item.opportunity_type || item.type || "").toUpperCase();
}

/**
 * Internships page: internships + junior / graduate / early-career CS.
 * Jobs page: non-intern full-time and experienced roles.
 */
export function matchesOpportunityFeed(item, typeFilter) {
  const want = String(typeFilter || "ALL").toUpperCase();
  if (!want || want === "ALL") return true;
  const title = listingTitle(item);
  const stored = storedOpportunityType(item);
  const internTitle = isInternshipTitle(title);
  const studentTitle = isStudentOpportunityTitle(title);

  if (want === "INTERNSHIP") {
    return internTitle || studentTitle || stored === "INTERNSHIP";
  }
  if (want === "JOB") {
    if (internTitle) return false;
    if (stored === "INTERNSHIP" && studentTitle) return false;
    return stored === "JOB" || !studentTitle;
  }
  return true;
}

export function distinctCompanyCount(items = []) {
  const names = new Set(
    items
      .map((item) => String(item.company || item.company_name || "").trim().toLowerCase())
      .filter(Boolean)
  );
  return names.size;
}
