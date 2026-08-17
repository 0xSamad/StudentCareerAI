import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { NextResponse } from "next/server";
import { studentCareerRoot } from "@/lib/student-career-ai";
import {
  findApplyArtifacts,
  fromBatches,
  mimeForKind,
  resolveApplyArtifactFile,
} from "@/lib/apply/apply-review-artifacts.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dataRoots(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const root of [studentCareerRoot(), process.cwd(), resolve(process.cwd(), ".."), resolve(process.cwd(), "../..")]) {
    const n = resolve(root);
    if (seen.has(n)) continue;
    seen.add(n);
    if (existsSync(join(n, "data", "apply-review")) || existsSync(join(n, "output", "apply")) || existsSync(join(n, "data", "apply-batches.json"))) {
      out.push(n);
    }
  }
  return out.length ? out : [resolve(studentCareerRoot())];
}

function artifactQueryUrl(reqUrl: string, kind: string) {
  const u = new URL(reqUrl);
  u.searchParams.set("kind", kind);
  return `${u.pathname}?${u.searchParams.toString()}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const company = String(url.searchParams.get("company") || "").trim();
  const role = String(url.searchParams.get("role") || "").trim();
  const jobId = String(url.searchParams.get("job") || "").trim();
  const kind = String(url.searchParams.get("kind") || "").trim();
  if (!company && !jobId) return NextResponse.json({ error: "company is required" }, { status: 400 });

  const roots = dataRoots();

  if (kind) {
    const file = resolveApplyArtifactFile({ roots, company, role, jobId, kind });
    if (!file) return NextResponse.json({ error: "file not found" }, { status: 404 });
    const buf = readFileSync(file);
    return new NextResponse(buf, {
      headers: {
        "Content-Type": mimeForKind(kind),
        "Content-Disposition": `inline; filename="${basename(file).replace(/"/g, "")}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const found = findApplyArtifacts({ roots, company, role, jobId });
  let cv = found.cv;
  let html = found.html;
  let coverLetter = found.coverLetter;
  let coverHtml = found.coverHtmlBody;

  if (!html || !cv || !coverLetter || !coverHtml) {
    const batch = fromBatches(roots, company, role, jobId);
    if (batch) {
      html = html || batch.cvHtml || "";
      cv = cv || batch.cvText || "";
      coverLetter = coverLetter || batch.coverLetter || "";
      coverHtml = coverHtml || batch.coverHtml || "";
    }
  }

  return NextResponse.json({
    company,
    role,
    job: jobId,
    cv,
    html,
    coverLetter,
    coverHtml,
    cvPdfUrl: found.cvPdf ? artifactQueryUrl(req.url, "cv-pdf") : "",
    coverPdfUrl: found.coverPdf ? artifactQueryUrl(req.url, "cover-pdf") : "",
  });
}
