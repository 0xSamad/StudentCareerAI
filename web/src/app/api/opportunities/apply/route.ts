import { NextResponse } from "next/server";
import path from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { studentCareerRoot } from "@/lib/student-career-ai";
import { emptyProfileShape, requireUserSession, withPreferredAiMatching } from "@/lib/user-session";
import { runCareerOpsLiveApply } from "@/lib/apply/live-from-profile";
import { guessListingFromUrl, listingUrlFromApplyUrl, normalizeApplyUrl } from "@/lib/apply/url-listing.mjs";
import { extractExternalJob, logUrlApply } from "@/lib/apply/extract-external-job.mjs";
import { tailorUrlApplyDocuments } from "@/lib/apply/url-apply-tailor.mjs";
import { loadOriginalCv } from "@/lib/apply/user-cv-store.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function loadQueue() {
  const root = studentCareerRoot();
  const moduleUrl = pathToFileURL(path.join(root, "lib", "saas", "application-queue.mjs")).href;
  return import(/* webpackIgnore: true */ moduleUrl);
}

function engineCheckoutRoot() {
  const candidates = [studentCareerRoot(), process.cwd(), path.resolve(process.cwd(), "..")];
  for (const root of candidates) {
    if (root && existsSync(path.join(root, "lib", "cv-tailor.mjs"))) return root;
  }
  return studentCareerRoot();
}

async function loadUrlApplyEngines() {
  const root = engineCheckoutRoot();
  const tailorUrl = pathToFileURL(path.join(root, "lib", "cv-tailor.mjs")).href;
  const letterUrl = pathToFileURL(path.join(root, "lib", "application-generator.mjs")).href;
  const providerUrl = pathToFileURL(path.join(root, "lib", "ai-provider.mjs")).href;
  const [{ tailorCV }, { generateCoverLetter }, { callAI }] = await Promise.all([
    import(/* webpackIgnore: true */ tailorUrl),
    import(/* webpackIgnore: true */ letterUrl),
    import(/* webpackIgnore: true */ providerUrl),
  ]);
  return { tailorCV, generateCoverLetter, callAI };
}

async function jdTextFromListingPage(applyUrl: string) {
  const listing = listingUrlFromApplyUrl(applyUrl);
  if (!listing) return "";
  try {
    const res = await fetch(listing, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 StudentCareer-apply" },
    });
    if (!res.ok) return "";
    return (await res.text()).slice(0, 80000);
  } catch {
    return "";
  }
}

function shapeProfile(stored: Record<string, unknown> | null | undefined) {
  const defaults = emptyProfileShape();
  if (!stored) return defaults;
  return {
    identity: (stored.identity as typeof defaults.identity) || defaults.identity,
    education: Array.isArray(stored.education) ? stored.education : [],
    skills: (stored.skills as typeof defaults.skills) || defaults.skills,
    experience: (stored.experience as typeof defaults.experience) || defaults.experience,
    projects: Array.isArray(stored.projects) ? stored.projects : [],
    certifications: Array.isArray(stored.certifications) ? stored.certifications : [],
    achievements: Array.isArray(stored.achievements) ? stored.achievements : [],
    languages: Array.isArray(stored.languages) ? stored.languages : [],
    preferences: (stored.preferences as typeof defaults.preferences) || defaults.preferences,
    matching: withPreferredAiMatching(stored.matching as Record<string, unknown> | undefined) as typeof defaults.matching,
    cvOriginal: stored.cvOriginal || null,
  };
}

/**
 * Apply one listing with the career-ops headed Chrome engine.
 * Enqueue is best-effort. Discovery is not run. Never submits.
 */
export async function POST(req: Request) {
  try {
    const { userId, tenantId, container, authContext } = await requireUserSession(req);
    const body = await req.json().catch(() => ({}));
    const opportunityId = String(body.opportunityId || body.opportunity?.id || "").trim();
    const isUrlApply = !opportunityId;
    let url = normalizeApplyUrl(body.url || body.source_url || body.sourceUrl || "");
    let company = String(body.company || body.opportunity?.company || "").trim();
    let role = String(body.role || body.opportunity?.role || "").trim();
    let jdText = String(body.jdText || body.description || "").trim();
    const pastedJd = jdText;

    if (!opportunityId && !url) {
      return NextResponse.json({ ok: false, error: "opportunityId or url is required" }, { status: 400 });
    }

    const stored = await container.profileRepository.getByUserId(userId, tenantId);
    const profile = shapeProfile(stored);
    const cvText = typeof stored?.cvText === "string" ? stored.cvText : "";
    const original = await loadOriginalCv({
      storage: container.storageService,
      record: stored?.cvOriginal,
      context: { userId, tenantId },
    });
    let fetchGitHubEvidence = null;
    try {
      const ghUrl = pathToFileURL(path.join(studentCareerRoot(), "lib", "saas", "knowledge", "github-enricher.mjs")).href;
      const ghMod = await import(/* webpackIgnore: true */ ghUrl);
      fetchGitHubEvidence = ghMod.fetchGitHubEvidence;
    } catch {
      fetchGitHubEvidence = null;
    }
    const githubToken = typeof stored?.secrets === "object" && stored.secrets ? String((stored.secrets as { githubToken?: string }).githubToken || "") : "";

    if (!profile.identity?.name) {
      return NextResponse.json(
        { ok: false, error: "Complete your profile (name) before applying." },
        { status: 400 }
      );
    }

    if (opportunityId && container.opportunityStore?.getById) {
      const listing = await container.opportunityStore.getById(opportunityId).catch(() => null);
      url = url || listing?.applicationUrl || listing?.url || listing?.sourceUrl || "";
      company = company || listing?.company || listing?.company_name || "";
      role = role || listing?.role || listing?.title || "";
      const raw = listing?.rawData || listing?.raw_data || {};
      jdText =
        jdText ||
        listing?.description ||
        listing?.content ||
        raw.description ||
        raw.content ||
        "";
    }

    url = normalizeApplyUrl(url);
    if (!isUrlApply && !jdText) jdText = await jdTextFromListingPage(url);

    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json(
        { ok: false, error: "Paste a job or application URL (https://…) so Chrome can open it." },
        { status: 400 }
      );
    }

    const listingUrlMod = await import(
      /* webpackIgnore: true */ pathToFileURL(path.join(studentCareerRoot(), "lib", "saas", "listing-url.mjs")).href
    );
    let applyUrl = url;
    if (listingUrlMod.isUnresolvedAggregatorUrl(applyUrl)) {
      applyUrl = await listingUrlMod.resolveListingUrl(applyUrl);
    }
    if (!listingUrlMod.isCredibleListingUrl(applyUrl)) {
      return NextResponse.json(
        {
          ok: false,
          error: "This listing does not have a real job URL (it may be an ad or unrelated site). Open a Greenhouse, Lever, company careers, Rozee, or Indeed job page instead.",
        },
        { status: 400 }
      );
    }
    url = applyUrl;

    let urlJob = null;
    if (isUrlApply) {
      logUrlApply("URL received");
      const extracted = await extractExternalJob({
        url,
        pastedDescription: pastedJd,
        companyHint: company,
        roleHint: role,
      });
      urlJob = extracted.job;
      company = extracted.job.company || company;
      role = extracted.job.title || role;
      jdText = extracted.job.description || pastedJd;
      if (!extracted.hasDescription) {
        return NextResponse.json(
          {
            ok: false,
            needsJobDescription: true,
            error:
              extracted.warning ||
              "Unable to extract the full job description from this page. Paste the job description to generate a tailored CV and cover letter.",
            company,
            role,
            url,
          },
          { status: 422 }
        );
      }
    }

    if (!company || !role) {
      const guessed = guessListingFromUrl(url);
      company = company || guessed.company;
      role = role || guessed.role;
    }

    let queuedId = opportunityId;
    if (!queuedId && container.opportunityStore?.upsert) {
      try {
        const result = await container.opportunityStore.upsert({
          url,
          sourceUrl: url,
          applicationUrl: url,
          company: company || "Unknown company",
          title: role || "Untitled role",
          description: jdText || null,
          source: "url-apply",
          source_id: url.slice(0, 250),
        });
        queuedId = String(result?.opportunity?.id || "").trim();
      } catch {
        /* persist is best-effort — still open Chrome */
      }
    }

    if (queuedId) {
      try {
        const { enqueueOpportunities } = await loadQueue();
        await enqueueOpportunities({
          container,
          authContext,
          opportunityIds: [queuedId],
          count: 1,
        });
      } catch {
        /* queue is secondary — still open the form */
      }
    }

    let prebuiltDocuments = null;
    if (isUrlApply && urlJob) {
      const engines = await loadUrlApplyEngines();
      const callAIFn = container.aiWorkerService?.complete
        ? async (_resolved: unknown, sys: string, usr: string) =>
            container.aiWorkerService.complete({ prompt: usr, system: sys, schema: true }, authContext)
        : (resolved: unknown, sys: string, usr: string) => engines.callAI(resolved, sys, usr);
      prebuiltDocuments = await tailorUrlApplyDocuments({
        profile,
        cvText,
        opportunity: {
          ...urlJob,
          company: company || urlJob.company,
          title: role || urlJob.title,
          role: role || urlJob.role,
          description: jdText || urlJob.description,
        },
        matchingConfig: profile.matching,
        callAIFn,
        root: studentCareerRoot(),
        loaders: {
          tailorCV: engines.tailorCV,
          generateCoverLetter: engines.generateCoverLetter,
        },
        originalBuffer: original?.buffer || null,
        originalFilename: original?.filename || "",
        originalMime: original?.mimeType || "",
        fetchGitHubEvidence,
        githubToken,
      });
      if (!prebuiltDocuments?.cvHtml && !prebuiltDocuments?.coverLetter) {
        prebuiltDocuments = null;
      }
    }

    const live = await runCareerOpsLiveApply({
      url,
      profile,
      company,
      cvText,
      role,
      jdText,
      prebuiltDocuments,
      originalBuffer: original?.buffer || null,
      originalFilename: original?.filename || "",
      originalMime: original?.mimeType || "",
      fetchGitHubEvidence,
      githubToken,
      useFormAgent: isUrlApply,
    });
    if (isUrlApply) logUrlApply("Application opened", { company, role });

    if (queuedId && container.applicationRepository?.getByOpportunityId) {
      try {
        const app = await container.applicationRepository.getByOpportunityId(
          queuedId,
          userId,
          tenantId
        );
        if (app?.id) {
          await container.applicationRepository.updateApplicationState(
            app.id,
            live.filledCount > 0 ? "REQUIRES_USER_INPUT" : "READY",
            { reason: live.message, last_message: live.message, pause_reason: "REVIEW" },
            authContext
          );
        }
      } catch {
        /* live apply already happened */
      }
    }

    return NextResponse.json({
      ok: true,
      submitted: false,
      dry_run: true,
      company,
      role,
      url,
      opportunityId: queuedId || null,
      ...live,
      message: live.message,
    });
  } catch (err: unknown) {
    console.error("Apply error:", err);
    const raw = err instanceof Error ? err.message : "Failed to open the application form";
    const message = /has been closed|Target closed|browser has been closed|context.*closed/i.test(raw)
      ? "The apply browser was closed. Click Apply again — Chrome will reopen."
      : raw;
    return NextResponse.json(
      {
        ok: false,
        status: "FAILED",
        error: message,
        dry_run: true,
        submitted_at: null,
      },
      { status: 500 }
    );
  }
}
