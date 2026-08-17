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
    const status = await pipeline.getStatus();
    const recentLogs = await pipeline.auditLog.getLogs(15);
    return NextResponse.json({ ok: true, ...status, status, recentLogs });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message, state: "STOPPED" }, { status: 500 });
  }
}
