import { NextResponse } from "next/server";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { studentCareerRoot } from "@/lib/student-career-ai";
import { emptyProfileShape, requireUserSession, withPreferredAiMatching } from "@/lib/user-session";

async function loadPersistApplication() {
  const root = studentCareerRoot();
  const moduleUrl = pathToFileURL(path.join(root, "lib", "saas", "persist-application.mjs")).href;
  return import(/* webpackIgnore: true */ moduleUrl);
}

async function loadWorkflow() {
  const root = studentCareerRoot();
  const moduleUrl = pathToFileURL(path.join(root, "lib", "saas", "application-workflow.mjs")).href;
  return import(/* webpackIgnore: true */ moduleUrl);
}

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

export async function POST(req: Request) {
  try {
    const { userId, tenantId, container, authContext } = await requireUserSession(req);
    const body = await req.json();
    const opportunityIds: string[] = Array.isArray(body.opportunityIds) ? body.opportunityIds : [];

    if (opportunityIds.length === 0) {
      return NextResponse.json({ ok: false, error: "opportunityIds array is required" }, { status: 400 });
    }

    const stored = await container.profileRepository.getByUserId(userId, tenantId);
    const profile = shapeProfile(stored);
    const cvText = typeof stored?.cvText === "string" ? stored.cvText : "";

    if (!profile.identity?.name) {
      return NextResponse.json({ ok: false, error: "Complete your profile before batch apply." }, { status: 400 });
    }

    const { runApplicationBatch, readAutoApply, summarizeBatch } = await loadWorkflow();
    const { persistApplicationRecord } = await loadPersistApplication();
    const root = studentCareerRoot();
    const autoApply = body.confirmSubmit === true || body.autoApply === true || readAutoApply(root);

    const existingApplications = await container.applicationRepository.findMany({}, authContext);
    const items = [];
    for (const id of opportunityIds.slice(0, 50)) {
      const targetOpp = await container.opportunityRepository.findById(id, authContext);
      if (!targetOpp?.url) {
        items.push({
          opportunity: { id, url: null, company: "Unknown", title: "Unknown" },
          applicationId: null,
        });
        continue;
      }
      items.push({
        opportunity: {
          ...targetOpp,
          title: targetOpp.title || targetOpp.role,
          company: targetOpp.company || targetOpp.company_name,
          description: targetOpp.description || "",
        },
        applicationId: existingApplications.find((a: any) => a.opportunity_id === id)?.id || null,
      });
    }

    const callAIFn = container.aiWorkerService?.complete
      ? async (_: unknown, sys: string, usr: string) =>
          container.aiWorkerService.complete({ prompt: usr, system: sys }, authContext)
      : null;

    const batch = await runApplicationBatch({
      items,
      profile,
      cvText,
      container,
      authContext,
      autoApply,
      callAIFn,
      existingApplications,
      onItemComplete: async (result: any, item: any) => {
        const targetOpp = item.opportunity;
        if (!targetOpp?.id || !targetOpp.url) return;
        try {
          await persistApplicationRecord({
            container,
            authContext,
            targetOpp,
            normalized: {
              status: result.status,
              dry_run: result.dry_run,
              submitted_at: result.submitted_at,
              message: result.outcome || result.reason,
            },
            processResult: result,
          });
        } catch (persistErr) {
          console.error("Batch persist application failed:", persistErr);
        }
      },
    });

    const summary = summarizeBatch(batch.results);
    return NextResponse.json({
      ok: true,
      autoApply,
      message: summary.headline,
      summary,
      liveSubmit: autoApply,
      results: batch.results.map((r: any) => ({
        id: r.opportunityId,
        ok: r.ok,
        status: r.status,
        outcome: r.outcome,
        skipReason: r.skipReason,
        message: r.reason,
        dry_run: r.dry_run,
        submitted_at: r.submitted_at,
        company: r.company,
        title: r.title,
      })),
    });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ ok: false, error: err.message || "Batch apply failed" }, { status });
  }
}
