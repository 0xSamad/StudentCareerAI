import { NextResponse } from "next/server";
import { requireUserSession } from "@/lib/user-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Record user-provided feedback for Candidate Intelligence.
 * AI-generated drafts are never stored as facts.
 *
 * body.kind:
 *   correction | answer | interview | confirm
 */
export async function POST(req: Request) {
  try {
    const { authContext, container } = await requireUserSession(req);
    const intel = container.candidateIntelligenceService;
    if (!intel) {
      return NextResponse.json({ ok: false, error: "Candidate intelligence is not available." }, { status: 503 });
    }

    const body = await req.json().catch(() => ({}));
    const kind = String(body.kind || body.type || "").toLowerCase();

    if (kind === "correction" || kind === "preference") {
      const profile = await intel.recordUserCorrection(
        {
          field: body.field || "preferred_role",
          previousValue: body.previousValue ?? body.from ?? body.previous,
          newValue: body.newValue ?? body.to ?? body.value,
          opportunityId: body.opportunityId || body.jobId || null,
          company: body.company || null,
        },
        authContext
      );
      return NextResponse.json({ ok: true, kind: "correction", profile });
    }

    if (kind === "answer") {
      const profile = await intel.recordAnswerFeedback(
        {
          question: body.question,
          proposed: body.proposed || body.previous || null,
          corrected: body.corrected || body.answer || body.value || null,
          verdict: String(body.verdict || "CORRECTED").toUpperCase(),
          opportunityId: body.opportunityId || body.jobId || null,
          company: body.company || null,
        },
        authContext
      );
      return NextResponse.json({ ok: true, kind: "answer", profile });
    }

    if (kind === "interview") {
      const profile = await intel.recordInterviewInformation(
        {
          company: body.company,
          notes: body.notes || body.value,
          opportunityId: body.opportunityId || null,
          round: body.round || null,
        },
        authContext
      );
      return NextResponse.json({ ok: true, kind: "interview", profile });
    }

    if (kind === "confirm") {
      const profile = await intel.confirmGenerated(
        {
          field: body.field || "claim",
          value: body.value || body.newValue,
          opportunityId: body.opportunityId || null,
        },
        authContext
      );
      return NextResponse.json({ ok: true, kind: "confirm", profile });
    }

    return NextResponse.json(
      { ok: false, error: "kind must be correction, answer, interview, or confirm" },
      { status: 400 }
    );
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ ok: false, error: err.message || "Failed to record feedback" }, { status });
  }
}
