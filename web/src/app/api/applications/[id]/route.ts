import { NextResponse } from "next/server";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { studentCareerRoot } from "@/lib/student-career-ai";
import { requireUserSession } from "@/lib/user-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { authContext, container } = await requireUserSession(req);
    const app =
      (await container.applicationRepository.getById?.(id, authContext)) ||
      (await container.applicationRepository.getByOpportunityId(id, authContext.userId, authContext.tenantId));

    if (!app) {
      return NextResponse.json(
        {
          ok: false,
          error: "Application not found",
          message: "No application record exists for this id. Nothing was invented.",
        },
        { status: 404 }
      );
    }

    const artifacts = app.artifacts || {};
    const rec = artifacts.applicationRecord || {};
    const tailored =
      artifacts.tailored_cv || rec.tailored_cv || null;
    const cvDecision =
      artifacts.cvDecision || rec.cv_decision || null;
    const submittedAt = app.submitted_at || app.applied_at || null;
    let status = app.state || "SELECTED";
    if ((status === "SUBMITTED" || status === "APPLIED") && !submittedAt) {
      status = "READY";
    }

    return NextResponse.json({
      ok: true,
      id: app.id,
      company: app.company || null,
      role: app.title || app.role || null,
      url: app.url || app.metadata?.url || null,
      status,
      dry_run: !submittedAt,
      submitted_at: submittedAt,
      discovered_at: app.discovered_at || app.createdAt || null,
      eligibility_status: app.eligibility_status || app.eligibilityStatus || "PENDING",
      match_score: typeof app.match_score === "number" ? app.match_score : app.matchScore ?? null,
      tailoredCV: tailored,
      originalCv: tailored?.original_cv || cvDecision?.originalCv || null,
      cvDecision,
      changesMade:
        (Array.isArray(tailored?.changes_made) && tailored.changes_made.length && tailored.changes_made) ||
        (Array.isArray(cvDecision?.changesMade) && cvDecision.changesMade.length && cvDecision.changesMade) ||
        cvDecision?.recommendedChanges ||
        tailored?.recommendedChanges ||
        [],
      reasonForChanges: tailored?.reason_for_changes || cvDecision?.reasonForChanges || cvDecision?.reason || null,
      coverLetter: artifacts.cover_letter || rec.cover_letter || null,
      coverLetterDecision: artifacts.coverLetterDecision || rec.cover_letter_decision || null,
      applicationAnswers: artifacts.application_answers || rec.application_answers || [],
      artifacts: {
        tailored_cv: tailored,
        cvDecision,
        cover_letter: artifacts.cover_letter || rec.cover_letter || null,
        coverLetterDecision: artifacts.coverLetterDecision || rec.cover_letter_decision || null,
        application_answers: artifacts.application_answers || rec.application_answers || null,
        applicationRecord: artifacts.applicationRecord || rec || null,
        agentSession: artifacts.agentSession || null,
      },
      eligibilityReport: artifacts.eligibilityReport || {
        verdict: app.eligibility_status || app.eligibilityStatus || "PENDING",
        checks: [],
        unknowns: [],
        note: "Detailed eligibility breakdown unavailable for this record.",
      },
      matchReport: artifacts.matchReport || {
        match_score: typeof app.match_score === "number" ? app.match_score : app.matchScore ?? null,
        tier: app.match_tier || null,
        strengths: [],
        missing_skills: [],
        recommendation: null,
        note:
          typeof app.match_score === "number" || typeof app.matchScore === "number"
            ? null
            : "Match score not computed yet.",
      },
    });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ ok: false, error: err.message || "Failed to load application" }, { status });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { authContext, container } = await requireUserSession(req);
    const root = studentCareerRoot();
    const moduleUrl = pathToFileURL(path.join(root, "lib", "saas", "application-queue.mjs")).href;
    const { removeQueueItem } = await import(/* webpackIgnore: true */ moduleUrl);
    const result = await removeQueueItem({ container, authContext, applicationId: id });
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ ok: false, error: err.message || "Failed to remove application" }, { status });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { authContext, container } = await requireUserSession(req);
    const app =
      (await container.applicationRepository.getById?.(id, authContext)) ||
      (await container.applicationRepository.getByOpportunityId?.(id, authContext.userId, authContext.tenantId));
    if (!app) {
      return NextResponse.json({ ok: false, error: "Application not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const intel = container.candidateIntelligenceService;

    if (body.preferredRole && intel) {
      await intel.recordUserCorrection(
        {
          field: "preferred_role",
          previousValue: body.previousRole || body.previousValue,
          newValue: body.preferredRole,
          opportunityId: app.opportunity_id || app.id,
          company: app.company,
        },
        authContext
      );
    }

    const answers = Array.isArray(body.answers) ? body.answers : body.answer ? [body.answer] : [];
    if (intel) {
      for (const a of answers) {
        const verdict = String(a.verdict || (a.corrected ? "CORRECTED" : a.approved === false ? "REJECTED" : "APPROVED")).toUpperCase();
        await intel.recordAnswerFeedback(
          {
            question: a.question || a.field,
            proposed: a.proposed || a.previous || null,
            corrected: a.corrected || a.answer || a.value || null,
            verdict,
            opportunityId: app.opportunity_id || app.id,
            company: app.company,
          },
          authContext
        );
      }
    }

    if (answers.length && container.applicationRepository.updateApplicationState) {
      const artifacts = app.artifacts || {};
      const existing = artifacts.application_answers || [];
      const merged = answers.map((a: any) => ({
        question: a.question || a.field,
        answer: a.corrected || a.answer || a.value,
        edited: true,
      }));
      await container.applicationRepository.updateApplicationState(
        app.id,
        app.state,
        {
          reason: "Application answers edited by student",
          artifacts: { application_answers: [...existing, ...merged] },
        },
        authContext
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ ok: false, error: err.message || "Failed to save feedback" }, { status });
  }
}
