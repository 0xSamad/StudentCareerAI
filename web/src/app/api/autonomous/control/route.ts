import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { studentCareerRoot } from "@/lib/student-career-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Module-level loop handle so Start Agent actually runs work in-process. */
declare global {
  // eslint-disable-next-line no-var
  var __scAgentLoop: { stop: () => void; running: boolean } | undefined;
}

function loadProfileAndCv(root: string): { profile: any; cvText: string } {
  const cvPath = path.join(root, "cv.md");
  const jsonSidecar = path.join(root, "data", "student-profile.json");
  let cvText = "";
  let profile: any = {};

  try {
    if (fs.existsSync(cvPath)) cvText = fs.readFileSync(cvPath, "utf-8");
  } catch {}

  try {
    if (fs.existsSync(jsonSidecar)) {
      profile = JSON.parse(fs.readFileSync(jsonSidecar, "utf-8"));
    }
  } catch {}

  if (!profile?.identity) {
    const nameMatch = cvText.match(/^#\s*(.+)$/m);
    const emailMatch = cvText.match(/[\w.+-]+@[\w.-]+\.\w+/);
    profile = {
      identity: {
        name: nameMatch?.[1]?.trim() || "Candidate",
        email: emailMatch?.[0] || null,
      },
      education: [],
      skills: {},
      experience: { internships: [] },
      projects: [],
      preferences: { search_mode: "internships" },
      matching: {
        ai_provider: process.env.AI_PROVIDER === "gemini" && !process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY
          ? "gemini"
          : process.env.AI_PROVIDER === "ollama"
            ? "ollama"
            : "openai",
      },
    };
  }

  return { profile, cvText };
}

function sanitizeLogs(logs: any[]) {
  return (logs || []).map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const { stack, ...rest } = entry;
    return {
      ...rest,
      error: rest.error ? String(rest.error).slice(0, 500) : rest.error,
    };
  });
}

export async function POST(req: Request) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const { action, reason, forceEnable, config } = body;
    const root = studentCareerRoot();
    const moduleUrl = pathToFileURL(path.join(root, "lib", "autonomous-pipeline.mjs")).href;
    const { AutonomousPipeline } = await import(/* webpackIgnore: true */ moduleUrl);
    const pipeline = new AutonomousPipeline({ repoRoot: root });

    if (config && typeof config === "object") {
      pipeline.configure(config);
    }

    if (forceEnable) {
      pipeline.configure({ AUTONOMOUS_MODE: true });
    }

    const { profile, cvText } = loadProfileAndCv(root);
    let resultStatus: any;

    switch (action) {
      case "start": {
        resultStatus = await pipeline.start();

        // Stop any previous loop, then start a real background cycle.
        if (globalThis.__scAgentLoop?.running) {
          globalThis.__scAgentLoop.stop();
        }

        let cancelled = false;
        globalThis.__scAgentLoop = {
          running: true,
          stop: () => {
            cancelled = true;
            globalThis.__scAgentLoop = { ...(globalThis.__scAgentLoop as any), running: false, stop: () => {} };
          },
        };

        // Fire-and-forget continuous loop (does not block the HTTP response).
        void (async () => {
          try {
            await pipeline.startContinuousLoop({
              intervalMs: Number(config?.SCAN_INTERVAL_MS) || 30000,
              profile,
              cvText,
              maxCycles: Number(config?.MAX_CYCLES) || Infinity,
            });
          } catch (err: any) {
            try {
              await pipeline.pause(`Worker crashed: ${err?.message || "unknown error"}`);
            } catch {}
          } finally {
            if (globalThis.__scAgentLoop) {
              globalThis.__scAgentLoop.running = false;
            }
          }
        })();

        break;
      }
      case "pause":
        if (globalThis.__scAgentLoop?.running) globalThis.__scAgentLoop.stop();
        resultStatus = await pipeline.pause(reason || "User requested pause via UI");
        break;
      case "resume": {
        resultStatus = await pipeline.resume();
        if (globalThis.__scAgentLoop?.running) {
          globalThis.__scAgentLoop.stop();
        }
        let cancelled = false;
        globalThis.__scAgentLoop = {
          running: true,
          stop: () => {
            cancelled = true;
          },
        };
        void (async () => {
          try {
            await pipeline.startContinuousLoop({
              intervalMs: Number(config?.SCAN_INTERVAL_MS) || 30000,
              profile,
              cvText,
            });
          } catch (err: any) {
            try {
              await pipeline.pause(`Worker crashed: ${err?.message || "unknown error"}`);
            } catch {}
          } finally {
            if (globalThis.__scAgentLoop) globalThis.__scAgentLoop.running = false;
          }
        })();
        break;
      }
      case "stop":
        if (globalThis.__scAgentLoop?.running) globalThis.__scAgentLoop.stop();
        resultStatus = await pipeline.stop();
        break;
      case "reset":
        if (globalThis.__scAgentLoop?.running) globalThis.__scAgentLoop.stop();
        resultStatus = await pipeline.resetState();
        break;
      case "run-once":
        if (pipeline.state !== "RUNNING") {
          await pipeline.configure({ AUTONOMOUS_MODE: true });
          await pipeline.start();
        }
        resultStatus = await pipeline.runCycle({ profile, cvText, maxItems: 5 });
        break;
      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
    }

    const recentLogs = sanitizeLogs(await pipeline.auditLog.getLogs(15));
    return NextResponse.json({
      ok: true,
      action,
      status: resultStatus || (await pipeline.getStatus()),
      worker_loop_active: Boolean(globalThis.__scAgentLoop?.running),
      recentLogs,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
