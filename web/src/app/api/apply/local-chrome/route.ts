import { NextResponse } from "next/server";
import { requireUserSession } from "@/lib/user-session";
import {
  authLocalChromeToken,
  heartbeatLocalChrome,
  localChromeCommand,
  localChromeConnected,
  tokenForUser,
} from "@/lib/apply/local-chrome-registry.mjs";
import { applyLocalChromeLiveResult, takeLocalChromeWork } from "@/lib/apply/multi-url-apply.mjs";
import { setHitlPersistPath, loadHitlPersist } from "@/lib/apply/hitl-state.mjs";
import { studentCareerRoot } from "@/lib/student-career-ai";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function wirePersist() {
  setHitlPersistPath(path.join(studentCareerRoot(), "data", "apply-hitl-state.json"));
  loadHitlPersist();
}

async function wireBatchPersist() {
  const { setBatchPersistPath } = await import("@/lib/apply/application-manager.mjs");
  setBatchPersistPath(path.join(studentCareerRoot(), "data", "apply-batches.json"));
}

function requestOrigin(req: Request) {
  const url = new URL(req.url);
  const forwarded = req.headers.get("x-forwarded-host");
  const proto = req.headers.get("x-forwarded-proto") || url.protocol.replace(":", "") || "http";
  if (forwarded) return `${proto}://${forwarded.split(",")[0].trim()}`;
  return `${url.protocol}//${url.host}`;
}

export async function GET(req: Request) {
  try {
    const { userId, tenantId } = await requireUserSession(req);
    const token = tokenForUser(userId, tenantId);
    const origin = requestOrigin(req);
    return NextResponse.json({
      ok: true,
      connected: localChromeConnected(userId),
      token,
      server: origin,
      command: localChromeCommand(origin, token),
    });
  } catch (err: unknown) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as { status?: number }).status) || 500 : 500;
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Could not load Chrome helper status." },
      { status },
    );
  }
}

export async function POST(req: Request) {
  try {
    wirePersist();
    await wireBatchPersist();
    const body = await req.json().catch(() => ({}));
    const token = String(body.token || req.headers.get("x-apply-chrome-token") || "").trim();
    const row = heartbeatLocalChrome(token) || authLocalChromeToken(token);
    if (!row) {
      return NextResponse.json({ ok: false, error: "Invalid or expired Chrome helper token." }, { status: 401 });
    }

    const action = String(body.action || "work").trim();
    if (action === "heartbeat") {
      heartbeatLocalChrome(token);
      return NextResponse.json({ ok: true, connected: true });
    }

    if (action === "work") {
      heartbeatLocalChrome(token);
      const busyJobId = String(body.busyJobId || "");
      let work = takeLocalChromeWork(row.userId, { busyJobId });
      if (!busyJobId) {
        const started = Date.now();
        while (!work && Date.now() - started < 20_000) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          work = takeLocalChromeWork(row.userId, { busyJobId });
        }
      }
      return NextResponse.json({ ok: true, work });
    }

    if (action === "result") {
      const batch = await applyLocalChromeLiveResult(row.userId, String(body.batchId || ""), String(body.jobId || ""), body.live || {});
      if (!batch) {
        return NextResponse.json({ ok: false, error: "Application not found." }, { status: 404 });
      }
      return NextResponse.json({ ok: true, batch });
    }

    return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  } catch (err: unknown) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as { status?: number }).status) || 500 : 500;
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Chrome helper request failed." },
      { status },
    );
  }
}
