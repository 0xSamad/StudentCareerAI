import { NextResponse } from "next/server";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { studentCareerRoot } from "@/lib/student-career-ai";
import { emptyProfileShape, requireUserSession, withPreferredAiMatching } from "@/lib/user-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId, tenantId, container, authContext } = await requireUserSession(req);
    const stored = await container.profileRepository.getByUserId(userId, tenantId);
    const profile = shapeProfile(stored);
    const cvText = typeof stored?.cvText === "string" ? stored.cvText : "";

    const root = studentCareerRoot();
    const queueUrl = pathToFileURL(path.join(root, "lib", "saas", "application-queue.mjs")).href;
    const workflowUrl = pathToFileURL(path.join(root, "lib", "saas", "application-workflow.mjs")).href;
    const { applyQueueItems } = await import(/* webpackIgnore: true */ queueUrl);
    const { readAutoApply } = await import(/* webpackIgnore: true */ workflowUrl);

    const callAIFn = container.aiWorkerService?.complete
      ? async (_: unknown, sys: string, usr: string) =>
          container.aiWorkerService.complete({ prompt: usr, system: sys }, authContext)
      : null;

    const result = await applyQueueItems({
      container,
      authContext,
      ids: [id],
      all: false,
      profile,
      cvText,
      autoApply: readAutoApply(root),
      callAIFn,
    });

    const item = result.results[0] || null;
    return NextResponse.json({
      ok: Boolean(item),
      submitted: item?.applicationStatus === "SUBMITTED",
      application: item,
      message: item?.outcome || item?.message || "Retry finished.",
      ...result,
    });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ ok: false, error: err.message || "Retry failed" }, { status });
  }
}
