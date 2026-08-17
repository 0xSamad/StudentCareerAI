import { NextResponse } from "next/server";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { studentCareerRoot } from "@/lib/student-career-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const root = studentCareerRoot();
    const moduleUrl = pathToFileURL(path.join(root, "lib", "autonomous-pipeline.mjs")).href;
    const { AutonomousPipeline } = await import(/* webpackIgnore: true */ moduleUrl);
    const pipeline = new AutonomousPipeline({ repoRoot: root });
    return NextResponse.json({ ok: true, config: pipeline.config });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const root = studentCareerRoot();
    const moduleUrl = pathToFileURL(path.join(root, "lib", "autonomous-pipeline.mjs")).href;
    const { AutonomousPipeline } = await import(/* webpackIgnore: true */ moduleUrl);
    const pipeline = new AutonomousPipeline({ repoRoot: root });
    const updated = pipeline.configure(body);
    return NextResponse.json({ ok: true, config: updated });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
