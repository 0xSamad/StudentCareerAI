/**
 * application-queue.mjs — Per-user application selection queue.
 *
 * Enqueue does NOT apply. Apply runs the 20-step workflow independently
 * per item. SUBMITTED is never recorded without a real submitted_at.
 * One failure does not stop the remaining applications.
 */

import { userFacingStage } from "./application-orchestrator.mjs";
import {
  resolvePersistedOpportunity,
  verifyPersistedOpportunity,
} from "./opportunity-store/index.mjs";

export const QUEUE_MACHINE = Object.freeze({
  SELECTED: "SELECTED",
  ANALYZING: "ANALYZING",
  CV_PREPARATION: "CV_PREPARATION",
  COVER_LETTER_PREPARATION: "COVER_LETTER_PREPARATION",
  APPLICATION_PREPARATION: "APPLICATION_PREPARATION",
  READY: "READY",
  APPLYING: "APPLYING",
  SUBMITTED: "SUBMITTED",
  FAILED: "FAILED",
  REQUIRES_USER_INPUT: "REQUIRES_USER_INPUT",
  PAUSED: "PAUSED",
  SKIPPED: "SKIPPED",
});

export const MAX_ENQUEUE = 50;

const APPLYABLE = new Set([
  QUEUE_MACHINE.SELECTED,
  QUEUE_MACHINE.ANALYZING,
  QUEUE_MACHINE.CV_PREPARATION,
  QUEUE_MACHINE.COVER_LETTER_PREPARATION,
  QUEUE_MACHINE.APPLICATION_PREPARATION,
  QUEUE_MACHINE.READY,
  QUEUE_MACHINE.APPLYING,
  QUEUE_MACHINE.FAILED,
  QUEUE_MACHINE.REQUIRES_USER_INPUT,
  QUEUE_MACHINE.PAUSED,
  QUEUE_MACHINE.SKIPPED,
  "APPLICATION_READY",
  "DRY_RUN",
  "PREPARED",
  "CV_GENERATED",
]);

const PAUSEABLE = new Set([
  QUEUE_MACHINE.SELECTED,
  QUEUE_MACHINE.ANALYZING,
  QUEUE_MACHINE.CV_PREPARATION,
  QUEUE_MACHINE.COVER_LETTER_PREPARATION,
  QUEUE_MACHINE.APPLICATION_PREPARATION,
  QUEUE_MACHINE.READY,
  QUEUE_MACHINE.REQUIRES_USER_INPUT,
  QUEUE_MACHINE.FAILED,
  "APPLICATION_READY",
  "DRY_RUN",
  "PREPARED",
]);

export function inferWorkplace(item = {}) {
  const loc = `${item.location || ""} ${item.title || item.role || ""} ${item.workplace || ""}`.toLowerCase();
  if (item.remote === true || item.is_remote === true || /\bremote\b/.test(loc)) return "remote";
  if (/\bhybrid\b/.test(loc)) return "hybrid";
  return "on-site";
}

export function inferCountry(item = {}) {
  if (item.country) return item.country;
  const market = item.market || item.metadata?.market;
  if (market === "NATIONAL") return "Pakistan";
  const loc = String(item.location || "");
  if (/pakistan|lahore|karachi|islamabad|rawalpindi|faisalabad|peshawar|quetta/i.test(loc)) {
    return "Pakistan";
  }
  const parts = loc.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 1];
  if (market === "INTERNATIONAL") return "International";
  return null;
}

export function cvStatusFrom(app = {}) {
  const artifacts = app.artifacts || app.metadata?.artifacts || {};
  const rec = artifacts.applicationRecord || artifacts;
  const cv = rec?.tailored_cv || artifacts.tailored_cv;
  const decision = artifacts.cvDecision || rec?.cv_decision;
  if (cv?.reused_master || decision?.reusedMaster) return "reused";
  if (cv?.tailored_html || cv?.regenerated || decision?.regenerated) return "tailored";
  if (cv || artifacts.tailored_cv) return "ready";
  if ([QUEUE_MACHINE.CV_PREPARATION, "CV_GENERATED"].includes(app.state)) return "preparing";
  return "pending";
}

export function coverLetterStatusFrom(app = {}) {
  const artifacts = app.artifacts || app.metadata?.artifacts || {};
  const rec = artifacts.applicationRecord || artifacts;
  const letter = rec?.cover_letter || artifacts.cover_letter;
  const decision = artifacts.coverLetterDecision || rec?.cover_letter_decision;
  if (letter?.body || letter?.coverLetter) return "ready";
  if (letter?.skipped || decision?.skipped || decision?.requirement === "NOT_NEEDED" || letter?.requirement === "NOT_NEEDED") {
    return "skipped";
  }
  if (app.state === QUEUE_MACHINE.COVER_LETTER_PREPARATION || app.state === QUEUE_MACHINE.APPLICATION_PREPARATION) {
    return "preparing";
  }
  return "pending";
}

/**
 * Map engine/pipeline status onto the user-facing queue machine.
 * SUBMITTED is only returned when a real submission timestamp exists.
 */
export function mapEngineStatusToQueueState(status, submittedAt = null) {
  if (status === "SUBMITTED" || status === "APPLIED") {
    return submittedAt ? QUEUE_MACHINE.SUBMITTED : QUEUE_MACHINE.READY;
  }
  if (
    status === "DRY_RUN" ||
    status === "APPLICATION_READY" ||
    status === "PREPARED" ||
    status === "CV_GENERATED" ||
    status === "READY"
  ) {
    return QUEUE_MACHINE.READY;
  }
  if (status === "REQUIRES_USER_INPUT" || status === "BLOCKED") {
    return QUEUE_MACHINE.REQUIRES_USER_INPUT;
  }
  if (status === "SKIPPED" || status === "NOT_ELIGIBLE" || status === "CLOSED" || status === "DUPLICATE") {
    return QUEUE_MACHINE.SKIPPED;
  }
  if (status === "FAILED" || status === "ERROR") {
    return QUEUE_MACHINE.FAILED;
  }
  if (status === "PAUSED") return QUEUE_MACHINE.PAUSED;
  if (status === "APPLYING") return QUEUE_MACHINE.APPLYING;
  if (status === "ANALYZING") return QUEUE_MACHINE.ANALYZING;
  if (status === "CV_PREPARATION") return QUEUE_MACHINE.CV_PREPARATION;
  if (status === "COVER_LETTER_PREPARATION") return QUEUE_MACHINE.COVER_LETTER_PREPARATION;
  if (status === "APPLICATION_PREPARATION") return QUEUE_MACHINE.APPLICATION_PREPARATION;
  if (status === "SELECTED") return QUEUE_MACHINE.SELECTED;
  return QUEUE_MACHINE.READY;
}

export function shapeQueueItem(app = {}) {
  const meta = app.metadata && typeof app.metadata === "object" ? app.metadata : {};
  const artifacts = app.artifacts || meta.artifacts || {};
  const state = app.state || QUEUE_MACHINE.SELECTED;
  const submittedAt = app.submitted_at || app.applied_at || null;
  const honestState =
    (state === "SUBMITTED" || state === "APPLIED") && !submittedAt
      ? QUEUE_MACHINE.READY
      : state;

  return {
    id: app.id,
    opportunityId: app.opportunity_id || app.opportunityId,
    company: app.company || "Unknown company",
    position: app.title || app.role || "Untitled role",
    type: app.opportunity_type || app.type || meta.opportunity_type || "INTERNSHIP",
    eligibility: app.eligibility_status || app.eligibilityStatus || "PENDING",
    matchScore: typeof app.match_score === "number" ? app.match_score : app.matchScore ?? null,
    cvStatus: cvStatusFrom(app),
    coverLetterStatus: coverLetterStatusFrom(app),
    applicationStatus: honestState,
    location: app.location || meta.location || null,
    country: app.country || meta.country || inferCountry(app),
    workplace: app.workplace || meta.workplace || inferWorkplace(app),
    deadline: app.deadline || meta.deadline || null,
    source: app.source_name || meta.source_name || app.source || null,
    sourceUrl: app.url || meta.url || app.source_url || null,
    paused: honestState === QUEUE_MACHINE.PAUSED,
    pauseReason: app.pause_reason || meta.pause_reason || null,
    skipReason: app.skip_reason || meta.skip_reason || artifacts.skipReason || null,
    lastMessage: app.last_message || meta.last_message || meta.reason || null,
    outcome: app.outcome || meta.outcome || null,
    submitted_at: submittedAt,
    stageLabel: userFacingStage(honestState, {
      pause_reason: app.pause_reason || meta.pause_reason || null,
      submitted_at: submittedAt,
    }),
    dry_run: app.dry_run !== false && !submittedAt,
    artifacts,
    stateHistory: app.stateHistory || app.state_history || meta.stateHistory || [],
    createdAt: app.createdAt || app.created_at || null,
    updatedAt: app.updatedAt || app.updated_at || null,
  };
}

function normalizeCount(count, fallbackLength) {
  const n = Number(count);
  if (!Number.isFinite(n) || n < 1) return Math.min(fallbackLength, MAX_ENQUEUE);
  return Math.min(Math.floor(n), MAX_ENQUEUE, fallbackLength);
}

function opportunityUrl(opp = {}) {
  return String(opp.url || opp.source_url || opp.sourceUrl || opp.applicationUrl || "").trim();
}

function asQueueListing(opp = {}) {
  const id = opp.id || opp.opportunity_id || opp.opportunityId;
  const url = opportunityUrl(opp) || (id ? `https://placeholder.local/opp/${id}` : "");
  return {
    ...opp,
    id,
    url,
    role: opp.role || opp.title || "Untitled role",
    title: opp.title || opp.role || "Untitled role",
  };
}

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "").split("?")[0].toLowerCase();
}

function queueItemMatchesOpportunity(app, id, listing = null) {
  const sid = String(id || "").trim();
  if (!sid) return false;
  const meta = app?.metadata && typeof app.metadata === "object" ? app.metadata : {};
  if (String(app.id) === sid) return true;
  if (String(app.opportunity_id || app.opportunityId || "") === sid) return true;
  if (String(meta.globalOpportunityId || "") === sid) return true;
  if (listing?.id && String(app.opportunity_id || app.opportunityId || "") === String(listing.id)) return true;
  const appUrl = normalizeUrl(app.url || meta.url || meta.source_url);
  const listingUrl = normalizeUrl(listing?.url || listing?.source_url);
  if (appUrl && listingUrl && appUrl === listingUrl) return true;
  return false;
}

async function selectQueueItemsForApply({ repo, container, authContext, ids = [], all = false }) {
  const allApps = await repo.findMany({}, authContext);
  if (all) {
    return { allApps, items: allApps.filter((a) => APPLYABLE.has(a.state)) };
  }
  const wanted = [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))];
  const items = [];
  const seen = new Set();

  for (const id of wanted) {
    const before = seen.size;
    let listing = null;
    if (container?.opportunityStore) {
      listing = await resolvePersistedOpportunity(container, { id }, authContext).catch(() => null);
    }
    for (const app of allApps) {
      if (seen.has(String(app.id))) continue;
      if (queueItemMatchesOpportunity(app, id, listing)) {
        seen.add(String(app.id));
        items.push(app);
      }
    }
    if (seen.size === before) {
      const byOpp = await repo.getByOpportunityId?.(id, authContext.userId, authContext.tenantId);
      if (byOpp && !seen.has(String(byOpp.id))) {
        seen.add(String(byOpp.id));
        items.push(byOpp);
      }
    }
  }

  return { allApps, items: items.filter((a) => APPLYABLE.has(a.state)) };
}

/**
 * Queue references opportunityId only as source of truth.
 * Display fields (company/title) are denormalized for the queue UI;
 * apply always re-loads the listing from the Opportunity Store.
 */
export async function enqueueOpportunities({
  container,
  authContext,
  opportunities = [],
  opportunityIds = [],
  count,
} = {}) {
  const repo = container?.applicationRepository;
  if (!repo?.create) throw new Error("applicationRepository is required");
  if (!authContext?.userId || !authContext?.tenantId) {
    throw new Error("tenantId and userId are required");
  }

  const skipped = [];
  const resolved = [];
  const seen = new Set();
  const hasStore = Boolean(container?.opportunityStore);

  const ids = [
    ...(Array.isArray(opportunityIds) ? opportunityIds : []),
    ...(Array.isArray(opportunities) ? opportunities.map((o) => o?.id || o?.opportunityId || o?.opportunity_id) : []),
  ]
    .map((id) => String(id || "").trim())
    .filter(Boolean);

  for (const id of [...new Set(ids)]) {
    const fromStore = await resolvePersistedOpportunity(container, { id }, authContext);
    if (fromStore?.id) {
      if (!seen.has(String(fromStore.id))) {
        seen.add(String(fromStore.id));
        resolved.push(asQueueListing(fromStore));
      }
      continue;
    }
    if (hasStore) {
      skipped.push({ opportunityId: id, reason: "not_found" });
    }
  }

  if (!hasStore) {
    const raw = Array.isArray(opportunities) ? opportunities.filter(Boolean) : [];
    for (const opp of raw) {
      const listing = asQueueListing(opp);
      if (!listing.id || seen.has(String(listing.id))) continue;
      seen.add(String(listing.id));
      resolved.push(listing);
    }
  }

  const list = resolved.filter((opp) => opp.id && opp.url);
  const droppedUnresolved =
    !hasStore && Array.isArray(opportunities)
      ? opportunities.filter(Boolean).length - list.length
      : 0;
  const limit = normalizeCount(count, list.length);
  const slice = list.slice(0, limit);

  const added = [];
  if (!hasStore && droppedUnresolved > 0 && slice.length === 0 && skipped.length === 0) {
    throw Object.assign(new Error("That listing is missing an id or URL, so it could not be queued."), { status: 400 });
  }
  if (hasStore && slice.length === 0 && skipped.length === 0 && ids.length === 0) {
    throw Object.assign(new Error("Select at least one opportunity to add."), { status: 400 });
  }

  for (const opp of slice) {
    const existing = await repo.getByOpportunityId(opp.id, authContext.userId, authContext.tenantId);
    if (existing) {
      skipped.push({ opportunityId: opp.id, applicationId: existing.id, reason: "already_in_queue" });
      continue;
    }

    const workplace = inferWorkplace(opp);
    const country = inferCountry(opp);
    try {
      const record = await repo.create(
        {
          opportunity_id: opp.id,
          company: String(opp.company || opp.company_name || "Unknown company").slice(0, 250),
          title: String(opp.role || opp.title || "Untitled role").slice(0, 250),
          state: QUEUE_MACHINE.SELECTED,
          url: opp.url,
          match_score: opp.matchScore ?? opp.match_score ?? null,
          eligibility_status: opp.eligibility || opp.eligibility_status || "PENDING",
          dry_run: true,
          submitted_at: null,
          metadata: {
            url: opp.url,
            location: opp.location || null,
            country,
            workplace,
            deadline: opp.deadline || null,
            opportunity_type: opp.type || opp.opportunity_type || "INTERNSHIP",
            source_name: opp.source_name || opp.source || null,
            source_url: opp.source_url || opp.url || null,
            market: opp.market || null,
            globalOpportunityId: opp.id,
          },
        },
        authContext
      );
      added.push(shapeQueueItem(record));
    } catch (err) {
      const msg = String(err?.message || err);
      if (/unique|duplicate/i.test(msg)) {
        const existingAfter =
          (await repo.getByOpportunityId(opp.id, authContext.userId, authContext.tenantId)) ||
          (await repo.findMany({}, authContext)).find((a) => queueItemMatchesOpportunity(a, opp.id, opp));
        skipped.push({
          opportunityId: opp.id,
          applicationId: existingAfter?.id,
          reason: "already_in_queue",
        });
        continue;
      }
      throw err;
    }
  }

  return {
    added,
    skipped,
    addedCount: added.length,
    skippedCount: skipped.length,
    submitted: false,
    submitted_at: null,
  };
}

export async function listQueue({ container, authContext, state } = {}) {
  const repo = container?.applicationRepository;
  const apps = await repo.findMany(state ? { state } : {}, authContext);
  return apps.map(shapeQueueItem);
}

export async function pauseQueueItem({ container, authContext, applicationId, reason = "Paused by student" } = {}) {
  const repo = container.applicationRepository;
  const app = await loadOwned(repo, applicationId, authContext);
  if (!PAUSEABLE.has(app.state)) {
    throw Object.assign(new Error(`Cannot pause application in state ${app.state}`), { status: 409 });
  }
  const updated = await repo.updateApplicationState(
    app.id,
    QUEUE_MACHINE.PAUSED,
    { reason, pause_reason: reason, paused_at: new Date().toISOString() },
    authContext
  );
  return shapeQueueItem(updated);
}

export async function removeQueueItem({ container, authContext, applicationId } = {}) {
  const repo = container.applicationRepository;
  const app = await loadOwned(repo, applicationId, authContext);
  if (app.state === QUEUE_MACHINE.APPLYING) {
    throw Object.assign(new Error("Cannot remove an application that is currently applying"), { status: 409 });
  }
  if (typeof repo.deleteApplication === "function") {
    const ok = await repo.deleteApplication(app.id, authContext);
    return { removed: Boolean(ok), id: app.id };
  }
  throw new Error("deleteApplication is not available");
}

async function loadOwned(repo, applicationId, authContext) {
  const app =
    (await repo.getById?.(applicationId, authContext)) ||
    (await repo.getByOpportunityId(applicationId, authContext.userId, authContext.tenantId));
  if (!app) {
    throw Object.assign(new Error("Application not found"), { status: 404 });
  }
  return app;
}

/**
 * Run the intelligent 20-step workflow against queued items independently.
 * Does not fake SUBMITTED. One failure does not stop the rest.
 */
export async function applyQueueItems({
  container,
  authContext,
  ids = [],
  all = false,
  profile = {},
  cvText = "",
  processOpportunityFn,
  autoApply = false,
  skipBrowser = false,
  callAIFn = null,
  verifyLivenessFn = null,
  launchBrowserFn = null,
} = {}) {
  const repo = container.applicationRepository;
  const { allApps, items } = await selectQueueItemsForApply({
    repo,
    container,
    authContext,
    ids,
    all,
  });

  const results = [];
  for (const app of items) {
    try {
      results.push(
        await applyOneQueueItem({
          container,
          authContext,
          app,
          profile,
          cvText,
          processOpportunityFn,
          autoApply,
          skipBrowser,
          callAIFn,
          verifyLivenessFn,
          launchBrowserFn,
          existingApplications: allApps,
        })
      );
    } catch (err) {
      const failed = await repo.updateApplicationState(
        app.id,
        QUEUE_MACHINE.FAILED,
        { reason: err.message || "Apply failed" },
        authContext
      );
      results.push({
        ...shapeQueueItem(failed),
        ok: false,
        submitted: false,
        submitted_at: null,
        status: QUEUE_MACHINE.FAILED,
        message: err.message,
        outcome: `failed — ${err.message}`,
      });
    }
  }

  const submitted = results.some((r) => r.applicationStatus === QUEUE_MACHINE.SUBMITTED);
  return {
    processed: results.length,
    results,
    submitted,
    submittedCount: results.filter((r) => r.applicationStatus === QUEUE_MACHINE.SUBMITTED).length,
  };
}

async function applyOneQueueItem({
  container,
  authContext,
  app,
  profile,
  cvText,
  processOpportunityFn,
  autoApply = false,
  skipBrowser = false,
  callAIFn = null,
  verifyLivenessFn = null,
  launchBrowserFn = null,
  existingApplications = [],
}) {
  const repo = container.applicationRepository;
  const opportunityId = app.opportunity_id || app.opportunityId;
  const snapshotUrl = app.url || app.metadata?.url || app.metadata?.source_url;
  const store = container.opportunityStore || null;

  let resolved = await resolvePersistedOpportunity(
    container,
    { id: opportunityId, url: snapshotUrl },
    authContext
  );

  if (!resolved && !store) {
    resolved = {
      id: opportunityId,
      url: snapshotUrl,
      company: app.company,
      title: app.title,
      role: app.title,
      description: app.description || "",
      deadline: app.deadline || app.metadata?.deadline || null,
    };
  }

  if (!resolved) {
    const missing = await repo.updateApplicationState(
      app.id,
      QUEUE_MACHINE.SKIPPED,
      {
        reason: "Opportunity is no longer in the database.",
        skip_reason: "NOT_FOUND",
        last_message: "Opportunity is no longer in the database.",
        outcome: "skipped — listing missing",
      },
      authContext
    );
    return {
      ...shapeQueueItem(missing),
      ok: false,
      submitted: false,
      submitted_at: null,
      status: QUEUE_MACHINE.SKIPPED,
      skipReason: "NOT_FOUND",
      message: "Opportunity is no longer in the database.",
      outcome: "skipped — listing missing",
    };
  }

  const verify = await verifyPersistedOpportunity({
    opportunity: resolved,
    store,
    verifyLivenessFn:
      verifyLivenessFn ||
      (typeof processOpportunityFn === "function"
        ? null
        : (await import("./opportunity-ingest.mjs")).verifyPostingLiveness),
    now: new Date(),
  });

  if (!verify.ok) {
    const skipped = await repo.updateApplicationState(
      app.id,
      QUEUE_MACHINE.SKIPPED,
      {
        reason: verify.reason,
        skip_reason: verify.skipReason,
        last_message: verify.reason,
        outcome: `skipped — ${verify.skipReason || "closed"}`,
      },
      authContext
    );
    return {
      ...shapeQueueItem(skipped),
      ok: false,
      submitted: false,
      submitted_at: null,
      status: QUEUE_MACHINE.SKIPPED,
      skipReason: verify.skipReason,
      message: verify.reason,
      outcome: `skipped — ${verify.skipReason || "closed"}`,
    };
  }

  const opp = verify.opportunity || resolved;
  const opportunity = {
    ...opp,
    id: opp.id || opportunityId,
    title: opp.title || opp.role || app.title,
    company: opp.company || opp.company_name || app.company,
    url: opp.url || opp.applicationUrl || snapshotUrl,
    description: opp.description || app.description || "",
    deadline: opp.deadline || app.deadline || app.metadata?.deadline || null,
    questions: opp.questions || app.questions || app.metadata?.questions || [],
    application_fields: opp.application_fields || app.application_fields || app.metadata?.application_fields || [],
  };

  await repo.updateApplicationState(app.id, QUEUE_MACHINE.ANALYZING, { reason: "Apply started" }, authContext);

  const onQueueState = async (state, extra = {}) => {
    if (!Object.values(QUEUE_MACHINE).includes(state)) return;
    await repo.updateApplicationState(
      app.id,
      state,
      { reason: extra.reason || `Stage ${state}`, artifacts: extra.artifacts || {} },
      authContext
    );
  };

  let processResult;
  try {
    if (typeof processOpportunityFn === "function") {
      processResult = await processOpportunityFn({
        rawOpportunity: {
          ...opportunity,
          state: QUEUE_MACHINE.SELECTED,
          eligibility_status: app.eligibility_status || app.eligibilityStatus || opp.eligibility_status,
        },
        opportunity,
        profile,
        cvText,
        liveSubmit: autoApply === true,
        allowWhenStopped: true,
        onQueueState,
      });
    } else {
      const { ApplicationOrchestrator } = await import("./application-orchestrator.mjs");
      const orch = new ApplicationOrchestrator({
        opportunity,
        profile,
        cvText,
        container,
        authContext,
        autoApply,
        skipBrowser,
        existingApplications,
        applicationId: app.id,
        onQueueState,
        callAIFn,
        verifyLivenessFn: verifyLivenessFn || (typeof opportunity.verifyLivenessFn === "function" ? opportunity.verifyLivenessFn : null),
        launchBrowserFn,
      });
      processResult = await orch.processApplication();
    }
  } catch (err) {
    const failed = await repo.updateApplicationState(
      app.id,
      QUEUE_MACHINE.FAILED,
      { reason: err.message || "Apply failed" },
      authContext
    );
    return {
      ...shapeQueueItem(failed),
      ok: false,
      submitted: false,
      submitted_at: null,
      status: QUEUE_MACHINE.FAILED,
      message: err.message,
      outcome: `failed — ${err.message}`,
    };
  }

  const submittedAt = processResult?.submitted === true ? processResult.submitted_at || null : null;
  let engineStatus = processResult?.status;
  if (!engineStatus && processResult?.processed === false) {
    const reason = processResult?.reason || "";
    if (/ineligible|not_eligible/i.test(reason)) engineStatus = QUEUE_MACHINE.SKIPPED;
    else if (/captcha|user input|sensitive|unexpected|mfa/i.test(reason)) engineStatus = QUEUE_MACHINE.REQUIRES_USER_INPUT;
    else engineStatus = QUEUE_MACHINE.FAILED;
  }
  const nextState = mapEngineStatusToQueueState(engineStatus, submittedAt);

  const updated = await repo.updateApplicationState(
    app.id,
    nextState,
    {
      reason: processResult?.reason || processResult?.message || `Engine ${processResult?.status || "complete"}`,
      artifacts: {
        ...(processResult?.artifacts || {}),
        workflowSteps: processResult?.steps || [],
        skipReason: processResult?.skipReason || null,
        outcome: processResult?.outcome || null,
      },
      submitted_at: submittedAt,
      match_score: processResult?.match_score ?? processResult?.matchScore,
      eligibility_status: processResult?.eligibility_status,
      skip_reason: processResult?.skipReason || null,
      last_message: processResult?.reason || processResult?.message || null,
      outcome: processResult?.outcome || null,
      pause_reason: processResult?.pause_reason || null,
    },
    authContext
  );

  const shaped = shapeQueueItem(updated);
  return {
    ...shaped,
    ok: processResult?.ok !== false && nextState !== QUEUE_MACHINE.FAILED,
    submitted: nextState === QUEUE_MACHINE.SUBMITTED,
    submitted_at: submittedAt,
    status: nextState,
    message: processResult?.reason || processResult?.message || null,
    outcome: processResult?.outcome || shaped.outcome,
    skipReason: processResult?.skipReason || shaped.skipReason,
    engineStatus: processResult?.status || null,
    steps: processResult?.steps || [],
  };
}

/**
 * Enqueue persisted listings by id (if needed), then run apply.
 * Never starts a discovery scan.
 */
export async function applyPersistedOpportunities({
  container,
  authContext,
  opportunityIds = [],
  all = false,
  profile = {},
  cvText = "",
  processOpportunityFn,
  autoApply = false,
  skipBrowser = false,
  callAIFn = null,
  verifyLivenessFn = null,
  launchBrowserFn = null,
} = {}) {
  if (!all && Array.isArray(opportunityIds) && opportunityIds.length > 0) {
    await enqueueOpportunities({
      container,
      authContext,
      opportunityIds,
      count: opportunityIds.length,
    });
  }
  return applyQueueItems({
    container,
    authContext,
    ids: opportunityIds,
    all,
    profile,
    cvText,
    processOpportunityFn,
    autoApply,
    skipBrowser,
    callAIFn,
    verifyLivenessFn,
    launchBrowserFn,
  });
}
