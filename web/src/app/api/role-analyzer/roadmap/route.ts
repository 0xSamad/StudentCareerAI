import { handleRoadmapPost } from "@/lib/role-analyzer-roadmap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(req: Request) {
  try {
    return await handleRoadmapPost(req, { requireCustomDuration: false });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status || 500;
    const message = err instanceof Error ? err.message : "Failed to start roadmap";
    return Response.json({ ok: false, error: message }, { status });
  }
}
