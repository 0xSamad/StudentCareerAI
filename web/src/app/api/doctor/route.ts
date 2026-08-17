import { execFile } from "node:child_process";
import fs from "node:fs";
import { studentCareerRoot, rootScript } from "@/lib/student-career-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Orchestrates the core's own cold-start check (doctor.mjs --json) — the SAME
// source of truth the CLI uses to decide onboarding. We never reimplement the
// prerequisite list; we read the core's verdict.
export async function GET() {
  const root = studentCareerRoot();
  const doctor = rootScript("doctor");
  if (!fs.existsSync(doctor)) {
    return Response.json({ available: false, onboardingNeeded: false, missing: [], warnings: [] });
  }
  const stdout = await new Promise<string>((resolve) => {
    execFile("node", [doctor, "--json"], { cwd: root, timeout: 10_000 }, (_err, out) => resolve(out || ""));
  });
  try {
    const last = stdout.trim().split("\n").pop() || "{}";
    const j = JSON.parse(last);
    const missing = Array.isArray(j.missing) ? j.missing : [];
    const warnings = Array.isArray(j.warnings) ? j.warnings : [];
    const filteredMissing = missing.filter((entry: any) => {
      const path = String(entry?.path || entry?.file || "");
      return path !== "config/profile.yml" && path !== "portals.yml";
    });
    const filteredWarnings = warnings.filter((entry: any) => {
      const path = String(entry?.path || entry?.file || "");
      return path !== "config/profile.yml" && path !== "portals.yml";
    });
    return Response.json({
      available: true,
      onboardingNeeded: !!filteredMissing.length,
      missing: filteredMissing,
      warnings: filteredWarnings,
      saasIgnoredPrereqs: ["config/profile.yml", "portals.yml"],
    });
  } catch {
    return Response.json({ available: false, onboardingNeeded: false, missing: [], warnings: [] });
  }
}
