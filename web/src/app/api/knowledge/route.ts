import { NextResponse } from "next/server";
import { requireUserSession } from "@/lib/user-session";
import { attachProfileSuggestions } from "../../../../../lib/saas/knowledge/profile-suggestions.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { authContext, container } = await requireUserSession(req);
    const knowledge = await container.candidateKnowledgeService.listKnowledge(authContext);
    return NextResponse.json({
      ok: true,
      ...knowledge,
    });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ ok: false, error: err.message || "Failed to load knowledge base" }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const { authContext, userId, tenantId, container } = await requireUserSession(req);
    const contentType = req.headers.get("content-type") || "";

    let input: Record<string, unknown> = {};
    if (contentType.includes("multipart/form-data") || contentType.includes("multipart/")) {
      const form = await req.formData();
      const file = form.get("file") || form.get("cv") || form.get("document");
      const type = String(form.get("type") || form.get("docType") || "");
      const title = String(form.get("title") || "");
      const text = String(form.get("text") || "");
      input = { type, title, text, filename: "" };
      if (file && typeof file === "object" && "arrayBuffer" in file) {
        const blob = file as File;
        input.filename = blob.name;
        input.mimeType = blob.type;
        input.buffer = Buffer.from(await blob.arrayBuffer());
        if (!title) input.title = blob.name;
      }
    } else {
      const body = await req.json().catch(() => ({}));
      input = {
        type: body.type || body.docType,
        title: body.title,
        text: body.text || body.content,
        filename: body.filename,
        sourceName: body.sourceName,
        profile: body.profile,
      };
    }

    const result = await container.candidateKnowledgeService.ingestDocument(input, authContext);
    const stored = await container.profileRepository.getByUserId(userId, tenantId);
    const withSuggestions = attachProfileSuggestions(result, stored, String(input.type || "evidence").toLowerCase());
    const { facts: _facts, text: _text, extractedText: _extracted, ...safe } = withSuggestions;
    const status = result.ok ? 200 : 400;
    return NextResponse.json(safe, { status });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ ok: false, error: err.message || "Ingest failed" }, { status });
  }
}
