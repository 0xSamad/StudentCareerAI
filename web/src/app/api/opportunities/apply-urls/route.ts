import { NextResponse, after } from "next/server";
import path from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { studentCareerRoot } from "@/lib/student-career-ai";
import { emptyProfileShape, requireUserSession, withPreferredAiMatching } from "@/lib/user-session";
import { runStudentCareerLiveApply, continueStudentCareerLiveApply } from "@/lib/apply/live-from-profile";
import { guessListingFromUrl, normalizeApplyUrl } from "@/lib/apply/url-listing.mjs";
import { extractExternalJob } from "@/lib/apply/extract-external-job.mjs";
import { tailorUrlApplyDocuments } from "@/lib/apply/url-apply-tailor.mjs";
import { loadOriginalCv } from "@/lib/apply/user-cv-store.mjs";
import {
  createUrlApplyBatch,
  getUrlApplyBatch,
  MAX_URL_APPLY_JOBS,
  phaseToQueueState,
  resumeUrlApplyJob,
  openUrlApplySession,
  runUrlApplyBatch,
} from "@/lib/apply/multi-url-apply.mjs";
import { applyNotificationHub } from "@/lib/apply/apply-notifications.mjs";
import { setHitlPersistPath, loadHitlPersist } from "@/lib/apply/hitl-state.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

async function loadQueue() {
  const root = studentCareerRoot();
  const moduleUrl = pathToFileURL(path.join(root, "lib", "saas", "application-queue.mjs")).href;
  return import(/* webpackIgnore: true */ moduleUrl);
}

function engineCheckoutRoot() {
  const candidates = [studentCareerRoot(), process.cwd(), path.resolve(process.cwd(), "..")];
  for (const root of candidates) {
    if (root && existsSync(path.join(root, "lib", "cv-tailor.mjs"))) return root;
  }
  return studentCareerRoot();
}

async function loadUrlApplyEngines() {
  const root = engineCheckoutRoot();
  const tailorUrl = pathToFileURL(path.join(root, "lib", "cv-tailor.mjs")).href;
  const letterUrl = pathToFileURL(path.join(root, "lib", "application-generator.mjs")).href;
  const providerUrl = pathToFileURL(path.join(root, "lib", "ai-provider.mjs")).href;
  const [{ tailorCV }, { generateCoverLetter }, { callAI }] = await Promise.all([
    import(/* webpackIgnore: true */ tailorUrl),
    import(/* webpackIgnore: true */ letterUrl),
    import(/* webpackIgnore: true */ providerUrl),
  ]);
  return { tailorCV, generateCoverLetter, callAI };
}

function shapeProfile(stored: Record<string, unknown> | null | undefined) {
  const defaults = emptyProfileShape();
  if (!stored) return defaults;
  return {
    identity: (stored.identity as typeof defaults.identity) || defaults.identity,
    education: Array.isArray(stored.education) ? stored.education : [],
    skills: (stored.skills as typeof defaults.skills) || defaults.skills,
    experience: (stored.experience as typeof defaults.experience) || defaults.experience,
    projects: Array.isArray(stored.projects) ? stored.projects : [],
    certifications: Array.isArray(stored.certifications) ? stored.certifications : [],
    achievements: Array.isArray(stored.achievements) ? stored.achievements : [],
    languages: Array.isArray(stored.languages) ? stored.languages : [],
    preferences: (stored.preferences as typeof defaults.preferences) || defaults.preferences,
    matching: withPreferredAiMatching(stored.matching as Record<string, unknown> | undefined) as typeof defaults.matching,
    cvOriginal: stored.cvOriginal || null,
  };
}

function wireApplyPersist() {
  setHitlPersistPath(path.join(studentCareerRoot(), "data", "apply-hitl-state.json"));
  loadHitlPersist();
}

async function wireBatchPersist() {
  const { setBatchPersistPath } = await import("@/lib/apply/application-manager.mjs");
  setBatchPersistPath(path.join(studentCareerRoot(), "data", "apply-batches.json"));
}

async function buildUrlApplyDeps({
  userId,
  tenantId,
  container,
  authContext,
}: {
  userId: string;
  tenantId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  container: any;
  authContext: unknown;
}) {
  const stored = await container.profileRepository.getByUserId(userId, tenantId);
  const profile = shapeProfile(stored);
  const cvText = typeof stored?.cvText === "string" ? stored.cvText : "";
  const original = await loadOriginalCv({
    storage: container.storageService,
    record: stored?.cvOriginal,
    context: { userId, tenantId },
  });
  let fetchGitHubEvidence = null;
  try {
    const ghUrl = pathToFileURL(path.join(studentCareerRoot(), "lib", "saas", "knowledge", "github-enricher.mjs")).href;
    const ghMod = await import(/* webpackIgnore: true */ ghUrl);
    fetchGitHubEvidence = ghMod.fetchGitHubEvidence;
  } catch {
    fetchGitHubEvidence = null;
  }
  const githubToken =
    typeof stored?.secrets === "object" && stored.secrets
      ? String((stored.secrets as { githubToken?: string }).githubToken || "")
      : "";
  const listingUrl = await import(
    /* webpackIgnore: true */ pathToFileURL(path.join(studentCareerRoot(), "lib", "saas", "listing-url.mjs")).href
  );
  const engines = await loadUrlApplyEngines();
  const callAIFn = container.aiWorkerService?.complete
    ? async (_resolved: unknown, sys: string, usr: string) =>
        container.aiWorkerService.complete({ prompt: usr, system: sys, schema: true }, authContext)
    : (resolved: unknown, sys: string, usr: string) => engines.callAI(resolved, sys, usr);
  const { sessionHasInteractiveCaptcha, sessionIsUsableForFill, handoffSession } = await import("@/lib/apply/session");

  return {
    profile,
    cvText,
    matchingConfig: profile.matching,
    callAIFn,
    root: studentCareerRoot(),
    loaders: {
      tailorCV: engines.tailorCV,
      generateCoverLetter: engines.generateCoverLetter,
    },
    extractExternalJob,
    tailorUrlApplyDocuments,
    runStudentCareerLiveApply,
    continueLiveApply: continueStudentCareerLiveApply,
    originalBuffer: original?.buffer || null,
    originalFilename: original?.filename || "",
    originalMime: original?.mimeType || "",
    fetchGitHubEvidence,
    githubToken,
    captchaStillPresent: sessionHasInteractiveCaptcha,
    sessionUsable: sessionIsUsableForFill,
    focusSession: handoffSession,
    notifyHub: applyNotificationHub(),
    normalizeApplyUrl,
    guessListingFromUrl,
    listingUrl,
    persistOpportunity: async ({
      url,
      company,
      role,
      jdText,
    }: {
      url: string;
      company: string;
      role: string;
      jdText: string;
    }) => {
      let opportunityId = "";
      if (container.opportunityStore?.upsert) {
        const result = await container.opportunityStore.upsert({
          url,
          sourceUrl: url,
          applicationUrl: url,
          company: company || "Unknown company",
          title: role || "Untitled role",
          description: jdText || null,
          source: "url-apply",
          source_id: url.slice(0, 250),
        });
        opportunityId = String(result?.opportunity?.id || "").trim();
      }
      let applicationId = "";
      if (opportunityId) {
        try {
          const { enqueueOpportunities } = await loadQueue();
          const queued = await enqueueOpportunities({
            container,
            authContext,
            opportunityIds: [opportunityId],
            count: 1,
          });
          applicationId = String(queued?.added?.[0]?.id || queued?.applications?.[0]?.id || "").trim();
          if (!applicationId && container.applicationRepository?.getByOpportunityId) {
            const app = await container.applicationRepository.getByOpportunityId(opportunityId, userId, tenantId);
            applicationId = String(app?.id || "").trim();
          }
        } catch {
          /* queue is secondary */
        }
      }
      return { opportunityId, applicationId };
    },
    persistApplicationState: async (job: { applicationId?: string; phase?: string; message?: string }, extra: Record<string, unknown> = {}) => {
      if (!job?.applicationId || !container.applicationRepository?.updateApplicationState) return;
      await container.applicationRepository.updateApplicationState(
        job.applicationId,
        phaseToQueueState(job.phase),
        {
          reason: extra.reason || job.message,
          last_message: extra.last_message || job.message,
          pause_reason: extra.pause_reason || extra.reason || "REVIEW",
        },
        authContext,
      );
    },
  };
}

/**
 * Multi-URL apply. Does not replace POST /api/opportunities/apply.
 * GET  ?batchId= → poll independent job states
 * POST { urls }  → start one independent application per URL
 */
export async function GET(req: Request) {
  try {
    const { userId, tenantId } = await requireUserSession(req);
    wireApplyPersist();
    await wireBatchPersist();
    const batchId = new URL(req.url).searchParams.get("batchId") || "";
    if (!batchId) {
      return NextResponse.json({ ok: false, error: "batchId is required" }, { status: 400 });
    }
    const batch = getUrlApplyBatch(batchId, { userId });
    if (!batch) {
      return NextResponse.json({ ok: false, error: "Batch not found." }, { status: 404 });
    }
    const notifications = applyNotificationHub().listInApp(userId, tenantId);
    return NextResponse.json({ ok: true, batch, notifications });
  } catch (err: unknown) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as { status?: number }).status) || 500 : 500;
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to load applications" },
      { status },
    );
  }
}

export async function POST(req: Request) {
  try {
    const { userId, tenantId, container, authContext } = await requireUserSession(req);
    const body = await req.json().catch(() => ({}));
    const urls = Array.isArray(body.urls) ? body.urls : [];
    if (!urls.length) {
      return NextResponse.json({ ok: false, error: "Add at least one job URL." }, { status: 400 });
    }
    if (urls.length > MAX_URL_APPLY_JOBS) {
      return NextResponse.json(
        { ok: false, error: `You can start at most ${MAX_URL_APPLY_JOBS} applications at once.` },
        { status: 400 },
      );
    }

    wireApplyPersist();
    await wireBatchPersist();
    const deps = await buildUrlApplyDeps({ userId, tenantId, container, authContext });
    if (!deps.profile?.identity?.name) {
      return NextResponse.json({ ok: false, error: "Complete your profile (name) before applying." }, { status: 400 });
    }

    const batch = createUrlApplyBatch(urls, { userId, tenantId });
    const running = runUrlApplyBatch(batch.id, deps).catch((err) => {
      console.error("Multi-URL apply batch failed:", err);
    });
    const keep = ((globalThis as { __coUrlApplyRunning?: Map<string, Promise<unknown>> }).__coUrlApplyRunning ??= new Map());
    keep.set(batch.id, running);
    void running.finally(() => keep.delete(batch.id));
    after(() => running);

    return NextResponse.json({
      ok: true,
      submitted: false,
      dry_run: true,
      batchId: batch.id,
      batch,
      message: `Started ${batch.jobs.length} independent application${batch.jobs.length === 1 ? "" : "s"}. Nothing will be submitted.`,
    });
  } catch (err: unknown) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as { status?: number }).status) || 500 : 500;
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Could not start applications.",
        dry_run: true,
        submitted: false,
      },
      { status },
    );
  }
}

/**
 * Resume a paused application after the user completed CAPTCHA, signed in,
 * or provided a missing answer. Never bypasses CAPTCHA.
 */
export async function PATCH(req: Request) {
  try {
    const { userId, tenantId, container, authContext } = await requireUserSession(req);
    wireApplyPersist();
    await wireBatchPersist();
    const body = await req.json().catch(() => ({}));
    const batchId = String(body.batchId || "").trim();
    const jobId = String(body.jobId || "").trim();
    const action = String(body.action || "resume").trim();
    if (!batchId || !jobId) {
      return NextResponse.json({ ok: false, error: "batchId and jobId are required" }, { status: 400 });
    }
    const existing = getUrlApplyBatch(batchId, { userId });
    if (!existing) {
      return NextResponse.json({ ok: false, error: "Batch not found." }, { status: 404 });
    }

    const deps = await buildUrlApplyDeps({ userId, tenantId, container, authContext });

    if (action === "open") {
      const opened = await openUrlApplySession(batchId, jobId, deps);
      return NextResponse.json({ ok: true, submitted: false, opened, batch: getUrlApplyBatch(batchId, { userId }) });
    }

    const batch = await resumeUrlApplyJob(
      batchId,
      jobId,
      {
        answers: body.answers,
        jdText: body.jdText,
        captchaCleared: Boolean(body.captchaCleared),
      },
      deps,
    );
    return NextResponse.json({
      ok: true,
      submitted: false,
      dry_run: true,
      batch,
      notifications: applyNotificationHub().listInApp(userId, tenantId),
      message: "Resumed from the saved application. Nothing was submitted.",
    });
  } catch (err: unknown) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as { status?: number }).status) || 500 : 500;
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Could not resume application.", submitted: false },
      { status },
    );
  }
}
