import { NextResponse } from "next/server";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { studentCareerRoot } from "@/lib/student-career-ai";
import { emptyProfileShape, requireUserSession, withPreferredAiMatching } from "@/lib/user-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function loadQueue() {
  const root = studentCareerRoot();
  const moduleUrl = pathToFileURL(path.join(root, "lib", "saas", "application-queue.mjs")).href;
  return import(/* webpackIgnore: true */ moduleUrl);
}

async function loadWorkflow() {
  const root = studentCareerRoot();
  const moduleUrl = pathToFileURL(path.join(root, "lib", "saas", "application-workflow.mjs")).href;
  return import(/* webpackIgnore: true */ moduleUrl);
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
    preferences: (stored.preferences as typeof defaults.preferences) || defaults.preferences,
    matching: withPreferredAiMatching(stored.matching as Record<string, unknown> | undefined) as typeof defaults.matching,
  };
}

export async function POST(req: Request) {
  try {
    const { userId, tenantId, container, authContext } = await requireUserSession(req);
    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
    const all = body.all === true;

    if (!all && ids.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Pass ids or all: true" },
        { status: 400 }
      );
    }

    const stored = await container.profileRepository.getByUserId(userId, tenantId);
    const profile = shapeProfile(stored);
    const cvText = typeof stored?.cvText === "string" ? stored.cvText : "";

    if (!profile.identity?.name) {
      return NextResponse.json(
        { ok: false, error: "Complete your profile before applying from the queue." },
        { status: 400 }
      );
    }

    const { applyQueueItems } = await loadQueue();
    const { readAutoApply, summarizeBatch } = await loadWorkflow();
    const root = studentCareerRoot();
    const autoApply = body.autoApply === true || readAutoApply(root);

    const callAIFn = container.aiWorkerService?.complete
      ? async (_: unknown, sys: string, usr: string) =>
          container.aiWorkerService.complete({ prompt: usr, system: sys }, authContext)
      : null;

    const result = await applyQueueItems({
      container,
      authContext,
      ids,
      all,
      profile,
      cvText,
      autoApply,
      callAIFn,
    });

    const summary = summarizeBatch(result.results);
    if (!all && ids.length > 0 && (result.results || []).length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "That listing is in your Applications queue but Apply could not restart it. Open Applications and use Retry or Apply All.",
          processed: 0,
          results: [],
        },
        { status: 409 }
      );
    }
    const paused = (result.results || []).filter(
      (r: { applicationStatus?: string; status?: string }) =>
        r.applicationStatus === "REQUIRES_USER_INPUT" ||
        r.applicationStatus === "PAUSED" ||
        r.status === "REQUIRES_USER_INPUT"
    );
    const message =
      paused.length > 0
        ? "Chrome is open on the application form. Complete any remaining fields yourself — nothing was submitted."
        : summary.headline || "Chrome should be open on the application form. Nothing was submitted.";
    return NextResponse.json({
      ok: true,
      submitted: summary.submitted > 0,
      submittedCount: summary.submitted,
      autoApply,
      message,
      summary,
      ...result,
    });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ ok: false, error: err.message || "Failed to apply from queue" }, { status });
  }
}
