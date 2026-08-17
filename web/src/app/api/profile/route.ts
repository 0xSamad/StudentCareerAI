import { NextResponse } from "next/server";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { studentCareerRoot } from "@/lib/student-career-ai";
import { emptyProfileShape, requireUserSession, withPreferredAiMatching } from "@/lib/user-session";
import { hasProfileContent, stripProfileSecrets } from "../../../../../lib/saas/database/merge-profile.mjs";
import { persistGeneratedAtsCv } from "@/lib/apply/ats-cv-from-profile.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function shapeProfile(stored: Record<string, unknown> | null | undefined) {
  const defaults = emptyProfileShape();
  const safe = stored ? stripProfileSecrets(stored) : stored;
  const profile = safe
    ? {
        identity: (safe.identity as typeof defaults.identity) || defaults.identity,
        education: Array.isArray(safe.education) ? safe.education : [],
        skills: (safe.skills as typeof defaults.skills) || defaults.skills,
        experience: (safe.experience as typeof defaults.experience) || defaults.experience,
        projects: Array.isArray(safe.projects) ? safe.projects : [],
        certifications: Array.isArray(safe.certifications) ? safe.certifications : [],
        achievements: Array.isArray(safe.achievements) ? safe.achievements : [],
        languages: Array.isArray(safe.languages) ? safe.languages : [],
        preferences: (safe.preferences as typeof defaults.preferences) || defaults.preferences,
        matching: withPreferredAiMatching(safe.matching as Record<string, unknown> | undefined) as typeof defaults.matching,
        cvOriginal: publicCvOriginal(safe),
      }
    : defaults;

  const cvText = typeof stored?.cvText === "string" ? stored.cvText : "";
  const credentials = (safe as { credentials?: { githubTokenSet?: boolean } } | null)?.credentials || {
    githubTokenSet: false,
  };
  return { profile, cvText, empty: !hasProfileContent(profile.identity?.name), credentials };
}

function publicCvOriginal(stored: Record<string, unknown> | null | undefined) {
  const meta = stored?.cvOriginal as { filename?: string; uploadedAt?: string; mimeType?: string; storageKey?: string } | undefined;
  if (!meta || typeof meta !== "object") return null;
  if (!meta.storageKey && !meta.filename) return null;
  return {
    filename: meta.filename || "cv",
    uploadedAt: meta.uploadedAt || null,
    mimeType: meta.mimeType || "",
  };
}

function usesPostgres(container: { postgresClient?: { isMock?: boolean } }) {
  return Boolean(container.postgresClient && !container.postgresClient.isMock);
}

export async function GET(req: Request) {
  try {
    const { userId, tenantId, container } = await requireUserSession(req);
    const stored = await container.profileRepository.getByUserId(userId, tenantId);
    const { profile, cvText, empty, credentials } = shapeProfile(stored);
    let accountEmail = "";
    let accountName = "";
    try {
      const user = await container.authService?.getUserForAuth?.({ userId, tenantId });
      accountEmail = user?.email || "";
      accountName = user?.name || "";
    } catch {
      /* session user is optional for display defaults */
    }
    if (!hasProfileContent(profile.identity.email) && accountEmail) {
      profile.identity = { ...profile.identity, email: accountEmail };
    }
    if (!hasProfileContent(profile.identity.name) && accountName) {
      profile.identity = { ...profile.identity, name: accountName };
    }

    return NextResponse.json({
      ok: true,
      profile,
      cvText,
      empty,
      credentials,
      persisted: !!stored,
      source: stored ? "database" : "empty",
      cvOriginal: publicCvOriginal(stored),
    });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ ok: false, error: err.message || "Failed to load profile" }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const { userId, tenantId, container } = await requireUserSession(req);
    const body = await req.json();
    const { profile, cvText } = body;

    if (!profile || typeof profile !== "object") {
      return NextResponse.json({ ok: false, error: "profile is required" }, { status: 400 });
    }

    const incoming: Record<string, unknown> = { ...profile };
    const token = typeof body.githubToken === "string" ? body.githubToken.trim() : "";
    if (token) incoming.secrets = { githubToken: token };

    if (!usesPostgres(container)) {
      return NextResponse.json(
        { ok: false, error: "Database is not connected. Profile was not saved. Start Postgres and try again." },
        { status: 503 }
      );
    }

    const existing = await container.profileRepository.getByUserId(userId, tenantId);
    const hasOriginal = Boolean(
      (existing as { cvOriginal?: { storageKey?: string } } | null)?.cvOriginal?.storageKey
    );
    let nextCv = typeof cvText === "string" ? cvText : undefined;
    if (!hasOriginal && !hasProfileContent(nextCv) && hasProfileContent((incoming as { identity?: { name?: string } }).identity?.name)) {
      try {
        let fetchGitHubEvidence = null;
        try {
          const ghUrl = pathToFileURL(path.join(studentCareerRoot(), "lib", "saas", "knowledge", "github-enricher.mjs")).href;
          const ghMod = await import(/* webpackIgnore: true */ ghUrl);
          fetchGitHubEvidence = ghMod.fetchGitHubEvidence;
        } catch {
          fetchGitHubEvidence = null;
        }
        const githubToken =
          token ||
          String((existing as { secrets?: { githubToken?: string } } | null)?.secrets?.githubToken || "");
        const generated = await persistGeneratedAtsCv({
          profile: incoming,
          storage: container.storageService,
          context: { userId, tenantId },
          root: studentCareerRoot(),
          fetchGitHubEvidence,
          githubToken,
        });
        if (generated?.text) nextCv = generated.text;
      } catch {
        /* keep empty cvText; apply path can still generate later */
      }
    }

    const saved = await container.profileRepository.upsertProfile(userId, tenantId, {
      ...incoming,
      cvText: nextCv,
    });

    if (container.candidateKnowledgeService) {
      await container.candidateKnowledgeService
        .seedFromProfile(profile, typeof nextCv === "string" ? nextCv : saved?.cvText || "", {
          userId,
          tenantId,
        })
        .catch(() => null);
    }
    if (container.candidateIntelligenceService) {
      await container.candidateIntelligenceService
        .syncFromTrustedProfile(profile, { userId, tenantId })
        .catch(() => null);
    }

    return NextResponse.json({
      ok: true,
      message: hasOriginal
        ? "Profile saved. Your original uploaded CV was not changed."
        : nextCv && !hasProfileContent(typeof cvText === "string" ? cvText : "")
          ? "Profile saved. An ATS CV was generated from your profile, GitHub, and LinkedIn facts."
          : "Profile & CV saved to your account.",
      savedAt: saved?.updatedAt || new Date().toISOString(),
      accountSaved: true,
      source: usesPostgres(container) ? "database" : "memory",
      cvText: saved?.cvText || nextCv || "",
      cvOriginal: publicCvOriginal(saved),
    });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ ok: false, error: err.message || "Failed to save profile" }, { status });
  }
}
