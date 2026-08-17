import { NextResponse } from "next/server";
import { requireUserSession } from "@/lib/user-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadApp(container: any, id: string, authContext: any) {
  return (
    (await container.applicationRepository.getById?.(id, authContext)) ||
    (await container.applicationRepository.getByOpportunityId?.(id, authContext.userId, authContext.tenantId))
  );
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { authContext, container } = await requireUserSession(req);
    const engine = container.coverLetterDecisionEngine;
    if (!engine) return NextResponse.json({ ok: true, versions: [] });

    const app = await loadApp(container, id, authContext);
    let versions = await engine.listVersions(authContext, { applicationId: app?.id || id });
    if (!versions.length) {
      versions = await engine.listVersions(authContext, { jobId: app?.opportunity_id || id });
    }
    return NextResponse.json({
      ok: true,
      versions: versions.map((v: any) => ({
        id: v.id,
        kind: v.kind,
        version: v.version,
        jobId: v.jobId,
        coverLetter: v.coverLetter,
        subjectLine: v.subjectLine,
        sourceEvidence: v.sourceEvidence || [],
        requirement: v.requirement,
        reason: v.reason,
        generatedAt: v.generatedAt,
        createdAt: v.createdAt,
      })),
    });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ ok: false, error: err.message || "Failed to load cover letters" }, { status });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { authContext, container } = await requireUserSession(req);
    const app = await loadApp(container, id, authContext);
    if (!app) {
      return NextResponse.json({ ok: false, error: "Application not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const letterBody = String(body.body || body.coverLetter || "").trim();
    if (!letterBody) {
      return NextResponse.json({ ok: false, error: "Cover letter body is required to save an edit." }, { status: 400 });
    }

    const artifacts = app.artifacts || {};
    const current = artifacts.cover_letter || artifacts.applicationRecord?.cover_letter || {};
    const engine = container.coverLetterDecisionEngine;
    let record = {
      ...current,
      body: letterBody,
      coverLetter: letterBody,
      subject_line: body.subject_line || body.subjectLine || current.subject_line || null,
      edited: true,
      generatedAt: new Date().toISOString(),
    };

    if (engine) {
      const saved = await engine.saveEdit({
        body: letterBody,
        subjectLine: record.subject_line,
        opportunity: { id: app.opportunity_id, company: app.company, title: app.title },
        applicationId: app.id,
        analysis: artifacts.coverLetterDecision || {},
        sourceEvidence: current.sourceEvidence || [],
        context: authContext,
      });
      record = { ...record, ...saved.record };
    }

    if (container.candidateIntelligenceService) {
      await container.candidateIntelligenceService
        .recordAnswerFeedback(
          {
            question: `Cover letter for ${app.company || ""} ${app.title || ""}`.trim(),
            proposed: current.body || current.coverLetter || null,
            corrected: letterBody,
            verdict: "CORRECTED",
            opportunityId: app.opportunity_id || app.id,
            company: app.company,
          },
          authContext
        )
        .catch(() => null);
    }

    if (container.applicationRepository.updateApplicationState) {
      await container.applicationRepository.updateApplicationState(
        app.id,
        app.state,
        {
          reason: "Cover letter edited by student",
          artifacts: { cover_letter: record },
        },
        authContext
      );
    }

    return NextResponse.json({ ok: true, coverLetter: record });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ ok: false, error: err.message || "Failed to save cover letter" }, { status });
  }
}
