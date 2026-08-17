/**
 * persist-application.mjs — Save prepared/submitted application results.
 */

const PREPARED_STATES = new Set([
  "DRY_RUN",
  "PREPARED",
  "APPLICATION_READY",
  "CV_GENERATED",
  "SELECTED",
  "ANALYZING",
  "CV_PREPARATION",
  "COVER_LETTER_PREPARATION",
  "APPLICATION_PREPARATION",
  "READY",
  "APPLYING",
  "PAUSED",
  "SUBMITTED",
  "APPLIED",
  "REQUIRES_USER_INPUT",
  "FAILED",
  "SKIPPED",
  "NOT_ELIGIBLE",
]);

/**
 * @param {object} params
 */
export async function persistApplicationRecord({
  container,
  authContext,
  targetOpp,
  normalized,
  processResult,
}) {
  const repo = container.applicationRepository;
  if (!repo?.create) return null;

  const opportunityId = targetOpp.id;
  if (!opportunityId) return null;

  const company = targetOpp.company || targetOpp.company_name || "Unknown";
  const title = targetOpp.title || targetOpp.role || "Untitled role";
  const state = PREPARED_STATES.has(normalized.status) ? normalized.status : "APPLICATION_READY";
  const artifacts = processResult?.artifacts || {};

  const payload = {
    opportunity_id: opportunityId,
    company,
    title,
    role: title,
    state,
    url: targetOpp.url,
    location: targetOpp.location || null,
    opportunity_type: targetOpp.type || targetOpp.opportunity_type || "INTERNSHIP",
    match_score: targetOpp.match_score ?? targetOpp.matchScore ?? null,
    eligibility_status: targetOpp.eligibility_status ?? targetOpp.eligibilityStatus ?? "PENDING",
    dry_run: normalized.dry_run !== false,
    submitted_at: normalized.submitted_at || null,
    artifacts,
    metadata: {
      url: targetOpp.url,
      location: targetOpp.location || null,
      opportunity_type: targetOpp.type || targetOpp.opportunity_type || "INTERNSHIP",
      artifacts,
      last_apply_message: normalized.message || null,
    },
  };

  let existing = null;
  if (repo.getByOpportunityId) {
    existing = await repo.getByOpportunityId(
      opportunityId,
      authContext.userId,
      authContext.tenantId
    );
  }

  if (existing?.id && repo.updateApplicationState) {
    return repo.updateApplicationState(
      existing.id,
      state,
      {
        artifacts,
        match_score: payload.match_score,
        eligibility_status: payload.eligibility_status,
        submitted_at: payload.submitted_at,
        reason: normalized.message || "Apply run",
      },
      authContext
    );
  }

  return repo.create(payload, authContext);
}

/**
 * Build application-shaped rows from opportunities that have apply metadata but no app row yet.
 * @param {object[]} opportunities
 * @param {object[]} applications
 */
export function mergePreparedOpportunities(opportunities = [], applications = []) {
  const byOppId = new Set(applications.map((a) => a.opportunity_id || a.opportunityId).filter(Boolean));
  const byUrl = new Set(applications.map((a) => a.url || a.metadata?.url).filter(Boolean));

  const merged = [...applications];

  for (const opp of opportunities) {
    if (!opp?.id || byOppId.has(opp.id)) continue;
    const url = opp.url;
    if (url && byUrl.has(url)) continue;

    const lastApply = opp.metadata?.last_apply || opp.last_apply;
    const oppState = opp.state || opp.metadata?.state;
    const prepared =
      lastApply ||
      oppState === "DRY_RUN" ||
      oppState === "PREPARED" ||
      oppState === "APPLICATION_READY";

    if (!prepared) continue;

    merged.push({
      id: opp.id,
      opportunity_id: opp.id,
      company: opp.company || opp.company_name,
      role: opp.title || opp.role,
      title: opp.title || opp.role,
      type: opp.type || opp.opportunity_type || "INTERNSHIP",
      location: opp.location || "Location unknown",
      status: lastApply?.status || oppState || "APPLICATION_READY",
      state: lastApply?.status || oppState || "APPLICATION_READY",
      matchScore: opp.match_score ?? opp.matchScore ?? null,
      match_score: opp.match_score ?? opp.matchScore ?? null,
      eligibility: opp.eligibility_status || opp.eligibilityStatus || "PENDING",
      eligibility_status: opp.eligibility_status || opp.eligibilityStatus || "PENDING",
      url,
      timestamp: lastApply?.at || opp.updatedAt || opp.discovered_at || new Date().toISOString(),
      artifacts: opp.metadata?.artifacts || {},
      submitted_at: lastApply?.submitted_at || null,
      dry_run: lastApply?.dry_run !== false,
      _synthetic: true,
    });
    byOppId.add(opp.id);
    if (url) byUrl.add(url);
  }

  return merged.sort(
    (a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()
  );
}
